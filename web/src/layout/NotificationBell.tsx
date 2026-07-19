import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../lib/api';
import { Icon } from '../components/icons';
import type { NotificationsResponse } from '../lib/types';

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return 'ahora';
  if (m < 60) return `hace ${m} min`;
  const h = Math.floor(m / 60);
  if (h < 24) return `hace ${h} h`;
  const d = Math.floor(h / 24);
  return `hace ${d} d`;
}

export default function NotificationBell() {
  const [data, setData] = useState<NotificationsResponse>({ unread: 0, items: [] });
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();
  const ref = useRef<HTMLDivElement>(null);

  const load = useCallback(() => {
    api.get<NotificationsResponse>('/notifications').then(setData).catch(() => {});
  }, []);

  useEffect(() => {
    load();
    const t = setInterval(load, 30000); // sondeo cada 30s
    return () => clearInterval(t);
  }, [load]);

  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    if (open) document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, [open]);

  async function markAll() {
    await api.post('/notifications/read-all').catch(() => {});
    load();
  }

  async function openItem(id: string, link: string | null) {
    await api.post(`/notifications/${id}/read`).catch(() => {});
    setOpen(false);
    load();
    if (link) navigate(link);
  }

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        title="Notificaciones"
        className="relative flex h-[42px] w-[42px] items-center justify-center rounded-[10px] border border-line bg-bg text-muted hover:text-ink">
        <Icon name="bell" size={19} />
        {data.unread > 0 && (
          <span className="absolute -right-1 -top-1 flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-magenta px-1 text-[10.5px] font-bold text-white">
            {data.unread > 9 ? '9+' : data.unread}
          </span>
        )}
      </button>

      {open && (
        <div className="fixed inset-x-3 top-[64px] z-[60] w-auto overflow-hidden rounded-xl border border-line bg-card shadow-card animate-pop sm:absolute sm:inset-x-auto sm:right-0 sm:top-[50px] sm:w-[340px]">
          <div className="flex items-center justify-between border-b border-line px-4 py-3">
            <div className="text-[13.5px] font-extrabold">Notificaciones</div>
            {data.unread > 0 && (
              <button onClick={markAll} className="text-[12px] font-bold text-magenta hover:underline">Marcar todas leídas</button>
            )}
          </div>
          <div className="max-h-[380px] overflow-y-auto">
            {data.items.length === 0 && (
              <div className="px-4 py-8 text-center text-[13px] text-muted">Sin notificaciones.</div>
            )}
            {data.items.map((n) => (
              <button
                key={n.id}
                onClick={() => openItem(n.id, n.link)}
                className={`flex w-full items-start gap-3 border-b border-line-2 px-4 py-3 text-left hover:bg-bg ${n.read ? '' : 'bg-magenta-soft'}`}>
                <span className={`mt-1.5 h-2 w-2 flex-none rounded-full ${n.read ? 'bg-line' : 'bg-magenta'}`} />
                <div className="min-w-0 flex-1">
                  <div className="text-[13px] font-bold">{n.title}</div>
                  <div className="text-[12.5px] text-muted">{n.body}</div>
                  <div className="mt-0.5 text-[11px] text-muted">{timeAgo(n.createdAt)}</div>
                </div>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
