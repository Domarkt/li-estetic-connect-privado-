import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../../db/prisma.js';
import { requireStaff, requireRole } from '../../middleware/auth.js';
import { googleConfigured, buildAuthUrl, demoConnect, getConnection, disconnect as calDisconnect } from '../calendar/calendar.service.js';
import { sendWhatsAppText, sendWhatsAppTemplate } from '../messaging/whatsapp.service.js';

export const configRouter = Router();

// Toda la configuración del sistema es exclusiva de la Administradora.
configRouter.use(requireStaff, requireRole('ADMIN'));

// ── Metas por sucursal ──
configRouter.get('/branch-goals', async (_req, res) => {
  const branches = await prisma.branch.findMany({ orderBy: { code: 'asc' } });
  res.json(branches.map((b) => ({
    id: b.id, code: b.code, name: b.name, place: b.place, dotColor: b.dotColor,
    address: b.address, phone: b.phone,
    monthlyGoal: b.monthlyGoal, dailyGoal: b.dailyGoal, perAsesorGoal: b.perAsesorGoal,
  })));
});

const branchSchema = z.object({
  name: z.string().min(1),
  place: z.string().min(1),
  address: z.string().min(1),
  phone: z.string().min(1),
});

/** Editar datos del negocio por sucursal (nombre, dirección, teléfono → recibo). */
configRouter.patch('/branches/:id', async (req, res) => {
  const data = branchSchema.parse(req.body);
  const b = await prisma.branch.update({ where: { id: req.params.id }, data });
  res.json({ ok: true, id: b.id, message: `Datos de ${b.name} actualizados` });
});

const goalSchema = z.object({
  monthlyGoal: z.number().int().nonnegative(),
  dailyGoal: z.number().int().nonnegative(),
  perAsesorGoal: z.number().int().nonnegative(),
});
configRouter.patch('/branch-goals/:id', async (req, res) => {
  const data = goalSchema.parse(req.body);
  const b = await prisma.branch.update({ where: { id: req.params.id }, data });
  res.json({ ok: true, id: b.id, message: 'Metas actualizadas' });
});

// ── Reglas de puntos (ganar / deducir) ──
configRouter.get('/points-rules', async (_req, res) => {
  const rules = await prisma.pointsRule.findMany({ orderBy: [{ isEarn: 'desc' }, { sortOrder: 'asc' }] });
  res.json(rules);
});

const ruleSchema = z.object({
  label: z.string().min(1),
  points: z.number().int(),
  isEarn: z.boolean(),
});
configRouter.post('/points-rules', async (req, res) => {
  const data = ruleSchema.parse(req.body);
  // Normaliza el signo según sea ganar o deducir.
  const points = data.isEarn ? Math.abs(data.points) : -Math.abs(data.points);
  const rule = await prisma.pointsRule.create({ data: { ...data, points } });
  res.status(201).json(rule);
});
configRouter.patch('/points-rules/:id', async (req, res) => {
  const data = ruleSchema.partial().parse(req.body);
  const rule = await prisma.pointsRule.update({ where: { id: req.params.id }, data });
  res.json(rule);
});
configRouter.delete('/points-rules/:id', async (req, res) => {
  await prisma.pointsRule.delete({ where: { id: req.params.id } });
  res.json({ ok: true });
});

// ── Premios canjeables ──
configRouter.get('/rewards', async (_req, res) => {
  const rewards = await prisma.reward.findMany({ orderBy: { cost: 'asc' } });
  res.json(rewards);
});

const rewardSchema = z.object({ label: z.string().min(1), cost: z.number().int().positive(), icon: z.string().optional() });
configRouter.post('/rewards', async (req, res) => {
  const data = rewardSchema.parse(req.body);
  const r = await prisma.reward.create({ data });
  res.status(201).json(r);
});
configRouter.patch('/rewards/:id', async (req, res) => {
  const data = rewardSchema.partial().parse(req.body);
  const r = await prisma.reward.update({ where: { id: req.params.id }, data });
  res.json(r);
});
configRouter.delete('/rewards/:id', async (req, res) => {
  await prisma.reward.delete({ where: { id: req.params.id } });
  res.json({ ok: true });
});

// ── Integraciones de mensajería + Calendar por sucursal ──

const CHANNELS = [
  {
    key: 'whatsapp', label: 'WhatsApp Business', color: '#25D366',
    env: 'WHATSAPP_TOKEN',
    steps: [
      'Crea una app en Meta for Developers y agrega el producto "WhatsApp".',
      'Verifica tu número de negocio y obtén el Phone Number ID + token permanente.',
      'Copia el token en WHATSAPP_TOKEN del archivo .env del servidor.',
      'Configura el webhook: URL /api/messaging/webhook/whatsapp y token de verificación.',
      'Prueba enviando un mensaje al número — aparecerá en la bandeja de la sucursal.',
    ],
  },
  {
    key: 'meta', label: 'Instagram + Messenger (Meta)', color: '#E1306C',
    env: 'META_APP_SECRET',
    steps: [
      'En Meta for Developers agrega los productos "Instagram" y "Messenger".',
      'Vincula la página de Facebook y la cuenta de Instagram del negocio.',
      'Genera el token de página y colócalo junto a META_APP_SECRET en .env.',
      'Suscribe el webhook /api/messaging/webhook/instagram y /messenger.',
      'Los DM de Instagram y Messenger llegarán a la bandeja unificada.',
    ],
  },
  {
    key: 'tiktok', label: 'TikTok Messaging', color: '#1C2540',
    env: 'TIKTOK_APP_SECRET',
    steps: [
      'Solicita acceso a la API de mensajería en TikTok for Developers.',
      'Crea la app y obtén el App Secret y el token de acceso.',
      'Coloca las credenciales en TIKTOK_APP_SECRET del .env.',
      'Registra el webhook /api/messaging/webhook/tiktok.',
      'Los mensajes de TikTok entrarán filtrados por sucursal.',
    ],
  },
];

