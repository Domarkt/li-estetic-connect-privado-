import { useEffect, useState } from 'react';
import QRCode from 'qrcode';
import { api } from '../../lib/api';
import { useAuth } from '../../auth/AuthContext';
import { useBranch } from '../../layout/BranchContext';
import { useToast } from '../../components/Toast';
import { Portal, stop } from '../../components/Modal';
import { fmtRD, type PatientDetail, type PatientPackage } from '../../lib/types';

interface Props {
  patientId: string;
  onClose: () => void;
  onOpenFicha: (p: { id: string; name: string }) => void;
  onOpenAddServices: (id: string) => void;
  onOpenBill: (id: string) => void;
  reloadKey: number;
}

export default function PatientDrawer({ patientId, onClose, onOpenFicha, onOpenAddServices, onOpenBill, reloadKey }: Props) {
  const { staff } = useAuth();
  const { branches } = useBranch();
  const toast = useToast();
  const [d, setD] = useState<PatientDetail | null>(null);
  const [sending, setSending] = useState(false);
  const [transferTo, setTransferTo] = useState('');
  const [transferNote, setTransferNote] = useState('');
  const [transferring, setTransferring] = useState(false);
  const [accessGiven, setAccessGiven] = useState(false);
  const [waUrl, setWaUrl] = useState<string | null>(null);
  const [qr, setQr] = useState<string | null>(null);
  const [areasFor, setAreasFor] = useState<PatientPackage | null>(null); // paquete/combo al que se le definen áreas

  useEffect(() => {
    api.get<PatientDetail>(`/patients/${patientId}`).then(setD).catch(() => setD(null));
  }, [patientId, reloadKey]);

  const initials = (d?.name ?? '').split(' ').map((w) => w[0]).slice(0, 2).join('').toUpperCase();
  const isMasa = staff?.role === 'ESTETICISTA';
  const canBill = staff?.role === 'ADMIN' || staff?.role === 'RECEPCIONISTA';
  const fichaComplete = d?.fichaStatus === 'COMPLETA';
  const fichaFilled = !!d?.fichaFilled; // el paciente ya completó su parte
  const paso1Done = d?.fichaStatus !== 'PENDIENTE';

  async function transfer() {
    if (!transferTo) { toast('Elige la sucursal destino'); return; }
    setTransferring(true);
    try {
      const r = await api.post<{ message: string }>(`/patients/${patientId}/transfer`, { branchId: transferTo, note: transferNote.trim() || undefined });
      toast(r.message);
      setTransferTo(''); setTransferNote('');
      onClose();
    } catch (e) { toast(e instanceof Error ? e.message : 'Error'); } finally { setTransferring(false); }
  }

  async function sendToPatient() {
    setSending(true);
    try {
      const r = await api.post<{ message: string; whatsappUrl: string | null; portalUrl: string }>(`/patients/${patientId}/ficha/send-to-patient`);
      toast(r.message);
      setAccessGiven(true);
      setWaUrl(r.whatsappUrl);
      // QR de la URL pública del portal (no lleva datos del paciente).
      try { setQr(await QRCode.toDataURL(r.portalUrl, { width: 220, margin: 1 })); } catch { setQr(null); }
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Error');
    } finally { setSending(false); }
  }

  return (
    <Portal>
    <div onClick={onClose} className="fixed inset-0 z-[100] flex justify-end" style={{ background: 'rgba(28,37,64,.42)' }}>
      <div onClick={stop} className="h-screen w-[460px] max-w-full overflow-y-auto bg-card animate-slideup" style={{ boxShadow: '-8px 0 40px rgba(0,0,0,.2)' }}>
        {!d ? (
          <div className="p-8 text-sm text-muted">Cargando…</div>
        ) : (
          <>
            <div className="sticky top-0 z-[2] flex items-center gap-3.5 border-b border-line bg-card px-6 py-5">
              <div className="flex h-12 w-12 flex-none items-center justify-center rounded-full text-base font-extrabold text-white" style={{ background: d.avatarColor }}>{initials}</div>
              <div className="flex-1"><div className="text-[17px] font-extrabold">{d.name}</div><div className="text-[12.5px] text-muted">{d.age ? `${d.age} años · ` : ''}{d.phone}</div></div>
              <button onClick={onClose} className="h-[34px] w-[34px] rounded-[9px] bg-bg text-lg text-muted">×</button>
            </div>

            <div className="flex flex-col gap-4 px-6 py-6">
              {/* Ficha */}
              <div className="flex items-center justify-between rounded-[11px] bg-bg px-4 py-3.5">
                <div><div className="text-[11.5px] font-semibold text-muted">Ficha clínica</div><div className="mt-0.5 text-[13px] font-bold">{d.fichaLabel}</div></div>
                <button onClick={() => onOpenFicha({ id: d.id, name: d.name })} className="rounded-[9px] bg-magenta px-4 py-2.5 text-[12.5px] font-bold text-white">
                  {fichaComplete ? 'Ver ficha' : staff?.role === 'RECEPCIONISTA' ? (paso1Done ? 'Ver / editar datos' : 'Completar Paso 1') : 'Continuar/validar ficha'}
                </button>
              </div>

              {/* El paciente ya completó su parte: recepción no necesita reenviar. */}
              {canBill && !fichaComplete && fichaFilled && (
                <div className="rounded-[11px] border px-4 py-3 text-[12px] font-semibold" style={{ background: 'var(--ok-soft)', borderColor: '#CDEBDD', color: '#1F7A54' }}>
                  ✓ El paciente completó su ficha. Pendiente de que la esteticista la valide.
                </div>
              )}

              {/* Recepción/Admin: dar acceso al portal (tras presentarse y pagar) */}
              {canBill && !fichaComplete && (
                <div className="rounded-[11px] border px-4 py-3" style={{ background: 'var(--teal-soft)', borderColor: '#CFE2F0' }}>
                  <div className="mb-2 text-[12px] leading-normal" style={{ color: '#1E5A82' }}>
                    Cuando el paciente <b>se presenta y paga</b>, dale acceso a su portal (para ver su proceso y su ficha). Entra con su <b>correo y teléfono</b>.
                  </div>
                  <button onClick={sendToPatient} disabled={sending} className="flex w-full items-center justify-center gap-2 rounded-[9px] bg-navy py-2.5 text-[12.5px] font-bold text-white disabled:opacity-60">
                    {sending ? 'Enviando…' : d.fichaSent ? '✉ Reenviar acceso al portal' : '✉ Dar acceso al portal'}
                  </button>
                  {accessGiven && (
                    <div className="mt-2 rounded-[9px] bg-card p-3 text-center text-[12px]">
                      <div className="font-bold text-navy">Acceso activado ✓</div>
                      <div className="mt-0.5 text-muted">El paciente entra con su <b>correo</b> y <b>teléfono</b>.</div>
                      {qr && <img src={qr} alt="QR del portal" className="mx-auto my-2 h-40 w-40 rounded-lg" />}
                      {qr && <div className="text-faint">Escanea el QR para abrir el portal</div>}
                      {waUrl && (
                        <a href={waUrl} target="_blank" rel="noreferrer" className="mt-2.5 flex items-center justify-center gap-2 rounded-[9px] py-2.5 text-[12.5px] font-bold text-white no-underline" style={{ background: '#25D366' }}>
                          <span>🟢</span> Enviar por WhatsApp
                        </a>
                      )}
                    </div>
                  )}
                </div>
              )}

              {/* Admin: transferir el paciente a otra sucursal (se mueve con su ficha e historial) */}
              {staff?.role === 'ADMIN' && branches.length > 1 && (
                <div className="rounded-[11px] border border-line px-4 py-3">
                  <div className="mb-2 text-[12px] font-bold text-muted">Transferir a otra estética</div>
                  <div className="flex flex-col gap-2">
                    <select value={transferTo} onChange={(e) => setTransferTo(e.target.value)} className="rounded-[9px] border border-line bg-card px-3 py-2.5 text-[13px]">
                      <option value="">— Elegir sucursal destino —</option>
                      {branches.filter((b) => b.id !== d.branchId).map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
                    </select>
                    <input value={transferNote} onChange={(e) => setTransferNote(e.target.value)} placeholder="Nota / instrucciones (opcional)" className="rounded-[9px] border border-line px-3 py-2.5 text-[13px] outline-none focus:border-magenta" />
                    <button onClick={transfer} disabled={transferring || !transferTo} className="rounded-[9px] bg-navy py-2.5 text-[12.5px] font-bold text-white disabled:opacity-60">
                      {transferring ? 'Transfiriendo…' : 'Transferir paciente'}
                    </button>
                  </div>
                </div>
              )}

              <div className="grid grid-cols-2 gap-2.5">
                <Info label="Sucursal" value={d.branchName} />
                <Info label="Paciente desde" value={d.since} />
                <Info label="Fototipo de piel" value={d.skin} />
                <Info label="Esteticista" value={d.therapistName ?? '—'} />
              </div>

              {d.motivo.length > 0 && (
                <div>
                  <div className="mb-1.5 text-[11.5px] font-semibold text-muted">Motivo de consulta</div>
                  <div className="text-[13.5px] font-semibold">{d.motivo.join(', ')}</div>
                </div>
              )}

              {/* Historial clínico (antecedentes guardados en la ficha) */}
              {(d.clinical.antecedentes.length > 0 || d.clinical.medicamentos.length > 0 || d.clinical.tallaCm || d.clinical.observaciones) && (
                <div className="rounded-[11px] border border-line bg-bg px-4 py-3">
                  <div className="mb-2 text-[11.5px] font-bold uppercase tracking-wide text-navy">Historial clínico</div>
                  {d.clinical.antecedentes.length > 0 && (
                    <div className="mb-2">
                      <div className="text-[11px] font-semibold text-muted">Antecedentes</div>
                      <div className="mt-1 flex flex-wrap gap-1.5">
                        {d.clinical.antecedentes.map((a) => <span key={a} className="rounded-full bg-magenta-soft px-2 py-0.5 text-[11px] font-semibold text-magenta">{a}</span>)}
                      </div>
                    </div>
                  )}
                  {d.clinical.medicamentos.length > 0 && (
                    <div className="mb-2">
                      <div className="text-[11px] font-semibold text-muted">Medicamentos</div>
                      <div className="mt-1 flex flex-wrap gap-1.5">
                        {d.clinical.medicamentos.map((m) => <span key={m} className="rounded-full bg-warn-soft px-2 py-0.5 text-[11px] font-semibold text-warn">{m}</span>)}
                      </div>
                    </div>
                  )}
                  {(d.clinical.tallaCm || d.clinical.pesoLb) && (
                    <div className="text-[12px] text-ink"><span className="text-muted">Talla/Peso:</span> {d.clinical.tallaCm ?? '—'} cm · {d.clinical.pesoLb ?? '—'} lb</div>
                  )}
                  {d.clinical.observaciones && <div className="mt-1 text-[12px] text-ink"><span className="text-muted">Obs.:</span> {d.clinical.observaciones}</div>}
                </div>
              )}

              {/* Todos los paquetes/combos comprados y sin consumir (ya no hace falta grapar fichas). */}
              {(d.packages ?? []).length > 0 && (
                <div className="flex flex-col gap-3">
                  <div className="flex items-center justify-between">
                    <div className="text-sm font-bold">Paquetes activos</div>
                    <span className="rounded-full bg-magenta-soft px-2 py-0.5 text-[11px] font-bold text-magenta">{d.packages!.length}</span>
                  </div>
                  {d.packages!.map((pk) => (
                    <div key={pk.id} className="rounded-[11px] border border-line p-3">
                      <div className="mb-2 flex items-center justify-between gap-2">
                        <div className="min-w-0 flex-1 truncate text-[13.5px] font-bold">{pk.name}</div>
                        <div className="flex-none text-[12.5px] font-semibold text-muted">{pk.done}/{pk.total}</div>
                      </div>
                      <div className="mb-2 h-2 overflow-hidden rounded-md" style={{ background: 'var(--navy-soft)' }}>
                        <div className="h-full rounded-md bg-magenta" style={{ width: `${pk.total ? Math.round((pk.done / pk.total) * 100) : 0}%` }} />
                      </div>
                      <div className="flex flex-wrap items-center gap-2 text-[11.5px]">
                        <span className="rounded-full px-2 py-0.5 font-bold" style={{ background: 'var(--ok-soft)', color: 'var(--ok)' }}>
                          Quedan {pk.remaining} sesión{pk.remaining === 1 ? '' : 'es'}
                        </span>
                        {pk.balance > 0
                          ? <span className="rounded-full px-2 py-0.5 font-bold" style={{ background: 'var(--danger-soft)', color: 'var(--danger)' }}>Saldo {fmtRD(pk.balance)}</span>
                          : <span className="rounded-full px-2 py-0.5 font-bold" style={{ background: 'var(--navy-soft)', color: 'var(--navy)' }}>Pagado</span>}
                      </div>

                      {/* Áreas del paquete/combo: 2 incluidas, la 3ra es adicional (RD$1,500). */}
                      <div className="mt-2.5 border-t border-line-2 pt-2.5">
                        {(pk.areas ?? []).length === 0 ? (
                          <button onClick={() => setAreasFor(pk)} className="text-[12px] font-bold text-magenta">+ Definir áreas</button>
                        ) : (
                          <>
                            <div className="mb-1.5 flex items-center justify-between">
                              <span className="text-[11px] font-bold uppercase tracking-wide text-faint">Áreas</span>
                              <button onClick={() => setAreasFor(pk)} className="text-[11.5px] font-bold text-magenta">Editar</button>
                            </div>
                            <div className="flex flex-col gap-1">
                              {pk.areas!.map((ar) => (
                                <div key={ar.id} className="flex items-center gap-2 text-[12px]">
                                  <span className="flex-1">
                                    {ar.label}
                                    {ar.isExtra && <span className="ml-1.5 rounded-full bg-warn-soft px-1.5 py-0.5 text-[10px] font-bold text-warn">adicional</span>}
                                  </span>
                                  <span className="font-bold" style={{ color: ar.remaining === 0 ? 'var(--faint)' : 'var(--navy)' }}>{ar.done}/{ar.total}</span>
                                </div>
                              ))}
                            </div>
                          </>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {/* Historial de sesiones: qué se le viene aplicando y en qué áreas. */}
              {(d.sessions ?? []).length > 0 && <SessionHistory sessions={d.sessions!} />}

              {/* Cargos pendientes enviados a recepción */}
              {d.pendingCharges.length > 0 && (
                <div className="rounded-[11px] border px-4 py-3" style={{ background: 'var(--teal-soft)', borderColor: '#CFE2F0' }}>
                  <div className="mb-1.5 text-xs font-bold" style={{ color: '#1E5A82' }}>Cargos pendientes de facturar</div>
                  {d.pendingCharges.map((c) => (
                    <div key={c.id} className="flex justify-between text-[12.5px]" style={{ color: '#2C6B94' }}><span>{c.name}</span><span className="font-bold">{fmtRD(c.price)}</span></div>
                  ))}
                </div>
              )}

              {d.balance > 0 && (
                <div className="rounded-[11px] border px-4 py-3 text-[12.5px] font-semibold" style={{ background: 'var(--danger-soft)', borderColor: '#F0C9C4', color: 'var(--danger)' }}>
                  ⚠ Saldo pendiente de {fmtRD(d.balance)}. El paciente debe pagar antes de su próxima sesión.
                </div>
              )}
              {canBill && (
                <div className="flex flex-col gap-2.5 pt-1">
                  <button onClick={() => onOpenAddServices(d.id)} className="flex w-full items-center justify-center gap-2 rounded-[10px] border border-magenta bg-magenta-soft py-3 text-[13.5px] font-bold text-magenta">
                    <span className="text-base">+</span> Agregar servicios / productos y cobrar
                  </button>
                  <div className="flex gap-2.5">
                    <button onClick={() => onOpenBill(d.id)} className="flex-1 rounded-[10px] bg-navy py-3 text-[13.5px] font-bold text-white">Cobrar / Facturar</button>
                    <div className="flex-1 rounded-[10px] bg-bg px-3.5 py-2.5 text-center"><div className="text-[11px] font-semibold text-muted">Saldo</div><div className="text-[15px] font-extrabold" style={{ color: d.balance > 0 ? 'var(--danger)' : 'var(--ok)' }}>{fmtRD(d.balance)}</div></div>
                  </div>
                </div>
              )}

              {isMasa && (
                <div className="pt-1">
                  <div className="mb-2.5 rounded-[11px] border px-3.5 py-3 text-xs leading-normal" style={{ background: 'var(--teal-soft)', borderColor: '#CFE2F0', color: '#1E5A82' }}>
                    Como esteticista puedes <b>agregar paquetes o combos</b> a la ficha. La recepción es quien factura el cobro.
                  </div>
                  <button onClick={() => onOpenAddServices(d.id)} className="flex w-full items-center justify-center gap-2 rounded-[10px] bg-magenta py-3 text-[13.5px] font-bold text-white">
                    <span className="text-base">+</span> Agregar paquetes / combos a la ficha
                  </button>
                </div>
              )}
            </div>
          </>
        )}
      </div>
      {areasFor && (
        <AreasModal pkg={areasFor} onClose={() => setAreasFor(null)}
          onSaved={() => { setAreasFor(null); api.get<PatientDetail>(`/patients/${patientId}`).then(setD).catch(() => {}); }} />
      )}
    </div>
    </Portal>
  );
}

// Áreas agrupadas por familia. Corporal = combos reductores; Láser = depilación.
const AREA_GRUPOS: { label: string; areas: { key: string; label: string }[] }[] = [
  { label: 'Corporal', areas: [
    { key: 'ABDOMEN', label: 'Abdomen' },
    { key: 'ESPALDA', label: 'Espalda' },
    { key: 'ABDOMEN_LATERAL', label: 'Abdomen lateral' },
  ] },
  { label: 'Láser', areas: [
    { key: 'PIERNAS', label: 'Piernas' },
    { key: 'AXILAS', label: 'Axilas' },
    { key: 'BRAZOS', label: 'Brazos' },
    { key: 'CUERPO_COMPLETO', label: 'Cuerpo completo' },
    { key: 'BOZO', label: 'Bozo' },
    { key: 'CARA', label: 'Cara' },
    { key: 'ENTREPIERNAS', label: 'Entrepiernas' },
    { key: 'INTIMOS', label: 'Íntimos' },
  ] },
];
const LABEL_AREA: Record<string, string> = Object.fromEntries(AREA_GRUPOS.flatMap((g) => g.areas.map((a) => [a.key, a.label])));
const PRECIO_AREA_EXTRA = 1500;

/**
 * Define las áreas incluidas del paquete/combo (sus sesiones se reparten entre ellas)
 * y permite agregar un área adicional, que se cobra en recepción.
 */
function AreasModal({ pkg, onClose, onSaved }: { pkg: PatientPackage; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const incluidas = (pkg.areas ?? []).filter((a) => !a.isExtra).map((a) => a.area);
  const extras = (pkg.areas ?? []).filter((a) => a.isExtra).map((a) => a.area);
  const [sel, setSel] = useState<string[]>(incluidas.length ? incluidas : []);
  const [busy, setBusy] = useState(false);

  const toggle = (k: string) => {
    if (extras.includes(k)) return; // ya es adicional
    setSel((s) => (s.includes(k) ? s.filter((x) => x !== k) : [...s, k]));
  };

  async function guardar() {
    if (!sel.length) { toast('Elige al menos un área'); return; }
    setBusy(true);
    try {
      const r = await api.patch<{ message: string }>(`/patients/treatments/${pkg.id}/areas`, { areas: sel });
      toast(r.message);
      onSaved();
    } catch (e) { toast(e instanceof Error ? e.message : 'Error'); } finally { setBusy(false); }
  }

  async function agregarExtra(area: string) {
    if (!window.confirm(`Agregar ${LABEL_AREA[area]} como área adicional. Se generará un cargo de ${fmtRD(PRECIO_AREA_EXTRA)} para cobrar en recepción. ¿Continuar?`)) return;
    setBusy(true);
    try {
      const r = await api.post<{ message: string }>(`/patients/treatments/${pkg.id}/extra-area`, { area });
      toast(r.message);
      onSaved();
    } catch (e) { toast(e instanceof Error ? e.message : 'Error'); } finally { setBusy(false); }
  }

  const porArea = sel.length ? Math.floor(pkg.total / sel.length) : 0;

  return (
    <div onClick={onClose} className="fixed inset-0 z-[120] flex items-center justify-center p-4" style={{ background: 'rgba(28,37,64,.5)' }}>
      <div onClick={stop} className="flex max-h-[88vh] w-[430px] max-w-full flex-col overflow-hidden rounded-2xl bg-card animate-pop" style={{ boxShadow: '0 24px 80px rgba(0,0,0,.35)' }}>
        <div className="flex flex-none items-center border-b border-line px-6 py-5">
          <div className="flex-1"><div className="text-base font-extrabold">Áreas del paquete</div><div className="text-[12.5px] text-muted">{pkg.name} · {pkg.total} sesiones</div></div>
          <button onClick={onClose} className="h-8 w-8 rounded-lg bg-bg text-muted">×</button>
        </div>

        <div className="flex flex-col gap-3 overflow-y-auto px-6 py-5">
          <div className="text-xs font-bold text-muted">Marca las áreas que cubre este paquete</div>
          {AREA_GRUPOS.map((g) => (
            <div key={g.label} className="flex flex-col gap-1.5">
              <div className="text-[11px] font-bold uppercase tracking-wide text-faint">{g.label}</div>
              {g.areas.map((a) => {
                const esExtra = extras.includes(a.key);
                const on = sel.includes(a.key);
                return (
                  <div key={a.key} className="flex items-center gap-2">
                    <button onClick={() => toggle(a.key)} disabled={esExtra}
                      className="flex flex-1 items-center gap-3 rounded-[11px] border px-4 py-2.5 text-left disabled:opacity-60"
                      style={{ borderColor: on ? 'var(--magenta)' : 'var(--line)', background: on ? 'var(--magenta-soft)' : 'var(--card)' }}>
                      <span className="flex-1 text-[13.5px] font-bold">{a.label}</span>
                      {esExtra
                        ? <span className="rounded-full bg-warn-soft px-2 py-0.5 text-[10.5px] font-bold text-warn">adicional</span>
                        : <span className="flex h-5 w-5 items-center justify-center rounded-md text-[11px] font-extrabold text-white" style={{ background: on ? 'var(--magenta)' : 'var(--line)' }}>✓</span>}
                    </button>
                    {!esExtra && !on && sel.length >= 1 && (
                      <button onClick={() => agregarExtra(a.key)} disabled={busy}
                        className="flex-none rounded-[9px] border px-2.5 py-2 text-[11.5px] font-bold"
                        style={{ borderColor: 'var(--warn)', color: 'var(--warn)', background: 'var(--warn-soft)' }}>
                        +{fmtRD(PRECIO_AREA_EXTRA)}
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          ))}
          {sel.length > 0 && (
            <div className="rounded-[10px] bg-bg px-3 py-2 text-[11.5px] text-muted">
              Las {pkg.total} sesiones se reparten: <b>{porArea} por área</b> ({sel.length} área{sel.length === 1 ? '' : 's'}).
            </div>
          )}
          <div className="text-[11px] text-faint">Las áreas marcadas van incluidas. El botón <b>+{fmtRD(PRECIO_AREA_EXTRA)}</b> agrega un área adicional que se cobra en recepción.</div>
        </div>

        <div className="flex flex-none gap-2.5 border-t border-line px-6 py-4">
          <button onClick={onClose} className="flex-1 rounded-[10px] border border-line bg-card py-3 text-[13.5px] font-bold text-muted">Cancelar</button>
          <button onClick={guardar} disabled={busy} className="flex-[2] rounded-[10px] bg-magenta py-3 text-[13.5px] font-bold text-white disabled:opacity-60">Guardar áreas</button>
        </div>
      </div>
    </div>
  );
}

type Sesion = NonNullable<PatientDetail['sessions']>[number];

/**
 * Historial de sesiones atendidas. Lo primero que necesita ver la esteticista es
 * qué se aplicó la última vez, así que esa va destacada y el resto se despliega.
 */
function SessionHistory({ sessions }: { sessions: Sesion[] }) {
  const [abierto, setAbierto] = useState(false);
  const [ultima, ...previas] = sessions;

  const Detalle = ({ s }: { s: Sesion }) => (
    <>
      {s.techniques.length > 0 ? (
        <div className="mt-1.5 flex flex-wrap gap-1">
          {s.techniques.map((t) => (
            <span key={t} className="rounded-full bg-magenta-soft px-2 py-0.5 text-[11px] font-bold text-magenta">{t}</span>
          ))}
        </div>
      ) : (
        <div className="mt-1 text-[11.5px] text-faint">No se registró qué se aplicó.</div>
      )}
      {s.areas.length > 0 && (
        <div className="mt-1 text-[11.5px] text-muted">Áreas: {s.areas.join(' · ')}</div>
      )}
    </>
  );

  return (
    <div className="rounded-[11px] border border-line px-4 py-3">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-[13px] font-bold">Historial de sesiones</span>
        <span className="rounded-full bg-navy-soft px-2 py-0.5 text-[11px] font-bold text-navy">{sessions.length}</span>
      </div>

      {/* Última sesión: lo que la esteticista necesita antes de empezar. */}
      <div className="rounded-[10px] bg-bg px-3 py-2.5">
        <div className="flex items-baseline justify-between gap-2">
          <span className="text-[12px] font-bold">Última · {ultima.date}</span>
          {ultima.sessionNo && <span className="text-[11px] text-muted">sesión {ultima.sessionNo}</span>}
        </div>
        <div className="text-[11.5px] text-muted">{ultima.service}{ultima.therapist ? ` · ${ultima.therapist}` : ''}</div>
        <Detalle s={ultima} />
      </div>

      {previas.length > 0 && (
        <>
          <button onClick={() => setAbierto((v) => !v)} className="mt-2 text-[12px] font-bold text-magenta">
            {abierto ? 'Ocultar anteriores' : `Ver ${previas.length} sesión${previas.length === 1 ? '' : 'es'} anterior${previas.length === 1 ? '' : 'es'}`}
          </button>
          {abierto && (
            <div className="mt-2 flex flex-col gap-2">
              {previas.map((s) => (
                <div key={s.id} className="border-t border-line-2 pt-2">
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="text-[12px] font-bold">{s.date}</span>
                    {s.sessionNo && <span className="text-[11px] text-muted">sesión {s.sessionNo}</span>}
                  </div>
                  <div className="text-[11.5px] text-muted">{s.service}{s.therapist ? ` · ${s.therapist}` : ''}</div>
                  <Detalle s={s} />
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-[10px] bg-bg px-3.5 py-3"><div className="text-[11px] font-semibold text-muted">{label}</div><div className="text-[13px] font-bold">{value}</div></div>
  );
}
