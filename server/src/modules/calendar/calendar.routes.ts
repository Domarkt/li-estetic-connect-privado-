import { Router } from 'express';
import { requireStaff } from '../../middleware/auth.js';
import { env } from '../../config/env.js';
import {
  googleConfigured, buildAuthUrl, exchangeCode, getConnection, disconnect,
} from './calendar.service.js';

export const calendarRouter = Router();

/**
 * Estado de la conexión del calendario para la agenda.
 * El calendario se conecta POR SUCURSAL (en Configuración → Integraciones), así que el
 * estado se resuelve por sucursal: el personal de sucursal ve la suya; la admin ve la
 * sucursal activa que pasa por ?branch. Solo la admin puede gestionar la conexión.
 */
calendarRouter.get('/status', requireStaff, async (req, res) => {
  const isAdmin = req.staff!.role === 'ADMIN';
  const branchId = isAdmin ? (req.query.branch as string | undefined) : req.staff!.branchId ?? undefined;
  let real = false;
  if (branchId) {
    const conn = await getConnection('branch', branchId);
    real = !!conn && conn.accessToken !== 'demo';
  }
  res.json({
    connected: real,
    mode: real ? 'google' : null,
    scope: branchId ? 'branch' : 'all',
    canManage: isAdmin,
    googleConfigured: googleConfigured(),
  });
});

/** Conectar. Requiere credenciales de Google (OAuth real); no hay modo demo. */
calendarRouter.post('/connect', requireStaff, async (req, res) => {
  if (!googleConfigured()) {
    return res.status(400).json({
      error: 'Google Calendar no está configurado. Agrega GOOGLE_CLIENT_ID y GOOGLE_CLIENT_SECRET en el servidor para conectar.',
    });
  }
  const url = buildAuthUrl(`user:${req.staff!.sub}`);
  res.json({ redirect: url });
});

/** Callback de OAuth de Google. */
calendarRouter.get('/oauth/callback', async (req, res) => {
  const code = req.query.code as string | undefined;
  const state = (req.query.state as string | undefined) ?? '';
  const [ownerType, ownerId] = state.split(':');
  if (!code || !ownerType || !ownerId) return res.status(400).send('Parámetros OAuth inválidos');
  try {
    await exchangeCode(code, ownerType, ownerId);
    res.redirect(`${env.corsOrigin}/app/agenda?calendar=connected`);
  } catch (e) {
    res.status(500).send('Error al conectar Google Calendar: ' + (e instanceof Error ? e.message : ''));
  }
});

/** Desconectar. */
calendarRouter.post('/disconnect', requireStaff, async (req, res) => {
  await disconnect('user', req.staff!.sub);
  res.json({ ok: true });
});
