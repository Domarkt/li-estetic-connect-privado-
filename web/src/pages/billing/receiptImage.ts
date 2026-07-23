import { fmtRD, type Receipt } from '../../lib/types';

/**
 * Dibuja el recibo como una imagen PNG (sin librerías externas), para poder
 * ENVIARLO por WhatsApp como imagen —no como texto—. En el celular se comparte
 * directo con el menú nativo (navigator.share); en escritorio se descarga.
 *
 * Se dibuja a mano en un <canvas> porque html2canvas/PDF traería dependencias y
 * problemas con la CSP; aquí todo es local y nítido (escala 2x).
 */
const W = 720;            // ancho lógico del recibo
const PAD = 48;           // margen interno
const SCALE = 2;          // nitidez (retina)
const INK = '#1C2540';
const MUT = '#6A7089';
const LINE = '#C8CCDA';
const MAGENTA = '#B31C86';

function loadLogo(): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = '/li-logo.png'; // mismo origen: no contamina el canvas
  });
}

export async function buildReceiptImage(r: Receipt): Promise<Blob> {
  const logo = await loadLogo();
  // Lienzo generoso; al final se recorta a la altura realmente usada.
  const big = document.createElement('canvas');
  big.width = W * SCALE;
  big.height = 2600 * SCALE;
  const ctx = big.getContext('2d')!;
  ctx.scale(SCALE, SCALE);
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, W, 2600);
  ctx.textBaseline = 'alphabetic';

  let y = PAD;
  const cx = W / 2;
  const left = PAD;
  const right = W - PAD;

  const text = (s: string, x: number, align: CanvasTextAlign, font: string, color: string) => {
    ctx.font = font; ctx.fillStyle = color; ctx.textAlign = align; ctx.fillText(s, x, y);
  };
  const rowKV = (k: string, v: string, opts: { bold?: boolean; size?: number; color?: string } = {}) => {
    const size = opts.size ?? 15;
    ctx.font = `400 ${size}px Arial`; ctx.fillStyle = MUT; ctx.textAlign = 'left'; ctx.fillText(k, left, y);
    ctx.font = `${opts.bold === false ? 400 : 700} ${size}px Arial`; ctx.fillStyle = opts.color ?? INK; ctx.textAlign = 'right'; ctx.fillText(v, right, y);
  };
  const hr = (dashed = true) => {
    ctx.strokeStyle = dashed ? LINE : INK; ctx.lineWidth = dashed ? 1 : 2;
    ctx.setLineDash(dashed ? [5, 4] : []);
    ctx.beginPath(); ctx.moveTo(left, y); ctx.lineTo(right, y); ctx.stroke();
    ctx.setLineDash([]);
  };

  // ── Encabezado ──
  if (logo) {
    const h = 46; const w = (logo.width / logo.height) * h;
    ctx.drawImage(logo, cx - w / 2, y, w, h); y += h + 18;
  } else { y += 6; }
  text('LI ESTETIC CENTER', cx, 'center', '800 20px Arial', INK); y += 22;
  text(`${r.branchName} · ${r.branchAddress}`, cx, 'center', '400 13px Arial', MUT); y += 17;
  text(`RNC ${r.rnc} · Tel. ${r.branchPhone}`, cx, 'center', '400 13px Arial', MUT); y += 17;
  if (r.branchEmail) { text(r.branchEmail, cx, 'center', '400 13px Arial', MUT); y += 17; }
  if (r.ncf) { text(`NCF: ${r.ncf}`, cx, 'center', '400 13px Arial', MUT); y += 17; }
  // Tipo de comprobante: debe verse también en la imagen que recibe el paciente.
  text(r.ncfLabel ?? 'Factura de consumo', cx, 'center', '700 13px Arial', r.ncfType === 'B01' ? MAGENTA : MUT); y += 17;
  y += 8; hr(false); y += 24;

  // ── Datos ──
  rowKV('Recibo No.', r.id); y += 22;
  rowKV('Fecha', r.date); y += 22;
  if (r.ncfType === 'B01' && r.clientName) {
    rowKV('Facturar a', r.clientName); y += 22;
    rowKV('RNC / Cédula', r.clientRnc ?? '—'); y += 26;
  } else {
    rowKV('Cliente', r.patient); y += 26;
  }

  // ── Detalle ──
  hr(); y += 22;
  ctx.textAlign = 'left';
  for (const it of r.items) {
    const nombre = `${it.qty > 1 ? `${it.qty}× ` : ''}${it.name}`;
    ctx.font = '400 15px Arial'; ctx.fillStyle = INK; ctx.textAlign = 'left';
    // Recorta nombres largos para no chocar con el precio.
    let n = nombre; while (ctx.measureText(n).width > W - PAD * 2 - 110 && n.length > 4) n = n.slice(0, -2);
    if (n !== nombre) n = n.slice(0, -1) + '…';
    ctx.fillText(n, left, y);
    ctx.font = '700 15px Arial'; ctx.textAlign = 'right'; ctx.fillText(fmtRD(it.total), right, y);
    y += 24;
  }
  y -= 2; hr(); y += 26;

  // ── Totales ──
  rowKV('Subtotal', fmtRD(r.subtotal), { bold: false, size: 14 }); y += 22;
  if (r.itbisApplied === false) rowKV('ITBIS', 'No aplica', { bold: false, size: 14 });
  else rowKV('ITBIS incluido (18%)', fmtRD(r.itbis), { bold: false, size: 14 });
  y += 20;
  y += 8; hr(false); y += 28;
  ctx.font = '800 20px Arial'; ctx.fillStyle = INK; ctx.textAlign = 'left'; ctx.fillText('TOTAL', left, y);
  ctx.fillStyle = MAGENTA; ctx.textAlign = 'right'; ctx.fillText(fmtRD(r.total), right, y);
  y += 30;

  // ── Método de pago ──
  if (r.payments && r.payments.length > 1) {
    rowKV('Método de pago', 'Mixto', { size: 13 }); y += 20;
    for (const p of r.payments) { rowKV(`· ${p.method}`, fmtRD(p.amount), { bold: false, size: 12, color: MUT }); y += 18; }
  } else {
    rowKV('Método de pago', r.method, { size: 14 }); y += 20;
  }

  // ── Pie ──
  y += 14; hr(); y += 26;
  text('¡Gracias por confiar en Li Estetic Center! 💜', cx, 'center', '400 13px Arial', MUT); y += 18;
  text('Transformando Tu Cuerpo', cx, 'center', '400 13px Arial', MUT); y += PAD;

  // Recorta a la altura usada.
  const out = document.createElement('canvas');
  out.width = W * SCALE; out.height = Math.ceil(y) * SCALE;
  const octx = out.getContext('2d')!;
  octx.drawImage(big, 0, 0);
  return await new Promise<Blob>((resolve, reject) =>
    out.toBlob((b) => (b ? resolve(b) : reject(new Error('No se pudo generar la imagen'))), 'image/png'),
  );
}
