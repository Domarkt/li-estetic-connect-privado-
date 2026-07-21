import { useState } from 'react';
import { api } from '../../lib/api';
import { useToast } from '../../components/Toast';
import { Overlay, stop } from '../../components/Modal';
import { fmtRD, type Receipt } from '../../lib/types';

const SIZES: { key: string; label: string; width: string }[] = [
  { key: 'carta', label: 'Carta/A4', width: '380px' },
  { key: 't80', label: 'Ticket 80mm', width: '302px' },
  { key: 't58', label: 'Ticket 58mm', width: '219px' },
];

export default function ReceiptModal({ receipt, onClose }: { receipt: Receipt; onClose: () => void }) {
  const toast = useToast();
  const [size, setSize] = useState('carta');
  const width = SIZES.find((s) => s.key === size)!.width;

  // Envío del recibo al paciente (sustituye a imprimirlo).
  const [porWhatsapp, setPorWhatsapp] = useState(true);
  const [porCorreo, setPorCorreo] = useState(!!receipt.patientEmail);
  const [correo, setCorreo] = useState(receipt.patientEmail ?? '');
  const [enviando, setEnviando] = useState(false);
  const [enviado, setEnviado] = useState(false);

  function print() {
    try { window.print(); } catch { /* ignore */ }
    toast('Enviando a impresora (' + SIZES.find((s) => s.key === size)!.label + ')');
  }

  async function enviar() {
    const channels = [...(porWhatsapp ? ['whatsapp'] : []), ...(porCorreo ? ['correo'] : [])];
    if (!channels.length) { toast('Selecciona al menos una vía'); return; }
    if (porCorreo && !correo.trim()) { toast('Escribe el correo del paciente'); return; }
    if (!receipt.invoiceId) { toast('Este recibo no se puede reenviar'); return; }
    setEnviando(true);
    try {
      const r = await api.post<{ message: string; whatsappUrl: string | null }>(
        `/invoices/${receipt.invoiceId}/send`,
        { channels, email: porCorreo ? correo.trim() : undefined },
      );
      // WhatsApp se abre con el recibo ya redactado; solo hay que tocar Enviar.
      if (porWhatsapp && r.whatsappUrl) window.open(r.whatsappUrl, '_blank', 'noopener');
      toast(r.message);
      setEnviado(true);
    } catch (e) {
      toast(e instanceof Error ? e.message : 'No se pudo enviar el recibo');
    } finally { setEnviando(false); }
  }

  return (
    <Overlay onClose={onClose} z={120}>
      <div onClick={stop} className="flex w-[520px] max-w-full flex-col overflow-hidden rounded-2xl bg-bg animate-pop" style={{ boxShadow: '0 24px 80px rgba(0,0,0,.4)' }}>
        <div className="flex items-center gap-3 border-b border-line bg-card px-[22px] py-4">
          <div className="flex-1 text-[15px] font-extrabold">Recibo emitido</div>
          <div className="flex gap-1.5">
            {SIZES.map((s) => {
              const on = size === s.key;
              return (
                <button key={s.key} onClick={() => setSize(s.key)} className="rounded-lg px-2.5 py-1.5 text-[11.5px] font-bold"
                  style={{ background: on ? 'var(--magenta)' : 'var(--bg)', color: on ? '#fff' : 'var(--muted)', border: `1px solid ${on ? 'var(--magenta)' : 'var(--line)'}` }}>{s.label}</button>
              );
            })}
          </div>
          <button onClick={onClose} className="h-8 w-8 rounded-lg bg-bg text-muted">×</button>
        </div>

        <div className="flex justify-center p-6">
          <div id="li-receipt" style={{ width, background: '#fff', border: '1px solid var(--line)', borderRadius: 8, padding: 26, fontSize: 13, color: '#1C2540' }}>
            <div style={{ textAlign: 'center', borderBottom: '2px solid #1C2540', paddingBottom: 14, marginBottom: 14 }}>
              <img src="/li-logo.png" style={{ height: 34, marginBottom: 8 }} />
              <div style={{ fontWeight: 800, fontSize: 15 }}>LI ESTETIC CENTER</div>
              <div style={{ fontSize: 11, color: '#6A7089' }}>{receipt.branchName} · {receipt.branchAddress}</div>
              <div style={{ fontSize: 11, color: '#6A7089' }}>RNC {receipt.rnc} · Tel. {receipt.branchPhone}</div>
              {receipt.branchEmail && <div style={{ fontSize: 11, color: '#6A7089' }}>{receipt.branchEmail}</div>}
              {receipt.ncf && <div style={{ fontSize: 11, color: '#6A7089' }}>NCF (e-CF): {receipt.ncf}</div>}
            </div>
            <Row k="Recibo No." v={receipt.id} />
            <Row k="Fecha" v={receipt.date} />
            <Row k="Cliente" v={receipt.patient} mb={14} />
            <div style={{ borderTop: '1px dashed #C8CCDA', borderBottom: '1px dashed #C8CCDA', padding: '12px 0', marginBottom: 12 }}>
              {receipt.items.map((it, i) => (
                <div key={i} style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                  <span>{it.qty > 1 ? `${it.qty}× ` : ''}{it.name}</span>
                  <span style={{ fontWeight: 700 }}>{fmtRD(it.total)}</span>
                </div>
              ))}
            </div>
            <Row k="Subtotal" v={fmtRD(receipt.subtotal)} small />
            <Row k="ITBIS incluido (18%)" v={fmtRD(receipt.itbis)} small />
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 16, fontWeight: 800, borderTop: '2px solid #1C2540', paddingTop: 10, marginTop: 8 }}>
              <span>TOTAL</span><span style={{ color: '#B31C86' }}>{fmtRD(receipt.total)}</span>
            </div>
            {receipt.payments && receipt.payments.length > 1 ? (
              <div style={{ marginTop: 10 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11.5 }}><span style={{ color: '#6A7089' }}>Método de pago</span><span style={{ fontWeight: 700 }}>Mixto</span></div>
                {receipt.payments.map((p) => (
                  <div key={p.method} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: '#6A7089', paddingLeft: 8 }}><span>· {p.method}</span><span>{fmtRD(p.amount)}</span></div>
                ))}
              </div>
            ) : (
              <Row k="Método de pago" v={receipt.method} small mt={10} />
            )}
            <div style={{ textAlign: 'center', fontSize: 11, color: '#6A7089', marginTop: 20, borderTop: '1px dashed #C8CCDA', paddingTop: 12 }}>
              ¡Gracias por confiar en Li Estetic Center! 💜<br />Transformando Tu Cuerpo
            </div>
          </div>
        </div>

        {/* Enviar al paciente: reemplaza la impresión cuando no hay impresora.
            Al imprimir no aparece: el CSS de impresión solo deja visible #li-receipt. */}
        <div className="border-t border-line bg-card px-[22px] py-4">
          <div className="mb-2.5 flex items-center gap-2">
            <span className="text-[13px] font-extrabold">Enviar el recibo al paciente</span>
            {enviado && <span className="rounded-full bg-ok-soft px-2 py-0.5 text-[11px] font-bold text-ok">✓ Enviado</span>}
          </div>
          <div className="flex flex-col gap-2">
            <label className="flex items-center gap-2.5 rounded-[10px] border px-3.5 py-2.5"
              style={{ borderColor: porWhatsapp ? 'var(--magenta)' : 'var(--line)', background: porWhatsapp ? 'var(--magenta-soft)' : 'var(--card)' }}>
              <input type="checkbox" checked={porWhatsapp} onChange={(e) => setPorWhatsapp(e.target.checked)} className="h-4 w-4 accent-magenta" />
              <span className="flex h-7 w-7 items-center justify-center rounded-lg text-[13px]" style={{ background: '#25D366' }}>💬</span>
              <span className="flex-1 text-[13px]">
                <b className="font-bold">WhatsApp</b>
                <span className="block text-[11.5px] text-muted">{receipt.patientPhone ? receipt.patientPhone : 'Sin celular registrado'}</span>
              </span>
            </label>

            <label className="flex items-center gap-2.5 rounded-[10px] border px-3.5 py-2.5"
              style={{ borderColor: porCorreo ? 'var(--magenta)' : 'var(--line)', background: porCorreo ? 'var(--magenta-soft)' : 'var(--card)' }}>
              <input type="checkbox" checked={porCorreo} onChange={(e) => setPorCorreo(e.target.checked)} className="h-4 w-4 accent-magenta" />
              <span className="flex h-7 w-7 items-center justify-center rounded-lg text-[13px] text-white" style={{ background: 'var(--teal)' }}>✉</span>
              <span className="flex-1 text-[13px]"><b className="font-bold">Correo</b></span>
            </label>
            {porCorreo && (
              <input value={correo} onChange={(e) => setCorreo(e.target.value)} placeholder="correo@delpaciente.com"
                className="rounded-[10px] border border-line px-3.5 py-2.5 text-[13px] outline-none focus:border-magenta" />
            )}
          </div>
          <button onClick={enviar} disabled={enviando}
            className="mt-2.5 w-full rounded-[10px] bg-magenta py-3 text-[13.5px] font-bold text-white disabled:opacity-60">
            {enviando ? 'Enviando…' : 'Enviar recibo'}
          </button>
          <div className="mt-1.5 text-center text-[11px] text-faint">El correo se envía solo. El WhatsApp se abre con el recibo escrito: solo toca <b>Enviar</b>.</div>
        </div>

        <div className="flex gap-2.5 border-t border-line bg-card px-[22px] py-3.5">
          <button onClick={onClose} className="flex-1 rounded-[10px] border border-line bg-card py-3 text-[13.5px] font-bold text-muted">Cerrar</button>
          <button onClick={print} className="flex flex-[2] items-center justify-center gap-2 rounded-[10px] border border-line bg-card py-3 text-[13.5px] font-bold text-navy">🖨 Imprimir</button>
        </div>
      </div>
    </Overlay>
  );
}

function Row({ k, v, small, mb, mt }: { k: string; v: string; small?: boolean; mb?: number; mt?: number }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11.5, marginBottom: mb ?? 3, marginTop: mt ?? 0 }}>
      <span style={{ color: '#6A7089' }}>{k}</span>
      <span style={{ fontWeight: small ? 400 : 700 }}>{v}</span>
    </div>
  );
}
