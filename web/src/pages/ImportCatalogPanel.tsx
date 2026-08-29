import { useState } from 'react';
import { api } from '../lib/api';
import { useToast } from '../components/Toast';
import type { CatalogItem } from '../lib/types';

// Descargar/actualizar/subir el catálogo desde Excel (como los pacientes).
// Columnas en español, fáciles para quien digita. Coincide por CÓDIGO: si el código
// existe, ACTUALIZA; si no, CREA (con el código dado o uno automático).
const COLUMNAS = ['codigo', 'tipo', 'nombre', 'categoria', 'precio', 'sesiones', 'unidad'];
const EJEMPLO = ['', 'Servicio', 'Radiofrecuencia facial', 'Faciales', '1500', '1', ''];
const KIND_LABEL: Record<string, string> = { SERVICIO: 'Servicio', PAQUETE: 'Paquete', COMBO: 'Combo', PRODUCTO: 'Producto', INSUMO: 'Insumo' };

type Row = Record<string, unknown>;
type Report = { created: number; updated: number; errors: { line: number; name: string; reason: string }[]; dryRun: boolean };

function parseWorkbook(XLSX: typeof import('xlsx'), data: ArrayBuffer): Row[] {
  const wb = XLSX.read(data, { type: 'array' });
  const ws = wb.Sheets[wb.SheetNames[0]];
  if (!ws) return [];
  const json = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, { defval: '', raw: false });
  return json
    .map((r, idx) => ({ ...r, __line: String(idx + 2) }))
    .filter((o) => Object.entries(o).some(([k, v]) => k !== '__line' && String(v ?? '').trim()));
}

