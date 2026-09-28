import { describe, expect, it } from 'vitest'
import { comboToKeySequence, type CdpKeyEvent } from './keys'

function simplify(sequence: CdpKeyEvent[] | null) {
  return sequence?.map((event) => ({
    type: event.type,
    key: event.key,
    code: event.code,
    vk: event.windowsVirtualKeyCode,
    modifiers: event.modifiers,
    text: event.text,
  }))
}

describe('comboToKeySequence', () => {
  it('maps special keys with text where CDP expects it', () => {
    expect(simplify(comboToKeySequence('Enter'))).toEqual([
      { type: 'keyDown', key: 'Enter', code: 'Enter', vk: 13, modifiers: 0, text: '\r' },
      { type: 'keyUp', key: 'Enter', code: 'Enter', vk: 13, modifiers: 0, text: undefined },
    ])
    expect(simplify(comboToKeySequence('Space'))?.at(0)).toEqual({
      type: 'keyDown',
      key: ' ',
      code: 'Space',
      vk: 32,
      modifiers: 0,
      text: ' ',
    })
    expect(simplify(comboToKeySequence('F5'))?.at(0)).toEqual({
      type: 'keyDown',
      key: 'F5',
      code: 'F5',
      vk: 116,
      modifiers: 0,
      text: undefined,
    })
  })

  it('wraps shortcut combos with modifier key events', () => {
    const sequence = comboToKeySequence('Control+Shift+p')
    expect(sequence).not.toBeNull()
    expect(simplify(sequence)).toEqual([
      { type: 'keyDown', key: 'Control', code: 'ControlLeft', vk: 17, modifiers: 0, text: undefined },
      { type: 'keyDown', key: 'Shift', code: 'ShiftLeft', vk: 16, modifiers: 2, text: undefined },
      { type: 'keyDown', key: 'P', code: 'KeyP', vk: 80, modifiers: 10, text: undefined },
      { type: 'keyUp', key: 'P', code: 'KeyP', vk: 80, modifiers: 10, text: undefined },
      { type: 'keyUp', key: 'Shift', code: 'ShiftLeft', vk: 16, modifiers: 2, text: undefined },
      { type: 'keyUp', key: 'Control', code: 'ControlLeft', vk: 17, modifiers: 0, text: undefined },
    ])
  })

  it('keeps shortcut letters lowercase without Shift and includes symbol codes', () => {
    expect(simplify(comboToKeySequence('Meta+c'))?.at(1)).toEqual({
      type: 'keyDown',
      key: 'c',
      code: 'KeyC',
      vk: 67,
      modifiers: 4,
      text: undefined,
    })
    expect(simplify(comboToKeySequence('Control+ArrowLeft'))?.at(1)).toEqual({
      type: 'keyDown',
      key: 'ArrowLeft',
      code: 'ArrowLeft',
      vk: 37,
      modifiers: 2,
      text: undefined,
    })
    expect(simplify(comboToKeySequence('Control+,'))?.at(1)).toEqual({
      type: 'keyDown',
      key: ',',
      code: 'Comma',
      vk: 44,
      modifiers: 2,
      text: undefined,
    })
  })

  it('rejects malformed combos', () => {
    expect(comboToKeySequence('')).toBeNull()
    expect(comboToKeySequence('Control+')).toBeNull()
    expect(comboToKeySequence('Banana+p')).toBeNull()
    expect(comboToKeySequence(' Unknown')).toBeNull()
  })
})
