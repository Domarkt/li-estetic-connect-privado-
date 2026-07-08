const STAFF_KEY = 'li_staff_token';
const PATIENT_KEY = 'li_patient_token';

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

  const res = await fetch(`/api${path}`, {
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
