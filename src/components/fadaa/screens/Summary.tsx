import { useState } from 'react'
import { Copy } from 'lucide-react'
import { CONTRIB_KINDS, t } from '../lib/i18n'
import { useFadaa } from '../lib/store'

export function SummaryScreen() {
  const locale = useFadaa((s) => s.locale)
  const id = useFadaa((s) => s.activeSessionId)
  const session = useFadaa((s) => s.sessions.find((item) => item.id === id))
  const contributions = useFadaa((s) => s.contributions.filter((item) => item.sessionId === id && !item.hidden))
  const go = useFadaa((s) => s.go)
  const showToast = useFadaa((s) => s.showToast)
  const [copying, setCopying] = useState(false)

  if (!session) return <div className="empty card">{t(locale, 'empty_archive')}</div>

  const definitions = CONTRIB_KINDS[locale]?.[session.kind] ?? CONTRIB_KINDS.ar[session.kind]
  const grouped = definitions
    .map((definition) => ({
      ...definition,
      items: contributions.filter((item) => item.kind === definition.id),
    }))
    .filter((group) => group.items.length > 0)
  const knownKinds = new Set(definitions.map((definition) => definition.id))
  const otherItems = contributions.filter((item) => !knownKinds.has(item.kind))

  const report = [
    session.title,
    session.purpose,
    (locale === 'ar' ? 'نوع الجلسة' : locale === 'fr' ? 'Type' : 'Session type') + ': ' + session.kind,
    (locale === 'ar' ? 'المشاركون' : 'Participants') + ': ' + session.participantIds.length,
    ...grouped.map((group) => [
      group.label,
      ...group.items.map((item) => '- ' + item.authorName + ' (' + item.role + '): ' + item.text),
    ].join('\n')),
    ...otherItems.map((item) => '- ' + item.authorName + ' (' + item.role + '): ' + item.text),
    locale === 'ar'
      ? 'ملاحظة: هذا محضر منظم للمساهمات، وليس إثباتاً على وجود اتفاق أو قرار نهائي.'
      : locale === 'fr'
        ? 'Note : ce compte rendu organise les contributions ; il ne signifie pas qu’un accord ou une décision finale a été atteint.'
        : 'Note: this record organizes contributions; it does not imply consensus or a final decision.',
  ].join('\n\n')

  const copyReport = async () => {
    if (copying) return
    setCopying(true)
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(report)
        showToast(locale === 'ar' ? 'تم نسخ محضر الجلسة' : locale === 'fr' ? 'Compte rendu copié' : 'Session record copied')
      } else {
        window.prompt(locale === 'ar' ? 'انسخ محضر الجلسة' : 'Copy session record', report)
      }
    } catch {
      window.prompt(locale === 'ar' ? 'انسخ محضر الجلسة' : 'Copy session record', report)
    } finally {
      setCopying(false)
    }
  }

  return (
    <div className="space-y-4 pb-4">
      <button type="button" className="btn btn-ghost !px-0" onClick={() => go('archive')}>
        ← {t(locale, 'back')}
      </button>

      <div className="card space-y-2">
        <span className="flex flex-wrap items-center justify-between gap-2">
          <span className="badge">{t(locale, 'session_closed')}</span>
          <span className="text-[10px] text-[var(--color-ink-soft)]">
            {new Date(session.closedAt || session.closesAt).toLocaleDateString(locale, { day: 'numeric', month: 'short', year: 'numeric' })}
          </span>
        </span>
        <h1 className="text-lg font-bold">{session.title}</h1>
        <p className="text-sm leading-6 text-[var(--color-ink-muted)]">{session.purpose}</p>
        <div className="flex flex-wrap gap-3 border-t border-[var(--color-border)] pt-2 text-[11px] text-[var(--color-ink-soft)]">
          <span>{session.participantIds.length} {locale === 'ar' ? 'مشارك' : 'participants'}</span>
          <span>{contributions.length} {locale === 'ar' ? 'إسهامة محفوظة' : 'contributions'}</span>
        </div>
      </div>

      <section className="card space-y-2 border border-[var(--color-primary)]/30">
        <span className="flex items-center justify-between gap-2">
          <h2 className="font-bold text-[var(--color-primary-ink)]">{locale === 'ar' ? 'محضر الجلسة' : locale === 'fr' ? 'Compte rendu' : 'Session record'}</h2>
          <button type="button" className="btn btn-secondary !min-h-10 !px-3 !text-xs" onClick={copyReport} disabled={copying}>
            <Copy size={15} />{copying ? (locale === 'ar' ? 'جارٍ النسخ…' : '…') : (locale === 'ar' ? 'نسخ المحضر' : locale === 'fr' ? 'Copier' : 'Copy record')}
          </button>
        </span>
        <p className="text-xs leading-6 text-[var(--color-ink-muted)]">
          {locale === 'ar'
            ? 'ترتيب أمين لما أضافه المشاركون حسب نوع الإسهامة. لا يستنتج اتفاقاً أو نتيجة لم يسجلها المشاركون صراحةً.'
            : locale === 'fr'
              ? 'Les contributions sont regroupées par type. Aucun accord ni résultat non déclaré n’est inventé.'
              : 'Contributions are grouped by type. No unrecorded agreement or outcome is inferred.'}
        </p>
      </section>

      {grouped.length === 0 && otherItems.length === 0 ? (
        <div className="empty card">{t(locale, 'no_contributions')}</div>
      ) : (
        <div className="space-y-3">
          {grouped.map((group) => (
            <section key={group.id} className="card space-y-2">
              <span className="flex items-center justify-between gap-2">
                <h2 className="font-bold text-[var(--color-primary-ink)]">{group.label}</h2>
                <span className="badge">{group.items.length}</span>
              </span>
              {group.items.map((item) => (
                <article key={item.id} className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-2)] p-3">
                  <span className="flex flex-wrap items-center gap-2 text-xs">
                    <strong>{item.authorName}</strong>
                    <span className="text-[var(--color-ink-soft)]">{item.role}</span>
                    <time className="ms-auto text-[10px] text-[var(--color-ink-soft)]" dateTime={new Date(item.createdAt).toISOString()}>
                      {new Date(item.createdAt).toLocaleString(locale, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
                    </time>
                  </span>
                  <p className="mt-2 whitespace-pre-wrap break-words text-sm leading-7">{item.text}</p>
                </article>
              ))}
            </section>
          ))}
          {otherItems.length ? (
            <section className="card space-y-2">
              <h2 className="font-bold">{locale === 'ar' ? 'مساهمات أخرى' : locale === 'fr' ? 'Autres contributions' : 'Other contributions'}</h2>
              {otherItems.map((item) => (
                <p key={item.id} className="text-sm leading-7">{item.authorName}: {item.text}</p>
              ))}
            </section>
          ) : null}
        </div>
      )}

      <button type="button" className="btn btn-secondary w-full" onClick={() => go('archive')}>
        {locale === 'ar' ? 'العودة إلى الأرشيف' : locale === 'fr' ? 'Retour aux archives' : 'Back to archive'}
      </button>
    </div>
  )
}
