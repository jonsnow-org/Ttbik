import { Archive, BookOpen, Layers, PlusCircle, Scale, Sparkles, Users } from 'lucide-react'
import { t } from '../lib/i18n'
import { useFadaa } from '../lib/store'
import type { SessionKind } from '../lib/types'
import { getDailyPrompt } from '../lib/prompts'
import { getFadaaBotLink } from '../lib/api'

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
  const setDraft = useFadaa((s) => s.setDraft)
  const sessions = useFadaa((s) => s.sessions)
  const openCount = sessions.filter((session) => session.status === 'open' && session.visibility === 'public').length
  const peopleCount = sessions.reduce((total, session) => total + session.participantIds.length, 0)

  return (
    <div className="space-y-5 pb-3">
      <section className="fadaa-home-hero relative overflow-hidden rounded-3xl border border-white/10 p-5 text-white shadow-xl">
        <div className="absolute -end-10 -top-12 h-44 w-44 rounded-full bg-teal-300/20 blur-3xl" />
        <div className="relative space-y-3">
          <span className="inline-flex items-center gap-2 rounded-full border border-teal-300/20 bg-teal-300/10 px-3 py-1 text-[11px] font-bold text-teal-100">
            <span className="h-2 w-2 rounded-full bg-emerald-400" />
            {locale === 'ar' ? 'مساحة تعاون حيّة' : locale === 'fr' ? 'Espace de collaboration' : 'Live collaboration space'}
          </span>
          <h1 className="font-[family-name:var(--font-display)] text-3xl font-bold">فضاء</h1>
          <p className="max-w-sm text-sm leading-7 text-slate-100">
            {locale === 'ar'
              ? 'حوّل السؤال إلى جلسة واضحة. اختر دورك، أضف ما تعرفه، واترك خلاصة مفيدة تبقى بعد انتهاء الجلسة.'
              : locale === 'fr'
                ? 'Transformez une question en session structurée. Choisissez un rôle, partagez vos idées et gardez un résumé utile.'
                : 'Turn a question into a focused session. Choose a role, contribute what you know, and keep a useful summary.'}
          </p>
          <button type="button" className="btn w-full bg-teal-300 text-teal-950 hover:bg-teal-200" onClick={() => go('create')}>
            <PlusCircle size={20} />
            {t(locale, 'open_session')}
          </button>
        </div>
      </section>

      {(() => {
        const prompt = getDailyPrompt(locale)
        const challengeLabel = locale === 'ar' ? 'تحدي اليوم' : locale === 'fr' ? 'Défi du jour' : 'Daily challenge'
        const startLabel = locale === 'ar' ? 'ابدأ جلسة بهذا السؤال' : locale === 'fr' ? 'Lancer une session' : 'Start a session'
        const shareLabel = locale === 'ar' ? 'شارك التحدي' : locale === 'fr' ? 'Partager' : 'Share challenge'
        const share = async () => {
          const text = `${challengeLabel}: ${prompt.question}`
          try {
            const botLink = await getFadaaBotLink()
            const url = `https://t.me/share/url?${new URLSearchParams({ url: botLink, text })}`
            const telegram = (window as Window & { Telegram?: { WebApp?: { openTelegramLink?: (url: string) => void } } }).Telegram?.WebApp
            if (telegram?.openTelegramLink) telegram.openTelegramLink(url)
            else if (navigator.share) await navigator.share({ title: challengeLabel, text, url: botLink })
            else await navigator.clipboard?.writeText(`${text} ${botLink}`)
          } catch {
            if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(text).catch(() => null)
          }
        }
        return (
          <section className="relative overflow-hidden rounded-3xl border border-amber-300/20 bg-gradient-to-br from-amber-500/15 via-orange-500/10 to-transparent p-4">
            <div className="flex items-center justify-between gap-2">
              <span className="rounded-full bg-amber-400/15 px-3 py-1 text-[11px] font-bold text-amber-200">✦ {challengeLabel}</span>
              <span className="text-[10px] text-[var(--color-ink-soft)]">{locale === 'ar' ? 'يتجدد كل يوم' : locale === 'fr' ? 'Chaque jour' : 'Changes daily'}</span>
            </div>
            <h2 className="mt-3 text-base font-extrabold leading-7 text-[var(--color-ink)]">{prompt.question}</h2>
            <p className="mt-1 text-xs leading-6 text-[var(--color-ink-muted)]">{prompt.purpose}</p>
            <div className="mt-3 grid grid-cols-[1fr_auto] gap-2">
              <button
                type="button"
                className="btn btn-primary !min-h-10"
                onClick={() => {
                  setDraft({ kind: prompt.kind, title: prompt.title, purpose: prompt.purpose })
                  go('create')
                }}
              >
                {startLabel}
              </button>
              <button type="button" className="btn btn-secondary !min-h-10 !px-3" onClick={share}>
                {shareLabel}
              </button>
            </div>
          </section>
        )
      })()}

      <div className="grid grid-cols-2 gap-3">
        <div className="card flex items-center gap-3">
          <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-[var(--color-primary-soft)] text-[var(--color-primary)]"><Layers size={20} /></span>
          <div><div className="text-xl font-extrabold tabular-nums">{openCount}</div><div className="text-[11px] text-[var(--color-ink-soft)]">{locale === 'ar' ? 'جلسات مفتوحة' : 'Open sessions'}</div></div>
        </div>
        <div className="card flex items-center gap-3">
          <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-[var(--color-primary-soft)] text-[var(--color-primary)]"><Users size={20} /></span>
          <div><div className="text-xl font-extrabold tabular-nums">{peopleCount}</div><div className="text-[11px] text-[var(--color-ink-soft)]">{locale === 'ar' ? 'مشاركة في الجلسات' : 'Participants'}</div></div>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2.5">
        <button type="button" className="btn btn-secondary w-full" onClick={() => go('sessions')}>
          <Layers size={18} />
          {t(locale, 'enter_open')}
        </button>
        <button type="button" className="btn btn-secondary w-full" onClick={() => go('archive')}>
          <Archive size={18} />
          {t(locale, 'browse_summaries')}
        </button>
      </div>

      <section className="space-y-3">
        <div>
          <h2 className="section-title !mb-1">{locale === 'ar' ? 'ابدأ من نوع الجلسة' : locale === 'fr' ? 'Choisir un type' : 'Choose a session type'}</h2>
          <p className="text-xs text-[var(--color-ink-soft)]">{locale === 'ar' ? 'لكل جلسة هدف واضح وطريقة مساهمة مختلفة.' : 'Each session has a clear purpose and contribution style.'}</p>
        </div>
        <div className="grid gap-2.5">
          {kinds.map((item) => {
            const Icon = item.icon
            return (
              <button
                key={item.id}
                type="button"
                className="card flex w-full items-center gap-3 text-start transition active:scale-[0.99]"
                onClick={() => go('create')}
              >
                <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl" style={{ background: 'var(--color-primary-soft)', color: 'var(--color-primary)' }}>
                  <Icon size={22} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block font-bold text-[var(--color-ink)]">{t(locale, item.label)}</span>
                  <span className="mt-1 block text-xs leading-5 text-[var(--color-ink-muted)]">{t(locale, item.desc)}</span>
                </span>
                <span className="text-lg text-[var(--color-ink-soft)]">‹</span>
              </button>
            )
          })}
        </div>
      </section>

      <p className="text-center text-[10px] leading-5 text-[var(--color-ink-soft)]">
        {locale === 'ar'
          ? 'الجلسات والإسهامات تُحفظ مركزياً وتُحدّث بين المشاركين.'
          : 'Sessions and contributions are stored centrally and synced between participants.'}
      </p>
    </div>
  )
}
