import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Clock3, MessageCircle, Search, Users } from 'lucide-react'
import { loadFadaaArchivePage } from '../lib/api'
import { t } from '../lib/i18n'
import { useFadaa } from '../lib/store'
import type { SessionKind } from '../lib/types'

type KindFilter = 'all' | SessionKind
type SortMode = 'newest' | 'active'

function kindLabel(kind: SessionKind, locale: 'ar' | 'en' | 'fr') {
  if (kind === 'knowledge') return t(locale, 'kind_knowledge')
  if (kind === 'experience') return t(locale, 'kind_experience')
  return t(locale, 'kind_decision')
}

export function ArchiveScreen() {
  const locale = useFadaa((s) => s.locale)
  const allSessions = useFadaa((s) => s.sessions)
  const contributions = useFadaa((s) => s.contributions)
  const go = useFadaa((s) => s.go)
  const [query, setQuery] = useState('')
  const [kind, setKind] = useState<KindFilter>('all')
  const [sort, setSort] = useState<SortMode>('newest')
  const [hasMore, setHasMore] = useState(false)
  const [nextOffset, setNextOffset] = useState(0)
  const [loading, setLoading] = useState(false)
  const [loaded, setLoaded] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const loadingRef = useRef(false)

  const loadPage = useCallback(async (offset: number) => {
    if (loadingRef.current) return
    loadingRef.current = true
    setLoading(true)
    setError(null)
    try {
      const result = await loadFadaaArchivePage(offset)
      setHasMore(result.hasMore)
      setNextOffset(result.nextOffset)
      setLoaded(true)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'تعذّر تحميل الأرشيف.')
    } finally {
      loadingRef.current = false
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void loadPage(0)
  }, [loadPage])

  const sessions = useMemo(
    () => allSessions.filter((session) => session.status === 'closed'),
    [allSessions],
  )
  const contributionIndex = useMemo(() => {
    const index = new Map<string, { count: number; text: string }>()
    for (const item of contributions) {
      const current = index.get(item.sessionId) || { count: 0, text: '' }
      index.set(item.sessionId, {
        count: current.count + 1,
        text: current.text ? current.text + ' ' + item.text : item.text,
      })
    }
    return index
  }, [contributions])

  const filtered = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase(locale)
    return [...sessions]
      .filter((session) => kind === 'all' || session.kind === kind)
      .filter((session) => {
        if (!needle) return true
        const activityText = contributionIndex.get(session.id)?.text || ''
        return [session.title, session.purpose, session.ownerName, activityText]
          .some((value) => String(value || '').toLocaleLowerCase(locale).includes(needle))
      })
      .sort((a, b) => sort === 'active'
        ? (contributionIndex.get(b.id)?.count || 0) - (contributionIndex.get(a.id)?.count || 0)
          || b.participantIds.length - a.participantIds.length
          || b.createdAt - a.createdAt
        : b.createdAt - a.createdAt)
  }, [sessions, query, kind, sort, contributionIndex, locale])

  const filters: { id: KindFilter; label: string }[] = [
    { id: 'all', label: locale === 'ar' ? 'الكل' : locale === 'fr' ? 'Tout' : 'All' },
    { id: 'knowledge', label: t(locale, 'kind_knowledge') },
    { id: 'experience', label: t(locale, 'kind_experience') },
    { id: 'decision', label: t(locale, 'kind_decision') },
  ]

  const clearFilters = () => {
    setQuery('')
    setKind('all')
    setSort('newest')
  }

  return (
    <div className="space-y-4 pb-3">
      <div>
        <h1 className="section-title !mb-1">{t(locale, 'nav_archive')}</h1>
        <p className="text-xs leading-6 text-[var(--color-ink-soft)]">
          {locale === 'ar'
            ? 'حوّل الجلسات السابقة إلى معرفة قابلة للعثور والرجوع إليها. ابحث في العناوين والأهداف والمساهمات.'
            : locale === 'fr'
              ? 'Retrouvez les sessions passées en recherchant dans les titres, objectifs et contributions.'
              : 'Find past sessions by searching titles, purposes, and contributions.'}
        </p>
      </div>

      <label className="relative block">
        <Search size={18} className="pointer-events-none absolute start-3 top-1/2 -translate-y-1/2 text-[var(--color-ink-soft)]" />
        <input
          className="input !ps-10"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={locale === 'ar' ? 'ابحث في الأرشيف…' : locale === 'fr' ? 'Rechercher dans les archives…' : 'Search the archive…'}
          aria-label={locale === 'ar' ? 'البحث في الأرشيف' : 'Search archive'}
        />
      </label>

      <div className="flex gap-2 overflow-x-auto pb-1">
        {filters.map((filter) => (
          <button
            key={filter.id}
            type="button"
            aria-pressed={kind === filter.id}
            className={['min-h-11 shrink-0 rounded-full px-4 text-xs font-bold transition', kind === filter.id ? 'bg-[var(--color-primary)] text-[#062b30]' : 'border border-[var(--color-border)] bg-[var(--color-surface-2)] text-[var(--color-ink-muted)]'].join(' ')}
            onClick={() => setKind(filter.id)}
          >
            {filter.label}
          </button>
        ))}
      </div>

      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-semibold text-[var(--color-ink-muted)]">
          {filtered.length} {locale === 'ar' ? 'جلسة في النتائج' : locale === 'fr' ? 'sessions' : 'sessions'}
        </span>
        <div className="flex gap-1 rounded-full bg-[var(--color-surface-2)] p-1">
          <button
            type="button"
            className={['min-h-9 rounded-full px-3 text-[10px] font-bold', sort === 'newest' ? 'bg-[var(--color-surface)] text-[var(--color-ink)] shadow-sm' : 'text-[var(--color-ink-soft)]'].join(' ')}
            onClick={() => setSort('newest')}
          >
            {locale === 'ar' ? 'الأحدث' : locale === 'fr' ? 'Récentes' : 'Newest'}
          </button>
          <button
            type="button"
            className={['min-h-9 rounded-full px-3 text-[10px] font-bold', sort === 'active' ? 'bg-[var(--color-surface)] text-[var(--color-ink)] shadow-sm' : 'text-[var(--color-ink-soft)]'].join(' ')}
            onClick={() => setSort('active')}
          >
            {locale === 'ar' ? 'الأكثر ثراءً' : locale === 'fr' ? 'Plus riches' : 'Most contributions'}
          </button>
        </div>
      </div>

      {error ? (
        <div role="alert" className="card space-y-2 border border-[var(--color-danger)]/40 text-sm">
          <p className="text-[var(--color-danger)]">{error}</p>
          <button type="button" className="btn btn-secondary w-full" onClick={() => void loadPage(0)}>
            {locale === 'ar' ? 'إعادة المحاولة' : locale === 'fr' ? 'Réessayer' : 'Retry'}
          </button>
        </div>
      ) : null}

      {filtered.length === 0 ? (
        <div className="empty card space-y-3 py-8">
          <div className="text-3xl">◎</div>
          <div className="font-bold">
            {loading
              ? (locale === 'ar' ? 'جارٍ تحميل الأرشيف…' : locale === 'fr' ? 'Chargement…' : 'Loading archive…')
              : query || kind !== 'all'
                ? (locale === 'ar' ? 'لا توجد نتائج مطابقة' : locale === 'fr' ? 'Aucun résultat' : 'No matching results')
                : t(locale, 'empty_archive')}
          </div>
          {query || kind !== 'all' ? (
            <button type="button" className="btn btn-secondary mx-auto !min-h-10" onClick={clearFilters}>
              {locale === 'ar' ? 'مسح البحث والتصفية' : locale === 'fr' ? 'Effacer les filtres' : 'Clear filters'}
            </button>
          ) : null}
          {!loading && loaded && sessions.length === 0 ? (
            <p className="text-xs text-[var(--color-ink-soft)]">
              {locale === 'ar' ? 'ستظهر الجلسات هنا بعد إغلاقها.' : locale === 'fr' ? 'Les sessions apparaîtront ici après leur fermeture.' : 'Closed sessions will appear here.'}
            </p>
          ) : null}
        </div>
      ) : (
        <div className="space-y-3">
          {filtered.map((session) => {
            const activityCount = contributionIndex.get(session.id)?.count || 0
            const closedAt = session.closedAt || session.closesAt
            return (
              <button
                key={session.id}
                type="button"
                className="card w-full space-y-2.5 text-start transition hover:border-[var(--color-primary)]"
                onClick={() => go('summary', session.id)}
              >
                <span className="flex flex-wrap items-center justify-between gap-2">
                  <span className="badge">{kindLabel(session.kind, locale)}</span>
                  <span className="text-[10px] text-[var(--color-ink-soft)]">
                    {new Date(closedAt).toLocaleDateString(locale, { day: 'numeric', month: 'short', year: 'numeric' })}
                  </span>
                </span>
                <span className="block font-bold leading-6">{session.title}</span>
                <span className="block text-sm leading-6 text-[var(--color-ink-muted)]">{session.purpose}</span>
                <span className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-[var(--color-border)] pt-2 text-[11px] text-[var(--color-ink-soft)]">
                  <span className="inline-flex items-center gap-1"><Users size={14} />{session.participantIds.length} {locale === 'ar' ? 'مشارك' : 'participants'}</span>
                  <span className="inline-flex items-center gap-1"><MessageCircle size={14} />{activityCount} {locale === 'ar' ? 'إسهامة' : 'contributions'}</span>
                  <span className="inline-flex items-center gap-1"><Clock3 size={13} />{session.ownerName}</span>
                </span>
              </button>
            )
          })}
        </div>
      )}

      {hasMore ? (
        <button type="button" className="btn btn-secondary w-full" onClick={() => void loadPage(nextOffset)} disabled={loading}>
          {loading
            ? (locale === 'ar' ? 'جارٍ التحميل…' : locale === 'fr' ? 'Chargement…' : 'Loading…')
            : (locale === 'ar' ? 'تحميل جلسات أقدم' : locale === 'fr' ? 'Charger plus' : 'Load older sessions')}
        </button>
      ) : null}
    </div>
  )
}
