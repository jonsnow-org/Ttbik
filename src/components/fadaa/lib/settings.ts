import type { AppSettings, PaidPackageId } from './types'

export const defaultSettings = (): AppSettings => ({
  createEnabled: true,
  joinEnabled: true,
  writeEnabled: true,
  announcement: '',
  pin: '',
  payeerEnabled: false,
  cryptoEnabled: false,
  payeerWallet: '',
  cryptoUsdt: '',
  cryptoBtc: '',
  packages: {
    upgrade_session: { enabled: false, price: 5, currency: 'USD' },
    advanced_summary: { enabled: false, price: 3, currency: 'USD' },
    private_session: { enabled: false, price: 8, currency: 'USD' },
    open_archive: { enabled: false, price: 4, currency: 'USD' },
  },
})

export function mergeSettings(partial?: Partial<AppSettings> | null): AppSettings {
  const base = defaultSettings()
  if (!partial) return base
  return {
    ...base,
    ...partial,
    packages: {
      ...base.packages,
      ...(partial.packages ?? {}),
    } as AppSettings['packages'],
  }
}

export const PACKAGE_IDS: PaidPackageId[] = [
  'upgrade_session',
  'advanced_summary',
  'private_session',
  'open_archive',
]
