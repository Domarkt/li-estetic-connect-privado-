import { prisma } from '../db/prisma.js';
import { encrypt, encryptJson, isEncrypted } from '../utils/crypto.js';

/**
 * Cifra los datos sensibles que quedaron en texto plano ANTES de activar el cifrado.
 * Es idempotente: salta lo que ya está cifrado (prefijo `enc:`). Best-effort: si algo
 * falla, se registra pero no tumba el arranque del servidor. Para el volumen actual
 * (decenas de pacientes) corre en milisegundos y en arranques siguientes es no-op.
 */
export async function backfillEncryption() {
  let patients = 0, records = 0, tokens = 0;

  // Patient.cedula / address
  const ps = await prisma.patient.findMany({ where: { OR: [{ cedula: { not: null } }, { address: { not: null } }] }, select: { id: true, cedula: true, address: true } });
  for (const p of ps) {
    const data: { cedula?: string | null; address?: string | null } = {};
    if (p.cedula && !isEncrypted(p.cedula)) data.cedula = encrypt(p.cedula);
    if (p.address && !isEncrypted(p.address)) data.address = encrypt(p.address);
    if (Object.keys(data).length) { await prisma.patient.update({ where: { id: p.id }, data }); patients++; }
  }

  // ClinicalRecord: campos Json de salud + firma
  const crs = await prisma.clinicalRecord.findMany({ select: { id: true, antecedentes: true, ginecoObst: true, quirurgicos: true, medicamentos: true, signatureData: true } });
  for (const cr of crs) {
    const data: Record<string, unknown> = {};
    for (const k of ['antecedentes', 'ginecoObst', 'quirurgicos', 'medicamentos'] as const) {
      const v = cr[k];
      if (v != null && !isEncrypted(v)) data[k] = encryptJson(v);
    }
    if (cr.signatureData && !isEncrypted(cr.signatureData)) data.signatureData = encrypt(cr.signatureData);
    if (Object.keys(data).length) { await prisma.clinicalRecord.update({ where: { id: cr.id }, data }); records++; }
  }

  // Tokens OAuth de Google Calendar (el literal 'demo' se deja en claro)
  const conns = await prisma.calendarConnection.findMany({ select: { id: true, accessToken: true, refreshToken: true } });
  for (const c of conns) {
    const data: { accessToken?: string; refreshToken?: string } = {};
    if (c.accessToken && c.accessToken !== 'demo' && !isEncrypted(c.accessToken)) data.accessToken = encrypt(c.accessToken)!;
    if (c.refreshToken && c.refreshToken !== 'demo' && !isEncrypted(c.refreshToken)) data.refreshToken = encrypt(c.refreshToken)!;
    if (Object.keys(data).length) { await prisma.calendarConnection.update({ where: { id: c.id }, data }); tokens++; }
  }

  if (patients || records || tokens) {
    console.log(`  🔐 Cifrado backfill: ${patients} pacientes, ${records} fichas, ${tokens} conexiones.`);
  }
}
