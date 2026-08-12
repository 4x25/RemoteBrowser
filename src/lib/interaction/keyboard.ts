export type BrowserModifier = 'Control' | 'Alt' | 'Shift' | 'Meta'

export interface KeyboardEventLike {
  key: string
  code?: string
  ctrlKey?: boolean
  altKey?: boolean
  shiftKey?: boolean
  metaKey?: boolean
  isComposing?: boolean
}

export interface NormalizedKeyboardCommand {
  /** BrowserOS `act` kind=press key value, e.g. `Control+Shift+p`. */
  combo: string
  key: string
  modifiers: BrowserModifier[]
}

const specialKeys: Readonly<Record<string, string>> = {
  Enter: 'Enter',
  Return: 'Enter',
  Tab: 'Tab',
  Escape: 'Escape',
  Esc: 'Escape',
  Backspace: 'Backspace',
  Delete: 'Delete',
  Del: 'Delete',
  Insert: 'Insert',
  ArrowUp: 'ArrowUp',
  Up: 'ArrowUp',
  ArrowDown: 'ArrowDown',
  Down: 'ArrowDown',
  ArrowLeft: 'ArrowLeft',
  Left: 'ArrowLeft',
  ArrowRight: 'ArrowRight',
  Right: 'ArrowRight',
  Home: 'Home',
  End: 'End',
  PageUp: 'PageUp',
  PageDown: 'PageDown',
  CapsLock: 'CapsLock',
  NumLock: 'NumLock',
  ScrollLock: 'ScrollLock',
  Pause: 'Pause',
  PrintScreen: 'PrintScreen',
  ContextMenu: 'ContextMenu',
  ' ': 'Space',
  Spacebar: 'Space',
}

const modifierOnlyKeys = new Set([
  'Control',
  'Ctrl',
  'Alt',
  'AltGraph',
  'Shift',
  'Meta',
  'OS',
])

const ignoredKeys = new Set(['', 'Dead', 'Unidentified', 'Process', 'Compose'])

const codeFallback = (code: string | undefined): string | null => {
  if (!code) return null
  if (/^Key[A-Z]$/.test(code)) return code.slice(-1).toLowerCase()
  if (/^Digit\d$/.test(code)) return code.slice(-1)
  return specialKeys[code] ?? (/^F(?:[1-9]|1\d|2[0-4])$/.test(code) ? code : null)
}

export function normalizeBrowserKey(
  key: string,
  code?: string,
): string | null {
  if (ignoredKeys.has(key) || modifierOnlyKeys.has(key)) {
    return codeFallback(code)
  }
  const special = specialKeys[key]
  if (special) return special
  if (/^F(?:[1-9]|1\d|2[0-4])$/.test(key)) return key
  if (key.length === 1) return /[A-Z]/.test(key) ? key.toLowerCase() : key
  return codeFallback(code)
}

/**
 * Converts keydown-like data to a BrowserOS press command.
 * Printable input without Control/Alt/Meta returns null and should be sent by
 * the text/composition input path instead, preventing duplicated characters.
 */
export function normalizeKeyboardCommand(
  event: KeyboardEventLike,
): NormalizedKeyboardCommand | null {
  if (event.isComposing || modifierOnlyKeys.has(event.key)) return null

  const key = normalizeBrowserKey(event.key, event.code)
  if (!key) return null

  const hasShortcutModifier = Boolean(
    event.ctrlKey || event.altKey || event.metaKey,
  )
  const printable = key.length === 1
  if (printable && !hasShortcutModifier) return null

  const modifiers: BrowserModifier[] = []
  if (event.ctrlKey) modifiers.push('Control')
  if (event.altKey) modifiers.push('Alt')
  if (event.shiftKey) modifiers.push('Shift')
  if (event.metaKey) modifiers.push('Meta')

  return {
    combo: [...modifiers, key].join('+'),
    key,
    modifiers,
  }
}

export function toBrowserOsKeyCombo(event: KeyboardEventLike): string | null {
  return normalizeKeyboardCommand(event)?.combo ?? null
}
