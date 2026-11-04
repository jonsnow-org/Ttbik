import { Archive, Home, Layers, ShieldCheck, Users } from 'lucide-react'
import { t } from '../lib/i18n'
import { useFadaa } from '../lib/store'
import type { Screen } from '../lib/types'

const items: { id: Screen; icon: typeof Home; label: Parameters<typeof t>[1] }[] = [
  { id: 'home', icon: Home, label: 'nav_home' },
  { id: 'sessions', icon: Layers, label: 'nav_sessions' },
  { id: 'archive', icon: Archive, label: 'nav_archive' },
  { id: 'mine', icon: Users, label: 'nav_mine' },
]

export function BottomNav() {
  const locale = useFadaa((s) => s.locale)
  const screen = useFadaa((s) => s.screen)
  const go = useFadaa((s) => s.go)
  const supervisor = useFadaa((s) => s.supervisor)
  const visibleItems = supervisor ? [...items, { id: 'admin' as Screen, icon: ShieldCheck, label: 'nav_admin' as const }] : items

  return (
    <nav className="mx-auto flex max-w-lg items-stretch justify-around gap-1 px-2 pt-2 pb-1.5" aria-label="التنقل">
      {visibleItems.map(({ id, icon: Icon, label }) => {
        const active = screen === id || (id === 'sessions' && (screen === 'join' || screen === 'room' || screen === 'create' || screen === 'summary'))
        return (
          <button
            key={id}
            type="button"
            onClick={() => go(id)}
            className="flex flex-1 flex-col items-center gap-1 rounded-2xl px-1 py-2 text-xs font-bold transition"
            style={{ color: active ? 'var(--color-primary)' : 'var(--color-ink-soft)', background: active ? 'var(--color-primary-soft)' : 'transparent' }}
            aria-current={active ? 'page' : undefined}
          >
            <Icon size={20} strokeWidth={active ? 2.5 : 1.8} />
            <span className="max-w-full truncate leading-tight">{t(locale, label)}</span>
          </button>
        )
      })}
    </nav>
  )
}
