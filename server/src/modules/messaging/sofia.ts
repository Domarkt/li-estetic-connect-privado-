import Anthropic from '@anthropic-ai/sdk';
import type { Branch, Channel } from '@prisma/client';
import { prisma } from '../../db/prisma.js';

/**
 * "Sofia" — asistente de IA de Li Estetic para WhatsApp, Instagram y Messenger.
 * Modo HÍBRIDO: responde preguntas frecuentes (horarios, ubicación, precios,
 * servicios, cómo agendar) y ESCALA a una persona todo lo delicado o incierto
 * (citas concretas, temas médicos/clínicos, cobros/saldos, quejas, datos
 * personales). Nunca inventa: si no está segura, escala.
 */

const MODEL = process.env.SOFIA_MODEL || 'claude-opus-5';

let client: Anthropic | null = null;
function getClient(): Anthropic | null {
  if (process.env.SOFIA_ENABLED === 'false') return null;
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return null;
  if (!client) client = new Anthropic({ apiKey });
  return client;
}

export function sofiaConfigured(): boolean {
  return getClient() !== null;
}

export interface SofiaDecision {
  responder: boolean; // true = Sofia contesta con confianza; false = escala a humano
  mensaje: string; // texto a enviar al cliente (cortés; en escalación, línea de espera)
  motivo: string; // motivo interno de la escalación (no se muestra al cliente)
}

function fmtRD(n: number): string {
  return 'RD$' + n.toLocaleString('es-DO');
}

function hoursText(branch: Branch): string {
  const bh = branch.businessHours as { weekdays?: { open?: string; close?: string; closed?: boolean }; saturday?: { open?: string; close?: string; closed?: boolean }; sunday?: { open?: string; close?: string; closed?: boolean } } | null;
  if (!bh) return 'Horario: consultar con la sucursal.';
  const line = (label: string, d?: { open?: string; close?: string; closed?: boolean }) =>
    !d || d.closed ? `${label}: cerrado` : `${label}: ${d.open ?? '?'} a ${d.close ?? '?'}`;
  return [line('Lun–Vie', bh.weekdays), line('Sábado', bh.saturday), line('Domingo', bh.sunday)].join(' · ');
}

async function buildSystemPrompt(branch: Branch, channel: Channel): Promise<string> {
  const items = await prisma.catalogItem.findMany({
    where: { active: true, showInPortal: true, kind: { in: ['SERVICIO', 'COMBO', 'PAQUETE'] as never } },
    select: { name: true, price: true, category: true, kind: true },
    orderBy: [{ category: 'asc' }, { name: 'asc' }],
    take: 60,
  });
  const servicios = items.length
    ? items.map((i) => `- ${i.name}${i.category ? ` (${i.category})` : ''}${i.price > 0 ? ` — ${fmtRD(i.price)}` : ''}`).join('\n')
    : '(catálogo no disponible en este momento)';

  return `Eres "Sofía", asistente virtual de Li Estetic (centro de estética en República Dominicana). Atiendes por ${channel === 'WHATSAPP' ? 'WhatsApp' : channel === 'INSTAGRAM' ? 'Instagram' : 'Messenger'} a clientes y prospectos.

SUCURSAL QUE ATIENDES:
- ${branch.name} — ${branch.place}
- Dirección: ${branch.address}
- Teléfono: ${branch.phone}
- ${hoursText(branch)}

SERVICIOS Y PRECIOS (referencia; los precios pueden variar por promoción):
${servicios}

TU FORMA DE SER:
- Cálida, profesional y breve. Trato formal: "Sr." / "Sra.", de usted.
- Español dominicano natural. Puedes usar 1 emoji suave (💗, ✨) como máximo por mensaje.
- No repitas saludos en cada mensaje si la conversación ya empezó.

QUÉ PUEDES RESPONDER SOLA (responder=true):
- Horarios, ubicación, cómo llegar, teléfono.
- Qué servicios/tratamientos ofrecemos y sus precios de referencia.
- Explicar en qué consiste un tratamiento a nivel general y no médico.
- Cómo agendar (invitar a dejar nombre y el servicio de interés para que una asesora confirme el turno).
- Promociones vigentes SOLO si aparecen arriba.

CUÁNDO ESCALAR A UNA PERSONA (responder=false):
- Agendar, confirmar, mover o cancelar una cita en fecha/hora concreta.
- Cualquier tema médico/clínico, contraindicaciones, resultados, complicaciones, embarazo, medicamentos.
- Pagos, saldos, cobros, reembolsos, facturación.
- Quejas, reclamos o clientas molestas.
- Datos personales sensibles (cédula, dirección exacta, historial).
- Cualquier cosa que NO puedas responder con certeza a partir de la información de arriba. Ante la duda, ESCALA. Nunca inventes precios, fechas ni promociones.

FORMATO DE RESPUESTA (obligatorio):
Responde ÚNICAMENTE con un objeto JSON válido, sin texto fuera del JSON, con esta forma exacta:
{"responder": true|false, "mensaje": "<texto para el cliente>", "motivo": "<motivo interno si escalas, o cadena vacía>"}
- Si responder=true: "mensaje" es tu respuesta completa al cliente y "motivo" es "".
- Si responder=false: "mensaje" es una línea breve y cortés de espera (ej. "Con gusto la ayudo con eso 💗 En un momento una de nuestras asesoras le atiende por aquí."), y "motivo" explica en pocas palabras por qué escalas (para el staff).`;
}

interface HistoryMsg { fromMe: boolean; body: string }

/** Genera la decisión de Sofía para el último mensaje entrante. */
export async function generateSofiaReply(
  branch: Branch,
  channel: Channel,
  history: HistoryMsg[],
): Promise<SofiaDecision | null> {
  const ac = getClient();
  if (!ac) return null;

  const system = await buildSystemPrompt(branch, channel);
  const messages: Anthropic.MessageParam[] = history
    .slice(-12)
    .map((m) => ({ role: m.fromMe ? ('assistant' as const) : ('user' as const), content: m.body }));
  // La API exige que el primer mensaje sea 'user'.
  while (messages.length && messages[0].role === 'assistant') messages.shift();
  if (!messages.length) return null;

  try {
    const res = await ac.messages.create({
      model: MODEL,
      max_tokens: 1024,
      output_config: { effort: 'low' },
      system,
      messages,
    });
    const text = res.content.find((b): b is Anthropic.TextBlock => b.type === 'text')?.text ?? '';
    return parseDecision(text);
  } catch (err) {
    console.error('[sofia] fallo al generar respuesta:', err instanceof Error ? err.message : err);
    return null;
  }
}

/** Extrae el JSON de la respuesta; si algo falla, escala por seguridad. */
function parseDecision(text: string): SofiaDecision {
  try {
    const start = text.indexOf('{');
    const end = text.lastIndexOf('}');
    if (start >= 0 && end > start) {
      const obj = JSON.parse(text.slice(start, end + 1)) as Partial<SofiaDecision>;
      const mensaje = (obj.mensaje ?? '').toString().trim();
      if (mensaje) {
        return {
          responder: obj.responder === true,
          mensaje,
          motivo: (obj.motivo ?? '').toString(),
        };
      }
    }
  } catch {
    // cae al fallback
  }
  return { responder: false, mensaje: '', motivo: 'No se pudo interpretar la respuesta de la IA.' };
}
