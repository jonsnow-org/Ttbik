import { useState } from 'react'
import { PACKAGE_IDS } from '../lib/settings'
import { t } from '../lib/i18n'
import { useFadaa } from '../lib/store'
import type { PaidPackageId } from '../lib/types'

type Tab = 'overview' | 'payments' | 'sessions' | 'entries' | 'packages' | 'channels' | 'config'

export function AdminScreen() {
  const locale = useFadaa((s) => s.locale)
  const supervisor = useFadaa((s) => s.supervisor)
  const settings = useFadaa((s) => s.settings)
  const sessions = useFadaa((s) => s.sessions)
  const contributions = useFadaa((s) => s.contributions)
  const payments = useFadaa((s) => s.payments)
  const entitlements = useFadaa((s) => s.entitlements)
  const setSupervisor = useFadaa((s) => s.setSupervisor)
  const reviewPayment = useFadaa((s) => s.reviewPayment)
  const closeSession = useFadaa((s) => s.closeSession)
  const hideContribution = useFadaa((s) => s.hideContribution)
  const deleteContribution = useFadaa((s) => s.deleteContribution)
  const deleteSession = useFadaa((s) => s.deleteSession)
  const extendSession = useFadaa((s) => s.extendSession)
  const updateSettings = useFadaa((s) => s.updateSettings)
  const changePin = useFadaa((s) => s.changePin)
  const grantCredits = useFadaa((s) => s.grantCredits)
  const reseedDemo = useFadaa((s) => s.reseedDemo)
  const blockUser = useFadaa((s) => s.blockUser)

  const [pin, setPin] = useState('')
  const [tab, setTab] = useState<Tab>('overview')
  const [announcement, setAnnouncement] = useState(settings.announcement)
  const [newPin, setNewPin] = useState('')

  if (!supervisor) {
    return (
      <div className="space-y-4">
        <h1 className="section-title">{t(locale, 'admin_title')}</h1>
        <label className="block">
          <span className="label">{t(locale, 'admin_pin')}</span>
          <input
            className="input"
            type="password"
            inputMode="numeric"
            value={pin}
            onChange={(e) => setPin(e.target.value)}
            maxLength={8}
          />
        </label>
        <button
          type="button"
          className="btn btn-primary w-full"
          onClick={() => {
            if (pin === settings.pin) setSupervisor(true)
            else setPin('')
          }}
        >
          {t(locale, 'admin_enter')}
        </button>
      </div>
    )
  }

  const tabs: { id: Tab; label: Parameters<typeof t>[1] }[] = [
    { id: 'overview', label: 'admin_overview' },
    { id: 'payments', label: 'admin_payments' },
    { id: 'sessions', label: 'admin_sessions' },
    { id: 'entries', label: 'admin_entries' },
    { id: 'packages', label: 'admin_packages' },
    { id: 'channels', label: 'admin_channels' },
    { id: 'config', label: 'admin_config' },
  ]

  const openCount = sessions.filter((s) => s.status === 'open').length
  const closedCount = sessions.filter((s) => s.status === 'closed').length
  const pending = payments.filter((p) => p.status === 'pending')

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2">
        <h1 className="section-title !mb-0">{t(locale, 'admin_title')}</h1>
        <button type="button" className="btn btn-ghost !min-h-9 !text-xs" onClick={() => setSupervisor(false)}>
          {t(locale, 'back')}
        </button>
      </div>

      <div className="flex flex-wrap gap-1.5">
        {tabs.map((x) => (
          <button
            key={x.id}
            type="button"
            className={`btn !min-h-9 !px-2.5 !text-xs ${tab === x.id ? 'btn-primary' : 'btn-secondary'}`}
            onClick={() => setTab(x.id)}
          >
            {t(locale, x.label)}
          </button>
        ))}
      </div>

      {tab === 'overview' ? (
        <div className="space-y-3">
          <div className="grid grid-cols-3 gap-2">
            <div className="card text-center">
              <div className="text-2xl font-bold text-[var(--color-primary-ink)]">{openCount}</div>
              <div className="text-xs text-[var(--color-ink-soft)]">{t(locale, 'open_count')}</div>
            </div>
            <div className="card text-center">
              <div className="text-2xl font-bold">{closedCount}</div>
              <div className="text-xs text-[var(--color-ink-soft)]">{t(locale, 'closed_count')}</div>
            </div>
            <div className="card text-center">
              <div className="text-2xl font-bold text-[var(--color-warn)]">{pending.length}</div>
              <div className="text-xs text-[var(--color-ink-soft)]">{t(locale, 'pending_count')}</div>
            </div>
          </div>
          <div className="card space-y-2">
            <div className="font-semibold">{t(locale, 'credits')}</div>
            <div className="flex flex-wrap gap-2">
              <button type="button" className="btn btn-secondary !min-h-9 !text-xs" onClick={() => grantCredits('advancedSummaryCredits', 1)}>
                + {t(locale, 'pkg_advanced')}
              </button>
              <button type="button" className="btn btn-secondary !min-h-9 !text-xs" onClick={() => grantCredits('upgradeCredits', 1)}>
                + {t(locale, 'pkg_upgrade')}
              </button>
              <button type="button" className="btn btn-secondary !min-h-9 !text-xs" onClick={() => grantCredits('archiveUnlocked', 1)}>
                {t(locale, 'pkg_archive')}
              </button>
            </div>
            <div className="text-xs text-[var(--color-ink-soft)]">
              adv:{entitlements.advancedSummaryCredits} · up:{entitlements.upgradeCredits} · arch:{entitlements.archiveUnlocked ? '1' : '0'}
            </div>
          </div>
        </div>
      ) : null}

      {tab === 'payments' ? (
        <div className="space-y-3">
          {payments.length === 0 ? (
            <div className="empty card">—</div>
          ) : (
            payments.map((p) => (
              <div key={p.id} className="card space-y-2">
                <div className="flex flex-wrap items-center gap-2 text-sm">
                  <span className="badge">{p.status}</span>
                  <span className="font-semibold">{p.packageId}</span>
                  <span>
                    {p.amount} {p.currency}
                  </span>
                </div>
                <div className="text-sm text-[var(--color-ink-muted)]">
                  {p.userName} · {p.channel} · {p.reference}
                </div>
                {p.status === 'pending' ? (
                  <div className="flex gap-2">
                    <button type="button" className="btn btn-primary flex-1 !min-h-10" onClick={() => reviewPayment(p.id, true)}>
                      {t(locale, 'approve')}
                    </button>
                    <button type="button" className="btn btn-danger flex-1 !min-h-10" onClick={() => reviewPayment(p.id, false)}>
                      {t(locale, 'reject')}
                    </button>
                  </div>
                ) : null}
              </div>
            ))
          )}
        </div>
      ) : null}

      {tab === 'sessions' ? (
        <div className="space-y-3">
          {sessions.map((s) => (
            <div key={s.id} className="card space-y-2">
              <div className="font-bold">{s.title}</div>
              <div className="text-xs text-[var(--color-ink-soft)]">
                {s.status} · {s.kind} · {s.participantIds.length}
              </div>
              <div className="flex flex-wrap gap-2">
                {s.status === 'open' ? (
                  <>
                    <button type="button" className="btn btn-secondary !min-h-9 !text-xs" onClick={() => closeSession(s.id)}>
                      {t(locale, 'close_session')}
                    </button>
                    <button type="button" className="btn btn-secondary !min-h-9 !text-xs" onClick={() => extendSession(s.id, 12)}>
                      +12h
                    </button>
                  </>
                ) : null}
                <button type="button" className="btn btn-danger !min-h-9 !text-xs" onClick={() => deleteSession(s.id)}>
                  {t(locale, 'delete')}
                </button>
              </div>
            </div>
          ))}
        </div>
      ) : null}

      {tab === 'entries' ? (
        <div className="space-y-3">
          {contributions.slice().reverse().map((c) => (
            <div key={c.id} className="card space-y-2">
              <div className="text-sm">
                <span className="badge me-2">{c.kind}</span>
                <span className="font-semibold">{c.authorName}</span>
                {c.hidden ? <span className="ms-2 text-xs text-[var(--color-danger)]">hidden</span> : null}
              </div>
              <p className="text-sm text-[var(--color-ink-muted)]">{c.text}</p>
              <div className="flex flex-wrap gap-2">
                <button type="button" className="btn btn-secondary !min-h-9 !text-xs" onClick={() => hideContribution(c.id)}>
                  {t(locale, 'hide')}
                </button>
                <button type="button" className="btn btn-danger !min-h-9 !text-xs" onClick={() => deleteContribution(c.id)}>
                  {t(locale, 'delete')}
                </button>
                <button type="button" className="btn btn-secondary !min-h-9 !text-xs" onClick={() => blockUser(c.authorId)}>
                  block
                </button>
              </div>
            </div>
          ))}
        </div>
      ) : null}

      {tab === 'packages' ? (
        <div className="space-y-3">
          {PACKAGE_IDS.map((id) => {
            const pack = settings.packages[id]
            return (
              <div key={id} className="card space-y-2">
                <div className="font-bold">{id}</div>
                <div className="flex items-center gap-2">
                  <input
                    className="input !min-h-10"
                    type="number"
                    value={pack.price}
                    onChange={(e) =>
                      updateSettings({
                        packages: {
                          ...settings.packages,
                          [id]: { ...pack, price: Number(e.target.value) || 0 },
                        },
                      })
                    }
                  />
                  <button
                    type="button"
                    className={`btn !min-h-10 ${pack.enabled ? 'btn-primary' : 'btn-secondary'}`}
                    onClick={() =>
                      updateSettings({
                        packages: {
                          ...settings.packages,
                          [id]: { ...pack, enabled: !pack.enabled },
                        },
                      })
                    }
                  >
                    {pack.enabled ? 'ON' : 'OFF'}
                  </button>
                </div>
              </div>
            )
          })}
        </div>
      ) : null}

      {tab === 'channels' ? (
        <div className="space-y-3">
          <label className="card flex items-center justify-between gap-2">
            <span>{t(locale, 'channel_payeer')}</span>
            <button
              type="button"
              className={`btn !min-h-9 ${settings.payeerEnabled ? 'btn-primary' : 'btn-secondary'}`}
              onClick={() => updateSettings({ payeerEnabled: !settings.payeerEnabled })}
            >
              {settings.payeerEnabled ? 'ON' : 'OFF'}
            </button>
          </label>
          <label className="block card space-y-1">
            <span className="label">Payeer wallet</span>
            <input
              className="input"
              value={settings.payeerWallet}
              onChange={(e) => updateSettings({ payeerWallet: e.target.value })}
            />
          </label>
          <label className="card flex items-center justify-between gap-2">
            <span>{t(locale, 'channel_crypto')}</span>
            <button
              type="button"
              className={`btn !min-h-9 ${settings.cryptoEnabled ? 'btn-primary' : 'btn-secondary'}`}
              onClick={() => updateSettings({ cryptoEnabled: !settings.cryptoEnabled })}
            >
              {settings.cryptoEnabled ? 'ON' : 'OFF'}
            </button>
          </label>
          <label className="block card space-y-1">
            <span className="label">USDT</span>
            <input
              className="input"
              value={settings.cryptoUsdt}
              onChange={(e) => updateSettings({ cryptoUsdt: e.target.value })}
            />
          </label>
          <label className="block card space-y-1">
            <span className="label">BTC</span>
            <input
              className="input"
              value={settings.cryptoBtc}
              onChange={(e) => updateSettings({ cryptoBtc: e.target.value })}
            />
          </label>
        </div>
      ) : null}

      {tab === 'config' ? (
        <div className="space-y-3">
          {([
            ['createEnabled', 'create'],
            ['joinEnabled', 'join'],
            ['writeEnabled', 'write'],
          ] as const).map(([key, label]) => (
            <label key={key} className="card flex items-center justify-between gap-2">
              <span>{label}</span>
              <button
                type="button"
                className={`btn !min-h-9 ${(settings as any)[key] ? 'btn-primary' : 'btn-secondary'}`}
                onClick={() => updateSettings({ [key]: !(settings as any)[key] })}
              >
                {(settings as any)[key] ? 'ON' : 'OFF'}
              </button>
            </label>
          ))}
          <label className="block card space-y-1">
            <span className="label">{t(locale, 'announcement')}</span>
            <textarea
              className="input min-h-20"
              value={announcement}
              onChange={(e) => setAnnouncement(e.target.value)}
            />
            <button
              type="button"
              className="btn btn-primary !min-h-10"
              onClick={() => updateSettings({ announcement })}
            >
              {t(locale, 'save')}
            </button>
          </label>
          <label className="block card space-y-1">
            <span className="label">{t(locale, 'admin_pin')}</span>
            <input className="input" value={newPin} onChange={(e) => setNewPin(e.target.value)} />
            <button
              type="button"
              className="btn btn-secondary !min-h-10"
              onClick={() => {
                if (newPin.length >= 4) {
                  changePin(newPin)
                  setNewPin('')
                }
              }}
            >
              {t(locale, 'save')}
            </button>
          </label>
          <button type="button" className="btn btn-danger w-full" onClick={reseedDemo}>
            {t(locale, 'reset_demo')}
          </button>
        </div>
      ) : null}
    </div>
  )
}
