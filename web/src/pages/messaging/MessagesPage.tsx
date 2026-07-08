import { useCallback, useEffect, useState } from 'react';
import { api } from '../../lib/api';
import type { ChatMessage, Conversation } from '../../lib/types';

const FILTERS: { key: string; label: string }[] = [
  { key: 'all', label: 'Todos' },
  { key: 'INSTAGRAM', label: 'Instagram' },
  { key: 'WHATSAPP', label: 'WhatsApp' },
  { key: 'MESSENGER', label: 'Messenger' },
  { key: 'TIKTOK', label: 'TikTok' },
];

export default function MessagesPage() {
  const [filter, setFilter] = useState('all');
  const [convs, setConvs] = useState<Conversation[]>([]);
  const [currentId, setCurrentId] = useState<string | null>(null);
  const [current, setCurrent] = useState<Conversation | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState('');

  const loadConvs = useCallback(() => {
    api.get<Conversation[]>(`/messaging/conversations?channel=${filter}`).then((cs) => {
      setConvs(cs);
      setCurrentId((prev) => prev ?? cs[0]?.id ?? null);
    }).catch(() => {});
  }, [filter]);

  useEffect(() => { loadConvs(); }, [loadConvs]);

  useEffect(() => {
    if (!currentId) { setCurrent(null); setMessages([]); return; }
    api.get<{ conversation: Conversation; messages: ChatMessage[] }>(`/messaging/conversations/${currentId}`)
      .then((r) => { setCurrent(r.conversation); setMessages(r.messages); setConvs((cs) => cs.map((c) => c.id === currentId ? { ...c, unread: 0 } : c)); })
      .catch(() => {});
  }, [currentId]);

  async function send() {
    if (!draft.trim() || !currentId) return;
    const m = await api.post<ChatMessage>(`/messaging/conversations/${currentId}/messages`, { body: draft.trim() });
    setMessages((ms) => [...ms, m]);
    setDraft('');
    loadConvs();
  }

  return (
    <div className="grid animate-fade gap-4" style={{ gridTemplateColumns: '340px 1fr', height: 'calc(100vh - 150px)' }}>
      {/* Lista */}
      <div className="flex flex-col overflow-hidden rounded-base border border-line bg-card shadow-card">
        <div className="flex flex-wrap gap-1.5 border-b border-line-2 p-3.5">
          {FILTERS.map((f) => {
            const on = filter === f.key;
            return (
              <button key={f.key} onClick={() => setFilter(f.key)} className="rounded-full px-3 py-1.5 text-[12px] font-bold"
                style={{ background: on ? 'var(--magenta)' : 'var(--bg)', color: on ? '#fff' : 'var(--muted)', border: `1px solid ${on ? 'var(--magenta)' : 'var(--line)'}` }}>{f.label}</button>
            );
          })}
        </div>
        <div className="flex-1 overflow-y-auto p-2">
          {convs.map((c) => {
            const on = currentId === c.id;
            const initials = c.contactName.split(' ').map((w) => w[0]).slice(0, 2).join('').toUpperCase();
            return (
              <div key={c.id} onClick={() => setCurrentId(c.id)} className="flex cursor-pointer items-center gap-3 rounded-[11px] p-2.5" style={{ background: on ? 'var(--magenta-soft)' : 'transparent' }}>
                <div className="relative flex-none">
                  <div className="flex h-[42px] w-[42px] items-center justify-center rounded-full text-[13px] font-bold text-white" style={{ background: c.avatarColor }}>{initials}</div>
                  <span className="absolute -bottom-0.5 -right-0.5 rounded-md border-2 border-card px-1 py-0.5 text-[8px] font-extrabold text-white" style={{ background: c.channelColor }}>{c.channelBadge}</span>
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex justify-between gap-1.5"><span className="truncate text-[13.5px] font-bold">{c.contactName}</span><span className="flex-none text-[11px] text-faint">{c.time}</span></div>
                  <div className="truncate text-[12.5px] text-muted">{c.lastMessage}</div>
                </div>
                {c.unread > 0 && <span className="flex-none self-center rounded-full bg-magenta px-1.5 py-0.5 text-[10.5px] font-bold text-white">{c.unread}</span>}
              </div>
            );
          })}
          {convs.length === 0 && <div className="py-10 text-center text-sm text-muted">Sin conversaciones.</div>}
        </div>
      </div>

      {/* Chat */}
      <div className="flex flex-col overflow-hidden rounded-base border border-line bg-card shadow-card">
        {current ? (
          <>
            <div className="flex items-center gap-3 border-b border-line px-[18px] py-3.5">
              <div className="flex h-10 w-10 items-center justify-center rounded-full text-[13px] font-bold text-white" style={{ background: current.avatarColor }}>
                {current.contactName.split(' ').map((w) => w[0]).slice(0, 2).join('').toUpperCase()}
              </div>
              <div className="flex-1"><div className="text-[15px] font-extrabold">{current.contactName}</div><div className="text-xs text-muted">vía {current.channelLabel}</div></div>
              <span className="rounded-md px-2.5 py-1 text-[11px] font-extrabold text-white" style={{ background: current.channelColor }}>{current.channelBadge}</span>
            </div>
            <div className="flex flex-1 flex-col gap-3 overflow-y-auto p-5" style={{ background: 'var(--bg)' }}>
              {messages.map((m) => (
                <div key={m.id} className="flex" style={{ justifyContent: m.fromMe ? 'flex-end' : 'flex-start' }}>
                  <div>
                    <div className="max-w-[420px] rounded-2xl px-3.5 py-2.5 text-[13.5px]" style={m.fromMe ? { background: 'var(--magenta)', color: '#fff', borderBottomRightRadius: 4 } : { background: '#fff', border: '1px solid var(--line)', borderBottomLeftRadius: 4 }}>{m.body}</div>
                    <div className="mt-1 text-[10.5px] text-faint" style={{ textAlign: m.fromMe ? 'right' : 'left' }}>{m.time}</div>
                  </div>
                </div>
              ))}
            </div>
            <div className="flex items-center gap-2.5 border-t border-line p-3.5">
              <input value={draft} onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && send()} placeholder="Escribe un mensaje…" className="flex-1 rounded-[11px] border border-line px-3.5 py-3 text-[13.5px] outline-none focus:border-magenta" />
              <button onClick={send} className="rounded-[11px] bg-magenta px-5 py-3 text-[13.5px] font-bold text-white">Enviar</button>
            </div>
          </>
        ) : (
          <div className="flex flex-1 items-center justify-center text-sm text-muted">Selecciona una conversación.</div>
        )}
      </div>
    </div>
  );
}
