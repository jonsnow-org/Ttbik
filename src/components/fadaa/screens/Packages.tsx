import { useState } from 'react'
import { PACKAGE_IDS } from '../lib/settings'
import { t } from '../lib/i18n'
import { useFadaa } from '../lib/store'
import type { ManualChannel, PaidPackageId } from '../lib/types'

const labels: Record<PaidPackageId, Parameters<typeof t>[1]> = {
  upgrade_session: 'pkg_upgrade',
  advanced_summary: 'pkg_advanced',
  private_session: 'pkg_private',
  open_archive: 'pkg_archive',
}

const AUTO_METHODS = [
  'Stripe', 'PayPal', 'Visa', 'Mastercard', 'American Express', 'Apple Pay', 'Google Pay',
  'STC Pay', 'Urpay', 'Mobily Pay', 'vodafone cash', 'Orange Money', 'Fawry', 'Paymob',
  'Tap Payments', 'HyperPay', 'Checkout.com', 'PayTabs', 'Kashier', 'PayFort', 'Geidea',
  'مدى', 'تحويل بنكي محلي',
]

export function PackagesScreen() {
  const locale = useFadaa((s) => s.locale)
  const settings = useFadaa((s) => s.settings)
  const entitlements = useFadaa((s) => s.entitlements)
  const submitPayment = useFadaa((s) => s.submitPayment)
  const showToast = useFadaa((s) => s.showToast)

  const [selected, setSelected] = useState<PaidPackageId | null>(null)
  const [mode, setMode] = useState<'manual' | 'auto'>('manual')
  const [channel, setChannel] = useState<ManualChannel>('payeer')
  const [reference, setReference] = useState('')
  const [copied, setCopied] = useState(false)

  const wallet =
    channel === 'payeer' ? settings.payeerWallet : `${settings.cryptoUsdt}\nBTC: ${settings.cryptoBtc}`

  const copyWallet = async () => {
    try {
      await navigator.clipboard.writeText(wallet)
      setCopied(true)
      showToast('copied')
      setTimeout(() => setCopied(false), 1500)
    } catch {
      /* ignore */
    }
  }

  const send = () => {
    if (!selected || !reference.trim()) return
    if (mode === 'auto') {
      showToast(t(locale, 'pay_auto_warn'))
      return
    }
    const pack = settings.packages[selected]
    if (!pack.enabled) {
      showToast('pack_off')
      return
    }
    submitPayment({ packageId: selected, channel, reference })
    setReference('')
    setSelected(null)
  }

  return (
    <div className="space-y-4">
      <h1 className="section-title">{t(locale, 'packages_title')}</h1>

      <div className="card text-sm">
        <div className="font-semibold mb-1">{t(locale, 'credits')}</div>
        <div className="text-[var(--color-ink-muted)] space-y-0.5">
          <div>{t(locale, 'pkg_advanced')}: {entitlements.advancedSummaryCredits}</div>
          <div>{t(locale, 'pkg_upgrade')}: {entitlements.upgradeCredits}</div>
          <div>{t(locale, 'pkg_private')}: {entitlements.privateSessionCredits}</div>
          <div>{t(locale, 'pkg_archive')}: {entitlements.archiveUnlocked ? '✓' : '—'}</div>
        </div>
      </div>

      <div className="space-y-3">
        {PACKAGE_IDS.map((id) => {
          const pack = settings.packages[id]
          return (
            <button
              key={id}
              type="button"
              className={`card w-full text-start transition ${selected === id ? 'border-[var(--color-primary)] ring-2 ring-[var(--color-primary)]/30' : ''}`}
              onClick={() => setSelected(id)}
              disabled={!pack.enabled}
            >
              <div className="flex items-center justify-between gap-2">
                <div className="font-bold">{t(locale, labels[id])}</div>
                <div className="text-sm font-semibold text-[var(--color-primary-ink)]">
                  {pack.enabled ? `${pack.price} ${pack.currency}` : t(locale, 'pack_off')}
                </div>
              </div>
            </button>
          )
        })}
      </div>

      {selected ? (
        <div className="card space-y-3">
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              className={`btn ${mode === 'manual' ? 'btn-primary' : 'btn-secondary'}`}
              onClick={() => setMode('manual')}
            >
              {t(locale, 'pay_manual')}
            </button>
            <button
              type="button"
              className={`btn ${mode === 'auto' ? 'btn-primary' : 'btn-secondary'}`}
              onClick={() => setMode('auto')}
            >
              {t(locale, 'pay_auto')}
            </button>
          </div>

          {mode === 'auto' ? (
            <div className="space-y-2">
              <div
                className="rounded-xl border-2 p-3 text-sm font-semibold"
                style={{ borderColor: 'var(--color-warn)', color: 'var(--color-warn)', background: '#fffbeb' }}
              >
                {t(locale, 'pay_auto_warn')}
              </div>
              <div className="flex flex-wrap gap-2">
                {AUTO_METHODS.map((m) => (
                  <span key={m} className="badge opacity-50">
                    {m}
                  </span>
                ))}
              </div>
            </div>
          ) : (
            <>
              <div className="grid grid-cols-2 gap-2">
                {settings.payeerEnabled ? (
                  <button
                    type="button"
                    className={`btn ${channel === 'payeer' ? 'btn-primary' : 'btn-secondary'}`}
                    onClick={() => setChannel('payeer')}
                  >
                    {t(locale, 'channel_payeer')}
                  </button>
                ) : null}
                {settings.cryptoEnabled ? (
                  <button
                    type="button"
                    className={`btn ${channel === 'crypto' ? 'btn-primary' : 'btn-secondary'}`}
                    onClick={() => setChannel('crypto')}
                  >
                    {t(locale, 'channel_crypto')}
                  </button>
                ) : null}
              </div>
              <div className="rounded-xl bg-[var(--color-surface-2)] p-3 text-sm break-all border border-[var(--color-border)]">
                <div className="whitespace-pre-wrap font-mono text-xs">{wallet}</div>
                <button type="button" className="btn btn-secondary mt-2 !min-h-9 !text-xs" onClick={copyWallet}>
                  {copied ? t(locale, 'copied') : t(locale, 'copy')}
                </button>
              </div>
              <label className="block">
                <span className="label">{t(locale, 'reference')}</span>
                <input className="input" value={reference} onChange={(e) => setReference(e.target.value)} />
              </label>
              <button type="button" className="btn btn-primary w-full" onClick={send} disabled={!reference.trim()}>
                {t(locale, 'submit_payment')}
              </button>
            </>
          )}
        </div>
      ) : null}
    </div>
  )
}
