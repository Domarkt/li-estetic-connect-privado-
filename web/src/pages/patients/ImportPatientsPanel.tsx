import { useEffect, useState } from 'react';
import { api } from '../../lib/api';
import { useAuth } from '../../auth/AuthContext';
import { useToast } from '../../components/Toast';
import type { BranchGoal } from '../../lib/types';

// Importar pacientes desde una hoja de cálculo (digitación de fichas de papel).
// El admin elige la sucursal; recepción carga siempre en la suya (lo fuerza el servidor).
const IMPORT_HEADER = 'name,phone,email,sex,birthDate,cedula,branch';
type ImportRow = Record<string, string>;
type ImportReport = { created: number; duplicates: number; errors: { line: number; name: string; reason: string }[] };

/** Parser CSV/TSV tolerante: detecta el separador y respeta las comillas. */
export function parseDelimited(text: string): ImportRow[] {
  const clean = text.replace(/^﻿/, '').trim();
  if (!clean) return [];
  const nl = clean.indexOf('\n');
  const firstLine = clean.slice(0, nl === -1 ? undefined : nl);
  const sep = firstLine.includes('\t') ? '\t' : firstLine.split(';').length > firstLine.split(',').length ? ';' : ',';

  const rows: string[][] = [];
  let cell = '', row: string[] = [], quoted = false;
  for (let i = 0; i < clean.length; i++) {
    const c = clean[i];
    if (quoted) {
      if (c === '"') { if (clean[i + 1] === '"') { cell += '"'; i++; } else quoted = false; }
      else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === sep) { row.push(cell); cell = ''; }
    else if (c === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; }
    else if (c !== '\r') cell += c;
  }
  row.push(cell); rows.push(row);

  // Acepta encabezados en español o en inglés.
  const alias: Record<string, string> = {
    nombre: 'name', name: 'name', telefono: 'phone', 'teléfono': 'phone', celular: 'phone', phone: 'phone',
    correo: 'email', email: 'email', sexo: 'sex', sex: 'sex',
    nacimiento: 'birthDate', fechanacimiento: 'birthDate', birthdate: 'birthDate',
    cedula: 'cedula', 'cédula': 'cedula', sucursal: 'branch', branch: 'branch',
  };
  const map = rows[0].map((h) => alias[h.trim().toLowerCase().replace(/\s+/g, '')] ?? '');
  return rows.slice(1)
    .filter((r) => r.some((c) => c.trim()))
    .map((r, idx) => {
      const o: ImportRow = { __line: String(idx + 2) };
      map.forEach((k, i) => { if (k) o[k] = (r[i] ?? '').trim(); });
      return o;
    });
}

