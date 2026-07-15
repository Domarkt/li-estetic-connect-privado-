import type { ClinicalRecord, Patient } from '@prisma/client';
import { encrypt, decrypt, encryptJson, decryptJson } from '../../utils/crypto.js';

/**
 * Campos sensibles que se cifran en reposo:
 *  - ClinicalRecord: antecedentes, ginecoObst, quirurgicos, medicamentos (Json) + signatureData (firma).
 *  - Patient: cedula, address.
 * Nombre, teléfono y correo quedan en claro para poder buscar (decisión de negocio).
 */

/** Descifra la ficha clínica para enviarla al frontend (objetos legibles). */
export function decryptClinical<T extends Partial<ClinicalRecord> | null | undefined>(cr: T): T {
  if (!cr) return cr;
  return {
    ...cr,
    antecedentes: decryptJson(cr.antecedentes),
    ginecoObst: decryptJson(cr.ginecoObst),
    quirurgicos: decryptJson(cr.quirurgicos),
    medicamentos: decryptJson(cr.medicamentos),
    signatureData: cr.signatureData != null ? decrypt(cr.signatureData) : cr.signatureData,
  } as T;
}

/** Prepara los campos clínicos para guardarlos cifrados (solo los presentes). */
export function encryptClinicalWrite<T extends Record<string, unknown>>(data: T): T {
  const out: Record<string, unknown> = { ...data };
  if ('antecedentes' in out && out.antecedentes !== undefined) out.antecedentes = encryptJson(out.antecedentes);
  if ('ginecoObst' in out && out.ginecoObst !== undefined) out.ginecoObst = encryptJson(out.ginecoObst);
  if ('quirurgicos' in out && out.quirurgicos !== undefined) out.quirurgicos = encryptJson(out.quirurgicos);
  if ('medicamentos' in out && out.medicamentos !== undefined) out.medicamentos = encryptJson(out.medicamentos);
  if ('signatureData' in out && out.signatureData !== undefined) out.signatureData = encrypt(out.signatureData as string | null);
  return out as T;
}

/** Descifra la PII del paciente (cédula, dirección). */
export function decryptPatientPII<T extends Partial<Patient> | null | undefined>(p: T): T {
  if (!p) return p;
  return {
    ...p,
    cedula: p.cedula != null ? decrypt(p.cedula) : p.cedula,
    address: p.address != null ? decrypt(p.address) : p.address,
  } as T;
}

/** Cifra la PII del paciente antes de escribirla (solo campos presentes). */
export function encryptPatientWrite<T extends Record<string, unknown>>(data: T): T {
  const out: Record<string, unknown> = { ...data };
  if ('cedula' in out && out.cedula !== undefined) out.cedula = encrypt(out.cedula as string | null);
  if ('address' in out && out.address !== undefined) out.address = encrypt(out.address as string | null);
  return out as T;
}
