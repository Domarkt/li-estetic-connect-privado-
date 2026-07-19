import { useEffect, useState } from 'react';
import QRCode from 'qrcode';
import { api } from '../../lib/api';
import { useAuth } from '../../auth/AuthContext';
import { useBranch } from '../../layout/BranchContext';
import { useToast } from '../../components/Toast';
import { Portal, stop } from '../../components/Modal';
import { fmtRD, type PatientDetail } from '../../lib/types';

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

              {d.treatment && (
                <div>
                  <div className="mb-2 flex items-center justify-between">
                    <div className="text-sm font-bold">{d.treatment.name}</div>
                    <div className="text-[12.5px] font-semibold text-muted">{d.treatment.done}/{d.treatment.total}</div>
                  </div>
                  <div className="mb-3 h-2 overflow-hidden rounded-md" style={{ background: 'var(--navy-soft)' }}>
                    <div className="h-full rounded-md bg-magenta" style={{ width: `${Math.round((d.treatment.done / d.treatment.total) * 100)}%` }} />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    {Array.from({ length: d.treatment.total }, (_, i) => i + 1).map((n) => {
                      const done = n <= d.treatment!.done;
                      return (
                        <div key={n} className="flex items-center gap-2.5 rounded-lg px-2 py-1.5" style={{ background: done ? 'var(--magenta-soft)' : 'var(--bg)' }}>
                          <span className="flex h-[22px] w-[22px] items-center justify-center rounded-full text-[11px] font-bold text-white" style={{ background: done ? 'var(--magenta)' : 'var(--faint)' }}>{n}</span>
                          <span className="flex-1 text-[12.5px] font-semibold">Sesión {n}</span>
                          <span className="text-xs text-muted">{done ? 'Realizada' : 'Pendiente'}</span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

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
    </div>
    </Portal>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-[10px] bg-bg px-3.5 py-3"><div className="text-[11px] font-semibold text-muted">{label}</div><div className="text-[13px] font-bold">{value}</div></div>
  );
}
