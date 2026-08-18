import { useCallback, useEffect, useState } from 'react';
import { api } from '../../lib/api';
import { useAutoRefresh } from '../../lib/useAutoRefresh';
import { useAuth } from '../../auth/AuthContext';
import { useToast } from '../../components/Toast';
import { Cargando, ErrorCarga } from '../../components/EstadoCarga';

interface SegPatient {
  id: string; name: string; trato: string; phone: string; email: string | null; sex: string | null;
  branch: string; ultimaVisita: string | null; dias: number | null; wa: string | null; dia?: number;
  monto?: number;
}
interface SegData {
  porValidar: SegPatient[];
  inactivos: { m3: SegPatient[]; m6: SegPatient[]; m12: SegPatient[] };
  cumpleanos: SegPatient[];
  porCobrar: SegPatient[];
}

const fmtRD = (n: number) => 'RD$' + (n || 0).toLocaleString('en-US');

function telHref(phone: string) {
  const d = (phone || '').replace(/\D/g, '');
  return `tel:${d}`;
}

function Fila({ p, extra }: { p: SegPatient; extra?: string }) {
  const initials = p.name.split(' ').map((w) => w[0]).slice(0, 2).join('').toUpperCase();
  return (
    <div className="flex items-center gap-3 border-b border-line-2 px-4 py-2.5 last:border-0">
      <div className="flex h-9 w-9 flex-none items-center justify-center rounded-full bg-magenta-soft text-[12px] font-bold text-magenta">{initials}</div>
      <div className="min-w-0 flex-1">
        <div className="text-[13px] font-bold">{p.name} <span className="text-[11px] font-semibold text-faint">· {p.trato}</span></div>
        <div className="truncate text-[11.5px] text-muted">
          {extra ?? (p.ultimaVisita ? `Última visita: ${p.ultimaVisita}${p.dias != null ? ` · hace ${p.dias} días` : ''}` : 'Sin visitas registradas')} · {p.branch}
        </div>
      </div>
      <a href={telHref(p.phone)} className="flex-none rounded-[9px] border border-line bg-card px-2.5 py-1.5 text-[12px] font-bold text-navy no-underline hover:border-magenta">📞 Llamar</a>
      {p.wa && (
        <a href={p.wa} target="_blank" rel="noreferrer" className="flex-none rounded-[9px] px-2.5 py-1.5 text-[12px] font-bold text-white no-underline" style={{ background: '#25D366' }}>💬 WhatsApp</a>
      )}
    </div>
  );
}

function Seccion({ titulo, hint, color, rows, extra, grupo, onEnviar, enviando }: { titulo: string; hint: string; color: string; rows: SegPatient[]; extra?: (p: SegPatient) => string; grupo?: string; onEnviar?: (g: string) => void; enviando?: string }) {
  const conCorreo = rows.filter((r) => r.email).length;
  return (
    <div className="overflow-hidden rounded-base border border-line bg-card shadow-card">
      <div className="border-b border-line px-4 py-3">
        <div className="flex flex-wrap items-center gap-2">
          <span className="h-2.5 w-2.5 rounded-full" style={{ background: color }} />
          <span className="text-[13.5px] font-extrabold">{titulo}</span>
          <span className="rounded-full bg-bg px-2 py-0.5 text-[11px] font-bold text-muted">{rows.length}</span>
          {/* Envío masivo por correo (solo admin, solo grupos de campaña). */}
          {grupo && onEnviar && conCorreo > 0 && (
            <button onClick={() => onEnviar(grupo)} disabled={enviando === grupo}
              className="ml-auto rounded-[9px] bg-magenta px-3 py-1.5 text-[12px] font-bold text-white disabled:opacity-60">
              {enviando === grupo ? 'Enviando…' : `📧 Enviar correo a todos (${conCorreo})`}
            </button>
          )}
        </div>
        <div className="mt-0.5 text-[11.5px] text-muted">{hint}</div>
      </div>
      {rows.length === 0
        ? <div className="px-4 py-6 text-center text-[12.5px] text-muted">Nadie por ahora.</div>
        : rows.map((p) => <Fila key={p.id + titulo} p={p} extra={extra ? extra(p) : undefined} />)}
    </div>
  );
}

