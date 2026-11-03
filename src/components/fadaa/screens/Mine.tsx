import { Award, MessageCircle, Users, Layers, PlusCircle } from 'lucide-react'
import { t } from '../lib/i18n'
import { useFadaa } from '../lib/store'

export function MineScreen() {
  const locale = useFadaa((s) => s.locale)
  const user = useFadaa((s) => s.user)
  const userId = user.id
  const allSessions = useFadaa((s) => s.sessions)
  const allContributions = useFadaa((s) => s.contributions)
  const go = useFadaa((s) => s.go)

  const mySessions = allSessions
    .filter((session) => session.ownerId === userId || session.participantIds.includes(userId))
    .sort((a, b) => b.createdAt - a.createdAt)
  const created = mySessions.filter((session) => session.ownerId === userId)
  const participated = mySessions.filter((session) => session.ownerId !== userId)
  const myContributions = allContributions
    .filter((contribution) => contribution.authorId === userId && !contribution.hidden)
    .sort((a, b) => b.createdAt - a.createdAt)
  const peopleMet = new Set(
    mySessions.flatMap((session) => session.participantIds).filter((id) => id !== userId),
  ).size
  const badge = myContributions.length >= 10
    ? (locale === 'ar' ? 'صانع أثر' : locale === 'fr' ? 'Bâtisseur d’impact' : 'Impact builder')
    : myContributions.length >= 3
      ? (locale === 'ar' ? 'صوت نشط' : locale === 'fr' ? 'Voix active' : 'Active voice')
      : created.length > 0
        ? (locale === 'ar' ? 'منظّم جلسات' : locale === 'fr' ? 'Organisateur' : 'Session host')
        : (locale === 'ar' ? 'عضو جديد' : locale === 'fr' ? 'Nouveau membre' : 'New member')

  const sessionTitle = (id: string) => allSessions.find((session) => session.id === id)?.title || ''

  return (
    <div className="space-y-4">
      <section className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-indigo-500/20 via-[var(--color-surface)] to-teal-500/10 p-4">
        <div className="flex items-center gap-3">
          <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-[var(--color-primary-soft)] text-2xl font-black text-[var(--color-primary)]">
            {(user.name || '؟').slice(0, 1)}
          </div>
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-lg font-extrabold">{user.name}</h1>
            <span className="mt-1 inline-flex items-center gap-1 rounded-full bg-[var(--color-primary-soft)] px-2.5 py-1 text-[10px] font-bold text-[var(--color-primary)]">
              <Award size={12} /> {badge}
            </span>
          </div>
        </div>
        <p className="mt-3 text-xs leading-6 text-[var(--color-ink-muted)]">
          {locale === 'ar'
            ? 'كل جلسة تبدأ بسؤال، وكل مساهمة تضيف معرفة وخبرة إلى المجتمع.'
            : locale === 'fr'
              ? 'Chaque session commence par une question, chaque contribution enrichit la communauté.'
              : 'Every session starts with a question, and every contribution adds value to the community.'}
        </p>
      </section>

      <div className="grid grid-cols-2 gap-2.5">
        <div className="card space-y-1">
          <div className="flex items-center gap-2 text-[var(--color-primary)]"><Layers size={16} /><span className="text-[10px] font-bold">{locale === 'ar' ? 'جلسات نظمتها' : 'Hosted sessions'}</span></div>
          <div className="text-2xl font-extrabold tabular-nums">{created.length}</div>
        </div>
        <div className="card space-y-1">
          <div className="flex items-center gap-2 text-[var(--color-primary)]"><MessageCircle size={16} /><span className="text-[10px] font-bold">{locale === 'ar' ? 'إسهاماتك' : 'Contributions'}</span></div>
          <div className="text-2xl font-extrabold tabular-nums">{myContributions.length}</div>
        </div>
        <div className="card space-y-1">
          <div className="flex items-center gap-2 text-[var(--color-primary)]"><Users size={16} /><span className="text-[10px] font-bold">{locale === 'ar' ? 'أشخاص تفاعلت معهم' : 'People reached'}</span></div>
          <div className="text-2xl font-extrabold tabular-nums">{peopleMet}</div>
        </div>
        <div className="card space-y-1">
          <div className="flex items-center gap-2 text-[var(--color-primary)]"><Award size={16} /><span className="text-[10px] font-bold">{locale === 'ar' ? 'جلسات شاركت بها' : 'Joined sessions'}</span></div>
          <div className="text-2xl font-extrabold tabular-nums">{participated.length}</div>
        </div>
      </div>

      <section className="card space-y-3">
        <div className="flex items-center justify-between gap-2">
          <div>
            <h2 className="font-bold">{locale === 'ar' ? 'تقدمك في فضاء' : locale === 'fr' ? 'Votre progression' : 'Your progress'}</h2>
            <p className="mt-1 text-[10px] text-[var(--color-ink-soft)]">{locale === 'ar' ? 'الشارات تُحسب من نشاطك الحقيقي' : 'Badges are based on your actual activity'}</p>
          </div>
          <span className="text-2xl">✦</span>
        </div>
        <div className="space-y-2">
          {[
            { label: locale === 'ar' ? 'أول إسهامة' : 'First contribution', done: myContributions.length >= 1 },
            { label: locale === 'ar' ? 'صوت نشط · 3 إسهامات' : 'Active voice · 3 contributions', done: myContributions.length >= 3 },
            { label: locale === 'ar' ? 'صانع أثر · 10 إسهامات' : 'Impact builder · 10 contributions', done: myContributions.length >= 10 },
            { label: locale === 'ar' ? 'منظّم · أنشئ جلسة' : 'Host · create a session', done: created.length >= 1 },
          ].map((milestone) => (

              <div key={milestone.label} className="flex items-center gap-2">
                <span className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs ${milestone.done ? 'bg-emerald-500/15 text-emerald-400' : 'bg-[var(--color-surface-2)] text-[var(--color-ink-soft)]'}`}>
                  {milestone.done ? '✓' : '·'}
                </span>
                <span className={`flex-1 text-xs ${milestone.done ? 'font-semibold' : 'text-[var(--color-ink-soft)]'}`}>{milestone.label}</span>
              </div>
          ))}

        </div>
      </section>

      <section className="space-y-2">
        <div className="flex items-center justify-between">
          <h2 className="section-title !mb-0">{locale === 'ar' ? 'جلساتك' : locale === 'fr' ? 'Vos sessions' : 'Your sessions'}</h2>
          <button type="button" className="btn btn-ghost !min-h-8 !px-2 !text-xs" onClick={() => go('create')}>
            <PlusCircle size={15} /> {locale === 'ar' ? 'جلسة جديدة' : 'New session'}
          </button>
        </div>
        {mySessions.length === 0 ? (
          <div className="card space-y-3 py-6 text-center">
            <p className="text-sm text-[var(--color-ink-soft)]">{t(locale, 'empty_mine')}</p>
            <button type="button" className="btn btn-primary mx-auto !min-h-10" onClick={() => go('create')}>
              {t(locale, 'open_session')}
            </button>
          </div>
        ) : (
          mySessions.map((session) => (
            <button
              key={session.id}
              type="button"
              className="card flex w-full items-center gap-3 text-start"
              onClick={() => go(session.status === 'closed' ? 'summary' : session.roles[userId] ? 'room' : 'join', session.id)}
            >
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[var(--color-primary-soft)] text-[var(--color-primary)]">
                {session.ownerId === userId ? '✦' : '↗'}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-bold">{session.title}</span>
                <span className="mt-1 block text-[10px] text-[var(--color-ink-soft)]">
                  {session.ownerId === userId
                    ? (locale === 'ar' ? 'أنشأتها' : 'Created by you')
                    : (locale === 'ar' ? 'شاركت بها' : 'You joined')}
                  {' · '}{session.status === 'closed' ? (locale === 'ar' ? 'مغلقة' : 'Closed') : (locale === 'ar' ? 'مفتوحة' : 'Open')}
                </span>
              </span>
              <span className="text-xs text-[var(--color-ink-soft)]">{session.participantIds.length} {locale === 'ar' ? 'أشخاص' : 'people'}</span>
            </button>
          ))
        )}
      </section>

      {myContributions.length > 0 ? (
        <section className="space-y-2">
          <h2 className="section-title">{locale === 'ar' ? 'آخر إسهاماتك' : 'Your recent contributions'}</h2>
          {myContributions.slice(0, 5).map((contribution) => (
            <button
              key={contribution.id}
              type="button"
              className="card w-full text-start"
              onClick={() => {
                const target = allSessions.find((session) => session.id === contribution.sessionId)
                if (target) go(target.status === 'closed' ? 'summary' : 'room', target.id)
              }}
            >
              <div className="mb-1 text-[10px] font-bold text-[var(--color-primary)]">{sessionTitle(contribution.sessionId)}</div>
              <p className="line-clamp-3 text-xs leading-6 text-[var(--color-ink-muted)]">{contribution.text}</p>
            </button>
          ))}
        </section>
      ) : null}
    </div>
  )
}
