import type { ReactNode } from 'react'
import { useEffect, useState } from 'react'
import { Shell } from './components/Shell'
import { useFadaa } from './lib/store'
import { refreshFadaaSnapshot } from './lib/api'
import { ArchiveScreen } from './screens/Archive'
import { CreateScreen } from './screens/Create'
import { HomeScreen } from './screens/Home'
import { JoinScreen } from './screens/Join'
import { MineScreen } from './screens/Mine'
import { RoomScreen } from './screens/Room'
import { SessionsScreen } from './screens/Sessions'
import { SummaryScreen } from './screens/Summary'

export default function App() {
  const ready = useFadaa((s) => s.ready)
  const screen = useFadaa((s) => s.screen)
  const setReady = useFadaa((s) => s.setReady)
  const [loadError, setLoadError] = useState<string | null>(null)

  useEffect(() => {
    let active = true
    setReady(false)
    refreshFadaaSnapshot()
      .then((payload) => {
        if (!active) return
        setLoadError(null)
        const requestedSessionId = new URLSearchParams(window.location.search).get('session')
        const invitedSession = requestedSessionId
          ? payload.sessions?.find((session) => session.id === requestedSessionId)
          : null
        if (invitedSession) {
          const joined = Boolean(payload.user && invitedSession.roles[payload.user.id])
          useFadaa.setState({
            screen: invitedSession.status === 'closed' ? 'summary' : joined ? 'room' : 'join',
            activeSessionId: invitedSession.id,
          })
        }
      })
      .catch((error: unknown) => {
        if (!active) return
        const message = error instanceof Error ? error.message : 'تعذّر تحميل فضاء.'
        setLoadError(message)
        // Never present persisted demo or stale local data as live shared sessions.
        useFadaa.setState({ sessions: [], contributions: [], supervisor: false })
      })
      .finally(() => {
        if (active) setReady(true)
      })
    return () => { active = false }
  }, [setReady])

  useEffect(() => {
    if (!ready || loadError) return
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') {
        void refreshFadaaSnapshot().catch(() => null)
      }
    }, 15000)
    return () => window.clearInterval(timer)
  }, [ready, loadError])

  if (!ready) {
    return (
      <div className="grid min-h-dvh place-items-center bg-[var(--color-bg)] text-[var(--color-primary-ink)]">
        <div className="space-y-3 text-center">
          <div className="font-[family-name:var(--font-display)] text-3xl font-bold">فضاء</div>
          <div className="text-xs text-[var(--color-ink-soft)]">جارٍ الاتصال بقاعدة البيانات والتحقق من حسابك…</div>
          <div className="mx-auto h-1.5 w-28 overflow-hidden rounded-full bg-[var(--color-surface-2)]">
            <div className="h-full w-2/3 animate-pulse rounded-full bg-[var(--color-primary)]" />
          </div>
        </div>
      </div>
    )
  }

  if (loadError) {
    return (
      <div className="grid min-h-dvh place-items-center bg-[var(--color-bg)] px-6 text-[var(--color-ink)]">
        <div className="w-full max-w-sm space-y-4 text-center">
          <div className="font-[family-name:var(--font-display)] text-3xl font-bold">فضاء</div>
          <div className="card text-sm leading-7">{loadError}</div>
          <button type="button" className="btn btn-primary w-full" onClick={() => window.location.reload()}>
            إعادة المحاولة
          </button>
          <p className="text-xs text-[var(--color-ink-soft)]">يجب فتح فضاء من زر التطبيق المصغر داخل محادثة البوت.</p>
        </div>
      </div>
    )
  }

  let body: ReactNode
  switch (screen) {
    case 'home': body = <HomeScreen />; break
    case 'sessions': body = <SessionsScreen />; break
    case 'create': body = <CreateScreen />; break
    case 'join': body = <JoinScreen />; break
    case 'room': body = <RoomScreen />; break
    case 'summary': body = <SummaryScreen />; break
    case 'archive': body = <ArchiveScreen />; break
    case 'mine': body = <MineScreen />; break
    case 'packages':
    case 'admin':
    default: body = <HomeScreen />
  }

  return <Shell>{body}</Shell>
}
