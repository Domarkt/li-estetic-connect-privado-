import { useEffect, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';

/**
 * Acceso al portal en dos pasos: los datos identifican, el código autentica.
 * Correo y teléfono los puede conocer un tercero, y detrás está la ficha clínica;
 * por eso lo que abre la sesión es un código de 6 dígitos enviado al paciente.
 */
export default function PatientLogin() {
  const { requestPatientCode, loginPatient } = useAuth();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [paso, setPaso] = useState<'datos' | 'codigo'>('datos');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [aviso, setAviso] = useState('');
  const [error, setError] = useState(params.get('expirada') ? 'Tu sesión venció. Entra de nuevo.' : '');
  const [busy, setBusy] = useState(false);
  const [reenvioEn, setReenvioEn] = useState(0);
  const codeRef = useRef<HTMLInputElement>(null);

  // Cuenta atrás para poder reenviar el código.
  useEffect(() => {
    if (reenvioEn <= 0) return;
    const t = setTimeout(() => setReenvioEn((s) => s - 1), 1000);
    return () => clearTimeout(t);
  }, [reenvioEn]);

  useEffect(() => { if (paso === 'codigo') codeRef.current?.focus(); }, [paso]);

  async function pedirCodigo(reenvio = false) {
    setError('');
    if (!email.trim() || !phone.trim()) { setError('Escribe tu correo y tu teléfono'); return; }
    setBusy(true);
    try {
      const msg = await requestPatientCode(email.trim(), phone.trim());
      setAviso(reenvio ? 'Te enviamos un código nuevo.' : msg);
      setPaso('codigo');
      setReenvioEn(60);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo enviar el código');
    } finally { setBusy(false); }
  }

  async function entrar() {
    setError('');
    if (code.trim().length !== 6) { setError('El código son 6 dígitos'); return; }
    setBusy(true);
    try {
      await loginPatient(email.trim(), phone.trim(), code.trim());
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
          {paso === 'datos' ? (
            <>
              <p className="mb-[22px] mt-0 text-center text-[13.5px] text-muted">
                Escribe el <b>correo</b> y el <b>teléfono</b> que registraste en la estética. Te enviaremos un código para entrar.
              </p>
              <label className="mb-3.5 flex flex-col gap-1.5">
                <span className="text-xs font-bold text-muted">Correo</span>
                <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email"
                  className={inputCls} placeholder="tucorreo@ejemplo.com" />
              </label>
              <label className="mb-2 flex flex-col gap-1.5">
                <span className="text-xs font-bold text-muted">Teléfono</span>
                <input type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} autoComplete="tel"
                  onKeyDown={(e) => e.key === 'Enter' && pedirCodigo()}
                  className={inputCls} placeholder="809-000-0000" />
              </label>
              <div className="mb-[18px] text-[12px] text-faint">
                El acceso se activa cuando visitas la estética y pagas tu primer servicio.
              </div>
            </>
          ) : (
            <>
              <p className="mb-1 mt-0 text-center text-[13.5px] text-muted">
                Revisa tu correo <b className="break-all">{email.trim()}</b>
              </p>
              <p className="mb-[22px] mt-0 text-center text-[12px] text-faint">
                Escribe el código de 6 dígitos. Vence en 10 minutos.
              </p>
              <label className="mb-3 flex flex-col gap-1.5">
                <span className="text-xs font-bold text-muted">Código de acceso</span>
                <input ref={codeRef} inputMode="numeric" autoComplete="one-time-code" maxLength={6}
                  value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
                  onKeyDown={(e) => e.key === 'Enter' && entrar()}
                  className="rounded-[11px] border border-line p-3.5 text-center text-[26px] font-extrabold tracking-[10px] outline-none focus:border-magenta"
                  placeholder="000000" />
              </label>
              <div className="mb-[18px] flex items-center justify-between text-[12px]">
                <button onClick={() => { setPaso('datos'); setCode(''); setError(''); setAviso(''); }}
                  className="font-semibold text-faint">← Cambiar datos</button>
                <button onClick={() => pedirCodigo(true)} disabled={reenvioEn > 0 || busy}
                  className="font-bold text-magenta disabled:text-faint">
                  {reenvioEn > 0 ? `Reenviar en ${reenvioEn}s` : 'Reenviar código'}
                </button>
              </div>
            </>
          )}

          {aviso && !error && (
            <div className="mb-3 rounded-[11px] px-3.5 py-3 text-[12.5px] font-semibold"
              style={{ background: 'var(--teal-soft)', color: '#1E5A82' }}>
              {aviso}
            </div>
          )}
          {error && (
            <div role="alert" className="mb-3 rounded-[11px] px-3.5 py-3 text-[13px] font-semibold"
              style={{ background: 'var(--danger-soft)', color: 'var(--danger)' }}>
              {error}
            </div>
          )}

          <button onClick={() => (paso === 'datos' ? pedirCodigo() : entrar())} disabled={busy}
            className="w-full rounded-xl border-none bg-magenta py-[15px] text-[15px] font-bold text-white disabled:opacity-60"
            style={{ boxShadow: '0 6px 18px rgba(179,28,134,.28)' }}>
            {busy
              ? (paso === 'datos' ? 'Enviando código…' : 'Entrando…')
              : (paso === 'datos' ? 'Enviarme el código →' : 'Entrar a mi portal →')}
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
