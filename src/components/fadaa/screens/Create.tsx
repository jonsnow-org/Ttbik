import { useEffect, useState } from 'react'
import { t } from '../lib/i18n'
import { useFadaa } from '../lib/store'
import { fadaaAction, refreshFadaaSnapshot } from '../lib/api'
import type { SessionKind } from '../lib/types'

export function CreateScreen() {
  const locale = useFadaa((s) => s.locale)
  const go = useFadaa((s) => s.go)
  const draft = useFadaa((s) => s.draft)
  const setDraft = useFadaa((s) => s.setDraft)
  const [kind, setKind] = useState<SessionKind>('knowledge')
  const [title, setTitle] = useState('')
  const [purpose, setPurpose] = useState('')
  const [durationHours, setDuration] = useState<12 | 24 | 48 | 72>(24)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!draft) return
    setKind(draft.kind)
    setTitle(draft.title)
    setPurpose(draft.purpose)
    setDraft(null)
  }, [draft, setDraft])

  const templates = locale === 'ar'
    ? [
        { kind: 'knowledge' as const, title: 'دليل عملي للمبتدئين', purpose: 'ما الخطوات الأولى؟ ما الأدوات المناسبة؟ وما الأخطاء التي يجب تجنبها؟ شاركوا خطوات قابلة للتطبيق.' },
        { kind: 'experience' as const, title: 'شارك تجربة تعلمتها بالطريقة الصعبة', purpose: 'احكِ ما حدث، ما الذي نجح أو فشل، وما النصيحة التي كنت تتمنى سماعها.' },
        { kind: 'decision' as const, title: 'ساعدونا في اتخاذ قرار', purpose: 'اعرضوا الخيارات والمعايير والمخاطر، ثم ناقشوا أفضل قرار بناءً على الأدلة.' },
        { kind: 'knowledge' as const, title: 'حل مشكلة خطوة بخطوة', purpose: 'صفوا المشكلة، اسألوا أسئلة توضيحية، ثم ابنوا حلاً عملياً يمكن تجربته.' },
      ]
    : locale === 'fr'
      ? [
          { kind: 'knowledge' as const, title: 'Guide pratique pour débuter', purpose: 'Quelles sont les premières étapes, les bons outils et les erreurs à éviter ?' },
          { kind: 'experience' as const, title: 'Une expérience qui vous a appris quelque chose', purpose: 'Racontez ce qui s’est passé, ce qui a fonctionné et le conseil que vous auriez aimé recevoir.' },
          { kind: 'decision' as const, title: 'Aidez-nous à prendre une décision', purpose: 'Présentez les options, les critères et les risques pour construire une décision éclairée.' },
          { kind: 'knowledge' as const, title: 'Résoudre un problème étape par étape', purpose: 'Décrivez le problème, posez des questions puis construisez une solution pratique.' },
        ]
      : [
          { kind: 'knowledge' as const, title: 'A practical beginner guide', purpose: 'What are the first steps, useful tools, and common mistakes to avoid? Share actionable steps.' },
          { kind: 'experience' as const, title: 'A lesson learned the hard way', purpose: 'Describe what happened, what worked or failed, and the advice you wish you had received.' },
          { kind: 'decision' as const, title: 'Help us make a decision', purpose: 'Compare the options, criteria, and risks to reach a thoughtful decision.' },
          { kind: 'knowledge' as const, title: 'Solve a problem step by step', purpose: 'Describe the problem, ask clarifying questions, and build a practical solution.' },
        ]

  const submit = async () => {
    if (!title.trim() || !purpose.trim() || busy) return
    setBusy(true)
    setError(null)
    try {
      const result = await fadaaAction('create_session', {
        kind,
        title: title.trim(),
        purpose: purpose.trim(),
        durationHours,
        visibility: 'public',
      })
      await refreshFadaaSnapshot()
      const id = result.session?.id
      if (!id) throw new Error('تم إنشاء الجلسة لكن لم يصل معرّفها.')
      go('room', id)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'تعذّر إنشاء الجلسة.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-4">
      <button type="button" className="btn btn-ghost !min-h-9 !px-0" onClick={() => go('home')}>
        ← {t(locale, 'back')}
      </button>
      <div>
        <h1 className="section-title !mb-1">{t(locale, 'create_title')}</h1>
        <p className="text-xs leading-6 text-[var(--color-ink-soft)]">
          ستُحفظ الجلسة في قاعدة البيانات وتظهر للمشاركين الآخرين فوراً.
        </p>
      </div>

      <section className="card space-y-2">
        <div className="flex items-center justify-between gap-2">
          <h2 className="font-bold text-sm">{locale === 'ar' ? 'ابدأ بقالب جاهز' : locale === 'fr' ? 'Commencer avec un modèle' : 'Start with a template'}</h2>
          <span className="text-[10px] text-[var(--color-ink-soft)]">{locale === 'ar' ? 'تعديل كل شيء متاح' : 'Fully editable'}</span>
        </div>
        <div className="grid gap-2">
          {templates.map((template, index) => (
            <button
              key={template.title}
              type="button"
              className="flex items-center gap-3 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-2)] p-3 text-start transition hover:border-[var(--color-primary)]"
              onClick={() => {
                setKind(template.kind)
                setTitle(template.title)
                setPurpose(template.purpose)
              }}
            >
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[var(--color-primary-soft)] text-[var(--color-primary)]">
                {index === 0 ? '✦' : index === 1 ? '↗' : index === 2 ? '⚖' : '◎'}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-bold">{template.title}</span>
                <span className="mt-0.5 block text-xs leading-5 text-[var(--color-ink-soft)]">{template.purpose}</span>
              </span>
              <span className="text-[var(--color-primary)]">＋</span>
            </button>
          ))}
        </div>
      </section>

      <label className="block">
        <span className="label">{t(locale, 'field_kind')}</span>
        <div className="grid grid-cols-3 gap-2">
          {(['knowledge', 'experience', 'decision'] as SessionKind[]).map((value) => (
            <button
              key={value}
              type="button"
              className={`btn !min-h-11 !px-2 !text-sm ${kind === value ? 'btn-primary' : 'btn-secondary'}`}
              onClick={() => setKind(value)}
            >
              {t(locale, value === 'knowledge' ? 'kind_knowledge' : value === 'experience' ? 'kind_experience' : 'kind_decision')}
            </button>
          ))}
        </div>
      </label>

      <label className="block">
        <span className="label">{t(locale, 'field_title')}</span>
        <input className="input" value={title} onChange={(event) => setTitle(event.target.value)} maxLength={120} required />
        <span className="mt-1 block text-end text-[10px] text-[var(--color-ink-soft)]">{title.length}/120</span>
      </label>

      <label className="block">
        <span className="label">{t(locale, 'field_purpose')}</span>
        <textarea
          className="input min-h-24"
          value={purpose}
          onChange={(event) => setPurpose(event.target.value)}
          maxLength={500}
          required
        />
        <span className="mt-1 block text-end text-[10px] text-[var(--color-ink-soft)]">{purpose.length}/500</span>
      </label>

      <label className="block">
        <span className="label">{t(locale, 'field_duration')}</span>
        <div className="grid grid-cols-4 gap-2">
          {([12, 24, 48, 72] as const).map((hours) => (
            <button
              key={hours}
              type="button"
              className={`btn !min-h-11 !px-1 !text-sm ${durationHours === hours ? 'btn-primary' : 'btn-secondary'}`}
              onClick={() => setDuration(hours)}
            >
              {hours} {t(locale, 'hours')}
            </button>
          ))}
        </div>
      </label>

      <div className="card space-y-1">
        <div className="font-bold text-sm">{locale === 'ar' ? 'جلسة عامة مجانية' : 'Free public session'}</div>
        <p className="text-xs leading-6 text-[var(--color-ink-soft)]">
          {locale === 'ar'
            ? 'سيتمكن مستخدمو فضاء من العثور على الجلسة والانضمام إليها. إعداد الجلسات الخاصة والباقات المدفوعة سيُفعّل بعد ربط الدعوات والدفع من الخادم.'
            : 'Other Fadaa users can discover and join this session. Private invitations and paid packages will be enabled after secure server-side billing is connected.'}
        </p>
      </div>

      {error ? <div role="alert" className="card border border-[var(--color-danger)] text-sm text-[var(--color-danger)]">{error}</div> : null}

      <button
        type="button"
        className="btn btn-primary w-full"
        onClick={submit}
        disabled={busy || title.trim().length < 3 || !purpose.trim()}
      >
        {busy ? 'جارٍ حفظ الجلسة…' : t(locale, 'create_btn')}
      </button>
    </div>
  )
}
