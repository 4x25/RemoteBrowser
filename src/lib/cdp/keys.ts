/**
 * Maps the `Control+Shift+p`-style combos produced by the shared interaction
 * keyboard normalizer to CDP `Input.dispatchKeyEvent` sequences.
 */

export interface CdpKeyEvent {
  type: 'keyDown' | 'keyUp'
  key: string
  code?: string
  windowsVirtualKeyCode: number
  modifiers: number
  text?: string
}

interface KeyBase {
  key: string
  code?: string
  windowsVirtualKeyCode: number
  text?: string
}

interface ModifierDescriptor {
  name: string
  bit: number
  key: string
  code: string
  windowsVirtualKeyCode: number
}

/** Modifier bits defined by the CDP Input domain. */
const MODIFIER_BITS: Readonly<Record<string, number>> = {
  Alt: 1,
  Control: 2,
  Meta: 4,
  Shift: 8,
}

const MODIFIERS: readonly ModifierDescriptor[] = [
  { name: 'Control', bit: 2, key: 'Control', code: 'ControlLeft', windowsVirtualKeyCode: 17 },
  { name: 'Alt', bit: 1, key: 'Alt', code: 'AltLeft', windowsVirtualKeyCode: 18 },
  { name: 'Shift', bit: 8, key: 'Shift', code: 'ShiftLeft', windowsVirtualKeyCode: 16 },
  { name: 'Meta', bit: 4, key: 'Meta', code: 'MetaLeft', windowsVirtualKeyCode: 91 },
]

const NAMED_KEYS: Record<string, KeyBase> = {
  Enter: { key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, text: '\r' },
  Tab: { key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 },
  Escape: { key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 },
  Space: { key: ' ', code: 'Space', windowsVirtualKeyCode: 32, text: ' ' },
  Backspace: { key: 'Backspace', code: 'Backspace', windowsVirtualKeyCode: 8 },
  Delete: { key: 'Delete', code: 'Delete', windowsVirtualKeyCode: 46 },
  Insert: { key: 'Insert', code: 'Insert', windowsVirtualKeyCode: 45 },
  ArrowUp: { key: 'ArrowUp', code: 'ArrowUp', windowsVirtualKeyCode: 38 },
  ArrowDown: { key: 'ArrowDown', code: 'ArrowDown', windowsVirtualKeyCode: 40 },
  ArrowLeft: { key: 'ArrowLeft', code: 'ArrowLeft', windowsVirtualKeyCode: 37 },
  ArrowRight: { key: 'ArrowRight', code: 'ArrowRight', windowsVirtualKeyCode: 39 },
  Home: { key: 'Home', code: 'Home', windowsVirtualKeyCode: 36 },
  End: { key: 'End', code: 'End', windowsVirtualKeyCode: 35 },
  PageUp: { key: 'PageUp', code: 'PageUp', windowsVirtualKeyCode: 33 },
  PageDown: { key: 'PageDown', code: 'PageDown', windowsVirtualKeyCode: 34 },
  CapsLock: { key: 'CapsLock', code: 'CapsLock', windowsVirtualKeyCode: 20 },
  NumLock: { key: 'NumLock', code: 'NumLock', windowsVirtualKeyCode: 144 },
  ScrollLock: { key: 'ScrollLock', code: 'ScrollLock', windowsVirtualKeyCode: 145 },
  Pause: { key: 'Pause', code: 'Pause', windowsVirtualKeyCode: 19 },
  PrintScreen: { key: 'PrintScreen', code: 'PrintScreen', windowsVirtualKeyCode: 44 },
  ContextMenu: { key: 'ContextMenu', code: 'ContextMenu', windowsVirtualKeyCode: 93 },
}

for (let index = 1; index <= 24; index += 1) {
  NAMED_KEYS[`F${index}`] = {
    key: `F${index}`,
    code: `F${index}`,
    windowsVirtualKeyCode: 111 + index,
  }
}