export default function ImportCatalogPanel() {
  const toast = useToast();
  const [rows, setRows] = useState<Row[]>([]);
  const [fileName, setFileName] = useState('');
  const [report, setReport] = useState<Report | null>(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f) return;
    try {
      const buf = await f.arrayBuffer();
      const XLSX = await import('xlsx');
      const parsed = parseWorkbook(XLSX, buf);
      setRows(parsed); setFileName(f.name); setReport(null);
      if (!parsed.length) toast('El archivo no tiene filas con datos');
    } catch { toast('No se pudo leer el archivo'); }
  }

  async function downloadTemplate() {
    const XLSX = await import('xlsx');
    const ws = XLSX.utils.aoa_to_sheet([COLUMNAS, EJEMPLO]);
    ws['!cols'] = COLUMNAS.map(() => ({ wch: 18 }));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Catálogo');
    XLSX.writeFile(wb, 'plantilla-catalogo.xlsx');
  }

  // Descarga el catálogo ACTUAL para editarlo y volverlo a subir (mantén los códigos).
  async function downloadActual() {
    try {
      const items = await api.get<CatalogItem[]>('/catalog');
      const XLSX = await import('xlsx');
      const aoa = [COLUMNAS, ...items.map((i) => [
        i.code ?? '', KIND_LABEL[i.kind] ?? i.kind, i.name, i.category ?? '',
        i.price ? String(i.price) : '', i.sessions ? String(i.sessions) : '', i.unit ?? '',
      ])];
      const ws = XLSX.utils.aoa_to_sheet(aoa);
      ws['!cols'] = COLUMNAS.map(() => ({ wch: 18 }));
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, 'Catálogo');
      XLSX.writeFile(wb, 'catalogo-actual.xlsx');
    } catch (e) { toast(e instanceof Error ? e.message : 'No se pudo descargar el catálogo'); }
  }

  async function run(dryRun: boolean) {
    if (!rows.length) { toast('Primero carga un archivo'); return; }
    setBusy(true); setProgress(0); setReport(null);
    const total: Report = { created: 0, updated: 0, errors: [], dryRun };
    try {
      for (let i = 0; i < rows.length; i += 200) {
        const chunk = rows.slice(i, i + 200);
        const r = await api.post<Report>('/catalog/import', { rows: chunk, dryRun });
        total.created += r.created; total.updated += r.updated; total.errors.push(...r.errors);
        setProgress(Math.min(100, Math.round(((i + chunk.length) / rows.length) * 100)));
      }
      setReport(total);
      toast(dryRun ? 'Simulación terminada' : `${total.created} creados · ${total.updated} actualizados`);
    } catch (e) { toast(e instanceof Error ? e.message : 'Error en la importación'); }
    finally { setBusy(false); }
  }

  return (
    <div className="flex flex-col gap-3.5">
      <div className="rounded-base border border-line bg-card p-4 text-[12.5px] text-muted shadow-card">
        <b className="text-navy">Cómo funciona:</b> descarga el <b>catálogo actual</b> (o la plantilla), edítalo en <b>Excel</b> (precios, categorías, nombres, o agrega filas nuevas), guárdalo y súbelo aquí.
        Corre primero la <b>simulación</b> para ver qué se crearía/actualizaría sin escribir nada.
        <div className="mt-2">Coincide por <b>código</b>: si el código ya existe, <b>actualiza</b>; si la fila no trae código, <b>crea</b> uno nuevo. Deja el código como está para no duplicar.</div>
        <div className="mt-2">Columnas: <code className="text-[11.5px]">{COLUMNAS.join(', ')}</code> · Obligatoria: <b>nombre</b>. Tipo: Servicio, Paquete, Combo, Producto o Insumo.</div>
      </div>

      <div className="flex flex-wrap items-end gap-3 rounded-base border border-line bg-card p-4 shadow-card">
        <button onClick={downloadActual} className="rounded-[10px] bg-magenta px-3.5 py-2.5 text-[12.5px] font-bold text-white">⬇ Descargar catálogo actual</button>
        <button onClick={downloadTemplate} className="rounded-[10px] border border-line bg-bg px-3.5 py-2.5 text-[12.5px] font-bold text-magenta">⬇ Plantilla vacía</button>
        <label className="flex flex-col gap-1.5">
          <span className="text-xs font-bold text-muted">Subir Excel editado</span>
          <input type="file" accept=".xlsx,.xls,.csv" onChange={onFile} className="text-[12.5px]" />
        </label>
        {rows.length > 0 && <div className="text-[12.5px] font-bold text-navy">{fileName} · <b className="text-magenta">{rows.length}</b> filas</div>}
      </div>

      {rows.length > 0 && (
        <div className="flex flex-wrap items-center gap-2.5">
          <button onClick={() => run(true)} disabled={busy} className="rounded-[10px] border border-line bg-card px-4 py-2.5 text-[13px] font-bold text-navy disabled:opacity-50">1 · Simular (no escribe)</button>
          <button onClick={() => run(false)} disabled={busy || !report?.dryRun} title={!report?.dryRun ? 'Corre la simulación primero' : ''}
            className="rounded-[10px] bg-magenta px-4 py-2.5 text-[13px] font-bold text-white disabled:opacity-40">2 · Aplicar de verdad</button>
          {busy && <span className="text-[12.5px] font-bold text-muted">Procesando… {progress}%</span>}
        </div>
      )}

      {report && (
        <div className="rounded-base border border-line bg-card p-4 shadow-card">
          <div className="mb-2 text-[13.5px] font-extrabold">{report.dryRun ? 'Resultado de la simulación' : 'Cambios aplicados'}</div>
          <div className="flex flex-wrap gap-4 text-[13px]">
            <span>{report.dryRun ? 'Se crearían' : 'Creados'}: <b className="text-ok">{report.created}</b></span>
            <span>{report.dryRun ? 'Se actualizarían' : 'Actualizados'}: <b className="text-navy">{report.updated}</b></span>
            <span>Con error: <b className="text-danger">{report.errors.length}</b></span>
          </div>
          {report.errors.length > 0 && (
            <div className="mt-3 max-h-[220px] overflow-y-auto rounded-[9px] border border-line-2">
              {report.errors.slice(0, 200).map((er, i) => (
                <div key={i} className="flex gap-3 border-b border-line-2 px-3 py-1.5 text-[12px]">
                  <span className="font-bold text-muted">Fila {er.line}</span>
                  <span className="flex-1 truncate">{er.name}</span>
                  <span className="text-danger">{er.reason}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
