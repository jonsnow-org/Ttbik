import type { AppSettings, PaidPackageId } from './types'

export const defaultSettings = (): AppSettings => ({
  createEnabled: true,
  joinEnabled: true,
  writeEnabled: true,
  announcement: '',
  pin: '7042',
  payeerEnabled: true,
  cryptoEnabled: true,
  payeerWallet: 'P1234567890',
  cryptoUsdt: 'TXyzUSDTDemoWallet1234567890',
  cryptoBtc: 'bc1qdemoBitcoinWalletAddress000',
  packages: {
    upgrade_session: { enabled: true, price: 5, currency: 'USD' },
    advanced_summary: { enabled: true, price: 3, currency: 'USD' },
    private_session: { enabled: true, price: 8, currency: 'USD' },
    open_archive: { enabled: true, price: 4, currency: 'USD' },
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
