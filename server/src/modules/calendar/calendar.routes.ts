import { Router } from 'express';
import { requireStaff } from '../../middleware/auth.js';
import { env } from '../../config/env.js';
import {
  googleConfigured, buildAuthUrl, exchangeCode, demoConnect, getConnection, disconnect,
} from './calendar.service.js';

export const calendarRouter = Router();

/** Estado de la conexión del usuario actual. */
calendarRouter.get('/status', requireStaff, async (req, res) => {
  const conn = await getConnection('user', req.staff!.sub);
  res.json({
    connected: !!conn,
    mode: conn?.accessToken === 'demo' ? 'demo' : conn ? 'google' : null,
    googleConfigured: googleConfigured(),
  });
});

/**
 * Conectar. Si hay credenciales de Google, devuelve la URL de OAuth para redirigir;
 * si no, hace una conexión "demo" (para poder usar la app sin credenciales).
 */
calendarRouter.post('/connect', requireStaff, async (req, res) => {
  if (googleConfigured()) {
    const url = buildAuthUrl(`user:${req.staff!.sub}`);
    return res.json({ redirect: url });
  }
  await demoConnect('user', req.staff!.sub);
  res.json({ connected: true, mode: 'demo', message: 'Google Calendar conectado correctamente' });
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
