import nodemailer from 'nodemailer';

const HOST = process.env.SMTP_HOST;
const USER = process.env.SMTP_USER;
const PASS = process.env.SMTP_PASS;
const FROM = process.env.MAIL_FROM ?? 'Li Estetic Center <no-reply@liestetic.do>';
const PORTAL_URL = process.env.PORTAL_URL ?? (process.env.CORS_ORIGIN ?? 'http://localhost:5173') + '/portal/login';

export const mailConfigured = () => Boolean(HOST && USER && PASS);

let transporter: nodemailer.Transporter | null = null;
function getTransport() {
  if (!mailConfigured()) return null;
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: HOST, port: Number(process.env.SMTP_PORT ?? 587),
      secure: Number(process.env.SMTP_PORT ?? 587) === 465,
      auth: { user: USER, pass: PASS },
    });
  }
  return transporter;
}

export interface MailResult { sent: boolean; mode: 'live' | 'demo'; error?: string }

/** Envía el correo de acceso al portal para que el paciente complete su ficha. */
export async function sendPatientAccess(to: string, opts: { name: string; login: string; password?: string }): Promise<MailResult> {
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

  const t = getTransport();
  if (!t) return { sent: false, mode: 'demo' }; // sin SMTP: recepción comparte las credenciales manualmente
  try {
    await t.sendMail({ from: FROM, to, subject: 'Completa tu ficha clínica · Li Estetic Center', html });
    return { sent: true, mode: 'live' };
  } catch (e) {
    return { sent: false, mode: 'live', error: e instanceof Error ? e.message : 'error' };
  }
}

export { PORTAL_URL };
