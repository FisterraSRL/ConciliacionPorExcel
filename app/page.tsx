'use client';

import { ChangeEvent, DragEvent, useEffect, useMemo, useRef, useState } from 'react';

type Cell = string | number | boolean | Date | null;
type Row = Record<string, Cell>;
type MatchResult = { index: number; matched: boolean; cheque: { estado?: unknown; banco?: unknown; empresa?: unknown; documento?: unknown; fechaVencimiento?: unknown } | null };
const expectedColumns = ['Descripcion', 'Fecha', 'Referencia', 'Importe'];

function todayInBuenosAires() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Argentina/Buenos_Aires', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}

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
  const [apiStatus, setApiStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [apiCount, setApiCount] = useState(0);
  const [matchResults, setMatchResults] = useState<MatchResult[]>([]);
  const [matching, setMatching] = useState(false);
  const [fechaHasta, setFechaHasta] = useState(todayInBuenosAires);
  const [tipoCheque, setTipoCheque] = useState('0');

  useEffect(() => {
    let active = true;
    setApiStatus('loading');
    const params = new URLSearchParams({ fechaHasta, tipoCheque });
    fetch(`/api/situacion-cheques?${params}`)
      .then(async (response) => { const body = await response.json(); if (!response.ok) throw new Error(body.error); return body; })
      .then((body) => { if (active) { setApiCount(body.count); setApiStatus('ready'); } })
      .catch(() => { if (active) setApiStatus('error'); });
    if (rows.length) void reconcile(rows, fechaHasta, tipoCheque);
    return () => { active = false; };
  }, [fechaHasta, tipoCheque]);

  async function reconcile(parsedRows: Row[], selectedDate = fechaHasta, selectedType = tipoCheque) {
    setMatching(true); setMatchResults([]);
    try {
      const response = await fetch('/api/situacion-cheques', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ fechaHasta: selectedDate, tipoCheque: selectedType, rows: parsedRows.map((row, index) => ({ index, referencia: row.Referencia, importe: row.Importe })) }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error);
      setMatchResults(body.results);
      setApiStatus('ready');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'No se pudo conciliar con Finnegans.');
    } finally { setMatching(false); }
  }

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
      void reconcile(parsed);
    } catch (cause) {
      setRows([]); setColumns([]); setFileName(''); setSheetName('');
      setError(cause instanceof Error ? cause.message : 'No se pudo leer el archivo.');
    } finally { setLoading(false); }
  }

  function onChange(event: ChangeEvent<HTMLInputElement>) { void importFile(event.target.files?.[0]); event.target.value = ''; }
  function onDrop(event: DragEvent<HTMLDivElement>) { event.preventDefault(); setDragging(false); void importFile(event.dataTransfer.files?.[0]); }
  function clearImport() { setRows([]); setColumns([]); setFileName(''); setSheetName(''); setQuery(''); setError(''); setMatchResults([]); }

  return (
    <main className="min-h-screen bg-[#f8f8f9] text-[#1b2432]">
      <header className="border-b border-white/10 bg-[#04102d] text-white"><div className="mx-auto flex max-w-[1500px] items-center justify-between px-5 py-4 lg:px-10">
        <div className="flex items-center gap-3"><div className="grid h-10 w-10 place-items-center rounded-xl bg-gradient-to-br from-[#4bc3fe] to-[#3985ff] text-sm font-bold text-white shadow-[0_8px_24px_rgba(57,133,255,.28)]">FC</div><div><p className="text-[11px] font-bold uppercase tracking-[.15em] text-[#4bc3fe]">Fisterra</p><h1 className="text-base font-semibold">Conciliador de documentos físicos</h1></div></div>
        <span className="hidden rounded-full border border-white/20 bg-white/10 px-3 py-1.5 text-xs font-medium text-white sm:block">Etapa 1 · Importación</span>
      </div></header>

      <div className="mx-auto max-w-[1500px] px-5 py-8 lg:px-10">
        <div className="mb-7 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between"><div><p className="mb-2 text-sm font-semibold text-[#3985ff]">Conciliación de cheques</p><h2 className="text-3xl font-semibold tracking-[-.025em] text-[#04102d]">Importar movimientos</h2><p className="mt-2 max-w-2xl text-sm leading-6 text-[#49505b]">Cargá el archivo generado para compararlo con la Situación de Cheques de Finnegans.</p></div><div className={`rounded-lg border px-3 py-2 text-xs font-semibold ${apiStatus === 'ready' ? 'border-[#b8e8d5] bg-[#ebfcf7] text-[#006b33]' : apiStatus === 'error' ? 'border-[#efc7c3] bg-[#feeff0] text-[#a83c34]' : 'border-[#dcdffc] bg-[#f0effa] text-[#1529a0]'}`}>{apiStatus === 'ready' ? `Finnegans listo · ${apiCount.toLocaleString('es-AR')} cheques` : apiStatus === 'error' ? 'Finnegans no disponible' : 'Consultando Finnegans…'}</div></div>

        <section className="mb-5 rounded-2xl border border-[#e1e2e4] bg-white p-5 shadow-[0_8px_28px_rgba(31,52,69,.05)]">
          <div className="mb-4"><h3 className="font-semibold text-[#04102d]">Filtros de Finnegans</h3><p className="mt-1 text-xs text-[#898e95]">Definen qué cheques se consultan y se comparan con el archivo.</p></div>
          <div className="grid gap-4 sm:grid-cols-2 lg:max-w-2xl">
            <label className="block"><span className="mb-1.5 block text-xs font-semibold text-[#49505b]">Fecha hasta</span><input type="date" value={fechaHasta} onChange={(event) => setFechaHasta(event.target.value)} className="w-full rounded-lg border border-[#cdcfd2] bg-white px-3 py-2.5 text-sm text-[#04102d] outline-none transition focus:border-[#3985ff] focus:ring-2 focus:ring-[#3985ff]/15"/></label>
            <label className="block"><span className="mb-1.5 block text-xs font-semibold text-[#49505b]">Tipo de cheque</span><select value={tipoCheque} onChange={(event) => setTipoCheque(event.target.value)} className="w-full rounded-lg border border-[#cdcfd2] bg-white px-3 py-2.5 text-sm text-[#04102d] outline-none transition focus:border-[#3985ff] focus:ring-2 focus:ring-[#3985ff]/15"><option value="0">Propio</option><option value="1">Tercero</option></select></label>
          </div>
        </section>

        {!rows.length ? <section className="rounded-2xl border border-[#dfe4e8] bg-white p-4 shadow-[0_8px_28px_rgba(31,52,69,.06)] sm:p-7">
          <div className={`grid min-h-[330px] place-items-center rounded-xl border-2 border-dashed p-8 text-center transition ${dragging ? 'border-[#3985ff] bg-[#eef5ff]' : 'border-[#cdcfd2] bg-[#f8f8f9]'}`} onDragEnter={(e) => { e.preventDefault(); setDragging(true); }} onDragOver={(e) => e.preventDefault()} onDragLeave={() => setDragging(false)} onDrop={onDrop}>
            <div className="max-w-md"><div className="mx-auto mb-5 grid h-16 w-16 place-items-center rounded-2xl bg-gradient-to-br from-[#dcdffc] to-[#e8f7fb] text-3xl text-[#3985ff]">⇧</div><h3 className="text-xl font-semibold text-[#04102d]">Arrastrá tu archivo Excel acá</h3><p className="mt-2 text-sm leading-6 text-[#49505b]">Se admiten archivos .xls y .xlsx con las columnas Descripcion, Fecha, Referencia e Importe.</p>
              <button disabled={loading} onClick={() => inputRef.current?.click()} className="mt-6 rounded-lg bg-[#3985ff] px-5 py-2.5 text-sm font-semibold text-white shadow-[0_8px_20px_rgba(57,133,255,.24)] transition hover:bg-[#017ce2] disabled:opacity-60">{loading ? 'Leyendo archivo…' : 'Seleccionar archivo'}</button>
              <input ref={inputRef} type="file" accept=".xls,.xlsx" className="sr-only" onChange={onChange}/><p className="mt-5 text-xs text-[#83909a]">El archivo se procesa localmente en tu navegador.</p>
            </div>
          </div>{error && <div role="alert" className="mt-4 rounded-lg border border-[#efc7c3] bg-[#fff5f4] px-4 py-3 text-sm text-[#a83c34]">{error}</div>}
        </section> : <>
          <section className="mb-5 grid gap-4 md:grid-cols-[1.5fr_1fr_1fr_1fr]">
            <div className="rounded-xl border border-[#e1e2e4] bg-white p-5 shadow-sm"><p className="text-xs font-semibold uppercase tracking-wider text-[#898e95]">Archivo importado</p><div className="mt-3 flex items-center gap-3"><div className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-[#e8f7fb] font-bold text-[#3985ff]">XL</div><div className="min-w-0"><p className="truncate text-sm font-semibold text-[#04102d]">{fileName}</p><p className="mt-0.5 text-xs text-[#898e95]">Hoja: {sheetName}</p></div></div></div>
            <div className="rounded-xl border border-[#e1e2e4] bg-white p-5 shadow-sm"><p className="text-xs font-semibold uppercase tracking-wider text-[#898e95]">Registros</p><p className="mt-3 text-3xl font-semibold tabular-nums text-[#04102d]">{rows.length}</p></div>
            <div className="rounded-xl border border-[#e1e2e4] bg-white p-5 shadow-sm"><p className="text-xs font-semibold uppercase tracking-wider text-[#898e95]">Importe total</p><p className="mt-3 text-2xl font-semibold tabular-nums text-[#1529a0]">{formatMoney(total)}</p></div>
            <div className="rounded-xl border border-[#e1e2e4] bg-white p-5 shadow-sm"><p className="text-xs font-semibold uppercase tracking-wider text-[#898e95]">Coincidencias</p><p className="mt-3 text-3xl font-semibold tabular-nums text-[#006b33]">{matching ? '…' : matchResults.filter((item) => item.matched).length}</p></div>
          </section>
          <section className="overflow-hidden rounded-2xl border border-[#dce3e8] bg-white shadow-[0_8px_28px_rgba(31,52,69,.06)]">
            <div className="flex flex-col gap-3 border-b border-[#e1e2e4] px-5 py-4 sm:flex-row sm:items-center sm:justify-between"><div><h3 className="font-semibold text-[#04102d]">Detalle importado</h3><p className="mt-0.5 text-xs text-[#898e95]">{filteredRows.length} de {rows.length} registros</p></div><div className="flex gap-2"><label className="relative flex-1 sm:w-72"><span className="sr-only">Buscar en los registros</span><span className="absolute left-3 top-2.5 text-sm text-[#898e95]">⌕</span><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Buscar descripción o referencia" className="w-full rounded-lg border border-[#cdcfd2] py-2 pl-9 pr-3 text-sm outline-none transition focus:border-[#3985ff] focus:ring-2 focus:ring-[#3985ff]/15"/></label><button onClick={clearImport} className="whitespace-nowrap rounded-lg border border-[#cdcfd2] px-4 py-2 text-sm font-semibold text-[#49505b] transition hover:border-[#3985ff] hover:bg-[#eef5ff] hover:text-[#1529a0]">Cambiar archivo</button></div></div>
            <div className="overflow-x-auto"><table className="w-full min-w-[900px] border-collapse text-sm"><thead><tr className="bg-[#f0effa] text-left text-[11px] uppercase tracking-wider text-[#49505b]">{columns.map((column) => <th key={column} className={`border-b border-[#dcdffc] px-5 py-3 font-semibold ${column === 'Importe' ? 'text-right' : ''}`}>{column}</th>)}<th className="border-b border-[#dcdffc] px-5 py-3 font-semibold">Situación</th><th className="border-b border-[#dcdffc] px-5 py-3 font-semibold">Banco / documento</th></tr></thead><tbody>{filteredRows.map((row) => { const originalIndex = rows.indexOf(row); const result = matchResults.find((item) => item.index === originalIndex); return <tr key={`${String(row.Referencia)}-${originalIndex}`} className="border-b border-[#eff0f1] last:border-0 hover:bg-[#eef5ff]">{columns.map((column) => <td key={column} className={`whitespace-nowrap px-5 py-3.5 ${column === 'Importe' ? 'text-right font-medium tabular-nums text-[#1529a0]' : column === 'Referencia' ? 'font-mono text-xs text-[#0847ae]' : 'text-[#49505b]'}`}>{displayValue(row[column], column)}</td>)}<td className="whitespace-nowrap px-5 py-3.5">{matching ? <span className="text-xs text-[#898e95]">Comparando…</span> : result?.matched ? <span className="rounded-full bg-[#ebfcf7] px-2.5 py-1 text-xs font-semibold text-[#006b33]">Coincide · {String(result.cheque?.estado ?? 'Emitido')}</span> : <span className="rounded-full bg-[#feeff0] px-2.5 py-1 text-xs font-semibold text-[#a83c34]">No encontrado</span>}</td><td className="px-5 py-3.5 text-xs text-[#49505b]">{result?.cheque ? <><p className="font-semibold">{String(result.cheque.banco ?? '—')}</p><p className="mt-0.5 text-[#898e95]">{String(result.cheque.documento ?? '—')}</p></> : '—'}</td></tr>; })}</tbody></table>{!filteredRows.length && <div className="px-6 py-14 text-center text-sm text-[#898e95]">No hay registros que coincidan con la búsqueda.</div>}</div>
          </section>
        </>}
      </div>
    </main>
  );
}
