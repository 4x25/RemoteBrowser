export type ClientColorScheme = 'light' | 'dark'

export interface UserAgentBrandVersion {
  brand: string
  version: string
}

export interface ClientUserAgentMetadata {
  brands: UserAgentBrandVersion[]
  fullVersionList: UserAgentBrandVersion[]
  mobile: boolean
  platform: string
  platformVersion: string
  architecture: string
  bitness: string
  model: string
  wow64: boolean
}

export interface ClientEnvironment {
  userAgent: string
  platform: string
  languages: string[]
  acceptLanguage: string
  colorScheme: ClientColorScheme
  userAgentMetadata?: ClientUserAgentMetadata
}

interface UserAgentDataLike {
  readonly brands?: unknown
  readonly fullVersionList?: unknown
  readonly mobile?: unknown
  readonly platform?: unknown
  readonly platformVersion?: unknown
  readonly architecture?: unknown
  readonly bitness?: unknown
  readonly model?: unknown
  readonly wow64?: unknown
  readonly getHighEntropyValues?: (
    hints: string[],
  ) => Promise<unknown>
}

export interface ClientNavigatorLike {
  readonly userAgent?: unknown
  readonly platform?: unknown
  readonly language?: unknown
  readonly languages?: unknown
  readonly userAgentData?: UserAgentDataLike
}

export interface ClientEnvironmentSource {
  /** Pass null to explicitly collect without a navigator (for SSR/tests). */
  navigator?: ClientNavigatorLike | null
  /** Pass null to explicitly disable media-query detection. */
  matchMedia?: ((query: string) => { readonly matches: boolean }) | null
}

const HIGH_ENTROPY_HINTS = [
  'architecture',
  'bitness',
  'fullVersionList',
  'model',
  'platformVersion',
  'wow64',
]

const MAX_LANGUAGES = 10
const DEFAULT_LANGUAGE = 'en-US'

function getDefaultNavigator(): ClientNavigatorLike | null {
  return typeof navigator === 'undefined'
    ? null
    : (navigator as ClientNavigatorLike)
}

function getDefaultMatchMedia(): ClientEnvironmentSource['matchMedia'] {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return null
  }

  return window.matchMedia.bind(window)
}

function readProperty(source: unknown, property: string): unknown {
  if ((typeof source !== 'object' && typeof source !== 'function') || source === null) {
    return undefined
  }

  try {
    return Reflect.get(source, property)
  } catch {
    return undefined
  }
}

function readString(source: unknown, property: string): string {
  const value = readProperty(source, property)
  return typeof value === 'string' ? value : ''
}

function canonicalizeLanguage(language: unknown): string | null {
  if (typeof language !== 'string') {
    return null
  }

  const trimmedLanguage = language.trim()
  if (!trimmedLanguage) {
    return null
  }

  try {
    return Intl.getCanonicalLocales(trimmedLanguage)[0] ?? null
  } catch {
    return null
  }
}

function collectLanguages(browserNavigator: ClientNavigatorLike | null): string[] {
  const languageValues = readProperty(browserNavigator, 'languages')
  const candidates = Array.isArray(languageValues)
    ? languageValues
    : []
  const fallbackLanguage = readProperty(browserNavigator, 'language')
  const seen = new Set<string>()
  const languages: string[] = []

  for (const candidate of [...candidates, fallbackLanguage]) {
    const language = canonicalizeLanguage(candidate)
    const key = language?.toLocaleLowerCase('en-US')

    if (!language || !key || seen.has(key)) {
      continue
    }

    seen.add(key)
    languages.push(language)

    if (languages.length === MAX_LANGUAGES) {
      break
    }
  }

  return languages.length > 0 ? languages : [DEFAULT_LANGUAGE]
}

export function formatAcceptLanguage(languages: readonly string[]): string {
  // CDP expects the browser preference list, not a preformatted HTTP header.
  // Chromium adds its own quality weights when it creates Accept-Language;
  // including q-values here would duplicate them and corrupt navigator.languages.
  return languages.slice(0, MAX_LANGUAGES).join(',')
}

