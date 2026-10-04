import { t } from '../lib/i18n'
import { useFadaa } from '../lib/store'

export function MineScreen() {
  const locale = useFadaa((s) => s.locale)
  const userId = useFadaa((s) => s.user.id)
  const sessions = useFadaa((s) =>
    s.sessions.filter((x) => x.ownerId === userId || x.participantIds.includes(userId)),
  )
  const go = useFadaa((s) => s.go)

  return (
    <div className="space-y-4">
      <h1 className="section-title">{t(locale, 'nav_mine')}</h1>
      {sessions.length === 0 ? (
        <div className="empty card">{t(locale, 'empty_mine')}</div>
      ) : (
        <div className="space-y-3">
          {sessions.map((s) => (
            <button
              key={s.id}
              type="button"
              className="card w-full text-start"
              onClick={() => go(s.status === 'closed' ? 'summary' : s.roles[userId] ? 'room' : 'join', s.id)}
            >
              <div className="flex flex-wrap items-center gap-2">
                <span className="badge">
                  {s.kind === 'knowledge'
                    ? t(locale, 'kind_knowledge')
                    : s.kind === 'experience'
                      ? t(locale, 'kind_experience')
                      : t(locale, 'kind_decision')}
                </span>
                <span className="text-xs font-semibold text-[var(--color-ink-soft)]">
                  {s.status === 'closed' ? t(locale, 'session_closed') : t(locale, 'open_count')}
                </span>
              </div>
              <div className="mt-1 font-bold">{s.title}</div>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
