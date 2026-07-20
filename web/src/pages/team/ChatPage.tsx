import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../../lib/api';
import { useAuth } from '../../auth/AuthContext';
import { useToast } from '../../components/Toast';

type Target = 'ALL' | 'RECEPCIONISTA' | 'ESTETICISTA';
const TARGETS: { k: Target; label: string }[] = [
  { k: 'ALL', label: 'Todos' },
  { k: 'RECEPCIONISTA', label: 'Recepción' },
  { k: 'ESTETICISTA', label: 'Esteticista' },
];

interface Thread { branchId: string; name: string; place: string; dotColor: string; lastMessage: string | null; lastAt: string | null; unread: number }
interface Msg { id: string; body: string; senderName: string; senderRole: string; target: string; mine: boolean; patient: { id: string; name: string } | null; time: string }
interface PatientLite { id: string; name: string; phone: string }

const ROLE_LABEL: Record<string, string> = { ADMIN: 'Admin', RECEPCIONISTA: 'Recepción', ESTETICISTA: 'Esteticista' };

export default function ChatPage() {
  const { staff } = useAuth();
  const navigate = useNavigate();
  const toast = useToast();
  const isAdmin = staff?.role === 'ADMIN';
  const [target, setTarget] = useState<Target>('ALL');
  const [threads, setThreads] = useState<Thread[]>([]);
  const [active, setActive] = useState<string | null>(null);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [draft, setDraft] = useState('');
  const [tagged, setTagged] = useState<PatientLite | null>(null);
  const [showTag, setShowTag] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);

  const loadThreads = useCallback(() => {
    api.get<Thread[]>('/team-chat/threads').then((t) => {
      setThreads(t);
      setActive((prev) => prev ?? t[0]?.branchId ?? null);
    }).catch(() => {});
  }, []);

  const loadMessages = useCallback((branchId: string) => {
    api.get<Msg[]>(`/team-chat/threads/${branchId}/messages`).then(setMessages).catch(() => {});
  }, []);

  useEffect(() => { loadThreads(); }, [loadThreads]);
  useEffect(() => {
    if (!active) return;
    loadMessages(active);
    const t = setInterval(() => loadMessages(active), 20000);
    return () => clearInterval(t);
  }, [active, loadMessages]);
  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages]);

  async function send() {
    if (!draft.trim() || !active) return;
    try {
      await api.post(`/team-chat/threads/${active}/messages`, { body: draft.trim(), patientId: tagged?.id, targetRole: isAdmin ? target : undefined });
      setDraft(''); setTagged(null); setShowTag(false);
      loadMessages(active); loadThreads();
    } catch (e) { toast(e instanceof Error ? e.message : 'Error'); }
  }

  const activeThread = threads.find((t) => t.branchId === active) ?? null;

  return (
    <div className="grid animate-fade gap-4" style={{ gridTemplateColumns: isAdmin ? '300px 1fr' : '1fr', height: 'calc(100dvh - 150px)' }}>
      {/* Lista de hilos (solo admin ve varias sucursales) */}
      {isAdmin && (
        <div className="flex flex-col overflow-hidden rounded-base border border-line bg-card shadow-card">
          <div className="border-b border-line-2 px-4 py-3 text-[13px] font-extrabold">Sucursales</div>
          <div className="flex-1 overflow-y-auto p-2">
            {threads.map((t) => {
              const on = active === t.branchId;
              return (
                <div key={t.branchId} onClick={() => setActive(t.branchId)} className="flex cursor-pointer items-center gap-3 rounded-[11px] p-2.5" style={{ background: on ? 'var(--magenta-soft)' : 'transparent' }}>
                  <span className="h-2.5 w-2.5 flex-none rounded-full" style={{ background: t.dotColor }} />
                  <div className="min-w-0 flex-1">
                    <div className="text-[13.5px] font-bold">{t.name}</div>
                    <div className="truncate text-[12px] text-muted">{t.lastMessage ?? 'Sin mensajes'}</div>
                  </div>
                  {t.unread > 0 && <span className="flex-none rounded-full bg-magenta px-1.5 py-0.5 text-[10.5px] font-bold text-white">{t.unread}</span>}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Chat */}
      <div className="flex flex-col overflow-hidden rounded-base border border-line bg-card shadow-card">
        <div className="flex items-center gap-3 border-b border-line px-[18px] py-3.5">
          <div className="flex-1">
            <div className="text-[15px] font-extrabold">Chat del equipo{activeThread ? ` · ${activeThread.name}` : ''}</div>
            <div className="text-xs text-muted">Instrucciones internas del equipo. Puedes etiquetar a un paciente.</div>
          </div>
        </div>
        <div className="flex flex-1 flex-col gap-3 overflow-y-auto p-5" style={{ background: 'var(--bg)' }}>
          {messages.length === 0 && <div className="py-10 text-center text-sm text-muted">Sin mensajes. Escribe el primero. 💬</div>}
          {messages.map((m) => (
            <div key={m.id} className="flex" style={{ justifyContent: m.mine ? 'flex-end' : 'flex-start' }}>
              <div className="max-w-[440px]">
                {!m.mine && <div className="mb-0.5 text-[11px] font-bold text-muted">{m.senderName} · {ROLE_LABEL[m.senderRole] ?? m.senderRole}</div>}
                {m.mine && m.target !== 'ALL' && <div className="mb-0.5 text-right text-[10.5px] font-bold text-faint">Para: {ROLE_LABEL[m.target] ?? m.target}</div>}
                <div className="rounded-2xl px-3.5 py-2.5 text-[13.5px]" style={m.mine ? { background: 'var(--magenta)', color: '#fff', borderBottomRightRadius: 4 } : { background: '#fff', border: '1px solid var(--line)', borderBottomLeftRadius: 4 }}>
                  {m.patient && (
                    <button
                      onClick={() => navigate(`/app/pacientes?open=${m.patient!.id}`)}
                      title="Abrir ficha del paciente"
                      className={`mb-1 inline-block cursor-pointer rounded-md px-2 py-0.5 text-[11px] font-bold underline-offset-2 hover:underline ${m.mine ? 'bg-white/25 text-white' : 'bg-magenta-soft text-magenta'}`}>
                      🏷 {m.patient.name} ›
                    </button>
                  )}
                  <div>{m.body}</div>
                </div>
                <div className="mt-1 text-[10.5px] text-faint" style={{ textAlign: m.mine ? 'right' : 'left' }}>{m.time}</div>
              </div>
            </div>
          ))}
          <div ref={endRef} />
        </div>

        {/* Composer */}
        <div className="border-t border-line p-3.5">
          {isAdmin && (
            <div className="mb-2 flex items-center gap-1.5">
              <span className="text-[11.5px] font-bold text-muted">Para:</span>
              {TARGETS.map((t) => {
                const on = target === t.k;
                return (
                  <button key={t.k} onClick={() => setTarget(t.k)} className="rounded-full px-2.5 py-1 text-[11.5px] font-bold"
                    style={{ background: on ? 'var(--magenta)' : 'var(--bg)', color: on ? '#fff' : 'var(--muted)', border: `1px solid ${on ? 'var(--magenta)' : 'var(--line)'}` }}>
                    {t.label}
                  </button>
                );
              })}
            </div>
          )}
          {tagged && (
            <div className="mb-2 inline-flex items-center gap-2 rounded-full bg-magenta-soft px-3 py-1 text-[12px] font-bold text-magenta">
              🏷 {tagged.name}
              <button onClick={() => setTagged(null)} className="text-magenta">×</button>
            </div>
          )}
          {showTag && active && <PatientPicker branchId={isAdmin ? active : undefined} onPick={(p) => { setTagged(p); setShowTag(false); }} onClose={() => setShowTag(false)} />}
          <div className="flex items-center gap-2.5">
            <button onClick={() => setShowTag((v) => !v)} title="Etiquetar paciente" className="flex-none rounded-[11px] border border-line bg-bg px-3 py-3 text-[13px] font-bold text-muted">🏷</button>
            <input value={draft} onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && send()} placeholder="Escribe una instrucción…" className="flex-1 rounded-[11px] border border-line px-3.5 py-3 text-[13.5px] outline-none focus:border-magenta" />
            <button onClick={send} className="rounded-[11px] bg-magenta px-5 py-3 text-[13.5px] font-bold text-white">Enviar</button>
          </div>
        </div>
      </div>
    </div>
  );
}

function PatientPicker({ branchId, onPick, onClose }: { branchId?: string; onPick: (p: PatientLite) => void; onClose: () => void }) {
  const [q, setQ] = useState('');
  const [results, setResults] = useState<PatientLite[]>([]);
  useEffect(() => {
    const query = q.trim();
    if (query.length < 2) { setResults([]); return; }
    const id = setTimeout(() => {
      const branchQ = branchId ? `&branch=${branchId}` : '';
      api.get<PatientLite[]>(`/patients?q=${encodeURIComponent(query)}${branchQ}`).then(setResults).catch(() => setResults([]));
    }, 250);
    return () => clearTimeout(id);
  }, [q, branchId]);
  return (
    <div className="mb-2 rounded-[11px] border border-line bg-card p-2.5">
      <div className="mb-1.5 flex items-center gap-2">
        <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar paciente por nombre o teléfono…" className="flex-1 rounded-[9px] border border-line px-3 py-2 text-[13px] outline-none focus:border-magenta" />
        <button onClick={onClose} className="rounded-[9px] bg-bg px-2.5 py-2 text-[12px] font-bold text-muted">Cerrar</button>
      </div>
      <div className="max-h-[160px] overflow-y-auto">
        {results.map((p) => (
          <button key={p.id} onClick={() => onPick(p)} className="flex w-full items-center justify-between rounded-[9px] px-2.5 py-2 text-left text-[13px] hover:bg-bg">
            <span className="font-semibold">{p.name}</span><span className="text-[12px] text-muted">{p.phone}</span>
          </button>
        ))}
        {q.trim().length >= 2 && results.length === 0 && <div className="px-2.5 py-2 text-[12px] text-muted">Sin resultados.</div>}
      </div>
    </div>
  );
}
