import { useEffect, useState } from 'react';
import { api } from '../../lib/api';
import { useAuth } from '../../auth/AuthContext';
import { useToast } from '../../components/Toast';
import type { BranchGoal } from '../../lib/types';

// Importar pacientes desde una hoja de cálculo (digitación de fichas de papel).
// El admin elige la sucursal; recepción carga siempre en la suya (lo fuerza el servidor).
// La plantilla es Excel con encabezados en español, fáciles para quien digita.
const COLUMNAS = ['nombre', 'telefono', 'correo', 'sexo', 'nacimiento', 'cedula', 'sucursal'];
const EJEMPLO = ['María Pérez', '809-555-0101', 'maria@correo.com', 'F', '1990-05-23', '001-1234567-8', 'e1'];
type ImportRow = Record<string, string>;
type ImportReport = { created: number; duplicates: number; errors: { line: number; name: string; reason: string }[] };

// Acepta encabezados en español o en inglés.
const ALIAS: Record<string, string> = {
  nombre: 'name', name: 'name', telefono: 'phone', 'teléfono': 'phone', celular: 'phone', phone: 'phone',
  correo: 'email', email: 'email', sexo: 'sex', sex: 'sex',
  nacimiento: 'birthDate', fechanacimiento: 'birthDate', 'fechadenacimiento': 'birthDate', birthdate: 'birthDate',
  cedula: 'cedula', 'cédula': 'cedula', id: 'cedula', sucursal: 'branch', branch: 'branch',
};

/** Lee un Excel (.xlsx/.xls) o CSV y normaliza sus columnas a los campos del sistema. */
function parseWorkbook(XLSX: typeof import('xlsx'), data: ArrayBuffer): ImportRow[] {
  const wb = XLSX.read(data, { type: 'array' });
  const ws = wb.Sheets[wb.SheetNames[0]];
  if (!ws) return [];
  const json = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, { defval: '', raw: false });
  return json
    .map((r, idx) => {
      const o: ImportRow = { __line: String(idx + 2) };
      for (const [k, v] of Object.entries(r)) {
        const key = ALIAS[String(k).trim().toLowerCase().replace(/\s+/g, '')];
        if (key) o[key] = String(v ?? '').trim();
      }
      return o;
    })
    .filter((o) => (o.name || o.phone)); // descarta filas vacías
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

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f) return;
    try {
      const buf = await f.arrayBuffer();
      const XLSX = await import('xlsx'); // se carga solo al usar el importador
      const parsed = parseWorkbook(XLSX, buf);
      setRows(parsed); setFileName(f.name); setReport(null);
      if (!parsed.length) toast('El archivo no tiene filas con datos');
    } catch { toast('No se pudo leer el archivo'); }
  }

  async function downloadTemplate() {
    const XLSX = await import('xlsx');
    const ws = XLSX.utils.aoa_to_sheet([COLUMNAS, EJEMPLO]);
    ws['!cols'] = COLUMNAS.map(() => ({ wch: 18 })); // ancho de columnas cómodo
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Pacientes');
    XLSX.writeFile(wb, 'plantilla-pacientes.xlsx');
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
        <b className="text-navy">Cómo funciona:</b> descarga la plantilla de <b>Excel</b>, llénala con los datos de las fichas, <b>guárdala</b> y cárgala aquí (no hay que cambiar el formato).
        Corre primero la <b>simulación</b> para ver duplicados y errores <b>sin escribir nada</b>. Los repetidos (mismo teléfono) se omiten solos.
        <div className="mt-2">Columnas: <code className="text-[11.5px]">{COLUMNAS.join(', ')}</code> · Obligatorias: <b>nombre</b> y <b>telefono</b>.</div>
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
          <span className="text-xs font-bold text-muted">Archivo Excel</span>
          <input type="file" accept=".xlsx,.xls,.csv" onChange={onFile} className="text-[12.5px]" />
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
