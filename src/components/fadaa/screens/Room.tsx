import { useEffect, useState } from 'react'
import { CONTRIB_KINDS, t } from '../lib/i18n'
import { formatRemaining, peopleCount, useFadaa } from '../lib/store'
import { fadaaAction, getFadaaInviteLink, refreshFadaaSnapshot } from '../lib/api'
import type { ContributionKind } from '../lib/types'

export function RoomScreen() {
  const locale = useFadaa((s) => s.locale)
  const id = useFadaa((s) => s.activeSessionId)
  const session = useFadaa((s) => s.sessions.find((item) => item.id === id))
  const contributions = useFadaa((s) => s.contributions.filter((item) => item.sessionId === id && !item.hidden))
  const user = useFadaa((s) => s.user)
  const go = useFadaa((s) => s.go)
  const showToast = useFadaa((s) => s.showToast)

  const [openForm, setOpenForm] = useState(false)
  const [kind, setKind] = useState<ContributionKind | ''>('')
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [sharing, setSharing] = useState(false)
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [])

  if (!session) return <div className="empty card">{t(locale, 'empty_sessions')}</div>

  const role = session.roles[user.id]
  if (!role) {
    go('join', session.id)
    return null
  }
  if (session.status === 'closed') {
    go('summary', session.id)
    return null
  }

  const kinds = CONTRIB_KINDS[locale][session.kind] ?? CONTRIB_KINDS.ar[session.kind]
  const remaining = session.closesAt - now
  const isSessionOwner = session.ownerId === user.id

  const submit = async () => {
    if (!kind || !text.trim() || busy) return
    setBusy(true)
    setError(null)
    try {
      await fadaaAction('add_contribution', { sessionId: session.id, kind, text: text.trim() })
      await refreshFadaaSnapshot()
      setText('')
      setKind('')
      setOpenForm(false)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'تعذّر حفظ الإسهامة.')
    } finally {
      setBusy(false)
    }
  }

  const shareInvite = async () => {
    if (sharing) return
    setSharing(true)
    setError(null)
    try {
      const inviteLink = await getFadaaInviteLink(session.id)
      const invitationText = locale === 'ar'
        ? `انضم إلى جلسة «${session.title}» على فضاء وشارك برأيك:`
        : locale === 'fr'
          ? `Rejoignez la session « ${session.title} » sur Fadaa :`
          : `Join “${session.title}” on Fadaa and add your perspective:`
      const shareUrl = `https://t.me/share/url?${new URLSearchParams({ url: inviteLink, text: invitationText })}`
      const telegram = (window as Window & { Telegram?: { WebApp?: { openTelegramLink?: (url: string) => void } } }).Telegram?.WebApp
      if (telegram?.openTelegramLink) {
        telegram.openTelegramLink(shareUrl)
      } else if (navigator.share) {
        await navigator.share({ title: session.title, text: invitationText, url: inviteLink })
      } else if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(inviteLink)
        showToast(locale === 'ar' ? 'تم نسخ رابط الدعوة' : 'Invite link copied')
      } else {
        window.prompt(locale === 'ar' ? 'انسخ رابط الدعوة' : 'Copy invitation link', inviteLink)
      }
    } catch (cause) {
      if (cause instanceof Error && cause.name === 'AbortError') return
      setError(cause instanceof Error ? cause.message : 'تعذّر إنشاء رابط الدعوة.')
    } finally {
      setSharing(false)
    }
  }

  const close = async () => {
    if (!isSessionOwner || busy) return
    setBusy(true)
    setError(null)
    try {
      await fadaaAction('close_session', { sessionId: session.id })
      await refreshFadaaSnapshot()
      go('summary', session.id)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'تعذّر إغلاق الجلسة.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-4">
      <button type="button" className="btn btn-ghost !px-0" onClick={() => go('sessions')}>
        ← {t(locale, 'back')}
      </button>

      <div className="card space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <span className="badge">
            {session.kind === 'knowledge' ? t(locale, 'kind_knowledge') : session.kind === 'experience' ? t(locale, 'kind_experience') : t(locale, 'kind_decision')}
          </span>
          <span className="countdown">{t(locale, 'remaining')}: {formatRemaining(remaining, locale)}</span>
        </div>
        <h1 className="text-lg font-bold leading-snug">{session.title}</h1>
        <div className="text-xs text-[var(--color-ink-soft)]">
          {peopleCount(session.participantIds.length, locale)} · {role}
        </div>
      </div>

      <section className="card flex items-center gap-3 border border-[var(--color-primary)]/30 bg-[var(--color-primary-soft)]/30">
        <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-[var(--color-primary-soft)] text-xl">↗</span>
        <div className="min-w-0 flex-1">
          <div className="font-bold text-sm">{locale === 'ar' ? 'كبّر دائرة النقاش' : locale === 'fr' ? 'Invitez à participer' : 'Bring more voices in'}</div>
          <p className="mt-0.5 text-[11px] leading-5 text-[var(--color-ink-soft)]">
            {locale === 'ar' ? 'أرسل دعوة مباشرة لهذه الجلسة. يفتح صديقك المحادثة ثم يدخل إلى الجلسة بضغطة.' : locale === 'fr' ? 'Partagez un lien direct vers cette session.' : 'Share a direct invitation to this session.'}
          </p>
        </div>
        <button type="button" className="btn btn-primary !min-h-10 !px-3 !text-xs" onClick={shareInvite} disabled={sharing}>
          {sharing ? (locale === 'ar' ? 'جارٍ…' : '…') : (locale === 'ar' ? 'دعوة' : locale === 'fr' ? 'Inviter' : 'Invite')}
        </button>
      </section>

      <section className="card">
        <h2 className="section-title">{t(locale, 'purpose')}</h2>
        <p className="text-sm leading-relaxed text-[var(--color-ink-muted)]">{session.purpose}</p>
      </section>

      <section className="space-y-2">
        <div className="flex items-center justify-between gap-2">
          <h2 className="section-title !mb-0">{t(locale, 'building')}</h2>
          <span className="text-xs text-[var(--color-ink-soft)]">{contributions.length} إسهامة</span>
        </div>
        {contributions.length === 0 ? (
          <div className="empty card">{t(locale, 'no_contributions')}</div>
        ) : (
          contributions.map((item) => (
            <article key={item.id} className="card space-y-1">
              <div className="flex flex-wrap items-center gap-2 text-xs">
                <span className="badge">{kinds.find((choice) => choice.id === item.kind)?.label || item.kind}</span>
                <span className="font-semibold text-[var(--color-ink)]">{item.authorName}</span>
                <span className="text-[var(--color-ink-soft)]">{item.role}</span>
              </div>
              <p className="text-sm leading-relaxed whitespace-pre-wrap">{item.text}</p>
              <time className="block text-end text-[10px] text-[var(--color-ink-soft)]" dateTime={new Date(item.createdAt).toISOString()}>
                {new Date(item.createdAt).toLocaleTimeString(locale === 'ar' ? 'ar' : locale, { hour: '2-digit', minute: '2-digit' })}
              </time>
            </article>
          ))
        )}
      </section>

      <section className="card space-y-2">
        <h2 className="section-title">{t(locale, 'live_summary')}</h2>
        <p className="text-sm text-[var(--color-ink-muted)]">
          {contributions.length === 0 ? '—' : contributions.slice(-3).map((item) => item.text).join(' · ')}
        </p>
      </section>

      {error ? <div role="alert" className="card border border-[var(--color-danger)] text-sm text-[var(--color-danger)]">{error}</div> : null}

      {!openForm ? (
        <button type="button" className="btn btn-primary w-full" onClick={() => setOpenForm(true)}>
          {t(locale, 'add_contribution')}
        </button>
      ) : (
        <div className="card space-y-3">
          <span className="label">{t(locale, 'contribution_type')}</span>
          <div className="flex flex-wrap gap-2">
            {kinds.map((item) => (
              <button
                key={item.id}
                type="button"
                className={`btn !min-h-10 !px-3 !text-sm ${kind === item.id ? 'btn-primary' : 'btn-secondary'}`}
                onClick={() => setKind(item.id as ContributionKind)}
              >
                {item.label}
              </button>
            ))}
          </div>
          <label className="block">
            <span className="label">{t(locale, 'write_text')}</span>
            <textarea className="input min-h-28" value={text} onChange={(event) => setText(event.target.value)} maxLength={2000} />
          </label>
          <div className="flex gap-2">
            <button type="button" className="btn btn-secondary flex-1" onClick={() => setOpenForm(false)} disabled={busy}>
              {t(locale, 'cancel')}
            </button>
            <button type="button" className="btn btn-primary flex-1" onClick={submit} disabled={!kind || !text.trim() || busy}>
              {busy ? 'جارٍ الحفظ…' : t(locale, 'send')}
            </button>
          </div>
        </div>
      )}

      {isSessionOwner ? (
        <button type="button" className="btn btn-secondary w-full" onClick={close} disabled={busy}>
          إغلاق الجلسة وإنهاؤها
        </button>
      ) : null}
    </div>
  )
}
