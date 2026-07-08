import type { Channel, PipelineStage, Prisma } from '@prisma/client';

export const CHANNEL_META: Record<Channel, { label: string; color: string; badge: string }> = {
  INSTAGRAM: { label: 'Instagram', color: '#E1306C', badge: 'IG' },
  WHATSAPP: { label: 'WhatsApp', color: '#25D366', badge: 'WA' },
  MESSENGER: { label: 'Messenger', color: '#0084FF', badge: 'MS' },
  TIKTOK: { label: 'TikTok', color: '#1C2540', badge: 'TT' },
};

export const STAGE_META: Record<PipelineStage, { label: string; color: string }> = {
  NUEVO_MENSAJE: { label: 'Nuevo mensaje', color: '#B31C86' },
  EN_CONVERSACION: { label: 'En conversación', color: '#2C7FB8' },
  COTIZADO: { label: 'Cotizado', color: '#C9880E' },
  CITA_AGENDADA: { label: 'Cita agendada', color: '#1F9D6B' },
  VENDIDO: { label: 'Vendido', color: '#8E1268' },
};

export const STAGE_ORDER: PipelineStage[] = [
  'NUEVO_MENSAJE', 'EN_CONVERSACION', 'COTIZADO', 'CITA_AGENDADA', 'VENDIDO',
];

function relTime(d: Date): string {
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  if (sameDay) return d.toLocaleTimeString('es-DO', { hour: '2-digit', minute: '2-digit' });
  const yest = new Date(now);
  yest.setDate(now.getDate() - 1);
  if (d.toDateString() === yest.toDateString()) return 'Ayer';
  return d.toLocaleDateString('es-DO', { day: '2-digit', month: 'short' });
}

export function serializeConversation(
  c: Prisma.ConversationGetPayload<{ include: { branch: true } }>,
) {
  const meta = CHANNEL_META[c.channel];
  return {
    id: c.id,
    channel: c.channel,
    channelLabel: meta.label,
    channelColor: meta.color,
    channelBadge: meta.badge,
    contactName: c.contactName,
    avatarColor: c.avatarColor,
    unread: c.unread,
    lastMessage: c.lastMessage ?? '',
    time: relTime(c.lastAt),
    branchName: c.branch.name,
  };
}

export function serializeMessage(m: Prisma.MessageGetPayload<object>) {
  return {
    id: m.id,
    fromMe: m.fromMe,
    body: m.body,
    time: m.sentAt.toLocaleTimeString('es-DO', { hour: '2-digit', minute: '2-digit' }),
  };
}
