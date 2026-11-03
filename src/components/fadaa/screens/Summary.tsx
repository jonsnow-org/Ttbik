import { t } from '../lib/i18n'
import { useFadaa } from '../lib/store'

export function SummaryScreen() {
  const locale = useFadaa((s) => s.locale)
  const id = useFadaa((s) => s.activeSessionId)
  const session = useFadaa((s) => s.sessions.find((item) => item.id === id))
  const contributions = useFadaa((s) => s.contributions.filter((item) => item.sessionId === id && !item.hidden))
  const go = useFadaa((s) => s.go)

  if (!session) return <div className="empty card">{t(locale, 'empty_archive')}</div>

  const texts = contributions.map((item) => item.text)
  const sections = session.kind === 'knowledge'
    ? [
        { title: t(locale, 'what_cleared'), body: texts.slice(0, 2).join(' ') || '—' },
        { title: t(locale, 'what_unclear'), body: texts.length < 2 ? '—' : texts.slice(-1).join(' ') },
        { title: t(locale, 'key_clarifications'), body: texts.join(' · ') || '—' },
      ]
    : session.kind === 'experience'
      ? [
          { title: t(locale, 'stage_summary'), body: texts.slice(0, 2).join(' ') || '—' },
          { title: t(locale, 'milestones'), body: texts.join(' · ') || '—' },
          { title: t(locale, 'lessons'), body: texts.slice(-2).join(' ') || '—' },
        ]
      : [
          { title: t(locale, 'final_options'), body: texts.filter((_, index) => index % 2 === 0).join(' · ') || '—' },
          { title: t(locale, 'decision_factors'), body: texts.join(' · ') || '—' },
          { title: t(locale, 'decision_or_delay'), body: texts.slice(-1).join(' ') || '—' },
        ]

  return (
    <div className="space-y-4">
      <button type="button" className="btn btn-ghost !px-0" onClick={() => go('archive')}>
        ← {t(locale, 'back')}
      </button>
      <div className="card space-y-1">
        <span className="badge">{t(locale, 'session_closed')}</span>
        <h1 className="text-lg font-bold">{session.title}</h1>
        <p className="text-sm text-[var(--color-ink-muted)]">{session.purpose}</p>
        <p className="text-xs text-[var(--color-ink-soft)]">{contributions.length} {locale === 'ar' ? 'إسهامة محفوظة' : 'saved contributions'}</p>
      </div>

      <h2 className="section-title">{t(locale, 'summary_title')}</h2>
      {sections.map((section) => (
        <section key={section.title} className="card space-y-1">
          <h3 className="font-bold text-[var(--color-primary-ink)]">{section.title}</h3>
          <p className="text-sm leading-relaxed whitespace-pre-wrap">{section.body}</p>
        </section>
      ))}

      <section className="space-y-2">
        <h2 className="section-title">{locale === 'ar' ? 'كل الإسهامات' : 'All contributions'}</h2>
        {contributions.length === 0 ? (
          <div className="empty card">{t(locale, 'no_contributions')}</div>
        ) : contributions.map((item) => (
          <article key={item.id} className="card space-y-1">
            <div className="flex items-center gap-2 text-xs">
              <span className="badge">{item.kind}</span>
              <strong>{item.authorName}</strong>
              <span className="text-[var(--color-ink-soft)]">{item.role}</span>
            </div>
            <p className="text-sm leading-relaxed whitespace-pre-wrap">{item.text}</p>
          </article>
        ))}
      </section>
    </div>
  )
}
