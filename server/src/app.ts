import 'express-async-errors';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import cookieParser from 'cookie-parser';
import { env } from './config/env.js';
import { notFound, errorHandler } from './middleware/error.js';
import { authRouter } from './modules/auth/auth.routes.js';
import { branchesRouter } from './modules/branches/branches.routes.js';
import { catalogRouter } from './modules/catalog/catalog.routes.js';
import { patientsRouter } from './modules/patients/patients.routes.js';
import { appointmentsRouter } from './modules/appointments/appointments.routes.js';
import { calendarRouter } from './modules/calendar/calendar.routes.js';
import { usersRouter } from './modules/users/users.routes.js';
import { invoicesRouter } from './modules/invoices/invoices.routes.js';
import { messagingRouter } from './modules/messaging/messaging.routes.js';
import { pipelineRouter } from './modules/messaging/pipeline.routes.js';
import { pointsRouter } from './modules/points/points.routes.js';
import { configRouter } from './modules/config/config.routes.js';
import { portalRouter } from './modules/portal/portal.routes.js';
import { cashCloseRouter } from './modules/cashclose/cashclose.routes.js';
import { notificationsRouter } from './modules/notifications/notifications.routes.js';
import { reportsRouter } from './modules/reports/reports.routes.js';
import { inventoryRouter } from './modules/inventory/inventory.routes.js';

export function createApp() {
  const app = express();

  // Detrás de nginx/proxy: necesario para rate-limit e IPs reales.
  app.set('trust proxy', 1);

  // Cabeceras de seguridad. La API es JSON (no sirve HTML), así CSP no aplica aquí.
  app.use(helmet({ contentSecurityPolicy: false, crossOriginResourcePolicy: { policy: 'cross-origin' } }));
  app.use(cors({ origin: env.corsOrigins, credentials: true }));
  app.use(express.json({ limit: '1mb' }));
  app.use(cookieParser());

  // Anti fuerza-bruta en autenticación: 10 intentos por IP cada 15 min.
  const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 10,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Demasiados intentos. Espera unos minutos e inténtalo de nuevo.' },
  });

  // Límite general anti-abuso/DoS: 300 req/min por IP (holgado para uso normal).
  const apiLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 300,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Demasiadas peticiones. Espera un momento.' },
  });

  app.get('/api/health', (_req, res) => res.json({ ok: true, service: 'li-estetic-connect' }));

  app.use('/api', apiLimiter);
  app.use('/api/auth/staff/login', authLimiter);
  app.use('/api/auth/patient/login', authLimiter);
  app.use('/api/auth', authRouter);
  app.use('/api/branches', branchesRouter);
  app.use('/api/catalog', catalogRouter);
  app.use('/api/patients', patientsRouter);
  app.use('/api/appointments', appointmentsRouter);
  app.use('/api/calendar', calendarRouter);
  app.use('/api/users', usersRouter);
  app.use('/api/invoices', invoicesRouter);
  app.use('/api/messaging', messagingRouter);
  app.use('/api/pipeline', pipelineRouter);
  app.use('/api/points', pointsRouter);
  app.use('/api/config', configRouter);
  app.use('/api/portal', portalRouter);
  app.use('/api/cashclose', cashCloseRouter);
  app.use('/api/notifications', notificationsRouter);
  app.use('/api/reports', reportsRouter);
  app.use('/api/inventory', inventoryRouter);

  // Fases siguientes montan aquí sus routers:
  // app.use('/api/invoices', invoicesRouter);   // Fase 4
  // app.use('/api/messaging', messagingRouter); // Fase 5
  // app.use('/api/points', pointsRouter);       // Fase 6
  // app.use('/api/portal', portalRouter);       // Fase 7

  app.use(notFound);
  app.use(errorHandler);
  return app;
}
