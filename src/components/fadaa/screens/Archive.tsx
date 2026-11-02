import { t } from '../lib/i18n'
import { useFadaa } from '../lib/store'

export function ArchiveScreen() {
  const locale = useFadaa((s) => s.locale)
  const sessions = useFadaa((s) => s.sessions.filter((session) => session.status === 'closed'))
  const go = useFadaa((s) => s.go)

  return (
    <div className="space-y-4">
      <div>
        <h1 className="section-title !mb-1">{t(locale, 'nav_archive')}</h1>
        <p className="text-xs text-[var(--color-ink-soft)]">
          {locale === 'ar' ? 'كل الجلسات المغلقة وخلاصاتها متاحة للمشاركين.' : 'Closed sessions and their summaries remain available to participants.'}
        </p>
      </div>
      {sessions.length === 0 ? (
        <div className="empty card">{t(locale, 'empty_archive')}</div>
      ) : (
        <div className="space-y-3">
          {sessions.map((session) => (
            <button
              key={session.id}
              type="button"
              className="card w-full text-start transition hover:border-[var(--color-primary)]"
              onClick={() => go('summary', session.id)}
            >
              <span className="badge mb-1">
                {session.kind === 'knowledge' ? t(locale, 'kind_knowledge') : session.kind === 'experience' ? t(locale, 'kind_experience') : t(locale, 'kind_decision')}
              </span>
              <div className="font-bold">{session.title}</div>
              <div className="mt-1 text-sm text-[var(--color-ink-muted)]">{session.purpose}</div>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
