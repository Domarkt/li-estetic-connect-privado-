import dotenv from 'dotenv';
dotenv.config();

const isProd = process.env.NODE_ENV === 'production';

function required(name: string, fallback?: string): string {
  const v = process.env[name] ?? fallback;
  if (v === undefined) throw new Error(`Missing env var: ${name}`);
  return v;
}

// Secretos de desarrollo: en producción NO deben usarse.
const DEV_STAFF_SECRET = 'dev-staff-secret';
const DEV_PATIENT_SECRET = 'dev-patient-secret';

const jwtSecret = required('JWT_SECRET', DEV_STAFF_SECRET);
const jwtPatientSecret = required('JWT_PATIENT_SECRET', DEV_PATIENT_SECRET);

if (isProd) {
  const weak = (s: string) =>
    !s || s.length < 24 || s === DEV_STAFF_SECRET || s === DEV_PATIENT_SECRET || s.includes('change-me');
  if (weak(jwtSecret) || weak(jwtPatientSecret)) {
    throw new Error(
      'JWT_SECRET / JWT_PATIENT_SECRET inseguros en producción. Usa secretos aleatorios de 32+ caracteres (p.ej. `openssl rand -base64 48`).',
    );
  }
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL requerido en producción');
}

export const env = {
  isProd,
  port: Number(process.env.PORT ?? 4000),
  // En prod, CORS_ORIGIN es obligatorio (no permitimos "*").
  corsOrigin: process.env.CORS_ORIGIN ?? 'http://localhost:5173',
  jwtSecret,
  jwtPatientSecret,
  jwtExpires: process.env.JWT_EXPIRES ?? '12h',
  seedStaffPassword: process.env.SEED_STAFF_PASSWORD ?? 'liestetic',
  seedPatientPassword: process.env.SEED_PATIENT_PASSWORD ?? 'paciente',
};