const SYMBOL_CODES: Readonly<Record<string, string>> = {
  '-': 'Minus',
  '=': 'Equal',
  '[': 'BracketLeft',
  ']': 'BracketRight',
  '\\': 'Backslash',
  ';': 'Semicolon',
  "'": 'Quote',
  ',': 'Comma',
  '.': 'Period',
  '/': 'Slash',
  '`': 'Backquote',
}

const SHORTCUT_MODIFIER_BITS = 1 | 2 | 4
const SHIFT_BIT = 8

function singleCharacterBase(character: string, modifiers: number): KeyBase | null {
  const shifted = (modifiers & SHIFT_BIT) !== 0
  const shortcut = (modifiers & SHORTCUT_MODIFIER_BITS) !== 0

  if (/^[a-z]$/.test(character)) {
    const upper = character.toUpperCase()
    return {
      key: shifted ? upper : character,
      code: `Key${upper}`,
      windowsVirtualKeyCode: upper.charCodeAt(0),
      ...(shifted && !shortcut ? { text: upper } : {}),
    }
  }

  if (/^[0-9]$/.test(character)) {
    return {
      key: character,
      code: `Digit${character}`,
      windowsVirtualKeyCode: character.charCodeAt(0),
      ...(!shortcut ? { text: character } : {}),
    }
  }

  if (character.length === 1) {
    const code = SYMBOL_CODES[character]
    return {
      key: character,
      ...(code === undefined ? {} : { code }),
      windowsVirtualKeyCode: character.toUpperCase().charCodeAt(0),
      ...(!shortcut ? { text: character } : {}),
    }
  }

  return null
}

/**
 * Converts a combo such as `Control+Shift+p` or a single special key such as
 * `Enter` into the full key down/up sequence, including modifier key events.
 * Returns null for unknown or malformed combos.
 */
export function comboToKeySequence(combo: string): CdpKeyEvent[] | null {
  if (typeof combo !== 'string' || combo.length === 0 || combo.trim() !== combo) {
    return null
  }

  const parts = combo.split('+')
  const keyName = parts.pop()
  if (keyName === undefined || keyName.length === 0) return null

  let modifiers = 0
  for (const part of parts) {
    const bit = MODIFIER_BITS[part]
    if (bit === undefined) return null
    modifiers |= bit
  }

  const base = NAMED_KEYS[keyName]
    ?? (/^[a-z0-9]$/.test(keyName) || keyName.length === 1
      ? singleCharacterBase(keyName, modifiers)
      : null)
  if (!base) return null

  const shortcut = (modifiers & SHORTCUT_MODIFIER_BITS) !== 0
  const text = shortcut ? undefined : base.text
  const sequence: CdpKeyEvent[] = []
  let active = 0

  for (const modifier of MODIFIERS) {
    if ((modifiers & modifier.bit) === 0) continue
    sequence.push({
      type: 'keyDown',
      key: modifier.key,
      code: modifier.code,
      windowsVirtualKeyCode: modifier.windowsVirtualKeyCode,
      modifiers: active,
    })
    active |= modifier.bit
  }

  sequence.push({
    type: 'keyDown',
    key: base.key,
    ...(base.code === undefined ? {} : { code: base.code }),
    windowsVirtualKeyCode: base.windowsVirtualKeyCode,
    modifiers,
    ...(text === undefined ? {} : { text }),
  })

  sequence.push({
    type: 'keyUp',
    key: base.key,
    ...(base.code === undefined ? {} : { code: base.code }),
    windowsVirtualKeyCode: base.windowsVirtualKeyCode,
    modifiers,
  })

  for (const modifier of [...MODIFIERS].reverse()) {
    if ((modifiers & modifier.bit) === 0) continue
    active &= ~modifier.bit
    sequence.push({
      type: 'keyUp',
      key: modifier.key,
      code: modifier.code,
      windowsVirtualKeyCode: modifier.windowsVirtualKeyCode,
      modifiers: active,
    })
  }

  return sequence
}
