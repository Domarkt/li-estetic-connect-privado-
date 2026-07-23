const STAFF_KEY = 'li_staff_token';
const PATIENT_KEY = 'li_patient_token';

// Base del API. Vacío = mismas rutas relativas (Netlify con proxy). En hosts sin
// proxy (Cloudflare Pages) se define VITE_API_URL con la URL del backend en Render.
const API_BASE = (import.meta.env.VITE_API_URL ?? '').replace(/\/$/, '');

export const tokenStore = {
  getStaff: () => localStorage.getItem(STAFF_KEY),
  setStaff: (t: string) => localStorage.setItem(STAFF_KEY, t),
  clearStaff: () => localStorage.removeItem(STAFF_KEY),
  getPatient: () => localStorage.getItem(PATIENT_KEY),
  setPatient: (t: string) => localStorage.setItem(PATIENT_KEY, t),
  clearPatient: () => localStorage.removeItem(PATIENT_KEY),
};

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

type Kind = 'staff' | 'patient' | 'none';

/**
 * Cierra la sesión vencida y manda al login correspondiente con un aviso.
 * Se protege con una bandera porque una pantalla suele lanzar varias llamadas a
 * la vez: sin esto, un token vencido dispararía N redirecciones.
 */
let redirigiendo = false;
function handleSessionExpired(kind: Exclude<Kind, 'none'>) {
  if (redirigiendo) return;
  redirigiendo = true;
  const destino = kind === 'patient' ? '/portal/login' : '/login';
  tokenStore.clearStaff();
  tokenStore.clearPatient();
  // assign (no replace) para que el navegador recargue limpio el estado de la app.
  window.location.assign(`${destino}?expirada=1`);
}

async function request<T>(
  method: string,
  path: string,
  body?: unknown,
  kind: Kind = 'staff',
): Promise<T> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (kind === 'staff') {
    const t = tokenStore.getStaff();
    if (t) headers.Authorization = `Bearer ${t}`;
  } else if (kind === 'patient') {
    const t = tokenStore.getPatient();
    if (t) headers.Authorization = `Bearer ${t}`;
  }

  const res = await fetch(`${API_BASE}/api${path}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  if (!res.ok) {
    let msg = `Error ${res.status}`;
    try {
      const data = await res.json();
      msg = data.error ?? msg;
    } catch {
      /* ignore */
    }
    // Sesión vencida o token inválido: en vez de dejar toasts crípticos por toda
    // la pantalla, se cierra la sesión y se lleva al login con un mensaje claro.
    // Se excluyen las llamadas 'none' (los propios login), donde un 401 significa
    // "credenciales incorrectas" y debe mostrarse en el formulario.
    if (res.status === 401 && kind !== 'none') handleSessionExpired(kind);
    throw new ApiError(res.status, msg);
  }
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

export const api = {
  get: <T>(p: string, kind?: Kind) => request<T>('GET', p, undefined, kind),
  post: <T>(p: string, body?: unknown, kind?: Kind) => request<T>('POST', p, body, kind),
  patch: <T>(p: string, body?: unknown, kind?: Kind) => request<T>('PATCH', p, body, kind),
  del: <T>(p: string, kind?: Kind) => request<T>('DELETE', p, undefined, kind),
};
