import nodemailer from 'nodemailer';

const BREVO_KEY = process.env.BREVO_API_KEY;
const HOST = process.env.SMTP_HOST;
const USER = process.env.SMTP_USER;
const PASS = process.env.SMTP_PASS;
const FROM = process.env.MAIL_FROM ?? 'Li Estetic Center <no-reply@liestetic.do>';
// Enlace del portal del paciente en los correos. Usa el dominio oficial;
// ignora el env si apunta a un dominio viejo (pages.dev / netlify / localhost).
const PORTAL_URL = (() => {
  const e = process.env.PORTAL_URL;
  if (e && !/pages\.dev|netlify|localhost/i.test(e)) return e;
  return 'https://sistema.liesteticcenter.com/portal/login';
})();

// Correo configurado si hay API de Brevo (HTTP, funciona en hosts que bloquean SMTP) o SMTP directo.
export const mailConfigured = () => Boolean(BREVO_KEY || (HOST && USER && PASS));

/** Separa "Nombre <correo>" en { name, email } para la API de Brevo. */
function parseFrom(): { email: string; name?: string } {
  const m = FROM.match(/^\s*(.*?)\s*<([^>]+)>\s*$/);
  if (m) return { name: m[1] || undefined, email: m[2] };
  return { email: FROM.trim() };
}

/** Envío vía API HTTP de Brevo (puerto 443, no usa SMTP). */
async function sendViaBrevo(to: string, subject: string, html: string, replyTo?: string): Promise<MailResult> {
  try {
    const res = await fetch('https://api.brevo.com/v3/smtp/email', {
      method: 'POST',
      headers: { 'api-key': BREVO_KEY!, 'Content-Type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({ sender: parseFrom(), to: [{ email: to }], subject, htmlContent: html, ...(replyTo ? { replyTo: { email: replyTo } } : {}) }),
    });
    if (res.ok) return { sent: true, mode: 'live' };
    const body = await res.text().catch(() => '');
    return { sent: false, mode: 'live', error: `Brevo ${res.status}: ${body.slice(0, 200)}` };
  } catch (e) {
    return { sent: false, mode: 'live', error: e instanceof Error ? e.message : 'error' };
  }
}

let transporter: nodemailer.Transporter | null = null;
function getTransport() {
  if (!(HOST && USER && PASS)) return null;
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: HOST, port: Number(process.env.SMTP_PORT ?? 587),
      secure: Number(process.env.SMTP_PORT ?? 587) === 465,
      auth: { user: USER, pass: PASS },
    });
  }
  return transporter;
}

/** Envía un correo por el canal disponible: Brevo (HTTP) → SMTP → demo. replyTo = correo de la sucursal. */
async function deliver(to: string, subject: string, html: string, replyTo?: string): Promise<MailResult> {
  if (BREVO_KEY) return sendViaBrevo(to, subject, html, replyTo);
  const t = getTransport();
  if (!t) return { sent: false, mode: 'demo' };
  try {
    await t.sendMail({ from: FROM, to, subject, html, ...(replyTo ? { replyTo } : {}) });
    return { sent: true, mode: 'live' };
  } catch (e) {
    return { sent: false, mode: 'live', error: e instanceof Error ? e.message : 'error' };
  }
}

export interface MailResult { sent: boolean; mode: 'live' | 'demo'; error?: string }

/** Envía el correo de acceso al portal para que el paciente complete su ficha. */
/**
 * Acceso al portal del paciente. NO expone credenciales: el paciente entra con
 * su propio CORREO (este) y su TELÉFONO. Incluye un breve instructivo.
 */
