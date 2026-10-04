import { useState } from 'react'
import { ROLES, t } from '../lib/i18n'
import { useFadaa } from '../lib/store'

export function JoinScreen() {
  const locale = useFadaa((s) => s.locale)
  const id = useFadaa((s) => s.activeSessionId)
  const session = useFadaa((s) => s.sessions.find((x) => x.id === id))
  const userId = useFadaa((s) => s.user.id)
  const joinEnabled = useFadaa((s) => s.settings.joinEnabled)
  const joinWithRole = useFadaa((s) => s.joinWithRole)
  const go = useFadaa((s) => s.go)
  const showToast = useFadaa((s) => s.showToast)
  const [role, setRole] = useState('')

  if (!session) {
    return (
      <div className="space-y-3">
        <button type="button" className="btn btn-ghost !px-0" onClick={() => go('sessions')}>
          ← {t(locale, 'back')}
        </button>
        <div className="empty card">{t(locale, 'empty_sessions')}</div>
      </div>
    )
  }

  const roles = ROLES[locale][session.kind] ?? ROLES.ar[session.kind]

  if (session.roles[userId]) {
    return (
      <div className="space-y-3">
        <button type="button" className="btn btn-primary w-full" onClick={() => go('room', session.id)}>
          {t(locale, 'enter_room')}
        </button>
      </div>
    )
  }

  const confirm = () => {
    if (!joinEnabled) {
      showToast('join_paused')
      return
    }
    if (!role) return
    joinWithRole(session.id, role)
  }

  return (
    <div className="space-y-4">
      <button type="button" className="btn btn-ghost !px-0" onClick={() => go('sessions')}>
        ← {t(locale, 'back')}
      </button>
      <div className="card space-y-2">
        <span className="badge">
          {session.kind === 'knowledge'
            ? t(locale, 'kind_knowledge')
            : session.kind === 'experience'
              ? t(locale, 'kind_experience')
              : t(locale, 'kind_decision')}
        </span>
        <h1 className="text-lg font-bold">{session.title}</h1>
        <p className="text-sm text-[var(--color-ink-muted)]">{session.purpose}</p>
      </div>

      <h2 className="section-title">{t(locale, 'choose_role')}</h2>
      <div className="grid gap-2">
        {roles.map((r) => (
          <button
            key={r}
            type="button"
            className={`btn justify-start ${role === r ? 'btn-primary' : 'btn-secondary'}`}
            onClick={() => setRole(r)}
          >
            {r}
          </button>
        ))}
      </div>

      <button type="button" className="btn btn-primary w-full" disabled={!role} onClick={confirm}>
        {t(locale, 'confirm_role')}
      </button>
    </div>
  )
}