export default function ImportPatientsPanel() {
  const { staff } = useAuth();
  const toast = useToast();
  const isAdmin = staff?.role === 'ADMIN';
  const [branches, setBranches] = useState<BranchGoal[]>([]);
  const [branchId, setBranchId] = useState('');
  const [rows, setRows] = useState<ImportRow[]>([]);
  const [fileName, setFileName] = useState('');
  const [report, setReport] = useState<(ImportReport & { dryRun: boolean }) | null>(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    if (!isAdmin) return; // recepción no elige sucursal: siempre la suya
    api.get<BranchGoal[]>('/config/branch-goals').then((bs) => { setBranches(bs); if (bs[0]) setBranchId(bs[0].id); }).catch(() => {});
  }, [isAdmin]);

  function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = parseDelimited(String(reader.result));
        setRows(parsed); setFileName(f.name); setReport(null);
        if (!parsed.length) toast('El archivo no tiene filas con datos');
      } catch { toast('No se pudo leer el archivo'); }
    };
    reader.readAsText(f, 'utf-8');
  }

  function downloadTemplate() {
    const sample = `${IMPORT_HEADER}\nMaría Pérez,809-555-0101,maria@correo.com,F,1990-05-23,001-1234567-8,e1\n`;
    const url = URL.createObjectURL(new Blob([`﻿${sample}`], { type: 'text/csv;charset=utf-8' }));
    const a = document.createElement('a');
    a.href = url; a.download = 'plantilla-pacientes.csv'; a.click();
    URL.revokeObjectURL(url);
  }

  // Envía en lotes de 200 para no saturar el servidor y poder mostrar avance.
  async function run(dryRun: boolean) {
    if (!rows.length) { toast('Primero carga un archivo'); return; }
    if (isAdmin && !branchId) { toast('Selecciona la sucursal'); return; }
    setBusy(true); setProgress(0); setReport(null);
    const total: ImportReport = { created: 0, duplicates: 0, errors: [] };
    try {
      for (let i = 0; i < rows.length; i += 200) {
        const chunk = rows.slice(i, i + 200);
        const r = await api.post<ImportReport>('/patients/import', { rows: chunk, branchId: isAdmin ? branchId : undefined, dryRun });
        total.created += r.created; total.duplicates += r.duplicates; total.errors.push(...r.errors);
        setProgress(Math.min(100, Math.round(((i + chunk.length) / rows.length) * 100)));
      }
      setReport({ ...total, dryRun });
      toast(dryRun ? 'Simulación terminada' : `${total.created} pacientes cargados`);
    } catch (e) { toast(e instanceof Error ? e.message : 'Error en la importación'); }
    finally { setBusy(false); }
  }

  return (
    <div className="flex flex-col gap-3.5">
      <div className="rounded-base border border-line bg-card p-4 text-[12.5px] text-muted shadow-card">
        <b className="text-navy">Cómo funciona:</b> digita las fichas en Excel usando la plantilla, guarda como <b>CSV</b> y cárgalo aquí.
        Corre primero la <b>simulación</b> para ver duplicados y errores <b>sin escribir nada</b>. Los repetidos (mismo teléfono) se omiten solos.
        <div className="mt-2">Columnas: <code className="text-[11.5px]">{IMPORT_HEADER}</code> · Obligatorias: <b>name</b> y <b>phone</b>.</div>
        {!isAdmin && <div className="mt-2 font-semibold text-navy">Los pacientes se cargarán en tu sucursal: <b>{staff?.branch?.name ?? '—'}</b>.</div>}
      </div>

      <div className="flex flex-wrap items-end gap-3 rounded-base border border-line bg-card p-4 shadow-card">
        <button onClick={downloadTemplate} className="rounded-[10px] border border-line bg-bg px-3.5 py-2.5 text-[12.5px] font-bold text-magenta">⬇ Descargar plantilla</button>
        {isAdmin && (
          <label className="flex flex-col gap-1.5">
            <span className="text-xs font-bold text-muted">Sucursal</span>
            <select value={branchId} onChange={(e) => setBranchId(e.target.value)} className="rounded-[9px] border border-line bg-card px-3.5 py-2.5 text-[13px]">
              {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
          </label>
        )}
        <label className="flex flex-col gap-1.5">
          <span className="text-xs font-bold text-muted">Archivo CSV</span>
          <input type="file" accept=".csv,.tsv,.txt,text/csv" onChange={onFile} className="text-[12.5px]" />
        </label>
        {rows.length > 0 && <div className="text-[12.5px] font-bold text-navy">{fileName} · <b className="text-magenta">{rows.length}</b> filas</div>}
      </div>

      {rows.length > 0 && (
        <div className="flex flex-wrap items-center gap-2.5">
          <button onClick={() => run(true)} disabled={busy} className="rounded-[10px] border border-line bg-card px-4 py-2.5 text-[13px] font-bold text-navy disabled:opacity-50">1 · Simular (no escribe)</button>
          <button onClick={() => run(false)} disabled={busy || !report?.dryRun} title={!report?.dryRun ? 'Corre la simulación primero' : ''}
            className="rounded-[10px] bg-magenta px-4 py-2.5 text-[13px] font-bold text-white disabled:opacity-40">2 · Importar de verdad</button>
          {busy && <span className="text-[12.5px] font-bold text-muted">Procesando… {progress}%</span>}
        </div>
      )}

      {report && (
        <div className="rounded-base border border-line bg-card p-4 shadow-card">
          <div className="mb-2 text-[13.5px] font-extrabold">{report.dryRun ? 'Resultado de la simulación' : 'Importación completada'}</div>
          <div className="flex flex-wrap gap-4 text-[13px]">
            <span>{report.dryRun ? 'Se cargarían' : 'Cargados'}: <b className="text-ok">{report.created}</b></span>
            <span>Duplicados omitidos: <b className="text-warn">{report.duplicates}</b></span>
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
