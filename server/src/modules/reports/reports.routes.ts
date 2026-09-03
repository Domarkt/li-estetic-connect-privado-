import { Router } from 'express';
import { Prisma } from '@prisma/client';
import { prisma } from '../../db/prisma.js';
import { requireStaff, requireRole } from '../../middleware/auth.js';
import { ageFromBirth } from '../patients/patients.service.js';

export const reportsRouter = Router();

/**
 * KPIs de la Vista General y desglose por sucursal (datos reales).
 * Accesible a todo el personal; los montos (ventas) solo se devuelven a la admin.
 * ?branch=<id|all> filtra el resumen a la sucursal seleccionada.
 */
reportsRouter.get('/dashboard', requireStaff, async (req, res) => {
  const isAdmin = req.staff!.role === 'ADMIN';
  const branch = req.query.branch as string | undefined;
  const scopeBranch = branch && branch !== 'all' ? branch : null;

  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const dayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const dayEnd = new Date(dayStart); dayEnd.setDate(dayEnd.getDate() + 1);

  const branches = await prisma.branch.findMany({ orderBy: { code: 'asc' } });

  // Calcula los KPIs de una sucursal (o consolidado si branchId=null).
  async function kpis(branchId: string | null) {
    const bw = branchId ? { branchId } : {};
    const [salesAgg, todaySalesAgg, citasHoy, citasConf, pacientesActivos] = await Promise.all([
      prisma.invoice.aggregate({ where: { ...bw, status: 'PAGADA', issuedAt: { gte: monthStart } }, _sum: { total: true }, _count: true }),
      prisma.invoice.aggregate({ where: { ...bw, status: 'PAGADA', issuedAt: { gte: dayStart, lt: dayEnd } }, _sum: { total: true } }),
      prisma.appointment.count({ where: { ...bw, startsAt: { gte: dayStart, lt: dayEnd }, status: { not: 'CANCELADA' } } }),
      prisma.appointment.count({ where: { ...bw, startsAt: { gte: dayStart, lt: dayEnd }, status: 'CONFIRMADA' } }),
      prisma.patient.count({ where: { ...(branchId ? { branchId } : {}), treatments: { some: { active: true } } } }),
    ]);
    const ventasMes = salesAgg._sum.total ?? 0;
    const recibosMes = salesAgg._count;
    return {
      ventasMes, recibosMes, ventasHoy: todaySalesAgg._sum.total ?? 0,
      ticketPromedio: recibosMes ? Math.round(ventasMes / recibosMes) : 0,
      citasHoy, citasHoyConfirmadas: citasConf, pacientesActivos,
    };
  }

  const scope = await kpis(scopeBranch);
  const perBranch = await Promise.all(branches.map(async (b) => ({ id: b.id, name: b.name, ...(await kpis(b.id)) })));

  // Oculta montos para no-admin.
  const strip = <T extends { ventasMes: number; recibosMes: number; ventasHoy: number; ticketPromedio: number }>(o: T) =>
    isAdmin ? o : { ...o, ventasMes: 0, recibosMes: 0, ventasHoy: 0, ticketPromedio: 0 };

  // ── METAS: mensual de la sucursal y por esteticista ──
  // La meta puede venir de BranchGoal (por período YYYY-MM) o del valor base de la sucursal.
  const period = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const metaCache = new Map<string, { monthly: number; perAsesor: number }>();
  async function metaDe(branchId: string): Promise<{ monthly: number; perAsesor: number }> {
    if (metaCache.has(branchId)) return metaCache.get(branchId)!;
    const b = branches.find((x) => x.id === branchId);
    const bg = await prisma.branchGoal.findUnique({ where: { branchId_period: { branchId, period } } }).catch(() => null);
    const r = { monthly: bg?.monthly ?? b?.monthlyGoal ?? 0, perAsesor: bg?.perAsesor ?? b?.perAsesorGoal ?? 0 };
    metaCache.set(branchId, r);
    return r;
  }
  // Meta de la sucursal en foco (o suma consolidada de todas).
  let metaScope = 0;
  if (scopeBranch) metaScope = (await metaDe(scopeBranch)).monthly;
  else for (const b of branches) metaScope += (await metaDe(b.id)).monthly;
  const perBranchMeta = await Promise.all(perBranch.map(async (b) => ({ ...b, meta: (await metaDe(b.id)).monthly })));
  const pct = (v: number, m: number) => (m > 0 ? Math.round((v / m) * 100) : 0);

  // Meta por esteticista (solo Admin): ventas atribuidas del mes vs meta por asesor.
  let staffGoals: { name: string; branch: string; ventas: number; meta: number; pct: number }[] = [];
  if (isAdmin) {
    const ventasPorTera = await prisma.invoice.groupBy({
      by: ['therapistId'],
      where: { status: 'PAGADA', issuedAt: { gte: monthStart }, therapistId: { not: null }, ...(scopeBranch ? { branchId: scopeBranch } : {}) },
      _sum: { total: true },
    });
    const vmap = new Map(ventasPorTera.map((v) => [v.therapistId, v._sum.total ?? 0]));
    const teras = await prisma.user.findMany({
      where: { role: 'ESTETICISTA', active: true, ...(scopeBranch ? { branchId: scopeBranch } : {}) },
      select: { id: true, name: true, branchId: true, branch: { select: { name: true } } },
    });
    staffGoals = (await Promise.all(teras.map(async (u) => {
      const meta = u.branchId ? (await metaDe(u.branchId)).perAsesor : 0;
      const ventas = vmap.get(u.id) ?? 0;
      return { name: u.name, branch: u.branch?.name ?? '—', ventas, meta, pct: pct(ventas, meta) };
    }))).sort((a, b) => b.ventas - a.ventas);
  }

  res.json({
    isAdmin,
    scope: { ...strip(scope), meta: isAdmin ? metaScope : 0, metaPct: isAdmin ? pct(scope.ventasMes, metaScope) : 0 },
    branches: perBranchMeta.map((b) => ({ ...strip(b), meta: isAdmin ? b.meta : 0, metaPct: isAdmin ? pct(b.ventasMes, b.meta) : 0 })),
    staffGoals,
  });
});

