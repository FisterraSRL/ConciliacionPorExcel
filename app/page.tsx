'use client';

import { ChangeEvent, DragEvent, useMemo, useRef, useState } from 'react';

type Cell = string | number | boolean | Date | null;
type Row = Record<string, Cell>;
const expectedColumns = ['Descripcion', 'Fecha', 'Referencia', 'Importe'];

function formatMoney(value: Cell) {
  const amount = typeof value === 'number' ? value : Number(String(value ?? '').replace(/[^0-9,.-]/g, '').replace(',', '.'));
  return Number.isFinite(amount) ? new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', minimumFractionDigits: 2 }).format(amount) : String(value ?? '—');
}

function displayValue(value: Cell, column: string) {
  if (value == null || value === '') return '—';
  if (column === 'Importe') return formatMoney(value);
  if (value instanceof Date) return new Intl.DateTimeFormat('es-AR').format(value);
  return String(value);
}

export default function Home() {
  const inputRef = useRef<HTMLInputElement>(null);
  const [rows, setRows] = useState<Row[]>([]);
  const [columns, setColumns] = useState<string[]>([]);
  const [fileName, setFileName] = useState('');
  const [sheetName, setSheetName] = useState('');
  const [query, setQuery] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [dragging, setDragging] = useState(false);

  const filteredRows = useMemo(() => {
    const search = query.trim().toLocaleLowerCase('es');
    return search ? rows.filter((row) => columns.some((column) => String(row[column] ?? '').toLocaleLowerCase('es').includes(search))) : rows;
  }, [rows, columns, query]);

  const total = useMemo(() => rows.reduce((sum, row) => {
    const raw = row.Importe;
    const amount = typeof raw === 'number' ? raw : Number(String(raw ?? '').replace(/[^0-9,.-]/g, '').replace(',', '.'));
    return sum + (Number.isFinite(amount) ? amount : 0);
  }, 0), [rows]);

  async function importFile(file?: File) {
    if (!file) return;
    if (!/\.(xls|xlsx)$/i.test(file.name)) { setError('El archivo debe tener formato .xls o .xlsx.'); return; }
    setLoading(true); setError('');
    try {
      const XLSX = await import('xlsx');
      const workbook = XLSX.read(await file.arrayBuffer(), { type: 'array', cellDates: true });
      const firstSheet = workbook.SheetNames[0];
      if (!firstSheet) throw new Error('El archivo no contiene hojas.');
      const parsed = XLSX.utils.sheet_to_json<Row>(workbook.Sheets[firstSheet], { defval: null, raw: true });
      const parsedColumns = parsed.length ? Object.keys(parsed[0]) : [];
      const missing = expectedColumns.filter((column) => !parsedColumns.includes(column));
      if (missing.length) throw new Error(`Faltan las columnas requeridas: ${missing.join(', ')}.`);
      setRows(parsed); setColumns(parsedColumns); setFileName(file.name); setSheetName(firstSheet); setQuery('');
    } catch (cause) {
      setRows([]); setColumns([]); setFileName(''); setSheetName('');
      setError(cause instanceof Error ? cause.message : 'No se pudo leer el archivo.');
    } finally { setLoading(false); }
  }

  function onChange(event: ChangeEvent<HTMLInputElement>) { void importFile(event.target.files?.[0]); event.target.value = ''; }
  function onDrop(event: DragEvent<HTMLDivElement>) { event.preventDefault(); setDragging(false); void importFile(event.dataTransfer.files?.[0]); }
  function clearImport() { setRows([]); setColumns([]); setFileName(''); setSheetName(''); setQuery(''); setError(''); }

  return (
    <main className="min-h-screen bg-[#f4f6f8] text-[#17212b]">
      <header className="border-b border-[#dfe4e8] bg-white"><div className="mx-auto flex max-w-[1500px] items-center justify-between px-5 py-4 lg:px-10">
        <div className="flex items-center gap-3"><div className="grid h-10 w-10 place-items-center rounded-xl bg-[#123f63] text-sm font-bold text-white">FC</div><div><p className="text-[11px] font-bold uppercase tracking-[.15em] text-[#637381]">Fisterra</p><h1 className="text-base font-semibold">Conciliador de documentos físicos</h1></div></div>
        <span className="hidden rounded-full border border-[#cbd5dc] bg-[#f8fafb] px-3 py-1.5 text-xs font-medium text-[#536572] sm:block">Etapa 1 · Importación</span>
      </div></header>

      <div className="mx-auto max-w-[1500px] px-5 py-8 lg:px-10">
        <div className="mb-7"><p className="mb-2 text-sm font-semibold text-[#167c69]">Conciliación de cheques</p><h2 className="text-3xl font-semibold tracking-[-.025em] text-[#102b3e]">Importar movimientos</h2><p className="mt-2 max-w-2xl text-sm leading-6 text-[#61717d]">Cargá el archivo generado para revisar sus registros antes de continuar con la conciliación.</p></div>

        {!rows.length ? <section className="rounded-2xl border border-[#dfe4e8] bg-white p-4 shadow-[0_8px_28px_rgba(31,52,69,.06)] sm:p-7">
          <div className={`grid min-h-[330px] place-items-center rounded-xl border-2 border-dashed p-8 text-center transition ${dragging ? 'border-[#167c69] bg-[#f0faf7]' : 'border-[#cbd5dc] bg-[#fafbfc]'}`} onDragEnter={(e) => { e.preventDefault(); setDragging(true); }} onDragOver={(e) => e.preventDefault()} onDragLeave={() => setDragging(false)} onDrop={onDrop}>
            <div className="max-w-md"><div className="mx-auto mb-5 grid h-16 w-16 place-items-center rounded-2xl bg-[#e7f3f0] text-3xl text-[#167c69]">⇧</div><h3 className="text-xl font-semibold text-[#17364b]">Arrastrá tu archivo Excel acá</h3><p className="mt-2 text-sm leading-6 text-[#687985]">Se admiten archivos .xls y .xlsx con las columnas Descripcion, Fecha, Referencia e Importe.</p>
              <button disabled={loading} onClick={() => inputRef.current?.click()} className="mt-6 rounded-lg bg-[#167c69] px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-[#116656] disabled:opacity-60">{loading ? 'Leyendo archivo…' : 'Seleccionar archivo'}</button>
              <input ref={inputRef} type="file" accept=".xls,.xlsx" className="sr-only" onChange={onChange}/><p className="mt-5 text-xs text-[#83909a]">El archivo se procesa localmente en tu navegador.</p>
            </div>
          </div>{error && <div role="alert" className="mt-4 rounded-lg border border-[#efc7c3] bg-[#fff5f4] px-4 py-3 text-sm text-[#a83c34]">{error}</div>}
        </section> : <>
          <section className="mb-5 grid gap-4 md:grid-cols-[1.5fr_1fr_1fr]">
            <div className="rounded-xl border border-[#dce3e8] bg-white p-5 shadow-sm"><p className="text-xs font-semibold uppercase tracking-wider text-[#73828d]">Archivo importado</p><div className="mt-3 flex items-center gap-3"><div className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-[#e7f3f0] font-bold text-[#167c69]">XL</div><div className="min-w-0"><p className="truncate text-sm font-semibold text-[#17364b]">{fileName}</p><p className="mt-0.5 text-xs text-[#778690]">Hoja: {sheetName}</p></div></div></div>
            <div className="rounded-xl border border-[#dce3e8] bg-white p-5 shadow-sm"><p className="text-xs font-semibold uppercase tracking-wider text-[#73828d]">Registros</p><p className="mt-3 text-3xl font-semibold tabular-nums text-[#17364b]">{rows.length}</p></div>
            <div className="rounded-xl border border-[#dce3e8] bg-white p-5 shadow-sm"><p className="text-xs font-semibold uppercase tracking-wider text-[#73828d]">Importe total</p><p className="mt-3 text-2xl font-semibold tabular-nums text-[#17364b]">{formatMoney(total)}</p></div>
          </section>
          <section className="overflow-hidden rounded-2xl border border-[#dce3e8] bg-white shadow-[0_8px_28px_rgba(31,52,69,.06)]">
            <div className="flex flex-col gap-3 border-b border-[#e3e8ec] px-5 py-4 sm:flex-row sm:items-center sm:justify-between"><div><h3 className="font-semibold text-[#17364b]">Detalle importado</h3><p className="mt-0.5 text-xs text-[#74838d]">{filteredRows.length} de {rows.length} registros</p></div><div className="flex gap-2"><label className="relative flex-1 sm:w-72"><span className="sr-only">Buscar en los registros</span><span className="absolute left-3 top-2.5 text-sm text-[#83919b]">⌕</span><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Buscar descripción o referencia" className="w-full rounded-lg border border-[#ccd6dc] py-2 pl-9 pr-3 text-sm outline-none transition focus:border-[#167c69] focus:ring-2 focus:ring-[#167c69]/15"/></label><button onClick={clearImport} className="whitespace-nowrap rounded-lg border border-[#ccd6dc] px-4 py-2 text-sm font-semibold text-[#405665] transition hover:bg-[#f4f7f8]">Cambiar archivo</button></div></div>
            <div className="overflow-x-auto"><table className="w-full min-w-[720px] border-collapse text-sm"><thead><tr className="bg-[#f6f8f9] text-left text-[11px] uppercase tracking-wider text-[#697a86]">{columns.map((column) => <th key={column} className={`border-b border-[#dfe5e9] px-5 py-3 font-semibold ${column === 'Importe' ? 'text-right' : ''}`}>{column}</th>)}</tr></thead><tbody>{filteredRows.map((row, index) => <tr key={`${String(row.Referencia)}-${index}`} className="border-b border-[#edf0f2] last:border-0 hover:bg-[#f8fbfa]">{columns.map((column) => <td key={column} className={`whitespace-nowrap px-5 py-3.5 ${column === 'Importe' ? 'text-right font-medium tabular-nums text-[#193e55]' : column === 'Referencia' ? 'font-mono text-xs text-[#36566b]' : 'text-[#405461]'}`}>{displayValue(row[column], column)}</td>)}</tr>)}</tbody></table>{!filteredRows.length && <div className="px-6 py-14 text-center text-sm text-[#71818c]">No hay registros que coincidan con la búsqueda.</div>}</div>
          </section>
        </>}
      </div>
    </main>
  );
}