export async function sendPatientAccess(to: string, opts: { name: string; phone: string; replyTo?: string }): Promise<MailResult> {
  const html = `
    <div style="font-family:Arial,sans-serif;max-width:520px;margin:auto;border:1px solid #E7E9F2;border-radius:12px;overflow:hidden">
      <div style="background:linear-gradient(135deg,#B31C86,#8E1268);color:#fff;padding:24px;text-align:center">
        <div style="font-style:italic;color:#F3C3E0">Transformando Tu Cuerpo</div>
        <h2 style="margin:6px 0 0">Li Estetic Center</h2>
      </div>
      <div style="padding:24px;color:#1C2540">
        <p>Hola <b>${opts.name}</b>, ¡ya tienes acceso a tu <b>portal del paciente</b>! 💜</p>
        <p>Ahí ves tu proceso, tus citas, tu ficha y tus paquetes.</p>
        <div style="background:#FBEEF6;border-radius:10px;padding:14px 16px">
          <b>Cómo entrar:</b>
          <ol style="margin:8px 0 0;padding-left:18px">
            <li>Abre: <a href="${PORTAL_URL}">${PORTAL_URL}</a></li>
            <li>Escribe tu <b>correo</b> (este) y tu <b>teléfono</b> (${opts.phone}).</li>
            <li>Te enviamos un <b>código de 6 dígitos</b> a este correo.</li>
            <li>Escríbelo y listo. El código vence en 10 minutos.</li>
          </ol>
        </div>
        <p style="margin-top:14px;font-size:12.5px;color:#6A7089">Por tu seguridad, tu acceso es personal. No compartas este correo.</p>
      </div>
    </div>`;
  return deliver(to, 'Tu acceso al portal · Li Estetic Center', html, opts.replyTo);
}

/**
 * Código de un solo uso para entrar al portal. Reemplaza al acceso por
 * correo+teléfono: esos datos los puede conocer un tercero, y detrás está la
 * ficha clínica. El código vive 10 minutos y sirve una sola vez.
 */
export async function sendPatientOtp(to: string, opts: { name: string; code: string; minutes: number; replyTo?: string }): Promise<MailResult> {
  const html = `
    <div style="font-family:Arial,sans-serif;max-width:520px;margin:auto;border:1px solid #E7E9F2;border-radius:12px;overflow:hidden">
      <div style="background:linear-gradient(135deg,#B31C86,#8E1268);color:#fff;padding:24px;text-align:center">
        <div style="font-style:italic;color:#F3C3E0">Transformando Tu Cuerpo</div>
        <h2 style="margin:6px 0 0">Li Estetic Center</h2>
      </div>
      <div style="padding:24px;color:#1C2540;text-align:center">
        <p style="text-align:left">Hola <b>${opts.name}</b>, este es tu código para entrar a tu portal:</p>
        <div style="background:#FBEEF6;border-radius:12px;padding:18px;margin:16px 0">
          <div style="font-size:34px;font-weight:800;letter-spacing:8px;color:#B31C86">${opts.code}</div>
        </div>
        <p style="text-align:left">Vence en <b>${opts.minutes} minutos</b> y solo se puede usar una vez.</p>
        <p style="text-align:left;font-size:12.5px;color:#6A7089">Si no fuiste tú quien lo pidió, ignora este mensaje y no compartas el código con nadie. El personal de Li Estetic Center nunca te lo pedirá.</p>
      </div>
    </div>`;
  return deliver(to, `${opts.code} es tu código de acceso · Li Estetic Center`, html, opts.replyTo);
}

/**
 * Confirmación de cita SIN acceso al portal (para cualquier agendamiento).
 * El acceso al sistema y la ficha se entregan cuando el paciente se presenta y paga.
 */
export async function sendAppointmentConfirmation(
  to: string,
  opts: { name: string; service: string; date: string; time: string; code: string; branchName?: string; branchPlace?: string; replyTo?: string },
): Promise<MailResult> {
  const html = `
    <div style="font-family:Arial,sans-serif;max-width:520px;margin:auto;border:1px solid #E7E9F2;border-radius:12px;overflow:hidden">
      <div style="background:linear-gradient(135deg,#B31C86,#8E1268);color:#fff;padding:24px;text-align:center">
        <div style="font-style:italic;color:#F3C3E0">Transformando Tu Cuerpo</div>
        <h2 style="margin:6px 0 0">Li Estetic Center</h2>
      </div>
      <div style="padding:24px;color:#1C2540">
        <p>Hola <b>${opts.name}</b>, ¡tu cita quedó agendada! 💜</p>
        <p style="background:#F0F6FB;border-radius:10px;padding:12px 14px">
          <b>Servicio:</b> ${opts.service}<br/>
          <b>Fecha:</b> ${opts.date} · <b>Hora:</b> ${opts.time}<br/>
          ${opts.branchName ? `<b>Sucursal:</b> ${opts.branchName}${opts.branchPlace ? ` · ${opts.branchPlace}` : ''}<br/>` : ''}
          <b>Código de tu turno:</b> <span style="font-size:18px;letter-spacing:2px;font-weight:bold;color:#B31C86">${opts.code}</span>
        </p>
        <p>Preséntalo al llegar. Cuando visites la estética y realices tu primer servicio, te daremos acceso a tu <b>portal del paciente</b> para ver tu proceso y tu ficha. ¡Te esperamos!</p>
      </div>
    </div>`;
  return deliver(to, `Tu cita en Li Estetic Center · código ${opts.code}`, html, opts.replyTo);
}

