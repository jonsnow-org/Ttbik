import { t } from '../lib/i18n'
import { useFadaa } from '../lib/store'

export function ArchiveScreen() {
  const locale = useFadaa((s) => s.locale)
  const archiveUnlocked = useFadaa((s) => s.entitlements.archiveUnlocked)
  const sessions = useFadaa((s) => s.sessions.filter((x) => x.status === 'closed'))
  const go = useFadaa((s) => s.go)

  if (!archiveUnlocked && sessions.length > 3) {
    // soft gate: still show recent few
  }

  return (
    <div className="space-y-4">
      <h1 className="section-title">{t(locale, 'nav_archive')}</h1>
      {!archiveUnlocked ? (
        <div className="card flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm text-[var(--color-ink-muted)]">
            {locale === 'ar'
              ? 'فتح الأرشيف الكامل متاح عبر الباقات'
              : 'Full archive unlock is available via packages'}
          </p>
          <button type="button" className="btn btn-secondary !min-h-10" onClick={() => go('packages')}>
            {t(locale, 'pkg_archive')}
          </button>
        </div>
      ) : null}

      {sessions.length === 0 ? (
        <div className="empty card">{t(locale, 'empty_archive')}</div>
      ) : (
        <div className="space-y-3">
          {(archiveUnlocked ? sessions : sessions.slice(0, 5)).map((s) => (
            <button
              key={s.id}
              type="button"
              className="card w-full text-start transition hover:border-[var(--color-primary)]"
              onClick={() => go('summary', s.id)}
            >
              <div className="badge mb-1">
                {s.kind === 'knowledge'
                  ? t(locale, 'kind_knowledge')
                  : s.kind === 'experience'
                    ? t(locale, 'kind_experience')
                    : t(locale, 'kind_decision')}
              </div>
              <div className="font-bold">{s.title}</div>
              <div className="mt-1 text-sm text-[var(--color-ink-muted)]">{s.purpose}</div>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
