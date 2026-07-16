export type Role = 'ADMIN' | 'RECEPCIONISTA' | 'ESTETICISTA';

export interface Branch {
  id: string;
  code: string;
  name: string;
  place: string;
  dotColor: string;
}

export interface StaffUser {
  id: string;
  name: string;
  email: string;
  role: Role;
  branchId: string | null;
  branch: Branch | null;
  avatarColor: string;
}

export interface PatientUser {
  id: string;
  name: string;
  phone: string;
  branch: { name: string; place: string } | null;
}

export const ROLE_LABEL: Record<Role, string> = {
  ADMIN: 'Administradora',
  RECEPCIONISTA: 'Recepcionista',
  ESTETICISTA: 'Esteticista',
};

export type FichaStatus = 'PENDIENTE' | 'PASO1_OK' | 'COMPLETA';
export type PatientType = 'NUEVO' | 'RECURRENTE';

export interface PatientRow {
  id: string;
  name: string;
  phone: string;
  age: number | null;
  branchId: string;
  branchName: string;
  avatarColor: string;
  type: PatientType;
  fichaStatus: FichaStatus;
  fichaLabel: string;
  fichaSent: boolean;
  fichaFilled: boolean;
  plan: string;
  progLabel: string;
  progPct: number;
  balance: number;
  next: string;
  therapist: string | null;
}

export interface PatientDetail extends PatientRow {
  since: string;
  skin: string;
  motivo: string[];
  therapistName: string | null;
  clinical: {
    antecedentes: string[];
    medicamentos: string[];
    tallaCm: number | null;
    pesoLb: number | null;
    observaciones: string | null;
  };
  treatment: { id: string; name: string; total: number; done: number; balance: number } | null;
  pendingCharges: { id: string; name: string; price: number }[];
}

export type CatalogKind = 'SERVICIO' | 'PAQUETE' | 'COMBO' | 'PRODUCTO' | 'INSUMO';
export interface CatalogItem {
  id: string;
  kind: CatalogKind;
  name: string;
  category: string | null;
  price: number;
  sessions: number;
  stock: number | null;
  unit: string | null;
  tag: string | null;
}

export const fmtRD = (n: number) => 'RD$' + Math.round(n).toLocaleString('en-US');

export type AppointmentStatus = 'SIN_CONFIRMAR' | 'CONFIRMADA' | 'COMPLETADA' | 'CANCELADA' | 'REAGENDADA';

export interface Appointment {
  id: string;
  time: string;
  startsAt: string;
  patientId: string;
  patient: string;
  patientType: PatientType;
  service: string;
  therapist: string;
  branchId: string;
  branchName: string;
  status: AppointmentStatus;
  statusLabel: string;
  statusColor: string;
  barColor: string;
  reminderSent: boolean;
  googleSynced: boolean;
  fichaComplete: boolean;
  balance: number;
  code: string | null;
  checkedIn: boolean;
  inService: boolean;
  finished: boolean;
  durationLabel?: string; // solo visible para admin
  cancelReason?: string | null;
  cancelledBy?: 'STAFF' | 'PATIENT' | null;
}

export interface AgendaResponse {
  appointments: Appointment[];
  counters: { total: number; confirmed: number; pending: number };
}

export interface CalendarDay { count: number; confirmed: number; pending: number; items: { time: string; patient: string; service: string; status: string }[] }
export interface CalendarResponse { month: string; days: Record<string, CalendarDay> }

export interface Therapist { id: string; name: string; branchId: string; avatarColor: string }
export interface CalendarStatus { connected: boolean; mode: 'demo' | 'google' | null; googleConfigured: boolean; scope?: 'branch' | 'all'; canManage?: boolean }

export type PaymentMethod = 'EFECTIVO' | 'TRANSFERENCIA' | 'TARJETA' | 'AZUL';

export interface InvoiceRow {
  id: string; number: string; patient: string; date: string; branchName: string;
  concept: string; method: string; total: number; status: string;
}
export interface BillingResponse {
  date?: string;
  stats: { label: string; value: number }[];
  invoices: InvoiceRow[];
}
export interface BillTreatment { id: string; name: string; price: number; balance: number; total: number; done: number; remaining: number; perSession: number }
export interface BillPatient {
  id: string; name: string; phone: string; avatarColor: string;
  plan: string; balance: number;
  treatment: BillTreatment | null;
  pendingCharges: { id: string; name: string; price: number }[];
  pendingTotal: number;
}
export interface Receipt {
  id: string; ncf: string | null;
  branchName: string; branchPlace: string; branchAddress: string; branchPhone: string; branchEmail?: string | null; rnc: string;
  date: string; patient: string; concept: string;
  items: { name: string; qty: number; total: number }[];
  subtotal: number; itbis: number; total: number; method: string;
  payments?: { method: string; amount: number }[];
  paymentKind?: string;
}

export type Channel = 'INSTAGRAM' | 'WHATSAPP' | 'MESSENGER' | 'TIKTOK';

export interface Conversation {
  id: string; channel: Channel; channelLabel: string; channelColor: string; channelBadge: string;
  contactName: string; avatarColor: string; unread: number; lastMessage: string; time: string; branchName: string;
}
export interface ChatMessage { id: string; fromMe: boolean; body: string; time: string }