export interface ReceiptMail {
  id: string; ncf: string | null; date: string; patient: string;
  items: { name: string; qty: number; total: number }[];
  subtotal: number; itbis: number; total: number; method: string;
  payments?: { method: string; amount: number }[];
  branchName: string; branchPlace: string; branchAddress: string; branchPhone: string; rnc: string;
  // Comprobante fiscal: consumo (B02) o crédito fiscal (B01, a nombre del cliente).
  ncfLabel?: string; itbisApplied?: boolean;
  clientRnc?: string | null; clientName?: string | null;
}

const rd = (n: number) => `RD$${n.toLocaleString('en-US')}`;

/**
 * Recibo de pago por correo. Reemplaza al recibo impreso: incluye NCF, el detalle
 * por servicio, el desglose de métodos de pago y los datos fiscales de la sucursal.
 */
export async function sendReceipt(to: string, r: ReceiptMail, replyTo?: string): Promise<MailResult> {
  const lineas = r.items
    .map((it) => `<tr>
      <td style="padding:7px 0;border-bottom:1px solid #EFF1F7">${it.name}${it.qty > 1 ? ` <span style="color:#6A7089">x${it.qty}</span>` : ''}</td>
      <td style="padding:7px 0;border-bottom:1px solid #EFF1F7;text-align:right;white-space:nowrap">${rd(it.total)}</td>
    </tr>`)
    .join('');

  const desglose = (r.payments ?? []).length > 1
    ? `<p style="margin:10px 0 0;color:#6A7089;font-size:13px">Pago dividido: ${(r.payments ?? []).map((p) => `${p.method} ${rd(p.amount)}`).join(' · ')}</p>`
    : '';

  const html = `
    <div style="font-family:Arial,sans-serif;max-width:520px;margin:auto;border:1px solid #E7E9F2;border-radius:12px;overflow:hidden">
      <div style="background:linear-gradient(135deg,#B31C86,#8E1268);color:#fff;padding:22px;text-align:center">
        <div style="font-style:italic;color:#F3C3E0">Transformando Tu Cuerpo</div>
        <h2 style="margin:6px 0 0">Li Estetic Center</h2>
        <div style="font-size:13px;color:#F3C3E0;margin-top:4px">${r.branchName} · ${r.branchPlace}</div>
      </div>
      <div style="padding:22px;color:#1C2540">
        <p style="margin:0 0 4px">Hola <b>${r.patient}</b>, gracias por tu visita 💜</p>
        <p style="margin:0 0 16px;color:#6A7089;font-size:13px">Este es tu comprobante de pago.</p>

        <div style="background:#F5F6FB;border-radius:10px;padding:12px 14px;font-size:13px;margin-bottom:16px">
          <b>Recibo:</b> ${r.id}${r.ncf ? ` &nbsp;·&nbsp; <b>NCF:</b> ${r.ncf}` : ''}<br/>
          <b>Fecha:</b> ${r.date}${r.ncfLabel ? `<br/><b>Comprobante:</b> ${r.ncfLabel}` : ''}
          ${r.clientName ? `<br/><b>Facturar a:</b> ${r.clientName}${r.clientRnc ? ` &nbsp;·&nbsp; <b>RNC/Cédula:</b> ${r.clientRnc}` : ''}` : ''}
        </div>

        <table style="width:100%;border-collapse:collapse;font-size:14px">${lineas}</table>

        <table style="width:100%;border-collapse:collapse;font-size:14px;margin-top:12px">
          <tr><td style="padding:3px 0;color:#6A7089">Subtotal</td><td style="padding:3px 0;text-align:right">${rd(r.subtotal)}</td></tr>
          <tr><td style="padding:3px 0;color:#6A7089">${r.itbisApplied === false ? 'ITBIS' : 'ITBIS (18%)'}</td><td style="padding:3px 0;text-align:right">${r.itbisApplied === false ? 'No aplica' : rd(r.itbis)}</td></tr>
          <tr>
            <td style="padding:9px 0 0;font-weight:bold;font-size:16px;border-top:2px solid #1C2540">Total</td>
            <td style="padding:9px 0 0;font-weight:bold;font-size:16px;text-align:right;border-top:2px solid #1C2540;color:#B31C86">${rd(r.total)}</td>
          </tr>
        </table>
        <p style="margin:10px 0 0;font-size:13px"><b>Forma de pago:</b> ${r.method}</p>
        ${desglose}

        <div style="margin-top:20px;padding-top:14px;border-top:1px solid #E7E9F2;color:#9AA0B4;font-size:12px;line-height:1.6">
          ${r.branchName} · ${r.branchAddress}<br/>
          Tel. ${r.branchPhone} · RNC ${r.rnc}<br/>
          Conserva este comprobante. Si tienes alguna duda, respóndenos este correo.
        </div>
      </div>
    </div>`;
  return deliver(to, `Tu recibo ${r.id} · Li Estetic Center`, html, replyTo);
}

