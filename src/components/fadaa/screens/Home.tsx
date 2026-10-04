import { Archive, BookOpen, Layers, Package, PlusCircle, Scale, Sparkles } from 'lucide-react'
import { t } from '../lib/i18n'
import { useFadaa } from '../lib/store'
import type { SessionKind } from '../lib/types'

const kinds: {
  id: SessionKind
  label: Parameters<typeof t>[1]
  desc: Parameters<typeof t>[1]
  icon: typeof BookOpen
}[] = [
  { id: 'knowledge', label: 'kind_knowledge', desc: 'kind_knowledge_desc', icon: BookOpen },
  { id: 'experience', label: 'kind_experience', desc: 'kind_experience_desc', icon: Sparkles },
  { id: 'decision', label: 'kind_decision', desc: 'kind_decision_desc', icon: Scale },
]

export function HomeScreen() {
  const locale = useFadaa((s) => s.locale)
  const go = useFadaa((s) => s.go)

  return (
    <div className="space-y-6 pb-2">
      <p className="text-center text-sm leading-7 text-[var(--color-ink-muted)]">{t(locale, 'tagline')}</p>

      <div className="grid grid-cols-1 gap-2.5">
        <button type="button" className="btn btn-primary w-full text-base" onClick={() => go('create')}>
          <PlusCircle size={20} />
          {t(locale, 'open_session')}
        </button>
        <button type="button" className="btn btn-secondary w-full" onClick={() => go('sessions')}>
          <Layers size={18} />
          {t(locale, 'enter_open')}
        </button>
        <div className="grid grid-cols-2 gap-2.5">
          <button type="button" className="btn btn-secondary w-full" onClick={() => go('archive')}>
            <Archive size={18} />
            {t(locale, 'browse_summaries')}
          </button>
          <button type="button" className="btn btn-secondary w-full" onClick={() => go('packages')}>
            <Package size={18} />
            {t(locale, 'my_packages')}
          </button>
        </div>
      </div>

      <section className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)]/60 p-3.5">
        <h2 className="section-title mb-3">
          {locale === 'ar' ? 'أنواع الجلسات' : locale === 'fr' ? 'Types de session' : 'Session types'}
        </h2>
        <div className="grid gap-2.5">
          {kinds.map((k) => {
            const Icon = k.icon
            return (
              <button
                key={k.id}
                type="button"
                className="card flex w-full items-start gap-3 text-start transition active:scale-[0.99]"
                style={{ background: 'var(--color-bg)' }}
                onClick={() => go('create')}
              >
                <span
                  className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl"
                  style={{ background: 'var(--color-primary-soft)', color: 'var(--color-primary)' }}
                >
                  <Icon size={22} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="badge mb-1.5">{t(locale, k.label)}</span>
                  <span className="block text-sm font-semibold leading-6 text-[var(--color-ink)]">
                    {t(locale, k.desc)}
                  </span>
                </span>
              </button>
            )
          })}
        </div>
      </section>
    </div>
  )
}
