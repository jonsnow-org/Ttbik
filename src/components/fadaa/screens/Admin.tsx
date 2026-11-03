import { useMemo, useState } from 'react'
import { Eye, EyeOff, Layers3, MessageSquareText, RefreshCw, Search, ShieldCheck, Trash2, Users } from 'lucide-react'
import { fadaaAction, refreshFadaaSnapshot } from '../lib/api'
import { useFadaa } from '../lib/store'

type Filter = 'all' | 'visible' | 'hidden'

const words = {
  ar: {
    title: 'إدارة فضاء', subtitle: 'لوحة المالك لمتابعة الجلسات ومراجعة المشاركات.',
    owner: 'مالك البوت · دخول موثّق', open: 'جلسات مفتوحة', closed: 'جلسات مكتملة',
    contributions: 'الإسهامات', people: 'المشاركون', sessions: 'أحدث الجلسات',
    review: 'مراجعة الإسهامات', search: 'ابحث في النص أو اسم المشارك أو الجلسة',
    all: 'الكل', visible: 'ظاهرة', hidden: 'مخفية', hide: 'إخفاء',
    restore: 'إعادة الإظهار', remove: 'حذف نهائي', confirm: 'سيُحذف المحتوى نهائياً. هل تريد المتابعة؟',
    refresh: 'تحديث البيانات', refreshing: 'جارٍ التحديث…', noSessions: 'لا توجد جلسات بعد.',
    noItems: 'لا توجد إسهامات تطابق البحث.', isHidden: 'مخفية عن المشاركين',
    isVisible: 'ظاهرة للمشاركين', failed: 'تعذّر تنفيذ الإجراء. حاول مجدداً.',
    openState: 'مفتوحة', closedState: 'مغلقة', participants: 'مشارك', contribution: 'إسهامة',
    unnamed: 'جلسة', denied: 'هذه الصفحة مخصصة لمالك البوت فقط.',
    safe: 'الأرقام تخص البيانات المحمّلة حالياً (حتى آخر 80 جلسة). إجراءات الإخفاء والحذف تُحفظ في قاعدة البيانات.',
  },
  en: {
    title: 'Fadaa administration', subtitle: 'Owner dashboard for sessions and contribution review.',
    owner: 'Bot owner · verified access', open: 'Open sessions', closed: 'Completed sessions',
    contributions: 'Contributions', people: 'Participants', sessions: 'Recent sessions',
    review: 'Contribution review', search: 'Search text, participant, or session',
    all: 'All', visible: 'Visible', hidden: 'Hidden', hide: 'Hide',
    restore: 'Restore', remove: 'Delete permanently', confirm: 'This contribution will be permanently deleted. Continue?',
    refresh: 'Refresh data', refreshing: 'Refreshing…', noSessions: 'No sessions yet.',
    noItems: 'No contributions match this search.', isHidden: 'Hidden from participants',
    isVisible: 'Visible to participants', failed: 'The action failed. Please try again.',
    openState: 'Open', closedState: 'Closed', participants: 'participants', contribution: 'contributions',
    unnamed: 'Session', denied: 'This page is restricted to the bot owner.',
    safe: 'Counts cover the currently loaded data (up to the latest 80 sessions). Moderation actions are saved directly to the database.',
  },
  fr: {
    title: 'Administration de Fadaa', subtitle: 'Tableau du propriétaire pour suivre les sessions et modérer.',
    owner: 'Propriétaire du bot · accès vérifié', open: 'Sessions ouvertes', closed: 'Sessions terminées',
    contributions: 'Contributions', people: 'Participants', sessions: 'Sessions récentes',
    review: 'Modération des contributions', search: 'Rechercher un texte, un participant ou une session',
    all: 'Tout', visible: 'Visibles', hidden: 'Masquées', hide: 'Masquer',
    restore: 'Restaurer', remove: 'Supprimer définitivement', confirm: 'Cette contribution sera supprimée définitivement. Continuer ?',
    refresh: 'Actualiser', refreshing: 'Actualisation…', noSessions: 'Aucune session.',
    noItems: 'Aucune contribution ne correspond.', isHidden: 'Masquée aux participants',
    isVisible: 'Visible aux participants', failed: 'Action impossible. Réessayez.',
    openState: 'Ouverte', closedState: 'Fermée', participants: 'participants', contribution: 'contributions',
    unnamed: 'Session', denied: 'Cette page est réservée au propriétaire du bot.',
    safe: 'Les chiffres couvrent les données chargées (jusqu’aux 80 dernières sessions). La modération est enregistrée en base.',
  },
} as const

