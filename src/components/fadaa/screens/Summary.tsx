import { t } from '../lib/i18n'
import { useFadaa } from '../lib/store'

export function SummaryScreen() {
  const locale = useFadaa((s) => s.locale)
  const id = useFadaa((s) => s.activeSessionId)
  const session = useFadaa((s) => s.sessions.find((x) => x.id === id))
  const contributions = useFadaa((s) =>
    s.contributions.filter((c) => c.sessionId === id && !c.hidden),
  )
  const credits = useFadaa((s) => s.entitlements.advancedSummaryCredits)
  const go = useFadaa((s) => s.go)

  if (!session) {
    return <div className="empty card">{t(locale, 'empty_archive')}</div>
  }

  const unlocked = session.advancedSummaryUnlocked || credits > 0 || session.plan !== 'free'
  const texts = contributions.map((c) => c.text)

  const sections =
    session.kind === 'knowledge'
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
            { title: t(locale, 'final_options'), body: texts.filter((_, i) => i % 2 === 0).join(' · ') || '—' },
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
      </div>

      <h2 className="section-title">{t(locale, 'summary_title')}</h2>
      {sections.map((s) => (
        <section key={s.title} className="card space-y-1">
          <h3 className="font-bold text-[var(--color-primary-ink)]">{s.title}</h3>
          <p className="text-sm leading-relaxed">{s.body}</p>
        </section>
      ))}

      {!unlocked ? (
        <div className="card space-y-3 border-[var(--color-warn)]">
          <p className="font-semibold text-[var(--color-warn)]">{t(locale, 'advanced_locked')}</p>
          <button type="button" className="btn btn-primary w-full" onClick={() => go('packages')}>
            {t(locale, 'unlock_advanced')}
          </button>
        </div>
      ) : (
        <div className="card space-y-2">
          <h3 className="font-bold text-[var(--color-primary-ink)]">
            {locale === 'ar' ? 'خلاصة متقدمة' : locale === 'fr' ? 'Résumé avancé' : 'Advanced summary'}
          </h3>
          <p className="text-sm leading-relaxed">
            {contributions
              .map((c) => `• [${c.role}] ${c.text}`)
              .join('\n') || '—'}
          </p>
        </div>
      )}
    </div>
  )
}
