import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';

export default function PatientLogin() {
  const { loginPatient } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit() {
    setError('');
    if (!email.trim() || !phone.trim()) { setError('Escribe tu correo y tu teléfono'); return; }
    setBusy(true);
    try {
      await loginPatient(email.trim(), phone.trim());
      navigate('/portal');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo iniciar sesión');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center p-6"
      style={{ background: 'linear-gradient(160deg,#FBEEF6,#EEF1F8)' }}>
      <div className="w-full max-w-[400px] overflow-hidden rounded-[22px] bg-card animate-pop"
        style={{ boxShadow: '0 24px 70px rgba(28,37,64,.18)' }}>
        <div className="px-[30px] pb-7 pt-[34px] text-center text-white"
          style={{ background: 'linear-gradient(135deg,#B31C86,#8E1268)' }}>
          <div className="mb-4 inline-flex rounded-[14px] bg-white px-4 py-2.5">
            <img src="/li-logo.png" className="h-[34px]" />
          </div>
          <div className="font-display italic text-[15px]" style={{ color: '#F3C3E0' }}>Transformando Tu Cuerpo</div>
          <h2 className="mb-0 mt-1.5 text-[22px] font-extrabold">Portal del Paciente</h2>
        </div>
        <div className="p-[30px]">
          <p className="mb-[22px] mt-0 text-center text-[13.5px] text-muted">
            Entra con el <b>correo</b> y el <b>teléfono</b> que registraste en la estética.
          </p>
          <label className="mb-3.5 flex flex-col gap-1.5">
            <span className="text-xs font-bold text-muted">Correo</span>
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="off"
              className="rounded-[11px] border border-line p-3.5 text-sm outline-none focus:border-magenta"
              placeholder="tucorreo@ejemplo.com" />
          </label>
          <label className="mb-2 flex flex-col gap-1.5">
            <span className="text-xs font-bold text-muted">Teléfono</span>
            <input type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} autoComplete="off"
              onKeyDown={(e) => e.key === 'Enter' && submit()}
              className="rounded-[11px] border border-line p-3.5 text-sm outline-none focus:border-magenta"
              placeholder="809-000-0000" />
          </label>
          <div className="mb-[18px] text-[12px] text-faint">
            El acceso se activa cuando visitas la estética y pagas tu primer servicio.
          </div>

          {error && (
            <div className="mb-3 rounded-[11px] px-3.5 py-3 text-[13px] font-semibold"
              style={{ background: 'var(--danger-soft)', color: 'var(--danger)' }}>
              {error}
            </div>
          )}

          <button onClick={submit} disabled={busy}
            className="w-full rounded-xl border-none bg-magenta py-[15px] text-[15px] font-bold text-white disabled:opacity-60"
            style={{ boxShadow: '0 6px 18px rgba(179,28,134,.28)' }}>
            {busy ? 'Entrando…' : 'Entrar a mi portal →'}
          </button>
          <div className="mt-5 border-t border-line-2 pt-4 text-center">
            <button onClick={() => navigate('/login')} className="text-xs font-semibold text-faint">
              ← Soy personal de Li Estetic
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
