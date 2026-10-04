import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type {
  AppSettings,
  Contribution,
  ContributionKind,
  Entitlements,
  Locale,
  PaidPackageId,
  PaymentRequest,
  Plan,
  Screen,
  Session,
  SessionKind,
  User,
  Visibility,
} from './types'
import { defaultSettings, mergeSettings } from './settings'

function uid(prefix = 'id') {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36).slice(-4)}`
}

function seedSessions(now: number): Session[] {
  return [
    {
      id: 's_demo1',
      kind: 'knowledge',
      title: 'فهم إدارة الوقت في العمل عن بُعد',
      purpose: 'توضيح أساليب عملية لترتيب الأولويات دون إرهاق.',
      durationHours: 24,
      visibility: 'public',
      plan: 'free',
      status: 'open',
      ownerId: 'u_owner',
      ownerName: 'مالك تجريبي',
      createdAt: now - 3600_000,
      closesAt: now + 20 * 3600_000,
      participantIds: ['u_owner'],
      roles: { u_owner: 'أوضّح' },
    },
    {
      id: 's_demo2',
      kind: 'decision',
      title: 'اختيار مسار تعلّم تقني',
      purpose: 'حسم بين مسار ويب أو بيانات خلال أسبوعين.',
      durationHours: 48,
      visibility: 'public',
      plan: 'upgraded',
      status: 'open',
      ownerId: 'u_owner',
      ownerName: 'مالك تجريبي',
      createdAt: now - 7200_000,
      closesAt: now + 40 * 3600_000,
      participantIds: ['u_owner'],
      roles: { u_owner: 'صاحب القرار' },
    },
  ]
}

function seedContributions(): Contribution[] {
  return [
    {
      id: 'c1',
      sessionId: 's_demo1',
      authorId: 'u_owner',
      authorName: 'مالك تجريبي',
      role: 'أوضّح',
      kind: 'clarify',
      text: 'ابدأ بثلاث مهام فقط في اليوم، ثم راجع في المساء.',
      createdAt: Date.now() - 3000_000,
    },
  ]
}

interface FadaaState {
  ready: boolean
  locale: Locale
  theme: 'light' | 'dark'
  screen: Screen
  activeSessionId: string | null
  user: User
  sessions: Session[]
  contributions: Contribution[]
  payments: PaymentRequest[]
  settings: AppSettings
  entitlements: Entitlements
  supervisor: boolean
  blockedUserIds: string[]
  toast: string | null

  setReady: (v: boolean) => void
  setLocale: (l: Locale) => void
  setTheme: (t: 'light' | 'dark') => void
  go: (s: Screen, sessionId?: string | null) => void
  showToast: (msg: string) => void

  createSession: (input: {
    kind: SessionKind
    title: string
    purpose: string
    durationHours: 12 | 24 | 48 | 72
    visibility: Visibility
    plan: Plan
  }) => string | null
  joinWithRole: (sessionId: string, role: string) => boolean
  addContribution: (sessionId: string, kind: ContributionKind, text: string) => boolean
  tickClose: () => void
  closeSession: (sessionId: string) => void
  hideContribution: (id: string) => void
  deleteContribution: (id: string) => void
  deleteSession: (id: string) => void
  extendSession: (id: string, hours: number) => void
  setSessionPlan: (id: string, plan: Plan) => void

  submitPayment: (input: {
    packageId: PaidPackageId
    channel: 'payeer' | 'crypto'
    reference: string
  }) => void
  reviewPayment: (id: string, approve: boolean) => void

  updateSettings: (patch: Partial<AppSettings>) => void
  changePin: (pin: string) => void
  grantCredits: (kind: keyof Entitlements, amount: number) => void
  blockUser: (userId: string) => void
  setSupervisor: (v: boolean) => void
  reseedDemo: () => void
}

const emptyEntitlements = (): Entitlements => ({
  advancedSummaryCredits: 0,
  archiveUnlocked: false,
  upgradeCredits: 0,
  privateSessionCredits: 0,
})

export const useFadaa = create<FadaaState>()(
  persist(
    (set, get) => {
      const now = Date.now()
      return {
        ready: false,
        locale: 'ar',
        theme: 'light',
        screen: 'home',
        activeSessionId: null,
        user: { id: 'u_me', name: 'زائر' },
        sessions: seedSessions(now),
        contributions: seedContributions(),
        payments: [],
        settings: defaultSettings(),
        entitlements: emptyEntitlements(),
        supervisor: false,
        blockedUserIds: [],
        toast: null,

        setReady: (v) => set({ ready: v }),
        setLocale: (locale) => set({ locale }),
        setTheme: (theme) => set({ theme }),
        go: (screen, sessionId) =>
          set({
            screen,
            activeSessionId: sessionId === undefined ? get().activeSessionId : sessionId,
          }),
        showToast: (msg) => {
          set({ toast: msg })
          setTimeout(() => set({ toast: null }), 2200)
        },

        createSession: (input) => {
          const { settings, user } = get()
          if (!settings.createEnabled) {
            get().showToast(settings.announcement || 'create_paused')
            return null
          }
          const id = uid('s')
          const session: Session = {
            id,
            kind: input.kind,
            title: input.title.trim(),
            purpose: input.purpose.trim(),
            durationHours: input.durationHours,
            visibility: input.visibility,
            plan: input.plan,
            status: 'open',
            ownerId: user.id,
            ownerName: user.name,
            createdAt: Date.now(),
            closesAt: Date.now() + input.durationHours * 3600_000,
            participantIds: [user.id],
            roles: {},
          }
          set((s) => ({ sessions: [session, ...s.sessions], screen: 'join', activeSessionId: id }))
          return id
        },

        joinWithRole: (sessionId, role) => {
          const { settings, user, sessions } = get()
          if (!settings.joinEnabled) return false
          const session = sessions.find((x) => x.id === sessionId)
          if (!session || session.status !== 'open') return false
          set((s) => ({
            sessions: s.sessions.map((x) =>
              x.id === sessionId
                ? {
                    ...x,
                    roles: { ...x.roles, [user.id]: role },
                    participantIds: x.participantIds.includes(user.id)
                      ? x.participantIds
                      : [...x.participantIds, user.id],
                  }
                : x,
            ),
            screen: 'room',
            activeSessionId: sessionId,
          }))
          return true
        },

        addContribution: (sessionId, kind, text) => {
          const { settings, user, sessions, blockedUserIds } = get()
          if (!settings.writeEnabled) return false
          if (blockedUserIds.includes(user.id)) return false
          const session = sessions.find((x) => x.id === sessionId)
          if (!session || session.status !== 'open') return false
          const role = session.roles[user.id]
          if (!role) return false
          const c: Contribution = {
            id: uid('c'),
            sessionId,
            authorId: user.id,
            authorName: user.name,
            role,
            kind,
            text: text.trim(),
            createdAt: Date.now(),
          }
          set((s) => ({ contributions: [...s.contributions, c] }))
          return true
        },

        tickClose: () => {
          const now = Date.now()
          set((s) => ({
            sessions: s.sessions.map((x) =>
              x.status === 'open' && x.closesAt <= now
                ? { ...x, status: 'closed', closedAt: now }
                : x,
            ),
          }))
        },

        closeSession: (sessionId) => {
          set((s) => ({
            sessions: s.sessions.map((x) =>
              x.id === sessionId
                ? { ...x, status: 'closed', closedAt: Date.now() }
                : x,
            ),
          }))
        },

        hideContribution: (id) =>
          set((s) => ({
            contributions: s.contributions.map((c) =>
              c.id === id ? { ...c, hidden: true } : c,
            ),
          })),

        deleteContribution: (id) =>
          set((s) => ({ contributions: s.contributions.filter((c) => c.id !== id) })),

        deleteSession: (id) =>
          set((s) => ({
            sessions: s.sessions.filter((x) => x.id !== id),
            contributions: s.contributions.filter((c) => c.sessionId !== id),
          })),

        extendSession: (id, hours) =>
          set((s) => ({
            sessions: s.sessions.map((x) =>
              x.id === id
                ? { ...x, closesAt: Math.max(x.closesAt, Date.now()) + hours * 3600_000, status: 'open' }
                : x,
            ),
          })),

        setSessionPlan: (id, plan) =>
          set((s) => ({
            sessions: s.sessions.map((x) => (x.id === id ? { ...x, plan } : x)),
          })),

        submitPayment: ({ packageId, channel, reference }) => {
          const { user, settings } = get()
          const pack = settings.packages[packageId]
          const p: PaymentRequest = {
            id: uid('pay'),
            userId: user.id,
            userName: user.name,
            packageId,
            method: 'manual',
            channel,
            reference: reference.trim(),
            amount: pack.price,
            currency: pack.currency,
            status: 'pending',
            createdAt: Date.now(),
          }
          set((s) => ({ payments: [p, ...s.payments] }))
          get().showToast('pending_pay')
        },

        reviewPayment: (id, approve) => {
          const pay = get().payments.find((p) => p.id === id)
          if (!pay || pay.status !== 'pending') return
          set((s) => ({
            payments: s.payments.map((p) =>
              p.id === id
                ? { ...p, status: approve ? 'approved' : 'rejected', reviewedAt: Date.now() }
                : p,
            ),
          }))
          if (approve) {
            set((s) => {
              const e = { ...s.entitlements }
              if (pay.packageId === 'advanced_summary') e.advancedSummaryCredits += 1
              if (pay.packageId === 'upgrade_session') e.upgradeCredits += 1
              if (pay.packageId === 'private_session') e.privateSessionCredits += 1
              if (pay.packageId === 'open_archive') e.archiveUnlocked = true
              return { entitlements: e }
            })
          }
        },

        updateSettings: (patch) =>
          set((s) => ({ settings: mergeSettings({ ...s.settings, ...patch }) })),

        changePin: (pin) => set((s) => ({ settings: { ...s.settings, pin } })),

        grantCredits: (kind, amount) =>
          set((s) => {
            const e = { ...s.entitlements }
            if (kind === 'archiveUnlocked') e.archiveUnlocked = amount > 0
            else (e as any)[kind] = Math.max(0, ((e as any)[kind] as number) + amount)
            return { entitlements: e }
          }),

        blockUser: (userId) =>
          set((s) => ({
            blockedUserIds: s.blockedUserIds.includes(userId)
              ? s.blockedUserIds
              : [...s.blockedUserIds, userId],
          })),

        setSupervisor: (v) => set({ supervisor: v }),

        reseedDemo: () => {
          const now = Date.now()
          set({
            sessions: seedSessions(now),
            contributions: seedContributions(),
            payments: [],
            entitlements: emptyEntitlements(),
            blockedUserIds: [],
            supervisor: false,
            screen: 'home',
            activeSessionId: null,
          })
        },
      }
    },
    {
      name: 'fadaa-v1',
      partialize: (s) => ({
        locale: s.locale,
        theme: s.theme,
        user: s.user,
        sessions: s.sessions,
        contributions: s.contributions,
        payments: s.payments,
        settings: s.settings,
        entitlements: s.entitlements,
        blockedUserIds: s.blockedUserIds,
      }),
      merge: (persisted, current) => {
        const p = (persisted ?? {}) as Partial<FadaaState>
        return {
          ...current,
          ...p,
          settings: mergeSettings(p.settings as AppSettings),
          entitlements: { ...emptyEntitlements(), ...(p.entitlements ?? {}) },
          ready: false,
          supervisor: false,
          toast: null,
        }
      },
    },
  ),
)

export function formatRemaining(ms: number, locale: Locale): string {
  if (ms <= 0) return locale === 'ar' ? 'انتهت' : locale === 'fr' ? 'terminé' : 'ended'
  const h = Math.floor(ms / 3600_000)
  const m = Math.floor((ms % 3600_000) / 60_000)
  if (locale === 'ar') return `${h}س ${m}د`
  if (locale === 'fr') return `${h}h ${m}m`
  return `${h}h ${m}m`
}

export function peopleCount(n: number, locale: Locale): string {
  if (locale === 'ar') return `${n} مشارك`
  if (locale === 'fr') return `${n} participant${n > 1 ? 's' : ''}`
  return `${n} participant${n === 1 ? '' : 's'}`
}
