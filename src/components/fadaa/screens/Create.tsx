import { useState } from 'react'
import { t } from '../lib/i18n'
import { useFadaa } from '../lib/store'
import type { Plan, SessionKind, Visibility } from '../lib/types'

export function CreateScreen() {
  const locale = useFadaa((s) => s.locale)
  const createEnabled = useFadaa((s) => s.settings.createEnabled)
  const createSession = useFadaa((s) => s.createSession)
  const go = useFadaa((s) => s.go)
  const showToast = useFadaa((s) => s.showToast)

  const [kind, setKind] = useState<SessionKind>('knowledge')
  const [title, setTitle] = useState('')
  const [purpose, setPurpose] = useState('')
  const [durationHours, setDuration] = useState<12 | 24 | 48 | 72>(24)
  const [visibility, setVisibility] = useState<Visibility>('public')
  const [plan, setPlan] = useState<Plan>('free')

  const submit = () => {
    if (!createEnabled) {
      showToast('create_paused')
      return
    }
    if (!title.trim() || !purpose.trim()) return
    const id = createSession({ kind, title, purpose, durationHours, visibility, plan })
    if (id) go('join', id)
  }

  return (
    <div className="space-y-4">
      <button type="button" className="btn btn-ghost !min-h-9 !px-0" onClick={() => go('home')}>
        ← {t(locale, 'back')}
      </button>
      <h1 className="section-title">{t(locale, 'create_title')}</h1>

      {!createEnabled ? (
        <div className="card text-sm font-medium text-[var(--color-danger)]">{t(locale, 'create_paused')}</div>
      ) : null}

      <label className="block">
        <span className="label">{t(locale, 'field_kind')}</span>
        <div className="grid grid-cols-3 gap-2">
          {(['knowledge', 'experience', 'decision'] as SessionKind[]).map((k) => (
            <button
              key={k}
              type="button"
              className={`btn !min-h-11 !px-2 !text-sm ${kind === k ? 'btn-primary' : 'btn-secondary'}`}
              onClick={() => setKind(k)}
            >
              {t(locale, k === 'knowledge' ? 'kind_knowledge' : k === 'experience' ? 'kind_experience' : 'kind_decision')}
            </button>
          ))}
        </div>
      </label>

      <label className="block">
        <span className="label">{t(locale, 'field_title')}</span>
        <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={80} />
      </label>

      <label className="block">
        <span className="label">{t(locale, 'field_purpose')}</span>
        <textarea
          className="input min-h-24"
          value={purpose}
          onChange={(e) => setPurpose(e.target.value)}
          maxLength={200}
        />
      </label>

      <label className="block">
        <span className="label">{t(locale, 'field_duration')}</span>
        <div className="grid grid-cols-4 gap-2">
          {([12, 24, 48, 72] as const).map((h) => (
            <button
              key={h}
              type="button"
              className={`btn !min-h-11 !px-1 !text-sm ${durationHours === h ? 'btn-primary' : 'btn-secondary'}`}
              onClick={() => setDuration(h)}
            >
              {h} {t(locale, 'hours')}
            </button>
          ))}
        </div>
      </label>

      <label className="block">
        <span className="label">{t(locale, 'field_visibility')}</span>
        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            className={`btn ${visibility === 'public' ? 'btn-primary' : 'btn-secondary'}`}
            onClick={() => setVisibility('public')}
          >
            {t(locale, 'public')}
          </button>
          <button
            type="button"
            className={`btn ${visibility === 'private' ? 'btn-primary' : 'btn-secondary'}`}
            onClick={() => setVisibility('private')}
          >
            {t(locale, 'private')}
          </button>
        </div>
      </label>

      <label className="block">
        <span className="label">{t(locale, 'field_plan')}</span>
        <div className="grid gap-2">
          {([
            ['free', 'plan_free'],
            ['upgraded', 'plan_upgraded'],
            ['private', 'plan_private'],
          ] as const).map(([p, key]) => (
            <button
              key={p}
              type="button"
              className={`btn justify-start ${plan === p ? 'btn-primary' : 'btn-secondary'}`}
              onClick={() => setPlan(p)}
            >
              {t(locale, key)}
            </button>
          ))}
        </div>
      </label>

      <button type="button" className="btn btn-primary w-full" onClick={submit} disabled={!title.trim() || !purpose.trim()}>
        {t(locale, 'create_btn')}
      </button>
    </div>
  )
}
