import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../../db/prisma.js';
import { requireStaff, requireRole, branchScope } from '../../middleware/auth.js';
import { normalizePhone } from '../messaging/whatsapp.service.js';
import { tratoFormal, sucursalLabel } from '../../utils/trato.js';
import { sendCampaignEmail } from '../mail/mail.service.js';

export const followupRouter = Router();

const DIA = 86_400_000;
const NEGOCIO = 'Li Estetic Center';

function wa(phone: string, texto: string): string | null {
  const p = normalizePhone(phone);
  return p ? `https://wa.me/${p}?text=${encodeURIComponent(texto)}` : null;
}

interface Row {
  id: string; name: string; trato: string; phone: string; email: string | null; sex: string | null;
  branch: string; ultimaVisita: string | null; dias: number | null; dia?: number; wa: string | null;
}

/** Mensajes de campaña por grupo (correo y WhatsApp). */
const MSG = {
  cumpleanos: { subject: `¡Feliz cumpleaños! 🎉 — ${NEGOCIO}`, wa: (t: string) => `Hola ${t} 🎉 ¡Feliz cumpleaños de parte de todo el equipo de ${NEGOCIO}! Le tenemos un detalle especial en su próxima visita. 💜`,
    lines: ['¡Feliz cumpleaños de parte de todo el equipo!', 'Queremos celebrar con usted: le tenemos un detalle especial en su próxima visita.', 'Agende cuando guste. 💜'] },
  m3: { subject: `Le extrañamos 💜 — ${NEGOCIO}`, wa: (t: string) => `Hola ${t} 💜 Le saludamos de ${NEGOCIO}. ¿Le gustaría agendar su próxima cita para seguir con su proceso?`,
    lines: ['Hace unos meses que no le vemos.', '¿Le gustaría agendar su próxima cita y continuar cuidándose?', 'Estamos para ayudarle.'] },
  m6: { subject: `¿Retomamos su tratamiento? — ${NEGOCIO}`, wa: (t: string) => `Hola ${t} 💜 La extrañamos en ${NEGOCIO}. ¿Le gustaría retomar su tratamiento?`,
    lines: ['Han pasado varios meses desde su última visita.', '¿Le gustaría retomar su tratamiento? Con gusto le ayudamos a agendar.'] },
  m12: { subject: `¡Le extrañamos! Ofertas para usted — ${NEGOCIO}`, wa: (t: string) => `Hola ${t} 💜 ¡Le extrañamos en ${NEGOCIO}! Tenemos ofertas especiales para que retome su cuidado.`,
    lines: ['Ha pasado más de un año desde su última visita.', 'Tenemos ofertas especiales de reactivación pensadas para usted.', '¡Nos encantaría verle de nuevo! 💜'] },
} as const;

type Grupo = keyof typeof MSG | 'm3' | 'm6' | 'm12';

/** Agrupa a los pacientes de una sucursal por seguimiento/inactividad/cumpleaños. */
async function buckets(scopeBranchId: string | null) {
  const scope = scopeBranchId ? { branchId: scopeBranchId } : {};
  const pacientes = await prisma.patient.findMany({
    where: scope,
    select: { id: true, name: true, phone: true, email: true, sex: true, birthDate: true, branch: { select: { name: true, place: true } } },
  });
  const porValidar: Row[] = [];
  const inactivos = { m3: [] as Row[], m6: [] as Row[], m12: [] as Row[] };
  const cumpleanos: Row[] = [];
  if (!pacientes.length) return { porValidar, inactivos, cumpleanos };

  const ult = await prisma.treatmentSession.groupBy({
    by: ['patientId'], _max: { at: true },
    where: { patientId: { in: pacientes.map((p) => p.id) } },
  });
  const ultimaDe = new Map(ult.map((u) => [u.patientId, u._max.at ?? null]));
  const ahora = Date.now();
  const mesActual = new Date().getMonth();
  const fmt = (d: Date | null) => (d ? d.toLocaleDateString('es-DO', { day: '2-digit', month: 'short', year: 'numeric' }) : null);

  for (const p of pacientes) {
    const trato = tratoFormal(p.name, p.sex);
    const ultima = ultimaDe.get(p.id) ?? null;
    const dias = ultima ? Math.floor((ahora - ultima.getTime()) / DIA) : null;
    const base: Row = { id: p.id, name: p.name, trato, phone: p.phone, email: p.email, sex: p.sex, branch: sucursalLabel(p.branch?.name ?? '—', p.branch?.place), ultimaVisita: fmt(ultima), dias, wa: null };

    if (dias != null && dias <= 7) porValidar.push({ ...base, wa: wa(p.phone, `Hola ${trato} 💜 Le saludamos de ${NEGOCIO}. ¿Cómo se ha sentido después de su tratamiento? Nos encantaría saber cómo va su proceso.`) });
    else if (dias != null && dias >= 365) inactivos.m12.push({ ...base, wa: wa(p.phone, MSG.m12.wa(trato)) });
    else if (dias != null && dias >= 180) inactivos.m6.push({ ...base, wa: wa(p.phone, MSG.m6.wa(trato)) });
    else if (dias != null && dias >= 90) inactivos.m3.push({ ...base, wa: wa(p.phone, MSG.m3.wa(trato)) });

    if (p.birthDate && p.birthDate.getMonth() === mesActual) cumpleanos.push({ ...base, dia: p.birthDate.getDate(), wa: wa(p.phone, MSG.cumpleanos.wa(trato)) });
  }
  cumpleanos.sort((a, b) => (a.dia ?? 0) - (b.dia ?? 0));
  return { porValidar, inactivos, cumpleanos };
}

