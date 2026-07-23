import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../../db/prisma.js';
import { requireStaff, requireRole } from '../../middleware/auth.js';
import { audit } from '../audit/audit.service.js';

/**
 * Administración del PORTAL DEL PACIENTE: qué paquetes ve, y los mensajes y
 * ofertas que la dirección le publica directamente.
 *
 * Es el canal propio hacia las pacientes, sin depender de WhatsApp ni del correo.
 */
export const portalAdminRouter = Router();

const gestores = ['ADMIN', 'RECEPCIONISTA'] as const;

// ── Paquetes visibles en el portal ──────────────────────────────────────────
/** Combos y paquetes con su estado de publicación (y por qué no se ven). */
portalAdminRouter.get('/catalogo', requireStaff, requireRole(...gestores), async (_req, res) => {
  const items = await prisma.catalogItem.findMany({
    where: { active: true, kind: { in: ['PAQUETE', 'COMBO'] } },
    orderBy: [{ kind: 'asc' }, { name: 'asc' }],
    select: { id: true, name: true, code: true, kind: true, price: true, sessions: true, showInPortal: true },
  });
  res.json(items.map((i) => ({
    ...i,
    // Sin precio no se publica aunque esté marcado: no se le puede ofrecer "RD$0".
    visible: i.showInPortal && i.price > 0,
    motivo: !i.showInPortal ? 'Oculto por la dirección' : i.price <= 0 ? 'Sin precio: defínelo para publicarlo' : null,
  })));
});

const visibleSchema = z.object({ showInPortal: z.boolean() });

/** Publicar o quitar del portal un paquete/combo. */
portalAdminRouter.patch('/catalogo/:id', requireStaff, requireRole(...gestores), async (req, res) => {
  const { showInPortal } = visibleSchema.parse(req.body);
  const item = await prisma.catalogItem.findUnique({ where: { id: req.params.id } });
  if (!item) return res.status(404).json({ error: 'Ítem no encontrado' });
  await prisma.catalogItem.update({ where: { id: item.id }, data: { showInPortal } });
  res.json({ ok: true, message: showInPortal ? `"${item.name}" ya se muestra en el portal` : `"${item.name}" se quitó del portal` });
});

// ── Accesos al portal ───────────────────────────────────────────────────────
/**
 * Pacientes con cuenta de portal. Permite retirar el acceso a alguien concreto
 * (conflicto, cuenta compartida, paciente que pidió salir) sin borrar su
 * expediente: se desactiva la cuenta, el historial clínico queda intacto.
 */
portalAdminRouter.get('/accesos', requireStaff, requireRole(...gestores), async (req, res) => {
  const q = (req.query.q as string | undefined)?.trim();
  const scope = req.staff!.role === 'ADMIN' ? {} : { branchId: req.staff!.branchId ?? undefined };
  const cuentas = await prisma.patientAccount.findMany({
    where: {
      patient: {
        ...scope,
        ...(q ? { OR: [{ name: { contains: q, mode: 'insensitive' as const } }, { phone: { contains: q } }] } : {}),
      },
    },
    include: { patient: { include: { branch: true } } },
    orderBy: { createdAt: 'desc' },
    take: 200,
  });
  res.json(cuentas.map((c) => ({
    id: c.id,
    patientId: c.patientId,
    name: c.patient.name,
    phone: c.patient.phone,
    email: c.patient.email,
    branch: c.patient.branch?.name ?? '—',
    active: c.active,
    desde: c.createdAt.toLocaleDateString('es-DO', { day: '2-digit', month: 'short', year: 'numeric' }),
  })));
});

const accesoSchema = z.object({ active: z.boolean() });

/** Quitar o devolver el acceso al portal de un paciente. */
portalAdminRouter.patch('/accesos/:id', requireStaff, requireRole(...gestores), async (req, res) => {
  const { active } = accesoSchema.parse(req.body);
  const cuenta = await prisma.patientAccount.findUnique({ where: { id: req.params.id }, include: { patient: true } });
  if (!cuenta) return res.status(404).json({ error: 'Cuenta no encontrada' });
  if (req.staff!.role !== 'ADMIN' && cuenta.patient.branchId !== req.staff!.branchId) {
    return res.status(403).json({ error: 'Paciente de otra sucursal' });
  }

  await prisma.patientAccount.update({
    where: { id: cuenta.id },
    // Al retirar el acceso se invalida cualquier código pendiente.
    data: { active, ...(active ? {} : { otpHash: null, otpExpiresAt: null, otpAttempts: 0 }) },
  });

  await audit(req, {
    action: 'PORTAL_ACCESS', entity: 'PatientAccount', entityId: cuenta.id,
    branchId: cuenta.patient.branchId,
    summary: `${active ? 'Devolvió' : 'Retiró'} el acceso al portal de ${cuenta.patient.name}`,
  });

  res.json({
    ok: true,
    message: active
      ? `${cuenta.patient.name} ya puede entrar a su portal`
      : `Se retiró el acceso al portal de ${cuenta.patient.name}`,
  });
});