/** Confirmación de cita para cliente nuevo: código de la cita + acceso al portal para completar la ficha. */
export async function sendAppointmentAccess(
  to: string,
  opts: { name: string; login: string; password?: string; service: string; date: string; time: string; code: string; replyTo?: string },
): Promise<MailResult> {
  const html = `
    <div style="font-family:Arial,sans-serif;max-width:520px;margin:auto;border:1px solid #E7E9F2;border-radius:12px;overflow:hidden">
      <div style="background:linear-gradient(135deg,#B31C86,#8E1268);color:#fff;padding:24px;text-align:center">
        <div style="font-style:italic;color:#F3C3E0">Transformando Tu Cuerpo</div>
        <h2 style="margin:6px 0 0">Li Estetic Center</h2>
      </div>
      <div style="padding:24px;color:#1C2540">
        <p>Hola <b>${opts.name}</b>, ¡tu cita está confirmada! 💜</p>
        <p style="background:#F0F6FB;border-radius:10px;padding:12px 14px">
          <b>Servicio:</b> ${opts.service}<br/>
          <b>Fecha:</b> ${opts.date} · <b>Hora:</b> ${opts.time}<br/>
          <b>Código de tu turno:</b> <span style="font-size:18px;letter-spacing:2px;font-weight:bold;color:#B31C86">${opts.code}</span>
        </p>
        <p>Preséntalo al llegar. Además, <b>completa tu ficha clínica</b> desde el portal antes de tu cita:</p>
        <p style="background:#FBEEF6;border-radius:10px;padding:12px 14px">
          <b>Portal:</b> <a href="${PORTAL_URL}">${PORTAL_URL}</a><br/>
          <b>Usuario:</b> ${opts.login}<br/>
          ${opts.password ? `<b>Contraseña temporal:</b> ${opts.password}` : '<i>Usa la contraseña que ya tienes.</i>'}
        </p>
        <p>Tu esteticista validará la ficha contigo. ¡Te esperamos!</p>
      </div>
    </div>`;
  return deliver(to, `Tu cita en Li Estetic Center · código ${opts.code}`, html, opts.replyTo);
}

/**
 * Aviso de cancelación de cita. `by` define el texto:
 *  - 'clinic'  → correo AL PACIENTE (la clínica canceló su cita).
 *  - 'patient' → correo A LA SUCURSAL (el paciente canceló; aviso al negocio).
 */
