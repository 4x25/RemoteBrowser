import { describe, expect, it, vi } from 'vitest'

import {
  collectClientEnvironment,
  environmentKey,
  formatAcceptLanguage,
  type ClientEnvironment,
} from './clientEnvironment'

describe('collectClientEnvironment', () => {
  it('collects the minimal navigator values, language header, and theme', async () => {
    const environment = await collectClientEnvironment({
      navigator: {
        userAgent: 'ExampleBrowser/1.0',
        platform: 'ExampleOS',
        language: 'en-us',
        languages: ['zh-cn', 'en-US', 'ZH-CN', '', 'invalid_tag'],
      },
      matchMedia: (query) => ({
        matches: query === '(prefers-color-scheme: dark)',
      }),
    })

    expect(environment).toEqual({
      userAgent: 'ExampleBrowser/1.0',
      platform: 'ExampleOS',
      languages: ['zh-CN', 'en-US'],
      acceptLanguage: 'zh-CN,en-US',
      colorScheme: 'dark',
    })
  })

  it('merges low- and high-entropy UA Client Hints', async () => {
    const getHighEntropyValues = vi.fn(async () => ({
      architecture: 'x86',
      bitness: '64',
      fullVersionList: [
        { brand: 'Chromium', version: '140.0.0.0' },
        { brand: 'Chromium', version: '140.0.0.0' },
        { brand: '', version: '1' },
      ],
      model: '',
      platformVersion: '15.0.0',
      wow64: false,
    }))

    const environment = await collectClientEnvironment({
      navigator: {
        userAgent: 'Mozilla/5.0',
        platform: 'MacIntel',
        language: 'en-US',
        languages: ['en-US'],
        userAgentData: {
          brands: [{ brand: 'Chromium', version: '140' }],
          mobile: false,
          platform: 'macOS',
          getHighEntropyValues,
        },
      },
      matchMedia: () => ({ matches: false }),
    })

    expect(getHighEntropyValues).toHaveBeenCalledWith([
      'architecture',
      'bitness',
      'fullVersionList',
      'model',
      'platformVersion',
      'wow64',
    ])
    expect(environment.userAgentMetadata).toEqual({
      brands: [{ brand: 'Chromium', version: '140' }],
      fullVersionList: [{ brand: 'Chromium', version: '140.0.0.0' }],
      mobile: false,
      platform: 'macOS',
      platformVersion: '15.0.0',
      architecture: 'x86',
      bitness: '64',
      model: '',
      wow64: false,
    })
  })

  it('falls back to low-entropy hints when high-entropy access rejects', async () => {
    const environment = await collectClientEnvironment({
      navigator: {
        userAgentData: {
          brands: [{ brand: 'Example', version: '1' }],
          fullVersionList: [{ brand: 'Example', version: '1.2.3' }],
          mobile: true,
          platform: 'Android',
          platformVersion: '14',
          architecture: 'arm',
          bitness: '64',
          model: 'Example Phone',
          wow64: true,
          getHighEntropyValues: vi.fn().mockRejectedValue(
            new Error('blocked'),
          ),
        },
      },
      matchMedia: null,
    })

    expect(environment.userAgentMetadata).toEqual({
      brands: [{ brand: 'Example', version: '1' }],
      fullVersionList: [{ brand: 'Example', version: '1.2.3' }],
      mobile: true,
      platform: 'Android',
      platformVersion: '14',
      architecture: 'arm',
      bitness: '64',
      model: 'Example Phone',
      wow64: true,
    })
  })

  it('returns safe defaults when browser APIs are unavailable or throw', async () => {
    const environment = await collectClientEnvironment({
      navigator: null,
      matchMedia: () => {
        throw new Error('unsupported')
      },
    })

    expect(environment).toEqual({
      userAgent: 'Mozilla/5.0 (compatible; RemoteBrowserOS)',
      platform: 'Unknown',
      languages: ['en-US'],
      acceptLanguage: 'en-US',
      colorScheme: 'light',
    })
  })

  it('limits the CDP language preference list to ten values', async () => {
    const languages = [
      'en-US',
      'zh-CN',
      'fr-FR',
      'de-DE',
      'es-ES',
      'ja-JP',
      'ko-KR',
      'pt-BR',
      'it-IT',
      'ru-RU',
      'nl-NL',
      'pl-PL',
    ]

    const environment = await collectClientEnvironment({
      navigator: { languages },
      matchMedia: null,
    })

    expect(environment.languages).toHaveLength(10)
    expect(environment.acceptLanguage).toBe(
      'en-US,zh-CN,fr-FR,de-DE,es-ES,ja-JP,ko-KR,pt-BR,it-IT,ru-RU',
    )
  })
})

describe('formatAcceptLanguage', () => {
  it('leaves HTTP quality weights for Chromium to generate', () => {
    expect(formatAcceptLanguage(['zh-CN', 'en-US', 'en'])).toBe(
      'zh-CN,en-US,en',
    )
  })
})

describe('environmentKey', () => {
  const environment: ClientEnvironment = {
    userAgent: 'ExampleBrowser/1.0',
    platform: 'ExampleOS',
    languages: ['zh-CN', 'en-US'],
    acceptLanguage: 'zh-CN,en-US',
    colorScheme: 'light',
    userAgentMetadata: {
      brands: [{ brand: 'Example', version: '1' }],
      fullVersionList: [{ brand: 'Example', version: '1.0.0' }],
      mobile: false,
      platform: 'ExampleOS',
      platformVersion: '1',
      architecture: 'x86',
      bitness: '64',
      model: '',
      wow64: false,
    },
  }

  it('returns a stable key for equivalent snapshots', () => {
    const clone = structuredClone(environment)

    expect(environmentKey(clone)).toBe(environmentKey(environment))
  })

  it('changes when a transmitted preference changes', () => {
    expect(environmentKey({ ...environment, colorScheme: 'dark' })).not.toBe(
      environmentKey(environment),
    )
  })
})
