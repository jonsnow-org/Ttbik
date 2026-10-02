import { useEffect } from 'react'
import { t } from '../lib/i18n'
import { useFadaa } from '../lib/store'
import { BottomNav } from './BottomNav'

export function Shell({ children }: { children: React.ReactNode }) {
  const locale = useFadaa((s) => s.locale)
  const theme = useFadaa((s) => s.theme)
  const toast = useFadaa((s) => s.toast)
  const announcement = useFadaa((s) => s.settings.announcement)
  const setLocale = useFadaa((s) => s.setLocale)
  const setTheme = useFadaa((s) => s.setTheme)

  useEffect(() => {
    document.documentElement.lang = locale
    document.documentElement.dir = locale === 'ar' ? 'rtl' : 'ltr'
    document.documentElement.classList.toggle('dark', theme === 'dark')
  }, [locale, theme])

  return (
    <div className="mx-auto flex h-[100dvh] max-h-[100dvh] w-full max-w-lg flex-col overflow-hidden bg-[var(--color-bg)]">
      <header
        className="sticky top-0 z-30 border-b-2 bg-[var(--color-surface)]/95 backdrop-blur"
        style={{ borderColor: 'var(--color-border)' }}
      >
        <div className="flex items-center justify-between gap-2 px-4 py-3">
          <div>
            <div className="font-[family-name:var(--font-display)] text-2xl font-bold leading-none text-[var(--color-primary-ink)]">
              {t(locale, 'app_name')}
            </div>
            <div className="mt-0.5 text-xs text-[var(--color-ink-soft)]">{t(locale, 'subtitle')}</div>
          </div>
          <div className="flex items-center gap-1.5">
            <select
              className="input !min-h-9 !w-auto !py-1 !text-sm"
              value={locale}
              onChange={(e) => setLocale(e.target.value as 'ar' | 'en' | 'fr')}
              aria-label={t(locale, 'language')}
            >
              <option value="ar">العربية</option>
              <option value="en">English</option>
              <option value="fr">Français</option>
            </select>
            <button
              type="button"
              className="btn btn-secondary !min-h-9 !px-2.5 !text-xs"
              onClick={() => setTheme(theme === 'light' ? 'dark' : 'light')}
            >
              {theme === 'light' ? t(locale, 'theme_dark') : t(locale, 'theme_light')}
            </button>
          </div>
        </div>
        {announcement ? (
          <div
            className="border-t px-4 py-2 text-sm font-medium"
            style={{
              background: 'var(--color-primary-soft)',
              color: 'var(--color-primary-ink)',
              borderColor: 'var(--color-border)',
            }}
          >
            {announcement}
          </div>
        ) : null}
      </header>

      <main className="safe-bottom min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-4">{children}</main>
      <BottomNav />

      {toast ? (
        <div className="fixed inset-x-0 bottom-24 z-50 flex justify-center px-4">
          <div
            className="rounded-xl px-4 py-2.5 text-sm font-semibold text-white shadow-lg"
            style={{ background: 'var(--color-ink)' }}
          >
            {t(locale, toast as any) === toast ? toast : t(locale, toast as any)}
          </div>
        </div>
      ) : null}
    </div>
  )
}
