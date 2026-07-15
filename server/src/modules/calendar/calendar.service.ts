import { prisma } from '../../db/prisma.js';
import { encrypt, decrypt } from '../../utils/crypto.js';

// Los tokens OAuth se guardan cifrados; el literal 'demo' (conexión sin OAuth real) se deja en claro.
const encTok = (t: string | null | undefined) => (t == null || t === 'demo' ? t ?? null : encrypt(t));
const decTok = (t: string | null | undefined) => (t == null ? null : decrypt(t));

const CLIENT_ID = process.env.GOOGLE_CLIENT_ID ?? '';
const CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET ?? '';
const REDIRECT_URI = process.env.GOOGLE_REDIRECT_URI ?? 'http://localhost:4000/api/calendar/oauth/callback';
const SCOPE = 'https://www.googleapis.com/auth/calendar';

/** true cuando hay credenciales OAuth reales configuradas. */
export const googleConfigured = () => Boolean(CLIENT_ID && CLIENT_SECRET);

/** URL de consentimiento OAuth de Google. `state` lleva ownerType:ownerId. */
export function buildAuthUrl(state: string): string {
  const p = new URLSearchParams({
    client_id: CLIENT_ID,
    redirect_uri: REDIRECT_URI,
    response_type: 'code',
    scope: SCOPE,
    access_type: 'offline',
    prompt: 'consent',
    state,
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${p.toString()}`;
}

/** Intercambia el `code` por tokens y guarda la conexión. */
export async function exchangeCode(code: string, ownerType: string, ownerId: string) {
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code, client_id: CLIENT_ID, client_secret: CLIENT_SECRET,
      redirect_uri: REDIRECT_URI, grant_type: 'authorization_code',
    }),
  });
  if (!res.ok) throw new Error('Google token exchange failed: ' + (await res.text()));
  const t = (await res.json()) as { access_token: string; refresh_token?: string; expires_in: number };
  await saveConnection(ownerType, ownerId, t.access_token, t.refresh_token, t.expires_in);
}

async function saveConnection(ownerType: string, ownerId: string, accessToken: string, refreshToken: string | undefined, expiresIn: number) {
  const expiresAt = new Date(Date.now() + expiresIn * 1000);
  const encAccess = encTok(accessToken)!;
  const encRefresh = encTok(refreshToken);
  await prisma.calendarConnection.upsert({
    where: { ownerType_ownerId: { ownerType, ownerId } },
    create: { ownerType, ownerId, accessToken: encAccess, refreshToken: encRefresh, expiresAt },
    update: { accessToken: encAccess, refreshToken: encRefresh ?? undefined, expiresAt },
  });
}

/** Conexión "demo" (sin OAuth real) para poder usar la app sin credenciales de Google. */
export async function demoConnect(ownerType: string, ownerId: string) {
  await prisma.calendarConnection.upsert({
    where: { ownerType_ownerId: { ownerType, ownerId } },
    create: { ownerType, ownerId, accessToken: 'demo', refreshToken: 'demo' },
    update: { accessToken: 'demo' },
  });
}

export async function getConnection(ownerType: string, ownerId: string) {
  const conn = await prisma.calendarConnection.findUnique({ where: { ownerType_ownerId: { ownerType, ownerId } } });
  if (!conn) return conn;
  // Devuelve los tokens ya descifrados para el resto de la app.
  return { ...conn, accessToken: decTok(conn.accessToken)!, refreshToken: decTok(conn.refreshToken) };
}

export async function disconnect(ownerType: string, ownerId: string) {
  await prisma.calendarConnection.deleteMany({ where: { ownerType, ownerId } });
}

/** Access token vigente, refrescándolo si expiró (solo conexiones reales). */
async function freshAccessToken(conn: { id: string; accessToken: string; refreshToken: string | null; expiresAt: Date | null }): Promise<string | null> {
  if (conn.accessToken === 'demo') return null; // conexión demo: sin push real
  if (conn.expiresAt && conn.expiresAt.getTime() > Date.now() + 60_000) return conn.accessToken;
  if (!conn.refreshToken) return conn.accessToken;
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: CLIENT_ID, client_secret: CLIENT_SECRET,
      refresh_token: conn.refreshToken, grant_type: 'refresh_token',
    }),
  });
  if (!res.ok) return conn.accessToken;
  const t = (await res.json()) as { access_token: string; expires_in: number };
  await prisma.calendarConnection.update({
    where: { id: conn.id },
    data: { accessToken: encTok(t.access_token)!, expiresAt: new Date(Date.now() + t.expires_in * 1000) },
  });
  return t.access_token;
}

interface EventInput { summary: string; description?: string; start: Date; durationMin: number }

/**
 * Sincroniza (push) una cita a Google Calendar. Devuelve el googleEventId o null.
 * En conexión demo o sin conexión, retorna null sin fallar (la app sigue).
 */
export async function pushEvent(ownerType: string, ownerId: string, ev: EventInput, existingEventId?: string | null): Promise<string | null> {
  const conn = await getConnection(ownerType, ownerId);
  if (!conn) return null;
  const token = await freshAccessToken(conn);
  if (!token) return null; // demo

  const calendarId = conn.calendarId || 'primary';
  const end = new Date(ev.start.getTime() + ev.durationMin * 60_000);
  const body = {
    summary: ev.summary,
    description: ev.description,
    start: { dateTime: ev.start.toISOString() },
    end: { dateTime: end.toISOString() },
  };
  const url = existingEventId
    ? `https://www.googleapis.com/calendar/v3/calendars/${calendarId}/events/${existingEventId}`
    : `https://www.googleapis.com/calendar/v3/calendars/${calendarId}/events`;
  const res = await fetch(url, {
    method: existingEventId ? 'PATCH' : 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) return existingEventId ?? null;
  const created = (await res.json()) as { id: string };
  return created.id;
}