/** Estado de todas las integraciones + guías. */
configRouter.get('/integrations', async (_req, res) => {
  const [connections, branches] = await Promise.all([
    prisma.integration.findMany(),
    prisma.branch.findMany({ orderBy: { code: 'asc' } }),
  ]);
  const channels = CHANNELS.map((c) => {
    const conn = connections.find((x) => x.kind === c.key && x.scopeId === 'global');
    return {
      key: c.key, label: c.label, color: c.color, steps: c.steps,
      credentialsConfigured: Boolean(process.env[c.env]),
      connected: conn?.status === 'CONNECTED',
      mode: conn?.mode ?? null,
    };
  });

  const calendars = await Promise.all(
    branches.map(async (b) => {
      const conn = await getConnection('branch', b.id);
      return { branchId: b.id, name: b.name, place: b.place, dotColor: b.dotColor, connected: !!conn, mode: conn?.accessToken === 'demo' ? 'demo' : conn ? 'google' : null };
    }),
  );

  res.json({ channels, calendars, googleConfigured: googleConfigured(), calendarGuide: [
    'Crea un proyecto en Google Cloud y habilita la API de Google Calendar.',
    'Configura la pantalla de consentimiento OAuth y crea credenciales OAuth 2.0.',
    'Agrega GOOGLE_CLIENT_ID y GOOGLE_CLIENT_SECRET al .env del servidor.',
    'Cada sucursal conecta el correo/calendario de su agenda con "Conectar".',
    'Las citas se sincronizan automáticamente con ese calendario.',
  ] });
});

/** Conectar/desconectar un canal de mensajería. WhatsApp acepta credenciales de prueba. */
configRouter.post('/integrations/:kind/connect', async (req, res) => {
  const kind = req.params.kind;
  if (!CHANNELS.some((c) => c.key === kind)) return res.status(404).json({ error: 'Canal desconocido' });
  const envKey = CHANNELS.find((c) => c.key === kind)!.env;

  // WhatsApp: si envían phoneId + token (número de prueba), se guardan para el envío real.
  let meta: { phoneId?: string; token?: string } | undefined;
  if (kind === 'whatsapp' && req.body?.phoneId && req.body?.token) {
    meta = { phoneId: String(req.body.phoneId), token: String(req.body.token) };
  }
  const mode = process.env[envKey] || meta ? 'live' : 'demo';
  await prisma.integration.upsert({
    where: { kind_scopeId: { kind, scopeId: 'global' } },
    create: { kind, scopeId: 'global', status: 'CONNECTED', mode, meta: meta ?? undefined },
    update: { status: 'CONNECTED', mode, ...(meta ? { meta } : {}) },
  });
  res.json({ ok: true, mode, message: mode === 'live' ? 'Canal conectado (modo real)' : 'Canal conectado en modo demo (agrega las credenciales para producción)' });
});

const testSchema = z.object({ to: z.string().min(1), useTemplate: z.boolean().optional() });

/** Enviar mensaje de prueba por WhatsApp para validar la conexión. */
configRouter.post('/whatsapp/test', async (req, res) => {
  const { to, useTemplate } = testSchema.parse(req.body);
  const r = useTemplate ? await sendWhatsAppTemplate(to) : await sendWhatsAppText(to, 'Prueba de Li Estetic Connect ✅ Tu WhatsApp está conectado correctamente.');
  if (r.mode === 'demo') return res.json({ ok: false, message: 'Sin credenciales de WhatsApp: guarda el Phone Number ID y el token primero.' });
  if (!r.sent) return res.status(400).json({ error: `No se pudo enviar: ${r.error}` });
  res.json({ ok: true, id: r.id, message: 'Mensaje de prueba enviado por WhatsApp ✅' });
});
configRouter.post('/integrations/:kind/disconnect', async (req, res) => {
  await prisma.integration.deleteMany({ where: { kind: req.params.kind, scopeId: 'global' } });
  res.json({ ok: true });
});

/** Conectar el calendario/correo de una sucursal. */
configRouter.post('/calendar/:branchId/connect', async (req, res) => {
  const branchId = req.params.branchId;
  const branch = await prisma.branch.findUnique({ where: { id: branchId } });
  if (!branch) return res.status(404).json({ error: 'Sucursal no encontrada' });
  if (googleConfigured()) return res.json({ redirect: buildAuthUrl(`branch:${branchId}`) });
  await demoConnect('branch', branchId);
  res.json({ ok: true, mode: 'demo', message: `Calendario de ${branch.name} conectado (demo)` });
});
configRouter.post('/calendar/:branchId/disconnect', async (req, res) => {
  await calDisconnect('branch', req.params.branchId);
  res.json({ ok: true });
});
