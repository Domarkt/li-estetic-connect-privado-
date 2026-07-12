import { useCallback, useEffect, useState } from 'react';
import { api } from '../../lib/api';
import { useToast } from '../../components/Toast';
import { Portal } from '../../components/Modal';
import type { PipelineColumn, PipelineLead, PipelineStage } from '../../lib/types';

interface MenuState { leadId: string; leadName: string; stage: PipelineStage; x: number; y: number }

export default function PipelinePage() {
  const toast = useToast();
  const [columns, setColumns] = useState<PipelineColumn[]>([]);
  const [menu, setMenu] = useState<MenuState | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);
  const [overStage, setOverStage] = useState<PipelineStage | null>(null);

  const load = useCallback(() => {
    api.get<{ columns: PipelineColumn[] }>('/pipeline').then((r) => setColumns(r.columns)).catch(() => {});
  }, []);
  useEffect(() => { load(); }, [load]);

  async function move(leadId: string, stage: PipelineStage, name?: string) {
    setMenu(null);
    // Optimista
    setColumns((cols) => {
      let lead: PipelineLead | undefined;
      const cleared = cols.map((c) => {
        const found = c.leads.find((l) => l.id === leadId);
        if (found) lead = found;
        return { ...c, leads: c.leads.filter((l) => l.id !== leadId) };
      });
      return cleared.map((c) => (c.stage === stage && lead ? { ...c, leads: [lead, ...c.leads] } : c));
    });
    try {
      await api.patch(`/pipeline/${leadId}`, { stage });
      if (name) toast(`${name} movido a nueva etapa`);
    } catch {
      toast('No se pudo mover el lead');
      load();
    }
  }

  const otherStages = menu ? columns.filter((c) => c.stage !== menu.stage) : [];

  return (
    <>
    <div className="flex animate-fade gap-3.5 overflow-x-auto pb-2" onClick={() => setMenu(null)}>
      {columns.map((col) => (
        <div key={col.stage}
          onDragOver={(e) => { e.preventDefault(); setOverStage(col.stage); }}
          onDrop={() => { if (dragId) move(dragId, col.stage); setDragId(null); setOverStage(null); }}
          className="min-w-[240px] flex-1 rounded-xl border p-3 transition"
          style={{ background: overStage === col.stage ? 'var(--magenta-soft)' : 'var(--bg)', borderColor: overStage === col.stage ? 'var(--magenta)' : 'var(--line)' }}>
          <div className="mb-3 flex items-center gap-2 p-0.5">
            <span className="h-2.5 w-2.5 rounded-full" style={{ background: col.color }} />
            <span className="flex-1 text-[13px] font-bold">{col.label}</span>
            <span className="rounded-full border border-line bg-card px-2 py-0.5 text-[11.5px] font-bold text-muted">{col.leads.length}</span>
          </div>
          <div className="flex flex-col gap-2.5">
            {col.leads.map((ld) => (
              <div key={ld.id} draggable
                onDragStart={() => setDragId(ld.id)} onDragEnd={() => { setDragId(null); setOverStage(null); }}
                className="relative cursor-grab rounded-[10px] border border-line bg-card p-3 active:cursor-grabbing"
                style={{ boxShadow: '0 1px 2px rgba(28,37,64,.05)', opacity: dragId === ld.id ? 0.5 : 1 }}>
                <div className="flex items-start justify-between gap-1.5">
                  <div className="flex items-center gap-2">
                    {ld.channelBadge && <span className="rounded px-1.5 py-0.5 text-[9px] font-extrabold text-white" style={{ background: ld.channelColor ?? '#999' }}>{ld.channelBadge}</span>}
                    <div className="text-[13px] font-bold">{ld.name}</div>
                  </div>
                  <button onClick={(e) => {
                    e.stopPropagation();
                    if (menu?.leadId === ld.id) { setMenu(null); return; }
                    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
                    setMenu({ leadId: ld.id, leadName: ld.name, stage: col.stage, x: r.right, y: r.bottom });
                  }}
                    className="flex h-6 w-6 flex-none items-center justify-center rounded-md bg-bg text-sm font-extrabold leading-none text-muted">⋯</button>
                </div>
                <div className="mt-1 text-[12px] leading-snug text-muted">{ld.summary}</div>
              </div>
            ))}
            {col.leads.length === 0 && <div className="rounded-lg border border-dashed border-line py-6 text-center text-[11.5px] text-faint">Vacío</div>}
          </div>
        </div>
      ))}
    </div>

    {menu && (
      <Portal>
        {/* Capa para cerrar al hacer clic fuera */}
        <div className="fixed inset-0 z-[200]" onClick={() => setMenu(null)} />
        <div className="fixed z-[201] min-w-[190px] overflow-hidden rounded-[10px] border border-line bg-card animate-pop"
          style={{ boxShadow: '0 8px 30px rgba(28,37,64,.18)', top: Math.min(menu.y + 4, window.innerHeight - 8 - 44 * (otherStages.length + 1)), left: Math.min(menu.x, window.innerWidth - 210) }}>
          <div className="px-3 pb-1 pt-2.5 text-[10.5px] font-bold uppercase tracking-wide text-faint">Mover a</div>
          {otherStages.map((c) => (
            <button key={c.stage} onClick={() => move(menu.leadId, c.stage, menu.leadName)} className="flex w-full items-center gap-2.5 px-3 py-2.5 text-left text-[13px] font-semibold hover:bg-bg">
              <span className="h-2 w-2 flex-none rounded-full" style={{ background: c.color }} />{c.label}
            </button>
          ))}
        </div>
      </Portal>
    )}
    </>
  );
}
