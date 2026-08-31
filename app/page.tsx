'use client';

import { ChangeEvent, DragEvent, useEffect, useMemo, useRef, useState } from 'react';

type Cell = string | number | boolean | Date | null;
type Row = Record<string, Cell>;
type MatchResult = { index: number; matched: boolean; cheque: { estado?: unknown; banco?: unknown; cuenta?: unknown; empresa?: unknown; documento?: unknown; fechaVencimiento?: unknown; documentoFisicoId?: unknown } | null };
type EstadoBancario = { codigo: string; nombre: string };
type OperacionBancaria = { codigo: string; nombre: string; estadoOrigen: string | null; estadoDestino: string | null };
type CuentaDestino = { codigo: string; nombre: string };
type EmpresaSucursal = { codigo: string; nombre: string };
type AsientoPreview = { tipoDocumento: string; operacion: string; operacionId: string; empresaId: string; estadoOrigen: string; estadoDestino: string; cuentaDestino: string; cuentaDestinoId: string; documentos: Array<{ documentoFisicoId: string; referencia: string; importe: Cell; cuentaOrigen: string; fechaVencimiento: string | null }> };
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
  const [estadoBancario, setEstadoBancario] = useState('Diferido');
  const [cuentaContable, setCuentaContable] = useState('');
  const [empresa, setEmpresa] = useState('049CDS');
  const [empresasSucursales, setEmpresasSucursales] = useState<EmpresaSucursal[]>([]);
  const [estadosBancarios, setEstadosBancarios] = useState<EstadoBancario[]>([]);
  const [refreshCounter, setRefreshCounter] = useState(0);
  const [selectedRows, setSelectedRows] = useState<Set<number>>(new Set());
  const [operacionesBancarias, setOperacionesBancarias] = useState<OperacionBancaria[]>([]);
  const [operacionBancaria, setOperacionBancaria] = useState('');
  const [cuentasDestino, setCuentasDestino] = useState<CuentaDestino[]>([]);
  const [cuentaDestino, setCuentaDestino] = useState('');
  const [tipoDocumento, setTipoDocumento] = useState('MOVFONDOS');
  const [movementMessage, setMovementMessage] = useState('');
  const [asientoPreview, setAsientoPreview] = useState<AsientoPreview | null>(null);
  const [movementLoading, setMovementLoading] = useState(false);
  const [movementSending, setMovementSending] = useState(false);
  const [movementSuccess, setMovementSuccess] = useState('');
  const [movementJson, setMovementJson] = useState<unknown>(null);
  const [endpointResponse, setEndpointResponse] = useState<unknown>(null);
  const [endpointResponseOk, setEndpointResponseOk] = useState<boolean | null>(null);

  useEffect(() => {
    fetch('/api/estados-bancarios')
      .then(async (response) => { const body = await response.json(); if (!response.ok) throw new Error(body.error); return body; })
      .then((body) => {
        setEstadosBancarios(body.estados);
        if (body.estados.length && !body.estados.some((item: EstadoBancario) => item.codigo === estadoBancario)) {
          setEstadoBancario(body.estados[0].codigo);
          setRefreshCounter((value) => value + 1);
        }
      })
      .catch(() => setError('No se pudieron cargar los estados bancarios.'));
    fetch('/api/operaciones-bancarias')
      .then(async (response) => { const body = await response.json(); if (!response.ok) throw new Error(body.error); return body; })
      .then((body) => {
        setOperacionesBancarias(body.operaciones);
        if (body.operaciones.length) setOperacionBancaria(body.operaciones[0].codigo);
      })
      .catch(() => setError('No se pudieron cargar las operaciones bancarias.'));
    fetch('/api/cuentas')
      .then(async (response) => { const body = await response.json(); if (!response.ok) throw new Error(body.error); return body; })
      .then((body) => {
        setCuentasDestino(body.cuentas);
        if (body.cuentas.length) setCuentaDestino(body.cuentas[0].codigo);
      })
      .catch(() => setError('No se pudieron cargar las cuentas destino.'));
    fetch('/api/empresas-sucursales')
      .then(async (response) => { const body = await response.json(); if (!response.ok) throw new Error(body.error); return body; })
      .then((body) => setEmpresasSucursales(body.empresasSucursales))
      .catch(() => setError('No se pudieron cargar las empresas y sucursales.'));
  }, []);

  useEffect(() => {
    let active = true;
    setApiStatus('loading');
    const params = new URLSearchParams({ fechaHasta, tipoCheque, estado: estadoBancario, cuentaContable, empresa });
    if (refreshCounter > 0) params.set('refresh', '1');
    fetch(`/api/situacion-cheques?${params}`)
      .then(async (response) => { const body = await response.json(); if (!response.ok) throw new Error(body.error); return body; })
      .then((body) => { if (active) { setApiCount(body.count); setApiStatus('ready'); } })
      .catch(() => { if (active) setApiStatus('error'); });
    if (rows.length) void reconcile(rows, fechaHasta, tipoCheque, estadoBancario, cuentaContable, empresa);
    return () => { active = false; };
  }, [refreshCounter]);

  async function reconcile(parsedRows: Row[], selectedDate = fechaHasta, selectedType = tipoCheque, selectedStatus = estadoBancario, selectedAccount = cuentaContable, selectedCompany = empresa) {
    setMatching(true); setMatchResults([]);
    try {
      const response = await fetch('/api/situacion-cheques', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ fechaHasta: selectedDate, tipoCheque: selectedType, estado: selectedStatus, cuentaContable: selectedAccount, empresa: selectedCompany, rows: parsedRows.map((row, index) => ({ index, referencia: row.Referencia, importe: row.Importe })) }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error);
      setMatchResults(body.results);
      setSelectedRows(new Set<number>(body.results.filter((item: MatchResult) => item.matched).map((item: MatchResult) => item.index)));
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
  function clearImport() { setRows([]); setColumns([]); setFileName(''); setSheetName(''); setQuery(''); setError(''); setMatchResults([]); setSelectedRows(new Set()); }

  function toggleRow(index: number) {
    setSelectedRows((current) => {
      const next = new Set(current);
      if (next.has(index)) next.delete(index); else next.add(index);
      return next;
    });
  }

  function toggleVisibleRows() {
    const visibleIndexes = filteredRows.map((row) => rows.indexOf(row));
    const allSelected = visibleIndexes.length > 0 && visibleIndexes.every((index) => selectedRows.has(index));
    setSelectedRows((current) => {
      const next = new Set(current);
      for (const index of visibleIndexes) { if (allSelected) next.delete(index); else next.add(index); }
      return next;
    });
  }

  async function createMovementPreview() {
    setMovementMessage('');
    setMovementSuccess('');
    setMovementJson(null);
    setEndpointResponse(null);
    setEndpointResponseOk(null);
    setAsientoPreview(null);
    if (!selectedRows.size) { setMovementMessage('No hay registros seleccionados.'); return; }
    const selectedMatches = matchResults.filter((item) => selectedRows.has(item.index) && item.matched && item.cheque);
    if (selectedMatches.length !== selectedRows.size) { setMovementMessage('Solo se pueden incluir registros cuya situación sea Coincide.'); return; }
    const selectedOperation = operacionesBancarias.find((item) => item.codigo === operacionBancaria);
    if (!selectedOperation) { setMovementMessage('Seleccioná una operación bancaria.'); return; }
    if (!tipoDocumento.trim()) { setMovementMessage('Ingresá el código del tipo de documento.'); return; }
    if (!empresa) { setMovementMessage('Seleccioná una empresa / sucursal antes de crear el movimiento.'); return; }
    setMovementLoading(true);
    try {
      const response = await fetch(`/api/operaciones-bancarias?codigo=${encodeURIComponent(selectedOperation.codigo)}`, { cache: 'no-store' });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error);
      const operation: OperacionBancaria = body.operacion;
      setOperacionesBancarias((current) => current.map((item) => item.codigo === operation.codigo ? operation : item));
      if (!operation.estadoOrigen || !operation.estadoDestino) { setMovementMessage(`La operación “${operation.nombre}” no tiene estados origen y destino configurados en Finnegans.`); return; }
      const selectedState = estadosBancarios.find((item) => item.codigo === estadoBancario);
      const normalizedSelectedState = (selectedState?.nombre ?? estadoBancario).trim().toLocaleLowerCase('es');
      if (normalizedSelectedState !== operation.estadoOrigen.toLocaleLowerCase('es')) { setMovementMessage(`La operación “${operation.nombre}” requiere el estado origen “${operation.estadoOrigen}”, pero el filtro seleccionado es “${selectedState?.nombre ?? estadoBancario}”.`); return; }
      const destination = cuentasDestino.find((item) => item.codigo === cuentaDestino);
      if (!destination) { setMovementMessage('Seleccioná una cuenta destino.'); return; }
      const documents = selectedMatches.map((item) => ({
        documentoFisicoId: String(item.cheque?.documentoFisicoId ?? ''),
        referencia: String(rows[item.index]?.Referencia ?? ''),
        importe: rows[item.index]?.Importe ?? null,
        cuentaOrigen: String(item.cheque?.cuenta ?? ''),
        fechaVencimiento: item.cheque?.fechaVencimiento ? String(item.cheque.fechaVencimiento) : null,
      }));
      if (documents.some((item) => !item.documentoFisicoId)) { setMovementMessage('Finnegans no devolvió el documentofisicoID de uno o más cheques seleccionados.'); return; }
      if (documents.some((item) => !item.cuentaOrigen)) { setMovementMessage('No se pudo determinar la cuenta origen de uno o más cheques seleccionados.'); return; }
      const preview = { tipoDocumento: tipoDocumento.trim(), operacion: operation.nombre, operacionId: operation.codigo, empresaId: empresa, estadoOrigen: operation.estadoOrigen, estadoDestino: operation.estadoDestino, cuentaDestino: destination.nombre, cuentaDestinoId: destination.codigo, documentos: documents };
      const previewResponse = await fetch('/api/movimientos-fondos', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ...preview, fecha: todayInBuenosAires(), descripcion: `${preview.operacion} - Conciliación Excel`, previewOnly: true }),
      });
      const previewBody = await previewResponse.json();
      if (!previewResponse.ok) throw new Error(previewBody.error);
      setAsientoPreview(preview);
      setMovementJson(previewBody.payload);
    } catch (cause) {
      setMovementMessage(cause instanceof Error ? cause.message : 'No se pudo crear la vista previa del movimiento.');
    } finally {
      setMovementLoading(false);
    }
  }

  async function submitMovement() {
    if (!asientoPreview || movementSending) return;
    if (!window.confirm(`Se creará un movimiento ${asientoPreview.tipoDocumento} con ${asientoPreview.documentos.length} documentos en Finnegans. ¿Confirmar?`)) return;
    setMovementSending(true); setMovementMessage(''); setMovementSuccess('');
    setEndpointResponse(null); setEndpointResponseOk(null);
    let receivedResponse = false;
    try {
      const response = await fetch('/api/movimientos-fondos', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ...asientoPreview, fecha: todayInBuenosAires(), descripcion: `${asientoPreview.operacion} - Conciliación Excel`, documentos: asientoPreview.documentos }),
      });
      const body = await response.json();
      receivedResponse = true;
      setEndpointResponse(body);
      setEndpointResponseOk(response.ok);
      if (!response.ok) throw new Error(body.error);
      const transactionId = body.result?.TransaccionID ?? body.result?.transaccionID ?? body.result?.id;
      setMovementSuccess(transactionId ? `Movimiento creado correctamente. Transacción: ${transactionId}.` : 'Movimiento creado correctamente en Finnegans.');
    } catch (cause) {
      if (!receivedResponse) { setEndpointResponse({ error: cause instanceof Error ? cause.message : 'Error desconocido.' }); setEndpointResponseOk(false); }
      setMovementMessage(cause instanceof Error ? cause.message : 'No se pudo crear el movimiento en Finnegans.');
    } finally { setMovementSending(false); }
  }

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
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
            <label className="block"><span className="mb-1.5 block text-xs font-semibold text-[#49505b]">Fecha hasta</span><input type="date" value={fechaHasta} onChange={(event) => setFechaHasta(event.target.value)} className="w-full rounded-lg border border-[#cdcfd2] bg-white px-3 py-2.5 text-sm text-[#04102d] outline-none transition focus:border-[#3985ff] focus:ring-2 focus:ring-[#3985ff]/15"/></label>
            <label className="block"><span className="mb-1.5 block text-xs font-semibold text-[#49505b]">Tipo de cheque</span><select value={tipoCheque} onChange={(event) => setTipoCheque(event.target.value)} className="w-full rounded-lg border border-[#cdcfd2] bg-white px-3 py-2.5 text-sm text-[#04102d] outline-none transition focus:border-[#3985ff] focus:ring-2 focus:ring-[#3985ff]/15"><option value="0">Propio</option><option value="1">Tercero</option></select></label>
            <label className="block"><span className="mb-1.5 block text-xs font-semibold text-[#49505b]">Estado bancario</span><select value={estadoBancario} onChange={(event) => setEstadoBancario(event.target.value)} disabled={!estadosBancarios.length} className="w-full rounded-lg border border-[#cdcfd2] bg-white px-3 py-2.5 text-sm text-[#04102d] outline-none transition focus:border-[#3985ff] focus:ring-2 focus:ring-[#3985ff]/15 disabled:bg-[#f8f8f9] disabled:text-[#898e95]">{estadosBancarios.length ? estadosBancarios.map((estado) => <option key={estado.codigo} value={estado.codigo}>{estado.nombre}</option>) : <option>Cargando estados…</option>}</select></label>
            <label className="block"><span className="mb-1.5 block text-xs font-semibold text-[#49505b]">Cuenta contable</span><select value={cuentaContable} onChange={(event) => setCuentaContable(event.target.value)} disabled={!cuentasDestino.length} className="w-full rounded-lg border border-[#cdcfd2] bg-white px-3 py-2.5 text-sm text-[#04102d] outline-none transition focus:border-[#3985ff] focus:ring-2 focus:ring-[#3985ff]/15 disabled:bg-[#f8f8f9] disabled:text-[#898e95]"><option value="">Todas las cuentas</option>{cuentasDestino.map((cuenta) => <option key={cuenta.codigo} value={cuenta.codigo}>{cuenta.nombre}</option>)}</select></label>
            <label className="block"><span className="mb-1.5 block text-xs font-semibold text-[#49505b]">Empresa / sucursal</span><select value={empresa} onChange={(event) => setEmpresa(event.target.value)} disabled={!empresasSucursales.length} className="w-full rounded-lg border border-[#cdcfd2] bg-white px-3 py-2.5 text-sm text-[#04102d] outline-none transition focus:border-[#3985ff] focus:ring-2 focus:ring-[#3985ff]/15 disabled:bg-[#f8f8f9] disabled:text-[#898e95]"><option value="">Todas las empresas y sucursales</option>{empresasSucursales.map((item) => <option key={item.codigo} value={item.codigo}>{item.nombre}</option>)}</select></label>
            <button type="button" onClick={() => setRefreshCounter((value) => value + 1)} disabled={apiStatus === 'loading' || !estadoBancario} className="self-end rounded-lg bg-[#3985ff] px-5 py-2.5 text-sm font-semibold text-white shadow-[0_8px_20px_rgba(57,133,255,.2)] transition hover:bg-[#017ce2] disabled:cursor-not-allowed disabled:opacity-60">{apiStatus === 'loading' ? 'Actualizando…' : 'Actualizar'}</button>
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
            <div className="flex flex-col gap-3 border-b border-[#e1e2e4] px-5 py-4 sm:flex-row sm:items-center sm:justify-between"><div><h3 className="font-semibold text-[#04102d]">Detalle importado</h3><p className="mt-0.5 text-xs text-[#898e95]">{filteredRows.length} de {rows.length} registros · {selectedRows.size} seleccionados</p></div><div className="flex gap-2"><label className="relative flex-1 sm:w-72"><span className="sr-only">Buscar en los registros</span><span className="absolute left-3 top-2.5 text-sm text-[#898e95]">⌕</span><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Buscar descripción o referencia" className="w-full rounded-lg border border-[#cdcfd2] py-2 pl-9 pr-3 text-sm outline-none transition focus:border-[#3985ff] focus:ring-2 focus:ring-[#3985ff]/15"/></label><button onClick={clearImport} className="whitespace-nowrap rounded-lg border border-[#cdcfd2] px-4 py-2 text-sm font-semibold text-[#49505b] transition hover:border-[#3985ff] hover:bg-[#eef5ff] hover:text-[#1529a0]">Cambiar archivo</button></div></div>
            <div className="overflow-x-auto"><table className="w-full min-w-[1200px] border-collapse text-sm"><thead><tr className="bg-[#f0effa] text-left text-[11px] uppercase tracking-wider text-[#49505b]"><th className="w-12 border-b border-[#dcdffc] px-5 py-3"><input type="checkbox" aria-label="Seleccionar todos los registros visibles" checked={filteredRows.length > 0 && filteredRows.every((row) => selectedRows.has(rows.indexOf(row)))} onChange={toggleVisibleRows} className="h-4 w-4 accent-[#3985ff]"/></th>{columns.map((column) => <th key={column} className={`border-b border-[#dcdffc] px-5 py-3 font-semibold ${column === 'Importe' ? 'text-right' : ''}`}>{column}</th>)}<th className="border-b border-[#dcdffc] px-5 py-3 font-semibold">Situación</th><th className="border-b border-[#dcdffc] px-5 py-3 font-semibold">DOCUMENTOFISICOID</th><th className="border-b border-[#dcdffc] px-5 py-3 font-semibold">Cuenta</th><th className="border-b border-[#dcdffc] px-5 py-3 font-semibold">Banco / documento</th></tr></thead><tbody>{filteredRows.map((row) => { const originalIndex = rows.indexOf(row); const result = matchResults.find((item) => item.index === originalIndex); return <tr key={`${String(row.Referencia)}-${originalIndex}`} className={`border-b border-[#eff0f1] last:border-0 hover:bg-[#eef5ff] ${selectedRows.has(originalIndex) ? 'bg-[#eef5ff]' : ''}`}><td className="px-5 py-3.5"><input type="checkbox" aria-label={`Seleccionar referencia ${String(row.Referencia)}`} checked={selectedRows.has(originalIndex)} onChange={() => toggleRow(originalIndex)} className="h-4 w-4 accent-[#3985ff]"/></td>{columns.map((column) => <td key={column} className={`whitespace-nowrap px-5 py-3.5 ${column === 'Importe' ? 'text-right font-medium tabular-nums text-[#1529a0]' : column === 'Referencia' ? 'font-mono text-xs text-[#0847ae]' : 'text-[#49505b]'}`}>{displayValue(row[column], column)}</td>)}<td className="whitespace-nowrap px-5 py-3.5">{matching ? <span className="text-xs text-[#898e95]">Comparando…</span> : result?.matched ? <span className="rounded-full bg-[#ebfcf7] px-2.5 py-1 text-xs font-semibold text-[#006b33]">Coincide · {String(result.cheque?.estado ?? 'Emitido')}</span> : <span className="rounded-full bg-[#feeff0] px-2.5 py-1 text-xs font-semibold text-[#a83c34]">No encontrado</span>}</td><td className="whitespace-nowrap px-5 py-3.5 font-mono text-xs text-[#0847ae]">{result?.cheque ? String(result.cheque.documentoFisicoId ?? '—') : '—'}</td><td className="whitespace-nowrap px-5 py-3.5 text-xs font-medium text-[#04102d]">{result?.cheque ? String(result.cheque.cuenta ?? '—') : '—'}</td><td className="px-5 py-3.5 text-xs text-[#49505b]">{result?.cheque ? <><p className="font-semibold">{String(result.cheque.banco ?? '—')}</p><p className="mt-0.5 text-[#898e95]">{String(result.cheque.documento ?? '—')}</p></> : '—'}</td></tr>; })}</tbody></table>{!filteredRows.length && <div className="px-6 py-14 text-center text-sm text-[#898e95]">No hay registros que coincidan con la búsqueda.</div>}</div>
            <div className="flex flex-col border-t border-[#e1e2e4] bg-[#f8f8f9] px-5 py-5">
              <div className="mb-4"><h3 className="font-semibold text-[#04102d]">Crear movimiento bancario</h3><p className="mt-1 text-xs text-[#898e95]">Se aplicará a los {selectedRows.size} registros seleccionados.</p></div>
              <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-[.65fr_1fr_1fr_auto] xl:items-end">
                <label className="block"><span className="mb-1.5 block text-xs font-semibold text-[#49505b]">Tipo de documento</span><input type="text" value={tipoDocumento} onChange={(event) => setTipoDocumento(event.target.value.toUpperCase())} className="w-full rounded-lg border border-[#cdcfd2] bg-white px-3 py-2.5 font-mono text-sm text-[#04102d] outline-none transition focus:border-[#3985ff] focus:ring-2 focus:ring-[#3985ff]/15"/></label>
                <label className="block"><span className="mb-1.5 block text-xs font-semibold text-[#49505b]">Operación bancaria</span><select value={operacionBancaria} onChange={(event) => setOperacionBancaria(event.target.value)} disabled={!operacionesBancarias.length} className="w-full rounded-lg border border-[#cdcfd2] bg-white px-3 py-2.5 text-sm text-[#04102d] outline-none transition focus:border-[#3985ff] focus:ring-2 focus:ring-[#3985ff]/15 disabled:bg-[#f0f1f2] disabled:text-[#898e95]">{operacionesBancarias.length ? operacionesBancarias.map((operacion) => <option key={operacion.codigo} value={operacion.codigo}>{operacion.nombre}</option>) : <option>Cargando operaciones…</option>}</select></label>
                <label className="block"><span className="mb-1.5 block text-xs font-semibold text-[#49505b]">Cuenta destino</span><select value={cuentaDestino} onChange={(event) => setCuentaDestino(event.target.value)} disabled={!cuentasDestino.length} className="w-full rounded-lg border border-[#cdcfd2] bg-white px-3 py-2.5 text-sm text-[#04102d] outline-none transition focus:border-[#3985ff] focus:ring-2 focus:ring-[#3985ff]/15 disabled:bg-[#f0f1f2] disabled:text-[#898e95]">{cuentasDestino.length ? cuentasDestino.map((cuenta) => <option key={cuenta.codigo} value={cuenta.codigo}>{cuenta.nombre}</option>) : <option>Cargando cuentas…</option>}</select></label>
                <button type="button" onClick={() => void createMovementPreview()} disabled={movementLoading} className="rounded-lg bg-[#3985ff] px-5 py-2.5 text-sm font-semibold text-white shadow-[0_8px_20px_rgba(57,133,255,.18)] transition hover:bg-[#017ce2] disabled:cursor-wait disabled:opacity-60">{movementLoading ? 'Consultando operación…' : 'Crear movimiento'}</button>
              </div>
              {movementJson != null && <div className="order-1 mt-4 overflow-hidden rounded-xl border border-[#dcdffc] bg-[#04102d]"><div className="border-b border-white/10 px-4 py-3 text-sm font-semibold text-white">JSON que se enviará a Finnegans</div><pre className="max-h-96 overflow-auto p-4 text-xs leading-5 text-[#b9e6ff]">{JSON.stringify(movementJson, null, 2)}</pre></div>}
              {asientoPreview && movementJson != null && <div className="order-2 mt-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"><p className="text-xs text-[#49505b]">Esta acción realizará un POST real en Finnegans.</p><button type="button" onClick={() => void submitMovement()} disabled={movementSending} className="rounded-lg bg-[#006b33] px-5 py-2.5 text-sm font-semibold text-white shadow-[0_8px_20px_rgba(0,107,51,.18)] transition hover:bg-[#005329] disabled:cursor-wait disabled:opacity-60">{movementSending ? 'Enviando a Finnegans…' : 'Confirmar y enviar a Finnegans'}</button></div>}
              {movementSuccess && <div role="status" className="order-3 mt-4 rounded-lg border border-[#b8e8d5] bg-[#ebfcf7] px-4 py-3 text-sm font-semibold text-[#006b33]">{movementSuccess}</div>}
              {endpointResponse != null && <div className={`order-4 mt-4 overflow-hidden rounded-xl border ${endpointResponseOk ? 'border-[#b8e8d5] bg-[#ebfcf7]' : 'border-[#efc7c3] bg-[#fff5f4]'}`}><div className={`border-b px-4 py-3 text-sm font-semibold ${endpointResponseOk ? 'border-[#b8e8d5] text-[#006b33]' : 'border-[#efc7c3] text-[#a83c34]'}`}>{endpointResponseOk ? 'Respuesta de Finnegans' : 'Error devuelto por el endpoint'}</div><pre className="max-h-80 overflow-auto p-4 text-xs leading-5 text-[#1b2432]">{JSON.stringify(endpointResponse, null, 2)}</pre></div>}
              {movementMessage && <div role="alert" className="mt-4 rounded-lg border border-[#efc7c3] bg-[#fff5f4] px-4 py-3 text-sm text-[#a83c34]">{movementMessage}</div>}
              {asientoPreview && <div className="mt-5 overflow-hidden rounded-xl border border-[#dcdffc] bg-white"><div className="border-b border-[#dcdffc] bg-[#f0effa] px-4 py-3"><p className="text-sm font-semibold text-[#04102d]">Vista previa · MovimientoFondo</p><p className="mt-1 text-xs text-[#49505b]">{asientoPreview.operacion} · {asientoPreview.estadoOrigen} → {asientoPreview.estadoDestino}</p></div><div className="overflow-x-auto"><table className="w-full min-w-[820px] text-sm"><thead><tr className="border-b border-[#e1e2e4] text-left text-[11px] uppercase tracking-wider text-[#898e95]"><th className="px-4 py-3">documentofisicoID</th><th className="px-4 py-3">Referencia</th><th className="px-4 py-3">Cuenta</th><th className="px-4 py-3">Debe</th><th className="px-4 py-3">Haber</th><th className="px-4 py-3">Estado destino</th></tr></thead><tbody>{asientoPreview.documentos.flatMap((item) => [<tr key={`${item.documentoFisicoId}-origen`} className="border-b border-[#eff0f1]"><td className="px-4 py-3 font-mono text-xs">{item.documentoFisicoId}</td><td className="px-4 py-3">{item.referencia}</td><td className="px-4 py-3">{item.cuentaOrigen}</td><td className="px-4 py-3 text-right">—</td><td className="px-4 py-3 text-right font-medium">{formatMoney(item.importe)}</td><td className="px-4 py-3">{asientoPreview.estadoOrigen}</td></tr>, <tr key={`${item.documentoFisicoId}-destino`} className="border-b border-[#eff0f1] bg-[#fbfcff]"><td className="px-4 py-3 font-mono text-xs">{item.documentoFisicoId}</td><td className="px-4 py-3">{item.referencia}</td><td className="px-4 py-3">{asientoPreview.cuentaDestino}</td><td className="px-4 py-3 text-right font-medium">{formatMoney(item.importe)}</td><td className="px-4 py-3 text-right">—</td><td className="px-4 py-3 font-medium text-[#006b33]">{asientoPreview.estadoDestino}</td></tr>])}</tbody></table></div></div>}
            </div>
          </section>
        </>}
      </div>
    </main>
  );
}
