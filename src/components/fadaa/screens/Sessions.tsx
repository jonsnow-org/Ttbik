import { useEffect } from 'react'
import { t } from '../lib/i18n'
import { formatRemaining, peopleCount, useFadaa } from '../lib/store'
import type { SessionKind } from '../lib/types'

function kindLabel(kind: SessionKind, locale: 'ar' | 'en' | 'fr') {
  if (kind === 'knowledge') return t(locale, 'kind_knowledge')
  if (kind === 'experience') return t(locale, 'kind_experience')
  return t(locale, 'kind_decision')
}

export function SessionsScreen() {
  const locale = useFadaa((s) => s.locale)
  const sessions = useFadaa((s) => s.sessions)
  const go = useFadaa((s) => s.go)
  const tickClose = useFadaa((s) => s.tickClose)
  const now = Date.now()

  useEffect(() => {
    tickClose()
    const id = setInterval(tickClose, 30_000)
    return () => clearInterval(id)
  }, [tickClose])

  const open = sessions.filter((s) => s.status === 'open' && s.visibility === 'public')

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2">
        <h1 className="section-title !mb-0">{t(locale, 'nav_sessions')}</h1>
        <button type="button" className="btn btn-primary !min-h-10 !px-3 !text-sm" onClick={() => go('create')}>
          {t(locale, 'open_session')}
        </button>
      </div>

      {open.length === 0 ? (
        <div className="empty card">{t(locale, 'empty_sessions')}</div>
      ) : (
        <div className="space-y-3">
          {open.map((s) => (
            <article key={s.id} className="card space-y-2">
              <div className="flex flex-wrap items-center gap-2">
                <span className="badge">{kindLabel(s.kind, locale)}</span>
                <span className="countdown">{t(locale, 'remaining')}: {formatRemaining(s.closesAt - now, locale)}</span>
              </div>
              <h3 className="text-base font-bold leading-snug">{s.title}</h3>
              <p className="text-sm text-[var(--color-ink-muted)]">{s.purpose}</p>
              <div className="flex items-center justify-between gap-2 pt-1">
                <span className="text-xs text-[var(--color-ink-soft)]">
                  {peopleCount(s.participantIds.length, locale)}
                </span>
                <button
                  type="button"
                  className="btn btn-primary !min-h-10 !px-4 !text-sm"
                  onClick={() => go('join', s.id)}
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
