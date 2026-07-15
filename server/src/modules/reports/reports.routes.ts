import { Router } from 'express';
import { prisma } from '../../db/prisma.js';
import { requireStaff, requireRole } from '../../middleware/auth.js';
import { ageFromBirth } from '../patients/patients.service.js';

export const reportsRouter = Router();
// Reportes son exclusivos de la Administradora (visión consolidada).
reportsRouter.use(requireStaff, requireRole('ADMIN'));

const METHOD_LABEL: Record<string, string> = {
  EFECTIVO: 'Efectivo', TRANSFERENCIA: 'Transferencia', TARJETA: 'Tarjeta', AZUL: 'Azul',
};

/** Rango [from, to] a partir de query (por defecto, mes actual). */
function range(q: Record<string, unknown>) {
  const today = new Date();
  const defFrom = new Date(today.getFullYear(), today.getMonth(), 1);
  const from = q.from ? new Date(String(q.from) + 'T00:00:00') : defFrom;
  const to = q.to ? new Date(String(q.to) + 'T23:59:59') : today;
  return { from, to };
}

/**
 * Reporte consolidado: ventas, operación (citas) y puntos/desempeño del equipo.
 * ?from=YYYY-MM-DD&to=YYYY-MM-DD&branch=<id|all>
 */
reportsRouter.get('/overview', async (req, res) => {
  const { from, to } = range(req.query as Record<string, unknown>);
  const branch = req.query.branch as string | undefined;
  const branchWhere = branch && branch !== 'all' ? { branchId: branch } : {};

  const [invoices, appts, points, branches] = await Promise.all([
    prisma.invoice.findMany({
      where: { ...branchWhere, status: 'PAGADA', issuedAt: { gte: from, lte: to } },
      include: { items: true, branch: true },
    }),
    prisma.appointment.findMany({
      where: { ...branchWhere, startsAt: { gte: from, lte: to } },
      include: { therapist: true },
    }),
    prisma.pointsEntry.findMany({
      where: { createdAt: { gte: from, lte: to }, ...(branch && branch !== 'all' ? { user: { branchId: branch } } : {}) },
      include: { user: { include: { branch: true } } },
    }),
    prisma.branch.findMany({ orderBy: { code: 'asc' } }),
  ]);

  // ── VENTAS ──
  const salesTotal = invoices.reduce((s, i) => s + i.total, 0);
  const salesCount = invoices.length;
  const avgTicket = salesCount ? Math.round(salesTotal / salesCount) : 0;

  const byBranchMap = new Map<string, { name: string; total: number; count: number }>();
  const byMethodMap = new Map<string, number>();
  const itemsMap = new Map<string, { total: number; qty: number }>();
  const dailyMap = new Map<string, number>();
  for (const inv of invoices) {
    const b = byBranchMap.get(inv.branchId) ?? { name: inv.branch.name, total: 0, count: 0 };
    b.total += inv.total; b.count += 1; byBranchMap.set(inv.branchId, b);
    // método(s): usa el desglose de pagos si existe, si no el dominante.
    const pays = (inv.payments ?? null) as { method: string; amount: number }[] | null;
    if (Array.isArray(pays) && pays.length) {
      for (const p of pays) byMethodMap.set(p.method, (byMethodMap.get(p.method) ?? 0) + p.amount);
    } else {
      byMethodMap.set(inv.method, (byMethodMap.get(inv.method) ?? 0) + inv.total);
    }
    for (const it of inv.items) {
      if (it.total < 0) continue; // ignora líneas de "saldo pendiente"
      const e = itemsMap.get(it.name) ?? { total: 0, qty: 0 };
      e.total += it.total; e.qty += it.qty; itemsMap.set(it.name, e);
    }
    const day = inv.issuedAt.toISOString().slice(0, 10);
    dailyMap.set(day, (dailyMap.get(day) ?? 0) + inv.total);
  }

  const sales = {
    total: salesTotal,
    count: salesCount,
    avgTicket,
    byBranch: [...byBranchMap.values()].sort((a, b) => b.total - a.total),
    byMethod: [...byMethodMap.entries()].map(([m, total]) => ({ method: METHOD_LABEL[m] ?? m, total })).sort((a, b) => b.total - a.total),
    topItems: [...itemsMap.entries()].map(([name, v]) => ({ name, total: v.total, qty: v.qty })).sort((a, b) => b.total - a.total).slice(0, 10),
    daily: [...dailyMap.entries()].map(([date, total]) => ({ date, total })).sort((a, b) => a.date.localeCompare(b.date)),
  };

  // ── OPERACIÓN (citas) ──
  const byStatus: Record<string, number> = {};
  const cancelBy: Record<string, number> = { STAFF: 0, PATIENT: 0 };
  const cancelReasons = new Map<string, number>();
  let attended = 0, nuevos = 0, recurrentes = 0, ratedSum = 0, ratedCount = 0, lowRatings = 0;
  for (const a of appts) {
    byStatus[a.status] = (byStatus[a.status] ?? 0) + 1;
    if (a.serviceEndedAt || a.status === 'COMPLETADA') attended++;
    if (a.patientType === 'NUEVO') nuevos++; else recurrentes++;
    if (a.status === 'CANCELADA') {
      if (a.cancelledBy) cancelBy[a.cancelledBy] = (cancelBy[a.cancelledBy] ?? 0) + 1;
      if (a.cancelReason) cancelReasons.set(a.cancelReason, (cancelReasons.get(a.cancelReason) ?? 0) + 1);
    }
    if (a.rating != null) { ratedSum += a.rating; ratedCount++; if (a.rating < 5) lowRatings++; }
  }
  const operations = {
    total: appts.length,
    attended,
    cancelled: byStatus['CANCELADA'] ?? 0,
    byStatus,
    cancelBy,
    cancelReasons: [...cancelReasons.entries()].map(([reason, count]) => ({ reason, count })).sort((a, b) => b.count - a.count),
    newVsRecurrent: { nuevos, recurrentes },
    avgRating: ratedCount ? Math.round((ratedSum / ratedCount) * 10) / 10 : null,
    ratedCount,
    lowRatings,
  };

  // ── PUNTOS + DESEMPEÑO POR ESTETICISTA ──
  const pointsMap = new Map<string, { name: string; branch: string; role: string; points: number }>();
  for (const p of points) {
    const e = pointsMap.get(p.userId) ?? { name: p.user.name, branch: p.user.branch?.name ?? '—', role: p.user.role, points: 0 };
    e.points += p.points; pointsMap.set(p.userId, e);
  }
  // Desempeño de esteticistas por citas atendidas + calificación.
  const perfMap = new Map<string, { name: string; attended: number; ratingSum: number; ratingCount: number }>();
  for (const a of appts) {
    if (!a.therapistId || !a.therapist) continue;
    const e = perfMap.get(a.therapistId) ?? { name: a.therapist.name, attended: 0, ratingSum: 0, ratingCount: 0 };
    if (a.serviceEndedAt || a.status === 'COMPLETADA') e.attended++;
    if (a.rating != null) { e.ratingSum += a.rating; e.ratingCount++; }
    perfMap.set(a.therapistId, e);
  }
  const team = {
    pointsRanking: [...pointsMap.values()].sort((a, b) => b.points - a.points),
    performance: [...perfMap.values()].map((e) => ({
      name: e.name, attended: e.attended,
      avgRating: e.ratingCount ? Math.round((e.ratingSum / e.ratingCount) * 10) / 10 : null,
    })).sort((a, b) => b.attended - a.attended),
  };

  res.json({
    period: { from: from.toISOString().slice(0, 10), to: to.toISOString().slice(0, 10) },
    branches: branches.map((b) => ({ id: b.id, name: b.name })),
    sales, operations, team,
  });
});

