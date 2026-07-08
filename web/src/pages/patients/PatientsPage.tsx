import { useCallback, useEffect, useState } from 'react';
import { api } from '../../lib/api';
import { useAuth } from '../../auth/AuthContext';
import { useBranch } from '../../layout/BranchContext';
import { Icon } from '../../components/icons';
import { fmtRD, type PatientRow } from '../../lib/types';
import PatientDrawer from './PatientDrawer';
import FichaWizard from './FichaWizard';
import AddServicesModal from './AddServicesModal';
import NewPatientModal from './NewPatientModal';
import BillModal from '../billing/BillModal';
import ReceiptModal from '../billing/ReceiptModal';
import type { Receipt } from '../../lib/types';

export default function PatientsPage() {
  const { staff } = useAuth();
  const { activeBranch } = useBranch();
  const [rows, setRows] = useState<PatientRow[]>([]);
  const [q, setQ] = useState('');
  const [detailId, setDetailId] = useState<string | null>(null);
  const [ficha, setFicha] = useState<{ id: string; name: string } | null>(null);
  const [addSvc, setAddSvc] = useState<string | null>(null);
  const [newOpen, setNewOpen] = useState(false);
  const [billId, setBillId] = useState<string | null>(null);
  const [receipt, setReceipt] = useState<Receipt | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  const branchQuery = staff?.role === 'ADMIN' && activeBranch !== 'all' ? `&branch=${activeBranch}` : '';

  const load = useCallback(() => {
    api.get<PatientRow[]>(`/patients?q=${encodeURIComponent(q)}${branchQuery}`).then(setRows).catch(() => setRows([]));
  }, [q, branchQuery]);

  useEffect(() => { load(); }, [load, reloadKey]);

  const canCreate = staff?.role === 'ADMIN' || staff?.role === 'RECEPCIONISTA';
  const refresh = () => setReloadKey((k) => k + 1);

  return (
    <div className="animate-fade">
      <div className="mb-4 flex items-center justify-between">
        <div className="flex w-[340px] items-center gap-2.5 rounded-[10px] border border-line bg-card px-3.5 py-2.5 text-faint">
          <Icon name="search" size={16} />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar paciente por nombre o teléfono…"
            className="w-full bg-transparent text-[13.5px] text-ink outline-none placeholder:text-faint" />
        </div>
        {canCreate && (
          <button onClick={() => setNewOpen(true)} className="flex items-center gap-1.5 rounded-[10px] bg-magenta px-[18px] py-2.5 text-[13.5px] font-bold text-white">
            <span className="text-base">+</span> Nuevo paciente
          </button>
        )}
      </div>

      <div className="overflow-hidden rounded-base border border-line bg-card shadow-card">
        <div className="grid grid-cols-[2.2fr_1.4fr_1.6fr_1fr_1.1fr_1fr] gap-3 border-b border-line px-5 py-3 text-[11.5px] font-bold uppercase tracking-wide text-muted">
          <div>Paciente</div><div>Ficha clínica</div><div>Tratamiento</div><div>Progreso</div><div>Saldo</div><div>Próxima cita</div>
        </div>
        {rows.length === 0 && <div className="px-5 py-10 text-center text-sm text-muted">Sin pacientes.</div>}
        {rows.map((p) => {
          const initials = p.name.split(' ').map((w) => w[0]).slice(0, 2).join('').toUpperCase();
          return (
            <div key={p.id} onClick={() => setDetailId(p.id)}
              className="grid cursor-pointer grid-cols-[2.2fr_1.4fr_1.6fr_1fr_1.1fr_1fr] items-center gap-3 border-b border-line-2 px-5 py-3.5 transition hover:bg-bg">
              <div className="flex items-center gap-3">
                <div className="flex h-9 w-9 flex-none items-center justify-center rounded-full text-[13px] font-bold text-white" style={{ background: p.avatarColor }}>{initials}</div>
                <div>
                  <div className="flex items-center gap-1.5">
                    <span className="text-[13.5px] font-bold">{p.name}</span>
                    {p.type === 'NUEVO' && <span className="rounded-full bg-magenta-soft px-2 py-0.5 text-[10px] font-bold text-magenta">Nuevo</span>}
                  </div>
                  <div className="text-xs text-muted">{p.phone} · {p.branchName}</div>
                </div>
              </div>
              <div><FichaChip status={p.fichaStatus} label={p.fichaLabel} /></div>
              <div className="text-[13px] font-semibold">{p.plan}</div>
              <div>
                <div className="mb-1 text-xs font-bold">{p.progLabel}</div>
                <div className="h-1.5 w-20 overflow-hidden rounded" style={{ background: 'var(--navy-soft)' }}><div className="h-full rounded bg-magenta" style={{ width: `${p.progPct}%` }} /></div>
              </div>
              <div className="text-[13px] font-bold" style={{ color: p.balance > 0 ? 'var(--danger)' : 'var(--ink)' }}>{fmtRD(p.balance)}</div>
              <div className="text-[12.5px] font-semibold text-muted">{p.next}</div>
            </div>
          );
        })}
      </div>

      {detailId && (
        <PatientDrawer patientId={detailId} reloadKey={reloadKey} onClose={() => setDetailId(null)}
          onOpenFicha={(p) => { setDetailId(null); setFicha(p); }}
          onOpenAddServices={(id) => { setDetailId(null); setAddSvc(id); }}
          onOpenBill={(id) => { setDetailId(null); setBillId(id); }} />
      )}
      {ficha && <FichaWizard patientId={ficha.id} patientName={ficha.name} onClose={() => setFicha(null)} onSaved={refresh} />}
      {addSvc && <AddServicesModal patientId={addSvc} onClose={() => setAddSvc(null)} onSaved={refresh} />}
      {newOpen && <NewPatientModal onClose={() => setNewOpen(false)} onCreated={(p) => { refresh(); setFicha({ id: p.id, name: p.name }); }} />}
      {billId && <BillModal preselectId={billId} onClose={() => setBillId(null)} onEmitted={(r) => { setReceipt(r); refresh(); }} />}
      {receipt && <ReceiptModal receipt={receipt} onClose={() => setReceipt(null)} />}
    </div>
  );
}

function FichaChip({ status, label }: { status: string; label: string }) {
  const styles: Record<string, { bg: string; fg: string }> = {
    PENDIENTE: { bg: 'var(--warn-soft)', fg: 'var(--warn)' },
    PASO1_OK: { bg: 'var(--teal-soft)', fg: 'var(--teal)' },
    COMPLETA: { bg: 'var(--ok-soft)', fg: 'var(--ok)' },
  };
  const s = styles[status] ?? styles.PENDIENTE;
  return <span className="rounded-full px-2.5 py-1 text-[11px] font-bold" style={{ background: s.bg, color: s.fg }}>{label}</span>;
}
