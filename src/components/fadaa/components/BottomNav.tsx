import { Archive, Home, Layers, Package, Shield, Users } from 'lucide-react'
import { t } from '../lib/i18n'
import { useFadaa } from '../lib/store'
import type { Screen } from '../lib/types'

const items: { id: Screen; icon: typeof Home; label: Parameters<typeof t>[1] }[] = [
  { id: 'home', icon: Home, label: 'nav_home' },
  { id: 'sessions', icon: Layers, label: 'nav_sessions' },
  { id: 'archive', icon: Archive, label: 'nav_archive' },
  { id: 'mine', icon: Users, label: 'nav_mine' },
  { id: 'packages', icon: Package, label: 'nav_packages' },
  { id: 'admin', icon: Shield, label: 'nav_admin' },
]

export function BottomNav() {
  const locale = useFadaa((s) => s.locale)
  const screen = useFadaa((s) => s.screen)
  const go = useFadaa((s) => s.go)

  return (
    <nav
      className="fixed bottom-0 inset-x-0 z-40 border-t-2 bg-[var(--color-surface)]"
      style={{ borderColor: 'var(--color-border)', paddingBottom: 'env(safe-area-inset-bottom, 0)' }}
    >
      <div className="mx-auto flex max-w-lg items-stretch justify-between gap-0.5 px-1 pt-1.5 pb-1.5">
        {items.map(({ id, icon: Icon, label }) => {
          const active = screen === id || (id === 'sessions' && (screen === 'join' || screen === 'room' || screen === 'create' || screen === 'summary'))
          return (
            <button
              key={id}
              type="button"
              onClick={() => go(id)}
              className="flex flex-1 flex-col items-center gap-0.5 rounded-xl px-1 py-1.5 text-[0.65rem] font-semibold transition"
              style={{
                color: active ? 'var(--color-primary-ink)' : 'var(--color-ink-soft)',
                background: active ? 'var(--color-primary-soft)' : 'transparent',
              }}
            >
              <Icon size={20} strokeWidth={active ? 2.5 : 2} />
              <span className="leading-tight text-center">{t(locale, label)}</span>
            </button>
          )
        })}
      </div>
    </nav>
  )
}
