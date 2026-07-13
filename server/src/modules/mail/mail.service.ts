import nodemailer from 'nodemailer';

const BREVO_KEY = process.env.BREVO_API_KEY;
const HOST = process.env.SMTP_HOST;
const USER = process.env.SMTP_USER;
const PASS = process.env.SMTP_PASS;
const FROM = process.env.MAIL_FROM ?? 'Li Estetic Center <no-reply@liestetic.do>';
const PORTAL_URL = process.env.PORTAL_URL ?? (process.env.CORS_ORIGIN ?? 'http://localhost:5173') + '/portal/login';

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
export async function sendPatientAccess(to: string, opts: { name: string; login: string; password?: string; replyTo?: string }): Promise<MailResult> {
  const html = `
    <div style="font-family:Arial,sans-serif;max-width:520px;margin:auto;border:1px solid #E7E9F2;border-radius:12px;overflow:hidden">
      <div style="background:linear-gradient(135deg,#B31C86,#8E1268);color:#fff;padding:24px;text-align:center">
        <div style="font-style:italic;color:#F3C3E0">Transformando Tu Cuerpo</div>
        <h2 style="margin:6px 0 0">Li Estetic Center</h2>
      </div>
      <div style="padding:24px;color:#1C2540">
        <p>Hola <b>${opts.name}</b>,</p>
        <p>Para agilizar tu atención, completa tu <b>ficha clínica</b> desde nuestro portal antes de tu cita.</p>
        <p style="background:#FBEEF6;border-radius:10px;padding:12px 14px">
          <b>Portal:</b> <a href="${PORTAL_URL}">${PORTAL_URL}</a><br/>
          <b>Usuario:</b> ${opts.login}<br/>
          ${opts.password ? `<b>Contraseña temporal:</b> ${opts.password}` : '<i>Usa la contraseña que ya tienes.</i>'}
        </p>
        <p>Al terminar, tu esteticista recibirá la ficha para validarla contigo. ¡Gracias! 💜</p>
      </div>
    </div>`;

  return deliver(to, 'Completa tu ficha clínica · Li Estetic Center', html, opts.replyTo);
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
  opts: { name: string; service: string; date: string; time: string; reason: string; by: 'clinic' | 'patient'; branchName?: string; replyTo?: string },
): Promise<MailResult> {
  const byClinic = opts.by === 'clinic';
  const heading = byClinic ? 'Tu cita fue cancelada' : 'Cancelación de cita';
  const intro = byClinic
    ? `Hola <b>${opts.name}</b>, lamentamos informarte que tu cita fue <b>cancelada</b>.`
    : `La paciente <b>${opts.name}</b> canceló su cita.`;
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

export { PORTAL_URL };
