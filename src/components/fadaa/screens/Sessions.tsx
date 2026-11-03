import { useMemo, useState } from 'react'
import { Search, Users, Clock3 } from 'lucide-react'
import { t } from '../lib/i18n'
import { formatRemaining, peopleCount, useFadaa } from '../lib/store'
import type { SessionKind } from '../lib/types'

type KindFilter = 'all' | SessionKind
type SortMode = 'newest' | 'active'

function kindLabel(kind: SessionKind, locale: 'ar' | 'en' | 'fr') {
  if (kind === 'knowledge') return t(locale, 'kind_knowledge')
  if (kind === 'experience') return t(locale, 'kind_experience')
  return t(locale, 'kind_decision')
}

export function SessionsScreen() {
  const locale = useFadaa((s) => s.locale)
  const sessions = useFadaa((s) => s.sessions)
  const go = useFadaa((s) => s.go)
  const [query, setQuery] = useState('')
  const [kind, setKind] = useState<KindFilter>('all')
  const [sort, setSort] = useState<SortMode>('newest')
  const now = Date.now()

  const open = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase()
    return sessions
      .filter((session) => session.status === 'open' && session.visibility === 'public')
      .filter((session) => kind === 'all' || session.kind === kind)
      .filter((session) => !normalized
        || session.title.toLocaleLowerCase().includes(normalized)
        || session.purpose.toLocaleLowerCase().includes(normalized)
        || session.ownerName.toLocaleLowerCase().includes(normalized))
      .sort((a, b) => sort === 'active'
        ? b.participantIds.length - a.participantIds.length || b.createdAt - a.createdAt
        : b.createdAt - a.createdAt)
  }, [sessions, query, kind, sort])

  const filters: { id: KindFilter; label: string }[] = [
    { id: 'all', label: locale === 'ar' ? 'الكل' : locale === 'fr' ? 'Tout' : 'All' },
    { id: 'knowledge', label: t(locale, 'kind_knowledge') },
    { id: 'experience', label: t(locale, 'kind_experience') },
    { id: 'decision', label: t(locale, 'kind_decision') },
  ]

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2">
        <div>
          <h1 className="section-title !mb-1">{t(locale, 'nav_sessions')}</h1>
          <p className="text-[11px] text-[var(--color-ink-soft)]">
            {locale === 'ar' ? 'اكتشف نقاشات مفتوحة وانضم بصوتك وخبرتك.' : locale === 'fr' ? 'Découvrez les discussions et apportez votre expérience.' : 'Discover open discussions and add your perspective.'}
          </p>
        </div>
        <button type="button" className="btn btn-primary !min-h-10 !px-3 !text-sm" onClick={() => go('create')}>
          {t(locale, 'open_session')}
        </button>
      </div>

      <label className="relative block">
        <Search size={18} className="pointer-events-none absolute start-3 top-1/2 -translate-y-1/2 text-[var(--color-ink-soft)]" />
        <input
          className="input !ps-10"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={locale === 'ar' ? 'ابحث بعنوان الجلسة أو موضوعها…' : locale === 'fr' ? 'Rechercher une session…' : 'Search sessions and topics…'}
          aria-label={locale === 'ar' ? 'بحث الجلسات' : 'Search sessions'}
        />
      </label>

      <div className="flex gap-2 overflow-x-auto pb-1">
        {filters.map((filter) => (
          <button
            key={filter.id}
            type="button"
            className={`shrink-0 rounded-full px-3.5 py-2 text-xs font-bold transition ${kind === filter.id ? 'bg-[var(--color-primary)] text-white' : 'border border-[var(--color-border)] bg-[var(--color-surface-2)] text-[var(--color-ink-muted)]'}`}
            onClick={() => setKind(filter.id)}
          >
            {filter.label}
          </button>
        ))}
      </div>

      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-semibold text-[var(--color-ink-muted)]">
          {open.length} {locale === 'ar' ? 'جلسة متاحة' : locale === 'fr' ? 'sessions' : 'open sessions'}
        </span>
        <div className="flex gap-1 rounded-full bg-[var(--color-surface-2)] p-1">
          <button
            type="button"
            className={`rounded-full px-3 py-1.5 text-[10px] font-bold ${sort === 'newest' ? 'bg-[var(--color-surface)] text-[var(--color-ink)] shadow-sm' : 'text-[var(--color-ink-soft)]'}`}
            onClick={() => setSort('newest')}
          >
            {locale === 'ar' ? 'الأحدث' : locale === 'fr' ? 'Récentes' : 'Newest'}
          </button>
          <button
            type="button"
            className={`rounded-full px-3 py-1.5 text-[10px] font-bold ${sort === 'active' ? 'bg-[var(--color-surface)] text-[var(--color-ink)] shadow-sm' : 'text-[var(--color-ink-soft)]'}`}
            onClick={() => setSort('active')}
          >
            {locale === 'ar' ? 'الأكثر مشاركة' : locale === 'fr' ? 'Actives' : 'Most active'}
          </button>
        </div>
      </div>

      {open.length === 0 ? (
        <div className="card space-y-3 py-8 text-center">
          <div className="text-3xl">◎</div>
          <div className="font-bold">{query || kind !== 'all'
            ? (locale === 'ar' ? 'لا توجد نتائج مطابقة' : locale === 'fr' ? 'Aucun résultat' : 'No matching sessions')
            : t(locale, 'empty_sessions')}</div>
          <p className="text-xs leading-6 text-[var(--color-ink-soft)]">
            {locale === 'ar' ? 'ابدأ جلسة جديدة بسؤال واضح، وادعُ الآخرين للمشاركة.' : 'Start a clear discussion and invite others to contribute.'}
          </p>
          <button type="button" className="btn btn-primary mx-auto !min-h-10" onClick={() => go('create')}>
            {t(locale, 'open_session')}
          </button>
        </div>
      ) : (
        <div className="space-y-3">
          {open.map((session) => (
            <article key={session.id} className="card space-y-2.5 transition hover:border-[var(--color-primary)]">
              <div className="flex flex-wrap items-center gap-2">
                <span className="badge">{kindLabel(session.kind, locale)}</span>
                <span className="countdown">{t(locale, 'remaining')}: {formatRemaining(session.closesAt - now, locale)}</span>
                {sort === 'active' && session.participantIds.length >= 3 ? (
                  <span className="rounded-full bg-emerald-500/10 px-2 py-1 text-[10px] font-bold text-emerald-400">
                    {locale === 'ar' ? 'نقاش نشط' : 'Active'}
                  </span>
                ) : null}
              </div>
              <h3 className="text-base font-bold leading-snug">{session.title}</h3>
              <p className="text-sm leading-6 text-[var(--color-ink-muted)]">{session.purpose}</p>
              <div className="flex items-center justify-between gap-2 border-t border-[var(--color-border)] pt-2">
                <div className="flex items-center gap-3 text-[11px] text-[var(--color-ink-soft)]">
                  <span className="inline-flex items-center gap-1"><Users size={14} />{peopleCount(session.participantIds.length, locale)}</span>
                  <span className="inline-flex items-center gap-1"><Clock3 size={13} />{new Date(session.createdAt).toLocaleDateString(locale === 'ar' ? 'ar' : locale, { month: 'short', day: 'numeric' })}</span>
                </div>
                <button
                  type="button"
                  className="btn btn-primary !min-h-10 !px-4 !text-sm"
                  onClick={() => go('join', session.id)}
                >
                  {t(locale, 'enter_room')}
                </button>
              </div>
            </article>
          ))}
        </div>
      )}
    </div>
  )
}