// Los demás reportes son exclusivos de la Administradora (visión consolidada).
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

/**
 * Auditoría de sesiones (solo Admin): calidad del diligenciamiento de bitácoras y
 * combos, por estética y esteticista. Agregados en SQL (sin traer firmas ni filas
 * masivas) para no disparar el egress. ?branch=<id> acota a una sucursal.
 */
reportsRouter.get('/audit', requireStaff, requireRole('ADMIN'), async (req, res) => {
  const branch = req.query.branch as string | undefined;
  const scope = branch && branch !== 'all' ? branch : null;
  const bfP = scope ? Prisma.sql`AND p."branchId" = ${scope}` : Prisma.empty; // vía Patient p
  const bfA = scope ? Prisma.sql`AND a."branchId" = ${scope}` : Prisma.empty; // vía Appointment a

  const [resumen] = await prisma.$queryRaw<Array<Record<string, number>>>`
    SELECT COUNT(*)::int total,
      COUNT(*) FILTER (WHERE array_length(ts.techniques,1) IS NULL)::int "sinTecnicas",
      COUNT(*) FILTER (WHERE array_length(ts.areas,1) IS NULL)::int "sinAreas",
      COUNT(*) FILTER (WHERE ts.signature IS NULL)::int "sinFirma",
      COUNT(*) FILTER (WHERE ts.notes IS NULL OR btrim(ts.notes)='')::int "sinNotas"
    FROM "TreatmentSession" ts
    JOIN "Treatment" t ON t.id=ts."treatmentId"
    JOIN "Patient" p ON p.id=t."patientId"
    WHERE 1=1 ${bfP}`;

  const porEsteticista = await prisma.$queryRaw<Array<Record<string, unknown>>>`
    SELECT b.name branch, COALESCE(u.name,'(sin esteticista)') therapist, COUNT(*)::int total,
      COUNT(*) FILTER (WHERE array_length(ts.techniques,1) IS NULL)::int "sinTecnicas",
      COUNT(*) FILTER (WHERE array_length(ts.areas,1) IS NULL)::int "sinAreas",
      COUNT(*) FILTER (WHERE ts.notes IS NULL OR btrim(ts.notes)='')::int "sinNotas"
    FROM "TreatmentSession" ts
    JOIN "Treatment" t ON t.id=ts."treatmentId"
    JOIN "Patient" p ON p.id=t."patientId"
    JOIN "Branch" b ON b.id=p."branchId"
    LEFT JOIN "User" u ON u.id=ts."therapistId"
    WHERE 1=1 ${bfP}
    GROUP BY b.name, u.name ORDER BY "sinTecnicas" DESC, "sinAreas" DESC, total DESC`;

  const detalle = await prisma.$queryRaw<Array<Record<string, unknown>>>`
    SELECT b.name branch, COALESCE(u.name,'(sin esteticista)') therapist, t.name combo,
      to_char(ts.at,'DD/MM/YYYY') fecha,
      (array_length(ts.techniques,1) IS NULL) "faltaTecnica",
      (array_length(ts.areas,1) IS NULL) "faltaArea"
    FROM "TreatmentSession" ts
    JOIN "Treatment" t ON t.id=ts."treatmentId"
    JOIN "Patient" p ON p.id=t."patientId"
    JOIN "Branch" b ON b.id=p."branchId"
    LEFT JOIN "User" u ON u.id=ts."therapistId"
    WHERE (array_length(ts.techniques,1) IS NULL OR array_length(ts.areas,1) IS NULL) ${bfP}
    ORDER BY ts.at DESC LIMIT 100`;

  const [combos] = await prisma.$queryRaw<Array<Record<string, number>>>`
    SELECT
      COUNT(*) FILTER (WHERE t."doneSessions">0
        AND EXISTS (SELECT 1 FROM "TreatmentTechnique" tt WHERE tt."treatmentId"=t.id)
        AND COALESCE((SELECT SUM(tt.done) FROM "TreatmentTechnique" tt WHERE tt."treatmentId"=t.id),0)=0)::int "avanceSinTecnicas",
      COUNT(*) FILTER (WHERE t."doneSessions">0
        AND NOT EXISTS (SELECT 1 FROM "TreatmentSession" ts WHERE ts."treatmentId"=t.id))::int "avanceSinBitacora"
    FROM "Treatment" t
    JOIN "Patient" p ON p.id=t."patientId"
    WHERE 1=1 ${bfP}`;

  const atencion = await prisma.$queryRaw<Array<Record<string, unknown>>>`
    SELECT b.name branch,
      COUNT(*) FILTER (WHERE a."codeUsedAt" IS NOT NULL)::int abiertos,
      COUNT(*) FILTER (WHERE a.status='COMPLETADA' OR a."serviceEndedAt" IS NOT NULL)::int cerrados,
      COUNT(*) FILTER (WHERE a.status='CANCELADA')::int cancelados
    FROM "Appointment" a JOIN "Branch" b ON b.id=a."branchId"
    WHERE 1=1 ${bfA}
    GROUP BY b.name ORDER BY b.name`;

  res.json({ resumen, porEsteticista, detalle, combos, atencion });
});

