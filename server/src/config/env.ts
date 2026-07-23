import dotenv from 'dotenv';
dotenv.config();

const isProd = process.env.NODE_ENV === 'production';

function required(name: string): string {
  const v = process.env[name];
  if (v === undefined) throw new Error(`Missing env var: ${name}`);
  return v;
}

// NINGÚN secreto/llave se escribe en el código. Todos se leen SIEMPRE del entorno
// (Render en producción, .env en local). Si falta alguno, la app no arranca.
const jwtSecret = required('JWT_SECRET');
const jwtPatientSecret = required('JWT_PATIENT_SECRET');
// Llave para cifrar datos sensibles del paciente y tokens de integraciones.
const encryptionKey = required('ENCRYPTION_KEY');

// En producción, además, exigimos que sean fuertes (no valores de ejemplo).
const weak = (s: string) => !s || s.length < 24 || s.includes('change-me') || s.startsWith('dev-');
if (isProd) {
  if (weak(jwtSecret) || weak(jwtPatientSecret)) {
    throw new Error(
      'JWT_SECRET / JWT_PATIENT_SECRET inseguros en producción. Usa secretos aleatorios de 32+ caracteres (p.ej. `openssl rand -base64 48`).',
    );
  }
  if (weak(encryptionKey)) {
    throw new Error(
      'ENCRYPTION_KEY inseguro en producción. Usa una llave aleatoria de 32+ caracteres (p.ej. `openssl rand -base64 48`). ¡No la cambies una vez en uso o no podrás descifrar los datos!',
    );
  }
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL requerido en producción');
}

// CORS_ORIGIN acepta uno o varios orígenes separados por coma (Netlify, Cloudflare Pages, etc.).
// El dominio propio siempre se permite (aunque no esté en el env), para no depender de Render.
const ALWAYS_ALLOWED = [
  'https://sistema.liesteticcenter.com',
  'https://liesteticcenter.com',
  'https://www.liesteticcenter.com',
];
const corsOrigins = [...new Set([
  ...(process.env.CORS_ORIGIN ?? 'http://localhost:5173').split(',').map((s) => s.trim()).filter(Boolean),
  ...ALWAYS_ALLOWED,
])];

export const env = {
  isProd,
  port: Number(process.env.PORT ?? 4000),
  // Compat: primer origen (usado como base por defecto en algunos lugares).
  corsOrigin: corsOrigins[0],
  corsOrigins,
  jwtSecret,
  jwtPatientSecret,
  encryptionKey,
  jwtExpires: process.env.JWT_EXPIRES ?? '12h',
  // La paciente entra desde su celular y no debe estar reingresando: su sesión
  // dura mucho más que la del personal (que sí trabaja en equipos compartidos).
  jwtPatientExpires: process.env.JWT_PATIENT_EXPIRES ?? '30d',
  seedStaffPassword: process.env.SEED_STAFF_PASSWORD ?? 'liestetic',
  seedPatientPassword: process.env.SEED_PATIENT_PASSWORD ?? 'paciente',
};
