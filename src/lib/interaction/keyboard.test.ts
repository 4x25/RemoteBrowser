import { describe, expect, it } from 'vitest'

import {
  normalizeBrowserKey,
  normalizeKeyboardCommand,
  toBrowserOsKeyCombo,
} from './keyboard'

describe('keyboard normalization', () => {
  it('normalizes BrowserOS special key aliases', () => {
    expect(normalizeBrowserKey('Esc')).toBe('Escape')
    expect(normalizeBrowserKey('Left')).toBe('ArrowLeft')
    expect(toBrowserOsKeyCombo({ key: 'Enter' })).toBe('Enter')
  })

  it('builds shortcuts in a stable modifier order', () => {
    expect(
      normalizeKeyboardCommand({
        key: 'P',
        ctrlKey: true,
        altKey: true,
        shiftKey: true,
        metaKey: true,
      }),
    ).toEqual({
      combo: 'Control+Alt+Shift+Meta+p',
      key: 'p',
      modifiers: ['Control', 'Alt', 'Shift', 'Meta'],
    })
  })

  it('supports shifted special keys and function keys', () => {
    expect(toBrowserOsKeyCombo({ key: 'Tab', shiftKey: true })).toBe(
      'Shift+Tab',
    )
    expect(toBrowserOsKeyCombo({ key: 'F5' })).toBe('F5')
  })

  it('leaves ordinary printable and composing input to the text path', () => {
    expect(toBrowserOsKeyCombo({ key: 'a' })).toBeNull()
    expect(toBrowserOsKeyCombo({ key: 'A', shiftKey: true })).toBeNull()
    expect(
      toBrowserOsKeyCombo({ key: 'Enter', isComposing: true }),
    ).toBeNull()
  })

  it('ignores modifier-only and unknown events', () => {
    expect(toBrowserOsKeyCombo({ key: 'Control', ctrlKey: true })).toBeNull()
    expect(toBrowserOsKeyCombo({ key: 'Unidentified' })).toBeNull()
  })

  it('uses code as a fallback for shortcut keys', () => {
    expect(
      toBrowserOsKeyCombo({ key: 'Unidentified', code: 'KeyA', ctrlKey: true }),
    ).toBe('Control+a')
    expect(
      toBrowserOsKeyCombo({ key: 'Unidentified', code: 'KeyA' }),
    ).toBeNull()
  })
})