export type PipelineStage = 'NUEVO_MENSAJE' | 'EN_CONVERSACION' | 'COTIZADO' | 'CITA_AGENDADA' | 'VENDIDO';
export interface PipelineLead {
  id: string; name: string; summary: string; channel: Channel | null;
  channelColor: string | null; channelBadge: string | null;
}
export interface PipelineColumn { stage: PipelineStage; label: string; color: string; leads: PipelineLead[] }

// ── Puntos & comisiones ──
export interface MyPoints {
  points: number; tier: string; tierColor: string; rank: string;
  commission: { sales: number; base: number; bonus: number; total: number; rate: number };
  ledger: { id: string; label: string; pts: number; time: string }[];
  rewards: { id: string; label: string; cost: number; icon: string; affordable: boolean }[];
}
export interface CommissionsView {
  rows: { rank: number; id: string; name: string; avatarColor: string; branch: string; points: number; tier: string; tierColor: string; sales: number; commission: number }[];
  totalCommissions: number; trophy: string; base: string;
}
export interface PointsRules { earn: { label: string; pts: string }[]; deduct: { label: string; pts: string }[] }

// ── Configuración ──
export interface BranchGoal { id: string; code: string; name: string; place: string; dotColor: string; address: string; phone: string; email: string | null; monthlyGoal: number; dailyGoal: number; perAsesorGoal: number }
export interface PointsRule { id: string; label: string; points: number; isEarn: boolean; active: boolean; sortOrder: number }
export interface RewardItem { id: string; label: string; cost: number; icon: string; active: boolean }

export interface ChannelField { name: string; label: string; placeholder: string; secret?: boolean }
export interface IntegrationsView {
  channels: { key: string; label: string; color: string; steps: string[]; fields: ChannelField[]; connected: boolean; account: string | null }[];
  calendars: { branchId: string; name: string; place: string; dotColor: string; connected: boolean }[];
  googleConfigured: boolean;
  calendarGuide: string[];
}

// ── Portal del paciente ──
export interface PortalProceso {
  notices?: { id: string; service: string; date: string; reason: string }[];
  treatment: { name: string; total: number; done: number; pct: number } | null;
  nextAppointment: { date: string; day: string; month: string; time: string; service: string; therapist: string; branch: string; code: string | null; checkedIn: boolean } | null;
  tips: string;
}
export interface PortalAppointment { id: string; date: string; service: string; therapist: string; code: string | null; checkedIn: boolean }
export interface PortalBranch { id: string; name: string; place: string; phone: string; waNumber: string }
export interface PortalProfile {
  firstName: string; lastName: string; phone: string; branch: string | null; since: string; firstEval: string | null;
  age?: number | null;
  baseline: {
    tallaCm: number | null; pesoLb: number | null; fototipo: string | null; motivos: string[];
    alturaCm?: number | null; cinturaCm?: number | null; abdomenCm?: number | null; piernaCm?: number | null; brazoCm?: number | null;
  };
  treatment: { name: string; total: number; done: number; pct: number } | null;
}
export interface PortalHistoryItem { id: string; date: string; service: string; therapist: string; rating: number | null; ratingComment: string | null; durationMin: number | null }
export interface PortalPackages {
  active: { name: string; total: number; done: number; remaining: number; pct: number; expiresAt: string | null } | null;
  shop: { id: string; name: string; sessions: number; price: number }[];
}

// ── Equipo ──
export interface TeamCollaborator { id: string; name: string; role: string; branch: string; avatarColor: string; points: number; sales: number; commission: number; attendance: string }
export interface SystemUser { id: string; name: string; email: string; role: string; roleKey: Role; branch: string; branchId: string | null; avatarColor: string; active: boolean }
export interface TeamResponse { collaborators: TeamCollaborator[]; systemUsers: SystemUser[] }

// ── Notificaciones ──
export interface NotificationItem { id: string; type: string; title: string; body: string; link: string | null; read: boolean; createdAt: string }
export interface NotificationsResponse { unread: number; items: NotificationItem[] }

// ── Cierre de caja ──
export interface CashCloseToday {
  denominations: number[]; // denominaciones disponibles (RD$)
  status: string | null;
  submitted: boolean;
  counted: { denominations: Record<string, number>; cardVouchers: number[]; countedCash: number; countedCard: number; countedTransfer: number; countedAzul: number } | null;
}
export interface CashCloseAdminRow {
  closeId: string | null;
  branchId: string; branchName: string; dotColor: string;
  status: 'PENDIENTE' | 'ENVIADO' | 'CUADRADO';
  methods: { method: string; expected: number; counted: number | null; diff: number | null }[];
  totalExpected: number; totalCounted: number | null; totalDiff: number | null;
  cardVouchers: number[] | null; notes: string | null;
  adminNote: string | null;
  resolution: string | null;
  deductAmount: number;
  submittedBy: { id: string; name: string } | null;
}
export interface CashCloseAdminView { date: string; branches: CashCloseAdminRow[] }