export async function sendAppointmentCancelled(
  to: string,
  opts: { name: string; service: string; date: string; time: string; reason: string; by: 'clinic' | 'patient'; sex?: string | null; branchName?: string; replyTo?: string },
): Promise<MailResult> {
  const byClinic = opts.by === 'clinic';
  const heading = byClinic ? 'Tu cita fue cancelada' : 'Cancelación de cita';
  // "El paciente" / "La paciente" según el sexo (neutral si no está definido).
  const pacienteNoun = opts.sex === 'M' ? 'El paciente' : opts.sex === 'F' ? 'La paciente' : 'El/La paciente';
  const intro = byClinic
    ? `Hola <b>${opts.name}</b>, lamentamos informarte que tu cita fue <b>cancelada</b>.`
    : `${pacienteNoun} <b>${opts.name}</b> canceló su cita.`;
  const footer = byClinic
    ? 'Escríbenos o llámanos para reagendar cuando gustes. 💜'
    : 'Registrado en el sistema. Puedes reasignar el turno.';
  const html = `
    <div style="font-family:Arial,sans-serif;max-width:520px;margin:auto;border:1px solid #E7E9F2;border-radius:12px;overflow:hidden">
      <div style="background:linear-gradient(135deg,#B31C86,#8E1268);color:#fff;padding:24px;text-align:center">
        <div style="font-style:italic;color:#F3C3E0">Transformando Tu Cuerpo</div>
        <h2 style="margin:6px 0 0">Li Estetic Center</h2>
      </div>
      <div style="padding:24px;color:#1C2540">
        <h3 style="margin:0 0 8px;color:#C0392B">${heading}</h3>
        <p>${intro}</p>
        <p style="background:#FBECEC;border-radius:10px;padding:12px 14px">
          <b>Servicio:</b> ${opts.service}<br/>
          <b>Fecha:</b> ${opts.date} · <b>Hora:</b> ${opts.time}<br/>
          ${opts.branchName ? `<b>Sucursal:</b> ${opts.branchName}<br/>` : ''}
          <b>Motivo:</b> ${opts.reason}
        </p>
        <p>${footer}</p>
      </div>
    </div>`;
  return deliver(to, `Cita cancelada · Li Estetic Center`, html, opts.replyTo);
}

/** Feedback de calificación de un paciente → correo a la sucursal. */
export async function sendRatingFeedback(
  to: string,
  opts: { name: string; service: string; date: string; stars: number; comment?: string; branchName?: string; replyTo?: string },
): Promise<MailResult> {
  const starRow = '★'.repeat(opts.stars) + '☆'.repeat(5 - opts.stars);
  const html = `
    <div style="font-family:Arial,sans-serif;max-width:520px;margin:auto;border:1px solid #E7E9F2;border-radius:12px;overflow:hidden">
      <div style="background:linear-gradient(135deg,#B31C86,#8E1268);color:#fff;padding:24px;text-align:center">
        <div style="font-style:italic;color:#F3C3E0">Transformando Tu Cuerpo</div>
        <h2 style="margin:6px 0 0">Li Estetic Center</h2>
      </div>
      <div style="padding:24px;color:#1C2540">
        <h3 style="margin:0 0 8px">Nueva calificación de un paciente</h3>
        <p style="background:#FBEEF6;border-radius:10px;padding:12px 14px">
          <b>Paciente:</b> ${opts.name}<br/>
          <b>Servicio:</b> ${opts.service}<br/>
          <b>Fecha:</b> ${opts.date}<br/>
          ${opts.branchName ? `<b>Sucursal:</b> ${opts.branchName}<br/>` : ''}
          <b>Calificación:</b> <span style="color:#F5B301;font-size:18px">${starRow}</span> (${opts.stars}/5)
        </p>
        ${opts.comment ? `<p><b>Comentario:</b><br/>“${opts.comment}”</p>` : ''}
      </div>
    </div>`;
  return deliver(to, `Calificación ${opts.stars}/5 · ${opts.name}`, html, opts.replyTo);
}

/** Alerta genérica (asunto + encabezado + líneas). Para avisos internos a la sucursal. */
export async function sendGenericAlert(
  to: string,
  opts: { subject: string; heading: string; lines: string[]; replyTo?: string },
): Promise<MailResult> {
  const html = `
    <div style="font-family:Arial,sans-serif;max-width:520px;margin:auto;border:1px solid #E7E9F2;border-radius:12px;overflow:hidden">
      <div style="background:linear-gradient(135deg,#B31C86,#8E1268);color:#fff;padding:24px;text-align:center">
        <div style="font-style:italic;color:#F3C3E0">Transformando Tu Cuerpo</div>
        <h2 style="margin:6px 0 0">Li Estetic Center</h2>
      </div>
      <div style="padding:24px;color:#1C2540">
        <h3 style="margin:0 0 10px">${opts.heading}</h3>
        <div style="background:#FBEEF6;border-radius:10px;padding:12px 14px">
          ${opts.lines.map((l) => `<div style="margin:2px 0">${l}</div>`).join('')}
        </div>
      </div>
    </div>`;
  return deliver(to, opts.subject, html, opts.replyTo);
}

export { PORTAL_URL };