// ─────────────────────────────────────────────────────────────
// REPORTES GERENCIALES (solo Admin — el router ya exige ADMIN arriba)
// Todo por agregados SQL para no disparar el egress. Cedula/direccion van
// cifradas; nombre y telefono son texto plano (sirven para gestionar cobros).
// ─────────────────────────────────────────────────────────────

/** 1) CARTERA — saldos de planes pendientes de pago, por antigüedad (aging). Punto en el tiempo. */
reportsRouter.get('/aging', async (req, res) => {
  const branch = req.query.branch as string | undefined;
  const scope = branch && branch !== 'all' ? branch : null;
  const bf = scope ? Prisma.sql`AND p."branchId" = ${scope}` : Prisma.empty;
  const porSucursal = await prisma.$queryRaw<Array<Record<string, unknown>>>`
    SELECT b.name branch, COUNT(*)::int cuentas, COALESCE(SUM(t.balance),0)::int total,
      COALESCE(SUM(t.balance) FILTER (WHERE (now()::date - t."createdAt"::date) <= 30),0)::int d0,
      COALESCE(SUM(t.balance) FILTER (WHERE (now()::date - t."createdAt"::date) BETWEEN 31 AND 60),0)::int d31,
      COALESCE(SUM(t.balance) FILTER (WHERE (now()::date - t."createdAt"::date) BETWEEN 61 AND 90),0)::int d61,
      COALESCE(SUM(t.balance) FILTER (WHERE (now()::date - t."createdAt"::date) > 90),0)::int d90
    FROM "Treatment" t JOIN "Patient" p ON p.id=t."patientId" JOIN "Branch" b ON b.id=p."branchId"
    WHERE t.balance > 0 AND t.active = true ${bf}
    GROUP BY b.name ORDER BY total DESC`;
  const top = await prisma.$queryRaw<Array<Record<string, unknown>>>`
    SELECT p.name paciente, p.phone, b.name branch, t.name plan, t.balance::int balance,
      (now()::date - t."createdAt"::date)::int dias
    FROM "Treatment" t JOIN "Patient" p ON p.id=t."patientId" JOIN "Branch" b ON b.id=p."branchId"
    WHERE t.balance > 0 AND t.active = true ${bf}
    ORDER BY t.balance DESC LIMIT 30`;
  res.json({ porSucursal, top });
});

