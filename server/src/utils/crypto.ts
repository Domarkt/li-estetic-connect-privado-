import crypto from 'node:crypto';
import { env } from '../config/env.js';

/**
 * Cifrado a nivel de aplicación para datos sensibles del paciente (ficha médica,
 * firma, cédula, dirección) y tokens de integraciones (Google Calendar).
 *
 * - Algoritmo: AES-256-GCM (cifrado autenticado: detecta manipulación).
 * - La llave vive SOLO en el servidor (env ENCRYPTION_KEY); nunca llega al navegador.
 * - Formato: `enc:v1:<base64(iv|tag|ciphertext)>`. El prefijo permite convivir con
 *   datos antiguos en texto plano (se leen tal cual) y migrarlos gradualmente.
 */

const PREFIX = 'enc:v1:';
const IV_LEN = 12; // 96 bits, recomendado para GCM
const TAG_LEN = 16;

// Llave de 32 bytes derivada del secreto (acepta cualquier longitud de secreto).
const KEY = crypto.createHash('sha256').update(env.encryptionKey).digest();

export const isEncrypted = (v: unknown): v is string =>
  typeof v === 'string' && v.startsWith(PREFIX);

/** Cifra un texto. `null`/`undefined` se conservan tal cual. */
export function encrypt(plain: string | null | undefined): string | null {
  if (plain == null) return null;
  const iv = crypto.randomBytes(IV_LEN);
  const cipher = crypto.createCipheriv('aes-256-gcm', KEY, iv);
  const ct = Buffer.concat([cipher.update(String(plain), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return PREFIX + Buffer.concat([iv, tag, ct]).toString('base64');
}

/** Descifra un texto. Si no está cifrado (dato antiguo en texto plano) lo devuelve igual. */
export function decrypt(value: string | null | undefined): string | null {
  if (value == null) return null;
  if (!isEncrypted(value)) return value;
  try {
    const raw = Buffer.from(value.slice(PREFIX.length), 'base64');
    const iv = raw.subarray(0, IV_LEN);
    const tag = raw.subarray(IV_LEN, IV_LEN + TAG_LEN);
    const ct = raw.subarray(IV_LEN + TAG_LEN);
    const decipher = crypto.createDecipheriv('aes-256-gcm', KEY, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ct), decipher.final()]).toString('utf8');
  } catch {
    // Llave incorrecta o dato corrupto: no tumbar el servidor, devolver lo guardado.
    return value;
  }
}

/** Cifra un objeto para guardarlo en una columna Json (se almacena como string cifrado). */
export function encryptJson(obj: unknown): string | null {
  if (obj == null) return null;
  return encrypt(JSON.stringify(obj));
}

/** Descifra un valor de columna Json. Soporta objetos antiguos en texto plano. */
export function decryptJson<T = unknown>(value: unknown): T | null {
  if (value == null) return null;
  if (typeof value === 'string') {
    const plain = isEncrypted(value) ? decrypt(value) : value;
    try {
      return plain ? (JSON.parse(plain) as T) : null;
    } catch {
      return null;
    }
  }
  // Dato antiguo ya como objeto (aún no migrado): devolver tal cual.
  return value as T;
}
