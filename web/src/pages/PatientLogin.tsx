import { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';

/**
 * Acceso al portal: correo + contraseña.
 *
 * La contraseña inicial es el teléfono que la paciente registró en la estética, y
 * desde su perfil puede cambiarla por una propia. Se probó con un código de un
 * solo uso, pero le complicaba demasiado la entrada.
 */
export default function PatientLogin() {
  const { loginPatient } = useAuth();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [verClave, setVerClave] = useState(false);
  const [error, setError] = useState(params.get('expirada') ? 'Tu sesión venció. Entra de nuevo.' : '');
  const [busy, setBusy] = useState(false);

  async function entrar() {
    setError('');
    if (!email.trim() || !password.trim()) { setError('Escribe tu correo y tu contraseña'); return; }
    setBusy(true);
    try {
      await loginPatient(email.trim(), password);
      navigate('/portal');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo iniciar sesión');
    } finally { setBusy(false); }
  }

  const inputCls = 'rounded-[11px] border border-line p-3.5 text-sm outline-none focus:border-magenta';

  return (
    <div className="flex min-h-screen items-center justify-center p-4 sm:p-6"
      style={{ background: 'linear-gradient(160deg,#FBEEF6,#EEF1F8)' }}>
      <div className="w-full max-w-[400px] overflow-hidden rounded-[22px] bg-card animate-pop"
        style={{ boxShadow: '0 24px 70px rgba(28,37,64,.18)' }}>
        <div className="px-[30px] pb-7 pt-[34px] text-center text-white"
          style={{ background: 'linear-gradient(135deg,#B31C86,#8E1268)' }}>
          <div className="mb-4 inline-flex rounded-[14px] bg-white px-4 py-2.5">
            <img src="/li-logo.png" alt="Li Estetic Center" className="h-[34px]" />
          </div>
          <div className="font-display italic text-[15px]" style={{ color: '#F3C3E0' }}>Transformando Tu Cuerpo</div>
          <h2 className="mb-0 mt-1.5 text-[22px] font-extrabold">Portal del Paciente</h2>
        </div>

        <div className="p-6 sm:p-[30px]">
          <p className="mb-[22px] mt-0 text-center text-[13.5px] text-muted">
            Entra con el <b>correo</b> que registraste en la estética.
          </p>

          <label className="mb-3.5 flex flex-col gap-1.5">
            <span className="text-xs font-bold text-muted">Correo</span>
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email"
              className={inputCls} placeholder="tucorreo@ejemplo.com" />
          </label>

          <label className="mb-2 flex flex-col gap-1.5">
            <span className="text-xs font-bold text-muted">Contraseña</span>
            <div className="flex items-center rounded-[11px] border border-line focus-within:border-magenta">
              <input type={verClave ? 'text' : 'password'} value={password} onChange={(e) => setPassword(e.target.value)}
                autoComplete="current-password" onKeyDown={(e) => e.key === 'Enter' && entrar()}
                className="w-full bg-transparent p-3.5 text-sm outline-none" placeholder="Tu contraseña" />
              <button type="button" onClick={() => setVerClave((v) => !v)}
                className="flex-none px-3 text-[11.5px] font-bold text-muted">
                {verClave ? '🙈 Ocultar' : '👁 Mostrar'}
              </button>
            </div>
          </label>

          <div className="mb-[18px] rounded-[10px] px-3 py-2.5 text-[11.5px]" style={{ background: 'var(--teal-soft)', color: '#1E5A82' }}>
            ¿Primera vez? Tu contraseña es <b>tu número de teléfono</b> (solo los números).
            Al entrar, cámbiala por una tuya en <b>Mi Ficha</b>.
          </div>

          {error && (
            <div role="alert" className="mb-3 rounded-[11px] px-3.5 py-3 text-[13px] font-semibold"
              style={{ background: 'var(--danger-soft)', color: 'var(--danger)' }}>
              {error}
            </div>
          )}

          <button onClick={entrar} disabled={busy}
            className="w-full rounded-xl border-none bg-magenta py-[15px] text-[15px] font-bold text-white disabled:opacity-60"
            style={{ boxShadow: '0 6px 18px rgba(179,28,134,.28)' }}>
            {busy ? 'Entrando…' : 'Entrar a mi portal →'}
          </button>

          <div className="mt-3 text-center text-[11.5px] text-faint">
            ¿Olvidaste tu contraseña? Pídele a recepción que te la restablezca.
          </div>

          <div className="mt-4 border-t border-line-2 pt-4 text-center">
            <button onClick={() => navigate('/login')} className="text-xs font-semibold text-faint">
              ← Soy personal de Li Estetic
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