/** 2) PASIVO DE COMBOS — sesiones prepagadas aún NO consumidas (servicio que se debe). Punto en el tiempo. */
reportsRouter.get('/combo-liability', async (req, res) => {
  const branch = req.query.branch as string | undefined;
  const scope = branch && branch !== 'all' ? branch : null;
  const bf = scope ? Prisma.sql`AND p."branchId" = ${scope}` : Prisma.empty;
  const porSucursal = await prisma.$queryRaw<Array<Record<string, unknown>>>`
    SELECT b.name branch, COUNT(*)::int planes,
      COALESCE(SUM(t."totalSessions" - t."doneSessions"),0)::int "sesionesPend",
      COALESCE(SUM((t."totalSessions" - t."doneSessions") * (t.price::numeric / NULLIF(t."totalSessions",0))),0)::int "valorEstimado"
    FROM "Treatment" t JOIN "Patient" p ON p.id=t."patientId" JOIN "Branch" b ON b.id=p."branchId"
    WHERE t.active = true AND t."totalSessions" > t."doneSessions" ${bf}
    GROUP BY b.name ORDER BY "sesionesPend" DESC`;
  const porVencer = await prisma.$queryRaw<Array<Record<string, unknown>>>`
    SELECT p.name paciente, b.name branch, t.name plan,
      (t."totalSessions" - t."doneSessions")::int pend, to_char(t."expiresAt",'DD/MM/YYYY') vence,
      (t."expiresAt"::date - now()::date)::int dias
    FROM "Treatment" t JOIN "Patient" p ON p.id=t."patientId" JOIN "Branch" b ON b.id=p."branchId"
    WHERE t.active = true AND t."totalSessions" > t."doneSessions" AND t."expiresAt" IS NOT NULL
      AND t."expiresAt" <= now() + interval '30 days' ${bf}
    ORDER BY t."expiresAt" ASC LIMIT 50`;
  res.json({ porSucursal, porVencer });
});

