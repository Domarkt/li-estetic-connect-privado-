import { Router } from 'express';
import { prisma } from '../../db/prisma.js';
import { requireStaff, requireRole, branchScope } from '../../middleware/auth.js';
import { normalizePhone } from '../messaging/whatsapp.service.js';
import { tratoFormal } from '../../utils/trato.js';

export const followupRouter = Router();

const DIA = 86_400_000;

/** Enlace de WhatsApp con un mensaje formal ya escrito para el paciente. */
function wa(phone: string, texto: string): string | null {
  const p = normalizePhone(phone);
  return p ? `https://wa.me/${p}?text=${encodeURIComponent(texto)}` : null;
}

/**
 * Reporte de SEGUIMIENTO y ACTIVIDAD del paciente (recepción/esteticista/admin).
 *  · porValidar: atendidos hace poco → llamar para validar cómo va el tratamiento.
 *  · inactivos:  sin volver 3 / 6 / 12+ meses → reactivar (mensajes por WhatsApp).
 *  · cumpleanos: cumpleaños del mes → felicitar / ofertar.
 * Todo filtrado por sucursal y con un mensaje formal (Sr./Sra.) listo para enviar.
 */
followupRouter.get('/', requireStaff, requireRole('ADMIN', 'RECEPCIONISTA', 'ESTETICISTA'), branchScope, async (req, res) => {
  const scope = req.scopeBranchId ? { branchId: req.scopeBranchId } : {};
  const negocio = 'Li Estetic Center';

  const pacientes = await prisma.patient.findMany({
    where: scope,
    select: { id: true, name: true, phone: true, sex: true, birthDate: true, branch: { select: { name: true } } },
  });
  if (!pacientes.length) return res.json({ porValidar: [], inactivos: { m3: [], m6: [], m12: [] }, cumpleanos: [] });

  // Última visita (última sesión firmada) de cada paciente, en una sola consulta.
  const ult = await prisma.treatmentSession.groupBy({
    by: ['patientId'],
    _max: { at: true },
    where: { patientId: { in: pacientes.map((p) => p.id) } },
  });
  const ultimaDe = new Map(ult.map((u) => [u.patientId, u._max.at ?? null]));

  const ahora = Date.now();
  const mesActual = new Date().getMonth();
  const fmt = (d: Date | null) => (d ? d.toLocaleDateString('es-DO', { day: '2-digit', month: 'short', year: 'numeric' }) : null);

  const porValidar: unknown[] = [];
  const inactivos = { m3: [] as unknown[], m6: [] as unknown[], m12: [] as unknown[] };
  const cumpleanos: unknown[] = [];

  for (const p of pacientes) {
    const trato = tratoFormal(p.name, p.sex);
    const ultima = ultimaDe.get(p.id) ?? null;
    const dias = ultima ? Math.floor((ahora - ultima.getTime()) / DIA) : null;
    const base = { id: p.id, name: p.name, trato, phone: p.phone, sex: p.sex, branch: p.branch?.name ?? '—', ultimaVisita: fmt(ultima), dias };

    // Por validar: atendido en los últimos 7 días.
    if (dias != null && dias <= 7) {
      porValidar.push({ ...base, wa: wa(p.phone, `Hola ${trato} 💜 Le saludamos de ${negocio}. ¿Cómo se ha sentido después de su tratamiento? Nos encantaría saber cómo va su proceso y aclarar cualquier duda.`) });
    } else if (dias != null && dias >= 365) {
      inactivos.m12.push({ ...base, wa: wa(p.phone, `Hola ${trato} 💜 ¡Le extrañamos en ${negocio}! Ha pasado más de un año desde su última visita. ¿Le gustaría retomar su tratamiento? Tenemos ofertas especiales para usted.`) });
    } else if (dias != null && dias >= 180) {
      inactivos.m6.push({ ...base, wa: wa(p.phone, `Hola ${trato} 💜 La extrañamos en ${negocio}. Han pasado varios meses; ¿le gustaría agendar una cita para continuar cuidándose?`) });
    } else if (dias != null && dias >= 90) {
      inactivos.m3.push({ ...base, wa: wa(p.phone, `Hola ${trato} 💜 Le saludamos de ${negocio}. ¿Le gustaría agendar su próxima cita? Estamos para ayudarle a seguir con su proceso.`) });
    }

    // Cumpleaños del mes (independiente de la actividad).
    if (p.birthDate && p.birthDate.getMonth() === mesActual) {
      cumpleanos.push({ ...base, dia: p.birthDate.getDate(), wa: wa(p.phone, `Hola ${trato} 🎉 ¡Feliz cumpleaños de parte de todo el equipo de ${negocio}! Queremos celebrarle con un detalle especial en su próxima visita. 💜`) });
    }
  }

  // Los inactivos y cumpleaños, del más reciente/próximo primero.
  (cumpleanos as { dia: number }[]).sort((a, b) => a.dia - b.dia);
  res.json({ porValidar, inactivos, cumpleanos });
});
