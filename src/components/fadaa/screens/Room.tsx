import { useEffect, useState } from 'react'
import { CONTRIB_KINDS, t } from '../lib/i18n'
import { formatRemaining, peopleCount, useFadaa } from '../lib/store'
import type { ContributionKind } from '../lib/types'

export function RoomScreen() {
  const locale = useFadaa((s) => s.locale)
  const id = useFadaa((s) => s.activeSessionId)
  const session = useFadaa((s) => s.sessions.find((x) => x.id === id))
  const contributions = useFadaa((s) => s.contributions.filter((c) => c.sessionId === id && !c.hidden))
  const user = useFadaa((s) => s.user)
  const settings = useFadaa((s) => s.settings)
  const blocked = useFadaa((s) => s.blockedUserIds.includes(s.user.id))
  const addContribution = useFadaa((s) => s.addContribution)
  const tickClose = useFadaa((s) => s.tickClose)
  const go = useFadaa((s) => s.go)
  const showToast = useFadaa((s) => s.showToast)

  const [openForm, setOpenForm] = useState(false)
  const [kind, setKind] = useState<ContributionKind | ''>('')
  const [text, setText] = useState('')
  const [, setTick] = useState(0)

  useEffect(() => {
    tickClose()
    const id = setInterval(() => {
      tickClose()
      setTick((x) => x + 1)
    }, 15_000)
    return () => clearInterval(id)
  }, [tickClose])

  if (!session) {
    return <div className="empty card">{t(locale, 'empty_sessions')}</div>
  }

  const role = session.roles[user.id]
  if (!role) {
    go('join', session.id)
    return null
  }

  if (session.status === 'closed') {
    go('summary', session.id)
    return null
  }

  const kinds = CONTRIB_KINDS[locale][session.kind] ?? CONTRIB_KINDS.ar[session.kind]
  const remaining = session.closesAt - Date.now()

  const submit = () => {
    if (!settings.writeEnabled) {
      showToast('write_paused')
      return
    }
    if (blocked) {
      showToast('blocked')
      return
    }
    if (!kind || !text.trim()) return
    if (addContribution(session.id, kind, text)) {
      setText('')
      setKind('')
      setOpenForm(false)
    }
  }

  return (
    <div className="space-y-4">
      <button type="button" className="btn btn-ghost !px-0" onClick={() => go('sessions')}>
        ← {t(locale, 'back')}
      </button>

      <div className="card space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <span className="badge">
            {session.kind === 'knowledge'
              ? t(locale, 'kind_knowledge')
              : session.kind === 'experience'
                ? t(locale, 'kind_experience')
                : t(locale, 'kind_decision')}
          </span>
          <span className="countdown">
            {t(locale, 'remaining')}: {formatRemaining(remaining, locale)}
          </span>
        </div>
        <h1 className="text-lg font-bold leading-snug">{session.title}</h1>
        <div className="text-xs text-[var(--color-ink-soft)]">
          {peopleCount(session.participantIds.length, locale)} · {role}
        </div>
      </div>

      <section className="card">
        <h2 className="section-title">{t(locale, 'purpose')}</h2>
        <p className="text-sm leading-relaxed text-[var(--color-ink-muted)]">{session.purpose}</p>
      </section>

      <section className="space-y-2">
        <h2 className="section-title">{t(locale, 'building')}</h2>
        {contributions.length === 0 ? (
          <div className="empty card">{t(locale, 'no_contributions')}</div>
        ) : (
          contributions.map((c) => (
            <article key={c.id} className="card space-y-1">
              <div className="flex flex-wrap items-center gap-2 text-xs">
                <span className="badge">{c.kind}</span>
                <span className="font-semibold text-[var(--color-ink)]">{c.authorName}</span>
                <span className="text-[var(--color-ink-soft)]">{c.role}</span>
              </div>
              <p className="text-sm leading-relaxed">{c.text}</p>
            </article>
          ))
        )}
      </section>

      <section className="card">
        <h2 className="section-title">{t(locale, 'live_summary')}</h2>
        <p className="text-sm text-[var(--color-ink-muted)]">
          {contributions.length === 0
            ? '—'
            : contributions
                .slice(-3)
                .map((c) => c.text)
                .join(' · ')}
        </p>
      </section>

      {!openForm ? (
        <button
          type="button"
          className="btn btn-primary w-full"
          onClick={() => setOpenForm(true)}
          disabled={!settings.writeEnabled || blocked}
        >
          {t(locale, 'add_contribution')}
        </button>
      ) : (
        <div className="card space-y-3">
          <span className="label">{t(locale, 'contribution_type')}</span>
          <div className="flex flex-wrap gap-2">
            {kinds.map((k) => (
              <button
                key={k.id}
                type="button"
                className={`btn !min-h-10 !px-3 !text-sm ${kind === k.id ? 'btn-primary' : 'btn-secondary'}`}
                onClick={() => setKind(k.id as ContributionKind)}
              >
                {k.label}
              </button>
            ))}
          </div>
          <label className="block">
            <span className="label">{t(locale, 'write_text')}</span>
            <textarea className="input min-h-28" value={text} onChange={(e) => setText(e.target.value)} maxLength={500} />
          </label>
          <div className="flex gap-2">
            <button type="button" className="btn btn-secondary flex-1" onClick={() => setOpenForm(false)}>
              {t(locale, 'cancel')}
            </button>
            <button type="button" className="btn btn-primary flex-1" onClick={submit} disabled={!kind || !text.trim()}>
              {t(locale, 'send')}
            </button>
          </div>
        </div>
      )}

      <button type="button" className="btn btn-secondary w-full" onClick={() => go('packages')}>
        {t(locale, 'upgrade_session')}
      </button>
    </div>
  )
}
