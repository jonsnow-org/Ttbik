import type { ReactNode } from 'react'
import { useEffect } from 'react'
import { Shell } from './components/Shell'
import { useFadaa } from './lib/store'
import { AdminScreen } from './screens/Admin'
import { ArchiveScreen } from './screens/Archive'
import { CreateScreen } from './screens/Create'
import { HomeScreen } from './screens/Home'
import { JoinScreen } from './screens/Join'
import { MineScreen } from './screens/Mine'
import { PackagesScreen } from './screens/Packages'
import { RoomScreen } from './screens/Room'
import { SessionsScreen } from './screens/Sessions'
import { SummaryScreen } from './screens/Summary'

export default function App() {
  const ready = useFadaa((s) => s.ready)
  const screen = useFadaa((s) => s.screen)
  const setReady = useFadaa((s) => s.setReady)
  const tickClose = useFadaa((s) => s.tickClose)

  useEffect(() => {
    // rehydrate is sync with persist middleware default; mark ready after paint
    const t = window.setTimeout(() => {
      try {
        tickClose()
      } finally {
        setReady(true)
      }
    }, 50)
    return () => clearTimeout(t)
  }, [setReady, tickClose])

  if (!ready) {
    return (
      <div className="grid min-h-dvh place-items-center bg-[var(--color-bg)] text-[var(--color-primary-ink)]">
        <div className="font-[family-name:var(--font-display)] text-3xl font-bold">فضاء</div>
      </div>
    )
  }

  let body: ReactNode
  switch (screen) {
    case 'home':
      body = <HomeScreen />
      break
    case 'sessions':
      body = <SessionsScreen />
      break
    case 'create':
      body = <CreateScreen />
      break
    case 'join':
      body = <JoinScreen />
      break
    case 'room':
      body = <RoomScreen />
      break
    case 'summary':
      body = <SummaryScreen />
      break
    case 'archive':
      body = <ArchiveScreen />
      break
    case 'mine':
      body = <MineScreen />
      break
    case 'packages':
      body = <PackagesScreen />
      break
    case 'admin':
      body = <AdminScreen />
      break
    default:
      body = <HomeScreen />
  }

  return <Shell>{body}</Shell>
}