/**
 * Demografía para campañas: pacientes filtrados por sexo, edad, sucursal y motivo.
 * Devuelve la lista (con contacto) + un resumen por sexo y rango de edad.
 */
reportsRouter.get('/patients', async (req, res) => {
  const q = req.query as Record<string, string | undefined>;
  const branch = q.branch;
  const sex = q.sex; // 'M' | 'F'
  const minAge = q.minAge ? Number(q.minAge) : null;
  const maxAge = q.maxAge ? Number(q.maxAge) : null;
  const motivo = q.motivo?.trim();

  const patients = await prisma.patient.findMany({
    where: {
      ...(branch && branch !== 'all' ? { branchId: branch } : {}),
      ...(sex ? { sex } : {}),
      ...(motivo ? { clinicalRecord: { motivos: { has: motivo } } } : {}),
    },
    include: { branch: true, clinicalRecord: true, treatments: { where: { active: true }, take: 1 } },
    orderBy: { name: 'asc' },
  });

  const rows = patients.map((p) => ({
    id: p.id, name: p.name, phone: p.phone, email: p.email, sex: p.sex,
    age: ageFromBirth(p.birthDate) ?? p.age ?? null,
    branch: p.branch.name,
    type: p.type,
    motivos: p.clinicalRecord?.motivos ?? [],
    treatment: p.treatments[0]?.name ?? null,
  })).filter((r) => {
    if (minAge != null && (r.age == null || r.age < minAge)) return false;
    if (maxAge != null && (r.age == null || r.age > maxAge)) return false;
    return true;
  });

  // Resumen para decisiones de campaña.
  const bySex = { F: 0, M: 0, ND: 0 };
  const byAge: Record<string, number> = { '<18': 0, '18-25': 0, '26-35': 0, '36-45': 0, '46-60': 0, '60+': 0, 'ND': 0 };
  for (const r of rows) {
    if (r.sex === 'F') bySex.F++; else if (r.sex === 'M') bySex.M++; else bySex.ND++;
    const a = r.age;
    const bucket = a == null ? 'ND' : a < 18 ? '<18' : a <= 25 ? '18-25' : a <= 35 ? '26-35' : a <= 45 ? '36-45' : a <= 60 ? '46-60' : '60+';
    byAge[bucket]++;
  }

  res.json({ count: rows.length, bySex, byAge, patients: rows });
});