/** 3) DESEMPEÑO POR ESTETICISTA — ventas atribuidas, servicios, rating y tiempo real. Por rango. */
reportsRouter.get('/staff-performance', async (req, res) => {
  const { from, to } = range(req.query as Record<string, unknown>);
  const branch = req.query.branch as string | undefined;
  const scope = branch && branch !== 'all' ? branch : null;
  const bfI = scope ? Prisma.sql`AND i."branchId" = ${scope}` : Prisma.empty;
  const bfA = scope ? Prisma.sql`AND a."branchId" = ${scope}` : Prisma.empty;
  const ventas = await prisma.$queryRaw<Array<{ tid: string; ventas: number; recibos: number }>>`
    SELECT i."therapistId" tid, COALESCE(SUM(i.total),0)::int ventas, COUNT(*)::int recibos
    FROM "Invoice" i
    WHERE i.status='PAGADA' AND i."therapistId" IS NOT NULL AND i."issuedAt" BETWEEN ${from} AND ${to} ${bfI}
    GROUP BY i."therapistId"`;
  const citas = await prisma.$queryRaw<Array<{ tid: string; atendidas: number; rating: number | null; avgMin: number | null }>>`
    SELECT a."therapistId" tid,
      COUNT(*) FILTER (WHERE a.status='COMPLETADA' OR a."serviceEndedAt" IS NOT NULL)::int atendidas,
      ROUND(AVG(a.rating) FILTER (WHERE a.rating IS NOT NULL),1)::float rating,
      ROUND(AVG(a."serviceDurationSec") FILTER (WHERE a."serviceDurationSec" IS NOT NULL)/60.0)::int "avgMin"
    FROM "Appointment" a
    WHERE a."therapistId" IS NOT NULL AND a."startsAt" BETWEEN ${from} AND ${to} ${bfA}
    GROUP BY a."therapistId"`;
  const ids = [...new Set([...ventas.map((v) => v.tid), ...citas.map((c) => c.tid)])];
  const users = ids.length ? await prisma.user.findMany({ where: { id: { in: ids } }, select: { id: true, name: true, branch: { select: { name: true } } } }) : [];
  const vMap = new Map(ventas.map((v) => [v.tid, v]));
  const cMap = new Map(citas.map((c) => [c.tid, c]));
  const rows = users.map((u) => ({
    therapist: u.name, branch: u.branch?.name ?? '—',
    ventas: vMap.get(u.id)?.ventas ?? 0, recibos: vMap.get(u.id)?.recibos ?? 0,
    atendidas: cMap.get(u.id)?.atendidas ?? 0,
    rating: cMap.get(u.id)?.rating ?? null, avgMin: cMap.get(u.id)?.avgMin ?? null,
  })).sort((a, b) => b.ventas - a.ventas);
  res.json({ rows });
});

/** 4) DESCUENTOS — control de rebajas por sucursal y recepcionista/cajero. Por rango. */
reportsRouter.get('/discounts', async (req, res) => {
  const { from, to } = range(req.query as Record<string, unknown>);
  const branch = req.query.branch as string | undefined;
  const scope = branch && branch !== 'all' ? branch : null;
  const bfI = scope ? Prisma.sql`AND i."branchId" = ${scope}` : Prisma.empty;
  const [resumen] = await prisma.$queryRaw<Array<Record<string, number>>>`
    SELECT COALESCE(SUM(i.discount),0)::int "totalDesc",
      COUNT(*) FILTER (WHERE i.discount>0)::int "facturasConDesc",
      COALESCE(SUM(i.total),0)::int ventas
    FROM "Invoice" i WHERE i.status='PAGADA' AND i."issuedAt" BETWEEN ${from} AND ${to} ${bfI}`;
  const porCajero = await prisma.$queryRaw<Array<Record<string, unknown>>>`
    SELECT COALESCE(u.name,'(sin cajero)') cajero, b.name branch,
      COALESCE(SUM(i.discount),0)::int "totalDesc", COUNT(*)::int facturas
    FROM "Invoice" i JOIN "Branch" b ON b.id=i."branchId" LEFT JOIN "User" u ON u.id=i."cashierId"
    WHERE i.status='PAGADA' AND i.discount>0 AND i."issuedAt" BETWEEN ${from} AND ${to} ${bfI}
    GROUP BY u.name, b.name ORDER BY "totalDesc" DESC`;
  const lista = await prisma.$queryRaw<Array<Record<string, unknown>>>`
    SELECT i.number, to_char(i."issuedAt",'DD/MM/YYYY') fecha, b.name branch,
      COALESCE(u.name,'—') cajero, COALESCE(p.name,'Cliente') paciente,
      i.discount::int descuento, i."discountReason" motivo, i.total::int total
    FROM "Invoice" i JOIN "Branch" b ON b.id=i."branchId"
    LEFT JOIN "User" u ON u.id=i."cashierId" LEFT JOIN "Patient" p ON p.id=i."patientId"
    WHERE i.status='PAGADA' AND i.discount>0 AND i."issuedAt" BETWEEN ${from} AND ${to} ${bfI}
    ORDER BY i."issuedAt" DESC LIMIT 100`;
  res.json({ resumen, porCajero, lista });
});
