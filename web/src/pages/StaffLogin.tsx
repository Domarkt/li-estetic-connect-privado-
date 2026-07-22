import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { api } from '../lib/api';
import { Icon } from '../components/icons';
import type { Role, Branch } from '../lib/types';

// Sin correos de ejemplo: cada quien escribe sus credenciales (nunca precargadas).
const ROLE_TILES: { key: Role; label: string; desc: string; icon: string }[] = [
  { key: 'ADMIN', label: 'Administradora', desc: 'Vista general', icon: 'grid' },
  { key: 'RECEPCIONISTA', label: 'Recepcionista', desc: 'Agenda · cobro', icon: 'cal' },
  { key: 'ESTETICISTA', label: 'Esteticista', desc: 'Fichas · atención', icon: 'star' },
];

const BRANCH_DOTS: Record<string, string> = { e1: '#B31C86', e2: '#2C7FB8', e3: '#1F9D6B' };

export default function StaffLogin() {
  const { loginStaff } = useAuth();
  const navigate = useNavigate();

  const [role, setRole] = useState<Role>('ADMIN');
  const [branchId, setBranchId] = useState<string>('');
  const [branches, setBranches] = useState<Branch[]>([]);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPass, setShowPass] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  // Sucursales para el selector (endpoint público de conveniencia en login).
  useEffect(() => {
    api
      .get<Branch[]>('/branches/public', 'none')
      .then((bs) => {
        setBranches(bs);
        if (bs[0]) setBranchId(bs[0].id);
      })
      .catch(() => {
        // fallback: sucursales conocidas del prototipo
        const fallback: Branch[] = [
          { id: 'e1', code: 'e1', name: 'Estética 1', place: 'Plaza San Vicente, 1er nivel', dotColor: '#B31C86' },
          { id: 'e2', code: 'e2', name: 'Estética 2', place: 'Plaza Baró, 2do nivel', dotColor: '#2C7FB8' },
          { id: 'e3', code: 'e3', name: 'Estética 3', place: 'Rómulo Betancour, Plaza Oliver Marín, 2do nivel', dotColor: '#1F9D6B' },
        ];
        setBranches(fallback);
        setBranchId('e1');
      });
  }, []);

  const isAdmin = role === 'ADMIN';
  const branchHint = isAdmin
    ? 'La Administradora accede al panel general de las 3 sucursales.'
    : 'Solo verás y operarás datos de la sucursal seleccionada.';

  async function submit() {
    setError('');
    setBusy(true);
    try {
      await loginStaff(email.trim(), password, role, isAdmin ? undefined : branchId);
      navigate('/app');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo iniciar sesión');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-screen bg-bg">
      {/* Panel de marca */}
      <div className="relative hidden flex-1 flex-col justify-between overflow-hidden p-12 text-white lg:flex"
        style={{ background: 'linear-gradient(160deg,#1C2540,#28324F 60%,#3a2440)' }}>
        <div className="absolute -right-20 -top-20 h-80 w-80 rounded-full" style={{ background: 'rgba(179,28,134,.18)', filter: 'blur(10px)' }} />
        <div className="absolute -left-16 bottom-10 h-52 w-52 rounded-full" style={{ background: 'rgba(255,255,255,.04)' }} />
        <div className="relative flex items-center gap-3">
          <div className="flex items-center rounded-xl bg-white px-3.5 py-2.5">
            <img src="/li-logo.png" alt="Li Estetic Center" className="block h-9" />
          </div>
        </div>
        <div className="relative">
          <div className="mb-3.5 font-display italic text-xl" style={{ color: '#F3C3E0' }}>Transformando Tu Cuerpo</div>
          <h1 className="m-0 mb-4 text-[44px] font-extrabold leading-[1.08] tracking-tight">Li Estetic<br />Connect</h1>
          <p className="m-0 max-w-[400px] text-base leading-relaxed" style={{ color: '#C6CBDE' }}>
            Plataforma de gestión de pacientes, agenda, facturación y desempeño para las 3 sucursales de Li Estetic Center.
          </p>
        </div>
        <div className="relative flex gap-7 text-[13px] font-semibold" style={{ color: '#AEB4CC' }}>
          <div><div className="text-[26px] font-extrabold text-white">3</div>Sucursales</div>
          <div><div className="text-[26px] font-extrabold text-white">9</div>Colaboradoras</div>
          <div><div className="text-[26px] font-extrabold text-white">CRM</div>+ Puntos LI</div>
        </div>
      </div>

      {/* Panel de formulario */}
      <div className="flex w-full flex-col justify-center bg-card p-8 sm:p-14 lg:w-[520px] lg:flex-none">
        <div className="animate-fade">
          <div className="text-[13px] font-bold uppercase tracking-[.14em] text-magenta">Bienvenida</div>
          <h2 className="mb-1 mt-1.5 text-[28px] font-extrabold tracking-tight">Iniciar sesión</h2>
          <p className="mb-7 mt-0 text-sm text-muted">Selecciona tu rol y sucursal para continuar.</p>

          <div className="mb-2.5 text-[13px] font-bold text-ink">Tu rol</div>
          <div className="mb-6 grid grid-cols-1 gap-2.5">
            {ROLE_TILES.map((t) => {
              const on = role === t.key;
              return (
                <button key={t.key} onClick={() => setRole(t.key)}
                  className="flex items-center gap-3 rounded-xl border-[1.5px] p-3 text-left transition-all"
                  style={{ background: on ? 'var(--magenta-soft)' : 'var(--card)', borderColor: on ? 'var(--magenta)' : 'var(--line)' }}>
                  <div className="flex h-[34px] w-[34px] flex-none items-center justify-center rounded-[9px]"
                    style={{ background: on ? 'var(--magenta)' : 'var(--navy-soft)', color: on ? '#fff' : 'var(--navy)' }}>
                    <Icon name={t.icon} />
                  </div>
                  <div>
                    <div className="text-sm font-bold">{t.label}</div>
                    <div className="text-[11.5px] font-medium text-muted">{t.desc}</div>
                  </div>
                </button>
              );
            })}
          </div>

          {/* Credenciales */}
          <div className="mb-4 grid grid-cols-1 gap-3">
            <label className="flex flex-col gap-1.5">
              <span className="text-xs font-bold text-muted">Correo</span>
              <input value={email} onChange={(e) => setEmail(e.target.value)}
                className="rounded-[11px] border border-line px-3.5 py-3 text-sm outline-none focus:border-magenta"
                placeholder="tu@liestetic.do" />
            </label>
            <label className="flex flex-col gap-1.5">
              <span className="text-xs font-bold text-muted">Contraseña</span>
              <div className="flex items-center rounded-[11px] border border-line pr-2 focus-within:border-magenta">
                <input type={showPass ? 'text' : 'password'} value={password} onChange={(e) => setPassword(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && submit()}
                  className="w-full bg-transparent px-3.5 py-3 text-sm outline-none"
                  placeholder="••••••••" />
                <button type="button" onClick={() => setShowPass((v) => !v)}
                  aria-label={showPass ? 'Ocultar contraseña' : 'Mostrar contraseña'}
                  className="flex-none rounded-lg px-2 py-1 text-[12px] font-bold text-muted hover:text-magenta">
                  {showPass ? '🙈 Ocultar' : '👁 Mostrar'}
                </button>
              </div>
            </label>
          </div>

          {!isAdmin && (
            <>
              <div className="mb-2.5 text-[13px] font-bold text-ink">Sucursal</div>
              <div className="mb-3 flex flex-col gap-2">
                {branches.map((b) => {
                  const on = branchId === b.id;
                  return (
                    <button key={b.id} onClick={() => setBranchId(b.id)}
                      className="flex items-center gap-2.5 rounded-xl border-[1.5px] p-3 text-left transition-all"
                      style={{ borderColor: on ? 'var(--magenta)' : 'var(--line)', background: on ? 'var(--magenta-soft)' : 'var(--card)' }}>
                      <span className="h-2.5 w-2.5 flex-none rounded-full" style={{ background: b.dotColor || BRANCH_DOTS[b.code] }} />
                      <div className="flex-1">
                        <div className="text-[13.5px] font-bold">{b.name}</div>
                        <div className="text-xs text-muted">{b.place}</div>
                      </div>
                      {on && <span className="font-extrabold text-magenta">✓</span>}
                    </button>
                  );
                })}
              </div>
            </>
          )}
          <div className="mb-5 text-xs text-faint">{branchHint}</div>

          {error && (
            <div className="mb-3 rounded-[11px] border px-3.5 py-3 text-[13px] font-semibold"
              style={{ background: 'var(--danger-soft)', borderColor: '#F0C9C4', color: 'var(--danger)' }}>
              {error}
            </div>
          )}

          <button onClick={submit} disabled={busy}
            className="w-full rounded-xl border-none bg-magenta py-[15px] text-[15px] font-bold text-white transition disabled:opacity-60"
            style={{ boxShadow: '0 6px 18px rgba(179,28,134,.28)' }}>
            {busy ? 'Ingresando…' : 'Ingresar al sistema →'}
          </button>

          <div className="my-4 flex items-center gap-3">
            <div className="h-px flex-1 bg-line" />
            <span className="text-[11.5px] font-semibold text-faint">¿ERES PACIENTE?</span>
            <div className="h-px flex-1 bg-line" />
          </div>
          <button onClick={() => navigate('/portal/login')}
            className="w-full rounded-xl border-[1.5px] border-line bg-card py-[13px] text-sm font-bold text-navy transition hover:border-magenta hover:text-magenta">
            Acceder a mi portal de paciente →
          </button>
          <div className="mt-[18px] text-center text-[12.5px] text-faint">
            Uso interno confidencial · Li Estetic Center © 2026
          </div>
        </div>
      </div>
    </div>
  );
}
