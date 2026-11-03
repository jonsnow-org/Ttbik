import { useState } from 'react'
import { ROLES, t } from '../lib/i18n'
import { useFadaa } from '../lib/store'
import { fadaaAction, refreshFadaaSnapshot } from '../lib/api'

export function JoinScreen() {
  const locale = useFadaa((s) => s.locale)
  const id = useFadaa((s) => s.activeSessionId)
  const session = useFadaa((s) => s.sessions.find((item) => item.id === id))
  const userId = useFadaa((s) => s.user.id)
  const go = useFadaa((s) => s.go)
  const [role, setRole] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (!session) {
    return (
      <div className="space-y-3">
        <button type="button" className="btn btn-ghost !px-0" onClick={() => go('sessions')}>← {t(locale, 'back')}</button>
        <div className="empty card">{t(locale, 'empty_sessions')}</div>
      </div>
    )
  }

  const roles = ROLES[locale][session.kind] ?? ROLES.ar[session.kind]
  const alreadyJoined = Boolean(session.roles[userId])

  const confirm = async () => {
    if (!role || busy) return
    setBusy(true)
    setError(null)
    try {
      await fadaaAction('join_session', { sessionId: session.id, role })
      await refreshFadaaSnapshot()
      go('room', session.id)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'تعذّر الانضمام إلى الجلسة.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-4">
      <button type="button" className="btn btn-ghost !px-0" onClick={() => go('sessions')}>← {t(locale, 'back')}</button>
      <div className="card space-y-2">
        <span className="badge">
          {session.kind === 'knowledge' ? t(locale, 'kind_knowledge') : session.kind === 'experience' ? t(locale, 'kind_experience') : t(locale, 'kind_decision')}
        </span>
        <h1 className="text-lg font-bold">{session.title}</h1>
        <p className="text-sm text-[var(--color-ink-muted)]">{session.purpose}</p>
      </div>

      {alreadyJoined ? (
        <button type="button" className="btn btn-primary w-full" onClick={() => go('room', session.id)}>
          {t(locale, 'enter_room')}
        </button>
      ) : (
        <>
          <h2 className="section-title">{t(locale, 'choose_role')}</h2>
          <div className="grid gap-2">
            {roles.map((item) => (
              <button
                key={item}
                type="button"
                className={`btn justify-start ${role === item ? 'btn-primary' : 'btn-secondary'}`}
                onClick={() => setRole(item)}
              >
                {item}
              </button>
            ))}
          </div>
          {error ? <div role="alert" className="card border border-[var(--color-danger)] text-sm text-[var(--color-danger)]">{error}</div> : null}
          <button type="button" className="btn btn-primary w-full" disabled={!role || busy} onClick={confirm}>
            {busy ? 'جارٍ الانضمام…' : t(locale, 'confirm_role')}
          </button>
        </>
      )}
    </div>
  )
}
