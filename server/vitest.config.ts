import { defineConfig } from 'vitest/config';

/**
 * Pruebas unitarias de la lógica crítica (dinero, sesiones y permisos).
 * No tocan la base de datos: se prueban funciones puras y middleware.
 *
 * Las variables son ficticias y solo sirven para que config/env.ts cargue en
 * las pruebas; nunca se usan contra un servicio real.
 */
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    env: {
      NODE_ENV: 'test',
      JWT_SECRET: 'test-jwt-secret-para-pruebas-1234567890',
      JWT_PATIENT_SECRET: 'test-jwt-patient-secret-para-pruebas-0987654321',
      // 32 bytes en hex, requerido por el cifrado AES-256-GCM.
      ENCRYPTION_KEY: '0'.repeat(64),
      DATABASE_URL: 'postgresql://test:test@localhost:5432/test',
    },
  },
});