export default function SeguimientoPage() {
  const { staff } = useAuth();
  const toast = useToast();
  const [data, setData] = useState<SegData | null>(null);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [enviando, setEnviando] = useState('');
  const esAdmin = staff?.role === 'ADMIN';

  const load = useCallback(() => {
    setCargando(true); setError(null);
    api.get<SegData>('/followup')
      .then((r) => { setData(r); setCargando(false); })
      .catch((e) => { setError(e instanceof Error ? e.message : 'Error'); setCargando(false); });
  }, []);
  useEffect(() => { load(); }, [load]);
  useAutoRefresh(load);

  async function campana(grupo: string) {
    const nombres: Record<string, string> = { cumpleanos: 'cumpleaños del mes', m3: 'inactivos 3+ meses', m6: 'inactivos 6+ meses', m12: 'inactivos +1 año' };
    if (!window.confirm(`¿Enviar el correo de campaña a TODOS los pacientes de "${nombres[grupo] ?? grupo}" que tengan correo? Esta acción envía correos reales.`)) return;
    setEnviando(grupo);
    try { const r = await api.post<{ message: string }>('/followup/campana', { grupo }); toast(r.message); }
    catch (e) { toast(e instanceof Error ? e.message : 'Error'); } finally { setEnviando(''); }
  }
  const campanaProps = (grupo: string) => (esAdmin ? { grupo, onEnviar: campana, enviando } : {});

  if (cargando) return <Cargando texto="Cargando seguimiento…" />;
  if (error || !data) return <ErrorCarga mensaje={error ?? 'Error'} onRetry={load} />;

  return (
    <div className="animate-fade flex flex-col gap-4">
      <div className="rounded-base border border-line bg-card p-4 text-[12.5px] text-muted shadow-card">
        Contacta a tus pacientes con un mensaje ya escrito (formal, con Sr./Sra.). <b className="text-navy">Llamar</b> abre el teléfono; <b className="text-navy">WhatsApp</b> abre el chat con el mensaje listo — solo toca enviar.
      </div>

      {/* Cuentas por cobrar: lo primero para recepción. Invita a agendar y saldar. */}
      <Seccion titulo="Cuentas por cobrar 💰" color="var(--danger)"
        hint="Pacientes con saldo pendiente · invítalos a agendar su próxima sesión y saldan al presentarse."
        rows={data.porCobrar}
        extra={(p) => `Saldo pendiente: ${fmtRD(p.monto ?? 0)} · agéndale su próxima cita`} />

      <Seccion titulo="Por validar el tratamiento" color="var(--ok)"
        hint="Atendidos en los últimos 7 días · llámalos para saber cómo se sintieron."
        rows={data.porValidar} />

      <Seccion titulo="Cumpleaños del mes 🎉" color="var(--magenta)"
        hint="Felicítalos y ofréceles un detalle en su próxima visita."
        rows={data.cumpleanos} extra={(p) => `Cumple el día ${p.dia}`} {...campanaProps('cumpleanos')} />

      <Seccion titulo="Inactivos · 3+ meses" color="var(--warn)"
        hint="Sin volver hace 3 a 6 meses · reactívalos con una invitación."
        rows={data.inactivos.m3} {...campanaProps('m3')} />

      <Seccion titulo="Inactivos · 6+ meses" color="#E8820E"
        hint="Sin volver hace 6 a 12 meses."
        rows={data.inactivos.m6} {...campanaProps('m6')} />

      <Seccion titulo="Inactivos · más de 1 año" color="var(--danger)"
        hint="Sin volver hace más de un año · ofertas de reactivación."
        rows={data.inactivos.m12} {...campanaProps('m12')} />
    </div>
  );
}