/** Reporte de seguimiento/actividad del paciente (admin/recepción/esteticista). */
followupRouter.get('/', requireStaff, requireRole('ADMIN', 'RECEPCIONISTA', 'ESTETICISTA'), branchScope, async (req, res) => {
  res.json(await buckets(req.scopeBranchId ?? null));
});

/** Envío masivo por correo a un grupo (solo Administradora). Manual y controlado. */
followupRouter.post('/campana', requireStaff, requireRole('ADMIN'), branchScope, async (req, res) => {
  const { grupo } = z.object({ grupo: z.enum(['cumpleanos', 'm3', 'm6', 'm12']) }).parse(req.body);
  const b = await buckets(req.scopeBranchId ?? null);
  const lista: Row[] = grupo === 'cumpleanos' ? b.cumpleanos : (b.inactivos as Record<string, Row[]>)[grupo];
  const plantilla = MSG[grupo as Grupo];
  let enviados = 0; let sinCorreo = 0;
  for (const p of lista) {
    if (!p.email) { sinCorreo++; continue; }
    const r = await sendCampaignEmail(p.email, { greeting: `Hola ${p.trato},`, subject: plantilla.subject, lines: [...plantilla.lines], branchName: p.branch });
    if (r.sent) enviados++;
  }
  res.json({ ok: true, total: lista.length, enviados, sinCorreo, message: `Enviados ${enviados} de ${lista.length}${sinCorreo ? ` · ${sinCorreo} sin correo` : ''}` });
});

/**
 * CRON diario de cumpleaños (sin login; protegido por secreto). Envía el saludo a
 * quienes cumplen HOY, con correo, y que aún no recibieron el de este año. Configúralo
 * con un Cron Job de Render que llame a POST /api/followup/cron/birthday con el header
 * x-cron-secret = CRON_SECRET. Sin CRON_SECRET, el endpoint queda deshabilitado.
 */
followupRouter.post('/cron/birthday', async (req, res) => {
  const secret = process.env.CRON_SECRET;
  if (!secret) return res.status(503).json({ error: 'CRON_SECRET no configurado' });
  if (req.header('x-cron-secret') !== secret) return res.status(401).json({ error: 'No autorizado' });

  const hoy = new Date();
  const anio = hoy.getFullYear();
  // Prisma no filtra por mes/día de una fecha directamente: se traen los que tienen
  // fecha de nacimiento y aún no fueron saludados este año, y se filtra en memoria.
  const candidatos = await prisma.patient.findMany({
    where: { birthDate: { not: null }, email: { not: null }, NOT: { lastBdayGreetYear: anio } },
    select: { id: true, name: true, sex: true, email: true, birthDate: true, branch: { select: { name: true } } },
  });
  let enviados = 0;
  for (const p of candidatos) {
    if (!p.birthDate || !p.email) continue;
    if (p.birthDate.getMonth() !== hoy.getMonth() || p.birthDate.getDate() !== hoy.getDate()) continue;
    const trato = tratoFormal(p.name, p.sex);
    const r = await sendCampaignEmail(p.email, { greeting: `Hola ${trato},`, subject: MSG.cumpleanos.subject, lines: [...MSG.cumpleanos.lines], branchName: p.branch?.name });
    if (r.sent) { enviados++; await prisma.patient.update({ where: { id: p.id }, data: { lastBdayGreetYear: anio } }); }
  }
  res.json({ ok: true, enviados });
});
