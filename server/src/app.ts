import 'express-async-errors';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import cookieParser from 'cookie-parser';
import { env } from './config/env.js';
import { notFound, errorHandler } from './middleware/error.js';
import { invalidateOnWrite } from './utils/cache.js';
import { auditRouter } from './modules/audit/audit.routes.js';
import { authRouter } from './modules/auth/auth.routes.js';
import { branchesRouter } from './modules/branches/branches.routes.js';
import { catalogRouter } from './modules/catalog/catalog.routes.js';
import { patientsRouter } from './modules/patients/patients.routes.js';
import { appointmentsRouter } from './modules/appointments/appointments.routes.js';
import { calendarRouter } from './modules/calendar/calendar.routes.js';
import { usersRouter } from './modules/users/users.routes.js';
import { invoicesRouter } from './modules/invoices/invoices.routes.js';
import { messagingRouter } from './modules/messaging/messaging.routes.js';
import { metaWebhookRouter } from './modules/messaging/meta.webhook.js';
import { pipelineRouter } from './modules/messaging/pipeline.routes.js';
import { pointsRouter } from './modules/points/points.routes.js';
import { configRouter } from './modules/config/config.routes.js';
import { portalRouter } from './modules/portal/portal.routes.js';
import { portalAdminRouter } from './modules/portal/portal.admin.routes.js';
import { cashCloseRouter } from './modules/cashclose/cashclose.routes.js';
import { notificationsRouter } from './modules/notifications/notifications.routes.js';
import { badgesRouter } from './modules/notifications/badges.routes.js';
import { reportsRouter } from './modules/reports/reports.routes.js';
import { inventoryRouter } from './modules/inventory/inventory.routes.js';
import { assetsRouter } from './modules/assets/assets.routes.js';
import { teamRouter } from './modules/team/team.routes.js';
import { maintenanceRouter } from './modules/maintenance/maintenance.routes.js';
import { purchasesRouter } from './modules/purchases/purchases.routes.js';
import { accountingRouter } from './modules/accounting/accounting.routes.js';
import { followupRouter } from './modules/followup/followup.routes.js';
import { denyCoordinator, requireModule, requireRole, requireStaff } from './middleware/auth.js';

export function createApp() {
  const app = express();

  // Detrás de nginx/proxy: necesario para rate-limit e IPs reales.
  app.set('trust proxy', 1);

  // Cabeceras de seguridad. La API es JSON (no sirve HTML), así CSP no aplica aquí.
  app.use(helmet({ contentSecurityPolicy: false, crossOriginResourcePolicy: { policy: 'cross-origin' } }));
  app.use(cors({ origin: env.corsOrigins, credentials: true }));
  // El chat de equipo permite adjuntos (base64) → límite mayor SOLO en esa ruta.
  app.use('/api/team-chat', express.json({ limit: '15mb' }));
  // Guardamos el cuerpo crudo para validar la firma del webhook de Meta (X-Hub-Signature-256).
  app.use(express.json({ limit: '1mb', verify: (req, _res, buf) => { (req as unknown as { rawBody: Buffer }).rawBody = buf; } }));
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

  // Webhook de Meta (WhatsApp/Instagram/Messenger): PÚBLICO, sin auth ni rate-limit
  // (lo llama Meta). Debe ir ANTES del limiter y de las rutas protegidas.
  app.use('/api/webhooks/meta', metaWebhookRouter);

  app.use('/api', apiLimiter);
  app.use('/api/auth/staff/login', authLimiter);
  app.use('/api/auth/patient/login', authLimiter);
  app.use('/api/auth', authRouter);
  app.use('/api/audit', auditRouter);
  app.use('/api/branches', branchesRouter);
  app.use('/api/catalog', requireStaff, denyCoordinator, catalogRouter);
  app.use('/api/patients', requireStaff, requireModule('pacientes'), invalidateOnWrite('pat:', 'inv:', 'appt:', 'fup:'), patientsRouter);
  app.use('/api/appointments', requireStaff, requireModule('agenda'), invalidateOnWrite('appt:', 'inv:', 'pat:', 'fup:'), appointmentsRouter);
  app.use('/api/calendar', calendarRouter);
  app.use('/api/users', usersRouter);
  app.use('/api/invoices', requireStaff, denyCoordinator, invalidateOnWrite('inv:', 'pat:', 'appt:', 'fup:', 'acc:'), invoicesRouter);
  app.use('/api/messaging', requireStaff, requireModule('mensajes'), messagingRouter);
  app.use('/api/pipeline', pipelineRouter);
  app.use('/api/points', requireStaff, denyCoordinator, pointsRouter);
  app.use('/api/config', requireStaff, denyCoordinator, configRouter);
  app.use('/api/portal-admin', requireStaff, denyCoordinator, portalAdminRouter);
  app.use('/api/portal', portalRouter);
  app.use('/api/cashclose', requireStaff, denyCoordinator, cashCloseRouter);
  app.use('/api/badges', badgesRouter);
  app.use('/api/notifications', notificationsRouter);
  app.use('/api/reports', requireStaff, denyCoordinator, reportsRouter);
  app.use('/api/inventory', requireStaff, denyCoordinator, inventoryRouter);
  app.use('/api/assets', requireStaff, requireModule('equipos'), assetsRouter);
  app.use('/api/team-chat', requireStaff, requireModule('chat'), teamRouter);
  app.use('/api/maintenance', maintenanceRouter);
  app.use('/api/purchases', requireStaff, denyCoordinator, invalidateOnWrite('pur:', 'acc:'), purchasesRouter);
  app.use('/api/accounting', requireStaff, requireRole('ADMIN'), invalidateOnWrite('acc:'), accountingRouter);
  app.use('/api/followup', requireStaff, requireModule('contactar'), invalidateOnWrite('fup:', 'pat:'), followupRouter);

  // Fases siguientes montan aquí sus routers:
  // app.use('/api/invoices', invoicesRouter);   // Fase 4
  // app.use('/api/messaging', messagingRouter); // Fase 5
  // app.use('/api/points', pointsRouter);       // Fase 6
  // app.use('/api/portal', portalRouter);       // Fase 7

  app.use(notFound);
  app.use(errorHandler);
  return app;
}