function collectBrandVersions(value: unknown): UserAgentBrandVersion[] {
  if (!Array.isArray(value)) {
    return []
  }

  const brandVersions: UserAgentBrandVersion[] = []
  const seen = new Set<string>()

  for (const item of value) {
    const brand = readString(item, 'brand').trim()
    const version = readString(item, 'version').trim()
    const key = `${brand}\u0000${version}`

    if (!brand || !version || seen.has(key)) {
      continue
    }

    seen.add(key)
    brandVersions.push({ brand, version })
  }

  return brandVersions
}

async function collectUserAgentMetadata(
  browserNavigator: ClientNavigatorLike | null,
): Promise<ClientUserAgentMetadata | undefined> {
  const userAgentData = readProperty(browserNavigator, 'userAgentData')

  if ((typeof userAgentData !== 'object' && typeof userAgentData !== 'function') || userAgentData === null) {
    return undefined
  }

  let highEntropyValues: unknown
  const getHighEntropyValues = readProperty(
    userAgentData,
    'getHighEntropyValues',
  )

  if (typeof getHighEntropyValues === 'function') {
    try {
      highEntropyValues = await Reflect.apply(
        getHighEntropyValues,
        userAgentData,
        [[...HIGH_ENTROPY_HINTS]],
      )
    } catch {
      // Low-entropy values are still useful when the API is blocked or rejects.
    }
  }

  const readHint = (property: string): unknown => (
    readProperty(highEntropyValues, property)
    ?? readProperty(userAgentData, property)
  )

  return {
    brands: collectBrandVersions(readHint('brands')),
    fullVersionList: collectBrandVersions(readHint('fullVersionList')),
    mobile: readHint('mobile') === true,
    platform: typeof readHint('platform') === 'string'
      ? String(readHint('platform'))
      : '',
    platformVersion: typeof readHint('platformVersion') === 'string'
      ? String(readHint('platformVersion'))
      : '',
    architecture: typeof readHint('architecture') === 'string'
      ? String(readHint('architecture'))
      : '',
    bitness: typeof readHint('bitness') === 'string'
      ? String(readHint('bitness'))
      : '',
    model: typeof readHint('model') === 'string'
      ? String(readHint('model'))
      : '',
    wow64: readHint('wow64') === true,
  }
}

function collectColorScheme(
  matchMedia: ClientEnvironmentSource['matchMedia'],
): ClientColorScheme {
  if (!matchMedia) {
    return 'light'
  }

  try {
    return matchMedia('(prefers-color-scheme: dark)').matches
      ? 'dark'
      : 'light'
  } catch {
    return 'light'
  }
}

export async function collectClientEnvironment(
  source: ClientEnvironmentSource = {},
): Promise<ClientEnvironment> {
  const browserNavigator = source.navigator === undefined
    ? getDefaultNavigator()
    : source.navigator
  const matchMedia = source.matchMedia === undefined
    ? getDefaultMatchMedia()
    : source.matchMedia
  const languages = collectLanguages(browserNavigator)
  const userAgentMetadata = await collectUserAgentMetadata(browserNavigator)

  const userAgent = readString(browserNavigator, 'userAgent')
    || 'Mozilla/5.0 (compatible; RemoteBrowser)'
  const platform = readString(browserNavigator, 'platform') || 'Unknown'

  return {
    userAgent,
    platform,
    languages,
    acceptLanguage: formatAcceptLanguage(languages),
    colorScheme: collectColorScheme(matchMedia),
    ...(userAgentMetadata ? { userAgentMetadata } : {}),
  }
}

export function environmentKey(environment: ClientEnvironment): string {
  const metadata = environment.userAgentMetadata

  return JSON.stringify({
    userAgent: environment.userAgent,
    platform: environment.platform,
    languages: [...environment.languages],
    acceptLanguage: environment.acceptLanguage,
    colorScheme: environment.colorScheme,
    userAgentMetadata: metadata
      ? {
          brands: metadata.brands.map(({ brand, version }) => ({ brand, version })),
          fullVersionList: metadata.fullVersionList.map(
            ({ brand, version }) => ({ brand, version }),
          ),
          mobile: metadata.mobile,
          platform: metadata.platform,
          platformVersion: metadata.platformVersion,
          architecture: metadata.architecture,
          bitness: metadata.bitness,
          model: metadata.model,
          wow64: metadata.wow64,
        }
      : null,
  })
}
