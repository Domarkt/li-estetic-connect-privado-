import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../../lib/api';
import { useAuth } from '../../auth/AuthContext';
import { useToast } from '../../components/Toast';

type Target = 'ALL' | 'ADMIN' | 'RECEPCIONISTA' | 'ESTETICISTA';
const TARGET_LABEL: Record<Target, string> = { ALL: 'Todos', ADMIN: 'Admin', RECEPCIONISTA: 'Recepción', ESTETICISTA: 'Esteticista' };

// Destinatarios disponibles según el rol de quien escribe (nunca se incluye a sí mismo).
function targetsFor(role?: string): Target[] {
  if (role === 'ADMIN') return ['ALL', 'RECEPCIONISTA', 'ESTETICISTA'];
  if (role === 'RECEPCIONISTA') return ['ALL', 'ADMIN', 'ESTETICISTA'];
  if (role === 'ESTETICISTA') return ['ALL', 'ADMIN', 'RECEPCIONISTA'];
  return ['ALL'];
}

interface Thread { branchId: string; name: string; place: string; dotColor: string; lastMessage: string | null; lastAt: string | null; unread: number }
interface Attachment { data: string; name: string; kind: 'image' | 'video' | 'file'; mime: string }
interface Msg { id: string; body: string; senderName: string; senderRole: string; target: string; mine: boolean; patient: { id: string; name: string } | null; attachment: Attachment | null; time: string }
interface PatientLite { id: string; name: string; phone: string }

const MAX_FILE_MB = 8;
function fileKind(mime: string): Attachment['kind'] {
  if (mime.startsWith('image/')) return 'image';
  if (mime.startsWith('video/')) return 'video';
  return 'file';
}

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
  const [file, setFile] = useState<Attachment | null>(null);
  const [sending, setSending] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

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

  function onPickFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    e.target.value = ''; // permite volver a elegir el mismo archivo
    if (!f) return;
    if (f.size > MAX_FILE_MB * 1024 * 1024) { toast(`El archivo supera el límite de ${MAX_FILE_MB} MB`); return; }
    const reader = new FileReader();
    reader.onload = () => setFile({ data: String(reader.result), name: f.name, kind: fileKind(f.type), mime: f.type || 'application/octet-stream' });
    reader.onerror = () => toast('No se pudo leer el archivo');
    reader.readAsDataURL(f);
  }

  async function send() {
    if ((!draft.trim() && !file) || !active || sending) return;
    setSending(true);
    try {
      await api.post(`/team-chat/threads/${active}/messages`, { body: draft.trim() || undefined, patientId: tagged?.id, targetRole: target, attachment: file ?? undefined });
      setDraft(''); setTagged(null); setShowTag(false); setFile(null);
      loadMessages(active); loadThreads();
    } catch (e) { toast(e instanceof Error ? e.message : 'Error'); }
    finally { setSending(false); }
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
                  {m.attachment && <AttachmentView att={m.attachment} mine={m.mine} />}
                  {m.body && <div className={m.attachment ? 'mt-1.5' : ''}>{m.body}</div>}
                </div>
                <div className="mt-1 text-[10.5px] text-faint" style={{ textAlign: m.mine ? 'right' : 'left' }}>{m.time}</div>
              </div>
            </div>
          ))}
          <div ref={endRef} />
        </div>

        {/* Composer */}
        <div className="border-t border-line p-3.5">
          {/* Destinatario: cualquier rol puede dirigir el mensaje. */}
          <div className="mb-2 flex items-center gap-1.5">
            <span className="text-[11.5px] font-bold text-muted">Para:</span>
            {targetsFor(staff?.role).map((k) => {
              const on = target === k;
              return (
                <button key={k} onClick={() => setTarget(k)} className="rounded-full px-2.5 py-1 text-[11.5px] font-bold"
                  style={{ background: on ? 'var(--magenta)' : 'var(--bg)', color: on ? '#fff' : 'var(--muted)', border: `1px solid ${on ? 'var(--magenta)' : 'var(--line)'}` }}>
                  {TARGET_LABEL[k]}
                </button>
              );
            })}
          </div>
          {tagged && (
            <div className="mb-2 inline-flex items-center gap-2 rounded-full bg-magenta-soft px-3 py-1 text-[12px] font-bold text-magenta">
              🏷 {tagged.name}
              <button onClick={() => setTagged(null)} className="text-magenta">×</button>
            </div>
          )}
          {file && (
            <div className="mb-2 flex items-center gap-2 rounded-[10px] border border-line bg-bg px-3 py-2 text-[12px]">
              <span>{file.kind === 'image' ? '📷' : file.kind === 'video' ? '🎬' : '📎'}</span>
              <span className="flex-1 truncate font-semibold">{file.name}</span>
              <button onClick={() => setFile(null)} className="font-bold text-muted hover:text-danger">Quitar</button>
            </div>
          )}
          {showTag && active && <PatientPicker branchId={isAdmin ? active : undefined} onPick={(p) => { setTagged(p); setShowTag(false); }} onClose={() => setShowTag(false)} />}
          <input ref={fileRef} type="file" accept="image/*,video/*,.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.csv" onChange={onPickFile} className="hidden" />
          <div className="flex items-center gap-2.5">
            <button onClick={() => setShowTag((v) => !v)} title="Etiquetar paciente" className="flex-none rounded-[11px] border border-line bg-bg px-3 py-3 text-[13px] font-bold text-muted">🏷</button>
            <button onClick={() => fileRef.current?.click()} title="Adjuntar foto, video o documento" className="flex-none rounded-[11px] border border-line bg-bg px-3 py-3 text-[13px] font-bold text-muted">📎</button>
            <input value={draft} onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && send()} placeholder="Escribe una instrucción…" className="flex-1 rounded-[11px] border border-line px-3.5 py-3 text-[13.5px] outline-none focus:border-magenta" />
            <button onClick={send} disabled={sending} className="rounded-[11px] bg-magenta px-5 py-3 text-[13.5px] font-bold text-white disabled:opacity-60">{sending ? '…' : 'Enviar'}</button>
          </div>
        </div>
      </div>
    </div>
  );
}

function AttachmentView({ att, mine }: { att: Attachment; mine: boolean }) {
  if (att.kind === 'image') {
    return <a href={att.data} target="_blank" rel="noopener noreferrer"><img src={att.data} alt={att.name} className="max-h-[240px] max-w-full rounded-[10px]" /></a>;
  }
  if (att.kind === 'video') {
    return <video src={att.data} controls className="max-h-[260px] max-w-full rounded-[10px]" />;
  }
  return (
    <a href={att.data} download={att.name}
      className={`flex items-center gap-2 rounded-[10px] px-3 py-2 text-[12.5px] font-bold ${mine ? 'bg-white/20 text-white' : 'bg-bg text-navy'}`}>
      <span className="text-[15px]">📎</span>
      <span className="truncate">{att.name}</span>
      <span className={`ml-1 text-[11px] ${mine ? 'text-white/80' : 'text-muted'}`}>Descargar</span>
    </a>
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
