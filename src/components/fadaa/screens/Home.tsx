import { Archive, Layers, Package, PlusCircle } from 'lucide-react'
import { t } from '../lib/i18n'
import { useFadaa } from '../lib/store'
import type { SessionKind } from '../lib/types'

const kinds: { id: SessionKind; label: Parameters<typeof t>[1]; desc: Parameters<typeof t>[1] }[] = [
  { id: 'knowledge', label: 'kind_knowledge', desc: 'kind_knowledge_desc' },
  { id: 'experience', label: 'kind_experience', desc: 'kind_experience_desc' },
  { id: 'decision', label: 'kind_decision', desc: 'kind_decision_desc' },
]

export function HomeScreen() {
  const locale = useFadaa((s) => s.locale)
  const go = useFadaa((s) => s.go)

  return (
    <div className="space-y-5">
      <p className="text-sm leading-relaxed text-[var(--color-ink-muted)]">{t(locale, 'tagline')}</p>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <button type="button" className="btn btn-primary w-full" onClick={() => go('create')}>
          <PlusCircle size={18} />
          {t(locale, 'open_session')}
        </button>
        <button type="button" className="btn btn-secondary w-full" onClick={() => go('sessions')}>
          <Layers size={18} />
          {t(locale, 'enter_open')}
        </button>
        <button type="button" className="btn btn-secondary w-full" onClick={() => go('archive')}>
          <Archive size={18} />
          {t(locale, 'browse_summaries')}
        </button>
        <button type="button" className="btn btn-secondary w-full" onClick={() => go('packages')}>
          <Package size={18} />
          {t(locale, 'my_packages')}
        </button>
      </div>

      <section>
        <h2 className="section-title">{locale === 'ar' ? 'أنواع الجلسات' : locale === 'fr' ? 'Types de session' : 'Session types'}</h2>
        <div className="grid gap-3">
          {kinds.map((k) => (
            <button
              key={k.id}
              type="button"
              className="card text-start transition hover:border-[var(--color-primary)]"
              onClick={() => go('create')}
            >
              <div className="badge mb-2">{t(locale, k.label)}</div>
              <div className="font-semibold text-[var(--color-ink)]">{t(locale, k.desc)}</div>
            </button>
          ))}
        </div>
      </section>
    </div>
  )
}