// ── Mensajes y ofertas ──────────────────────────────────────────────────────
const mensajeSchema = z.object({
  kind: z.enum(['OFERTA', 'AVISO', 'CONSEJO']).default('AVISO'),
  title: z.string().trim().min(1, 'Escribe un título').max(80),
  body: z.string().trim().min(1, 'Escribe el mensaje').max(500),
  ctaLabel: z.string().trim().max(30).optional(),
  ctaLink: z.string().trim().max(300).optional(),
  branchId: z.string().nullish(), // null = todas las sucursales
  startsAt: z.string().optional(),
  endsAt: z.string().optional(),
  active: z.boolean().optional(),
});

const serializar = (m: {
  id: string; kind: string; title: string; body: string; ctaLabel: string | null; ctaLink: string | null;
  branchId: string | null; active: boolean; startsAt: Date | null; endsAt: Date | null; createdAt: Date;
}) => ({
  id: m.id, kind: m.kind, title: m.title, body: m.body,
  ctaLabel: m.ctaLabel, ctaLink: m.ctaLink, branchId: m.branchId, active: m.active,
  startsAt: m.startsAt ? m.startsAt.toISOString().slice(0, 10) : null,
  endsAt: m.endsAt ? m.endsAt.toISOString().slice(0, 10) : null,
  creado: m.createdAt.toLocaleDateString('es-DO', { day: '2-digit', month: 'short', year: 'numeric' }),
  // Si está activo pero fuera de fechas, la dirección debe verlo claramente.
  vigente: m.active
    && (!m.startsAt || m.startsAt.getTime() <= Date.now())
    && (!m.endsAt || m.endsAt.getTime() >= Date.now()),
});

/** Lista de mensajes publicados (los más nuevos primero). */
portalAdminRouter.get('/mensajes', requireStaff, requireRole(...gestores), async (_req, res) => {
  const rows = await prisma.portalMessage.findMany({ orderBy: { createdAt: 'desc' }, take: 100 });
  res.json(rows.map(serializar));
});

/** Publicar un mensaje u oferta en el portal. */
portalAdminRouter.post('/mensajes', requireStaff, requireRole(...gestores), async (req, res) => {
  const b = mensajeSchema.parse(req.body);
  const m = await prisma.portalMessage.create({
    data: {
      kind: b.kind, title: b.title, body: b.body,
      ctaLabel: b.ctaLabel || null, ctaLink: b.ctaLink || null,
      branchId: b.branchId ?? null,
      startsAt: b.startsAt ? new Date(b.startsAt + 'T00:00:00') : null,
      endsAt: b.endsAt ? new Date(b.endsAt + 'T23:59:59') : null,
      active: b.active ?? true,
      createdById: req.staff!.sub,
    },
  });
  await audit(req, {
    action: 'PORTAL_MESSAGE', entity: 'PortalMessage', entityId: m.id,
    summary: `Publicó en el portal (${m.kind}): ${m.title}`,
  });
  res.status(201).json({ ...serializar(m), message: 'Publicado en el portal del paciente' });
});

/** Editar / activar / desactivar un mensaje. */
portalAdminRouter.patch('/mensajes/:id', requireStaff, requireRole(...gestores), async (req, res) => {
  const b = mensajeSchema.partial().parse(req.body);
  const existe = await prisma.portalMessage.findUnique({ where: { id: req.params.id } });
  if (!existe) return res.status(404).json({ error: 'Mensaje no encontrado' });
  const m = await prisma.portalMessage.update({
    where: { id: existe.id },
    data: {
      ...(b.kind !== undefined ? { kind: b.kind } : {}),
      ...(b.title !== undefined ? { title: b.title } : {}),
      ...(b.body !== undefined ? { body: b.body } : {}),
      ...(b.ctaLabel !== undefined ? { ctaLabel: b.ctaLabel || null } : {}),
      ...(b.ctaLink !== undefined ? { ctaLink: b.ctaLink || null } : {}),
      ...(b.branchId !== undefined ? { branchId: b.branchId ?? null } : {}),
      ...(b.active !== undefined ? { active: b.active } : {}),
      ...(b.startsAt !== undefined ? { startsAt: b.startsAt ? new Date(b.startsAt + 'T00:00:00') : null } : {}),
      ...(b.endsAt !== undefined ? { endsAt: b.endsAt ? new Date(b.endsAt + 'T23:59:59') : null } : {}),
    },
  });
  res.json({ ...serializar(m), message: b.active === false ? 'Mensaje ocultado' : 'Cambios guardados' });
});

/** Quitar un mensaje del portal. */
portalAdminRouter.delete('/mensajes/:id', requireStaff, requireRole(...gestores), async (req, res) => {
  const existe = await prisma.portalMessage.findUnique({ where: { id: req.params.id } });
  if (!existe) return res.status(404).json({ error: 'Mensaje no encontrado' });
  await prisma.portalMessage.delete({ where: { id: existe.id } });
  res.json({ ok: true, message: 'Mensaje eliminado' });
});
