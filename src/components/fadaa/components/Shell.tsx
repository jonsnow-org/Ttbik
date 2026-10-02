import { useEffect } from 'react'
import { t } from '../lib/i18n'
import { useFadaa } from '../lib/store'
import { BottomNav } from './BottomNav'

function closeTelegram() {
  try {
    const tg = (window as unknown as { Telegram?: { WebApp?: { close?: () => void } } }).Telegram?.WebApp
    if (tg?.close) {
      tg.close()
      return
    }
  } catch { /* ignore */ }
  try {
    window.history.back()
  } catch { /* ignore */ }
}

export function Shell({ children }: { children: import('react').ReactNode }) {
  const locale = useFadaa((s) => s.locale)
  const toast = useFadaa((s) => s.toast)
  const announcement = useFadaa((s) => s.settings.announcement)
  const setLocale = useFadaa((s) => s.setLocale)
  const setTheme = useFadaa((s) => s.setTheme)

  useEffect(() => {
    // TMA: دائماً الوضع الداكن بألوان الملف الأصلي
    setTheme('dark')
    document.documentElement.lang = locale
    document.documentElement.dir = locale === 'ar' ? 'rtl' : 'ltr'
    document.documentElement.classList.add('dark', 'fadaa-tma')
  }, [locale, setTheme])

  return (
    <div className="fadaa-shell">
      <header className="fadaa-header">
        <button
          type="button"
          onClick={closeTelegram}
          className="flex h-9 items-center gap-1 rounded-full bg-[var(--color-surface-2)] px-3 text-xs font-bold text-[var(--color-ink)]"
          aria-label={locale === 'ar' ? 'إغلاق' : 'Close'}
        >
          <span className="text-base leading-none">×</span>
          <span>{locale === 'ar' ? 'إغلاق' : 'Close'}</span>
        </button>

        <div className="min-w-0 flex-1 text-center">
          <div className="truncate font-[family-name:var(--font-display)] text-lg font-bold text-[var(--color-ink)]">
            فضاء
          </div>
          <div className="truncate text-[10px] text-[var(--color-ink-soft)]">
            {t(locale, 'tagline')}
          </div>
        </div>

        <select
          value={locale}
          onChange={(e) => setLocale(e.target.value as 'ar' | 'en' | 'fr')}
          className="h-9 max-w-[5.5rem] rounded-full border border-[var(--color-border)] bg-[var(--color-surface-2)] px-2 text-xs font-semibold text-[var(--color-ink)]"
          aria-label="Language"
        >
          <option value="ar">العربية</option>
          <option value="en">English</option>
          <option value="fr">Français</option>
        </select>
      </header>

      {announcement ? (
        <div className="border-b border-[var(--color-border)] bg-[var(--color-primary-soft)] px-4 py-2 text-center text-xs font-semibold text-[var(--color-primary-ink)]">
          {announcement}
        </div>
      ) : null}

      <main className="fadaa-main">{children}</main>

      <div className="fadaa-bottom-nav">
        <BottomNav />
      </div>

      {toast ? (
        <div className="pointer-events-none fixed inset-x-0 bottom-24 z-50 flex justify-center px-4">
          <div className="rounded-xl bg-[var(--color-ink)] px-4 py-2.5 text-sm font-semibold text-[var(--color-bg)] shadow-lg">
            {t(locale, toast as 'tagline') === toast ? toast : t(locale, toast as 'tagline')}
          </div>
        </div>
      ) : null}
    </div>
  )
}