export function AdminScreen() {
  const locale = useFadaa((s) => s.locale)
  const isOwner = useFadaa((s) => s.supervisor)
  const sessions = useFadaa((s) => s.sessions)
  const contributions = useFadaa((s) => s.contributions)
  const go = useFadaa((s) => s.go)
  const labels = words[locale]
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<Filter>('all')
  const [busyId, setBusyId] = useState<string | null>(null)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const byId = new Map(sessions.map((session) => [session.id, session] as const))

  const openCount = sessions.filter((session) => session.status === 'open').length
  const closedCount = sessions.filter((session) => session.status === 'closed').length
  const peopleCount = new Set(sessions.flatMap((session) => session.participantIds)).size
  const filtered = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase(locale)
    return [...contributions]
      .filter((item) => filter === 'all' || (filter === 'hidden' ? item.hidden : !item.hidden))
      .filter((item) => {
        if (!needle) return true
        const session = sessions.find((candidate) => candidate.id === item.sessionId)
        return [item.text, item.authorName, item.role, session?.title]
          .some((value) => String(value || '').toLocaleLowerCase(locale).includes(needle))
      })
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, 40)
  }, [contributions, filter, locale, query, sessions])

  const refresh = async () => {
    if (refreshing) return
    setRefreshing(true)
    setError(null)
    try {
      await refreshFadaaSnapshot()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : labels.failed)
    } finally {
      setRefreshing(false)
    }
  }

  const moderate = async (id: string, action: 'hide_contribution' | 'unhide_contribution' | 'delete_contribution') => {
    if (busyId) return
    if (action === 'delete_contribution' && !window.confirm(labels.confirm)) return
    setBusyId(id)
    setError(null)
    try {
      await fadaaAction(action, { contributionId: id })
      await refreshFadaaSnapshot()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : labels.failed)
    } finally {
      setBusyId(null)
    }
  }

  if (!isOwner) return (
    <section className="card space-y-3 border border-[var(--color-danger)]/40">
      <p className="font-bold text-[var(--color-danger)]">{labels.denied}</p>
      <button type="button" className="btn btn-secondary w-full" onClick={() => go('home')}>
        {locale === 'ar' ? 'العودة للرئيسية' : locale === 'fr' ? 'Retour' : 'Back home'}
      </button>
    </section>
  )

  return (
    <div className="space-y-5 pb-4">
      <section className="admin-hero relative overflow-hidden rounded-[1.7rem] p-5 text-white">
        <div className="admin-hero-orb admin-hero-orb-one" />
        <div className="admin-hero-orb admin-hero-orb-two" />
        <div className="relative space-y-3">
          <span className="inline-flex items-center gap-2 rounded-full border border-white/20 bg-white/10 px-3 py-1.5 text-[11px] font-bold text-teal-50">
            <ShieldCheck size={14} />{labels.owner}
          </span>
          <h1 className="font-[family-name:var(--font-display)] text-2xl font-bold">{labels.title}</h1>
          <p className="text-sm leading-6 text-slate-200">{labels.subtitle}</p>
          <button type="button" className="btn admin-refresh-btn !min-h-10 !px-4 !text-xs" onClick={refresh} disabled={refreshing}>
            <RefreshCw size={15} className={refreshing ? 'animate-spin' : ''} />
            {refreshing ? labels.refreshing : labels.refresh}
          </button>
        </div>
      </section>

      <section className="grid grid-cols-2 gap-3">
        <div className="admin-stat-card"><span className="admin-stat-icon bg-emerald-400/15 text-emerald-300"><Layers3 size={19} /></span><strong>{openCount}</strong><span>{labels.open}</span></div>
        <div className="admin-stat-card"><span className="admin-stat-icon bg-sky-400/15 text-sky-300"><Layers3 size={19} /></span><strong>{closedCount}</strong><span>{labels.closed}</span></div>
        <div className="admin-stat-card"><span className="admin-stat-icon bg-amber-400/15 text-amber-300"><MessageSquareText size={19} /></span><strong>{contributions.length}</strong><span>{labels.contributions}</span></div>
        <div className="admin-stat-card"><span className="admin-stat-icon bg-violet-400/15 text-violet-300"><Users size={19} /></span><strong>{peopleCount}</strong><span>{labels.people}</span></div>
      </section>

      <section className="space-y-3">
        <h2 className="section-title !mb-0">{labels.sessions}</h2>
        {sessions.length === 0 ? <div className="empty card">{labels.noSessions}</div> : (
          <div className="space-y-2">
            {[...sessions].sort((a, b) => b.createdAt - a.createdAt).slice(0, 8).map((session) => (
              <article key={session.id} className="card space-y-2">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0"><h3 className="truncate text-sm font-bold">{session.title || labels.unnamed}</h3><p className="mt-1 text-[11px] text-[var(--color-ink-soft)]">{session.ownerName} · {session.participantIds.length} {labels.participants}</p></div>
                  <span className={`shrink-0 rounded-full px-2.5 py-1 text-[10px] font-bold ${session.status === 'open' ? 'bg-emerald-400/15 text-emerald-300' : 'bg-slate-400/15 text-[var(--color-ink-muted)]'}`}>{session.status === 'open' ? labels.openState : labels.closedState}</span>
                </div>
                <p className="line-clamp-2 text-xs leading-5 text-[var(--color-ink-muted)]">{session.purpose}</p>
                <div className="border-t border-[var(--color-border)] pt-2 text-[10px] text-[var(--color-ink-soft)]">{contributions.filter((item) => item.sessionId === session.id).length} {labels.contribution}</div>
              </article>
            ))}
          </div>
        )}
      </section>

      <section className="space-y-3">
        <div><h2 className="section-title !mb-1">{labels.review}</h2><p className="text-[11px] leading-5 text-[var(--color-ink-soft)]">{labels.safe}</p></div>
        <label className="relative block">
          <Search size={17} className="pointer-events-none absolute start-3 top-1/2 -translate-y-1/2 text-[var(--color-ink-soft)]" />
          <input className="input !min-h-11 !ps-10" value={query} onChange={(event) => setQuery(event.target.value)} placeholder={labels.search} />
        </label>
        <div className="flex gap-2">
          {(['all', 'visible', 'hidden'] as const).map((item) => (
            <button key={item} type="button" className={`btn !min-h-9 flex-1 !px-2 !text-xs ${filter === item ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setFilter(item)}>{labels[item]}</button>
          ))}
        </div>
        {error ? <div role="alert" className="card border border-[var(--color-danger)]/40 text-sm text-[var(--color-danger)]">{error}</div> : null}
        {filtered.length === 0 ? <div className="empty card">{labels.noItems}</div> : (
          <div className="space-y-2">
            {filtered.map((item) => {
              const session = byId.get(item.sessionId)
              const busy = busyId === item.id
              return (
                <article key={item.id} className="card space-y-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0"><div className="text-sm font-bold">{item.authorName}</div><div className="mt-1 truncate text-[10px] text-[var(--color-primary)]">{session?.title || labels.unnamed}</div></div>
                    <span className={`shrink-0 rounded-full px-2 py-1 text-[10px] font-bold ${item.hidden ? 'bg-amber-400/15 text-amber-300' : 'bg-emerald-400/15 text-emerald-300'}`}>{item.hidden ? labels.isHidden : labels.isVisible}</span>
                  </div>
                  <p className="whitespace-pre-wrap break-words text-sm leading-7 text-[var(--color-ink-muted)]">{item.text}</p>
                  <div className="flex flex-wrap items-center justify-between gap-2 border-t border-[var(--color-border)] pt-2">
                    <time className="text-[10px] text-[var(--color-ink-soft)]" dateTime={new Date(item.createdAt).toISOString()}>{new Date(item.createdAt).toLocaleString(locale === 'ar' ? 'ar' : locale, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</time>
                    <div className="flex gap-2">
                      <button type="button" className="btn btn-secondary !min-h-9 !px-3 !text-[11px]" disabled={busy || Boolean(busyId)} onClick={() => void moderate(item.id, item.hidden ? 'unhide_contribution' : 'hide_contribution')}>
                        {item.hidden ? <Eye size={14} /> : <EyeOff size={14} />}{item.hidden ? labels.restore : labels.hide}
                      </button>
                      <button type="button" className="btn btn-danger !min-h-9 !px-3 !text-[11px]" disabled={busy || Boolean(busyId)} onClick={() => void moderate(item.id, 'delete_contribution')}>
                        <Trash2 size={14} />{labels.remove}
                      </button>
                    </div>
                  </div>
                </article>
              )
            })}
          </div>
        )}
      </section>
    </div>
  )
}
