export type Locale = 'ar' | 'en' | 'fr'
export type SessionKind = 'knowledge' | 'experience' | 'decision'
export type SessionStatus = 'open' | 'closed'
export type Visibility = 'public' | 'private'
export type Plan = 'free' | 'upgraded' | 'private'
export type PaymentStatus = 'pending' | 'approved' | 'rejected'
export type PaymentMethod = 'manual' | 'auto'
export type ManualChannel = 'payeer' | 'crypto'
export type PaidPackageId =
  | 'upgrade_session'
  | 'advanced_summary'
  | 'private_session'
  | 'open_archive'

export type ContributionKind =
  | 'clarify' | 'example' | 'correct' | 'step' | 'precise_q'
  | 'stage_update' | 'companion_note' | 'companion_q' | 'new_angle'
  | 'missing_option' | 'risk' | 'criterion' | 'rephrase' | 'decisive_q'

export interface Contribution {
  id: string
  sessionId: string
  authorId: string
  authorName: string
  role: string
  kind: ContributionKind
  text: string
  createdAt: number
  hidden?: boolean
}

export interface Session {
  id: string
  kind: SessionKind
  title: string
  purpose: string
  durationHours: 12 | 24 | 48 | 72
  visibility: Visibility
  plan: Plan
  status: SessionStatus
  ownerId: string
  ownerName: string
  createdAt: number
  closesAt: number
  closedAt?: number
  participantIds: string[]
  roles: Record<string, string>
  advancedSummaryUnlocked?: boolean
}

export interface PaymentRequest {
  id: string
  userId: string
  userName: string
  packageId: PaidPackageId
  method: PaymentMethod
  channel?: ManualChannel
  reference: string
  amount: number
  currency: string
  status: PaymentStatus
  createdAt: number
  reviewedAt?: number
}

export interface AppSettings {
  createEnabled: boolean
  joinEnabled: boolean
  writeEnabled: boolean
  announcement: string
  pin: string
  payeerEnabled: boolean
  cryptoEnabled: boolean
  payeerWallet: string
  cryptoUsdt: string
  cryptoBtc: string
  packages: Record<
    PaidPackageId,
    { enabled: boolean; price: number; currency: string }
  >
}

export interface Entitlements {
  advancedSummaryCredits: number
  archiveUnlocked: boolean
  upgradeCredits: number
  privateSessionCredits: number
}

export interface User {
  id: string
  name: string
}

export type Screen =
  | 'home'
  | 'sessions'
  | 'create'
  | 'join'
  | 'room'
  | 'summary'
  | 'archive'
  | 'mine'
  | 'packages'
  | 'admin'
