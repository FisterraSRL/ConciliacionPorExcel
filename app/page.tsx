'use client';

import { ChangeEvent, DragEvent, useEffect, useMemo, useRef, useState } from 'react';
import packageJson from '../package.json';

type Cell = string | number | boolean | Date | null;
type Row = Record<string, Cell>;
type MatchResult = { index: number; matched: boolean; cheque: { estado?: unknown; banco?: unknown; cuenta?: unknown; cuentaCodigo?: unknown; empresa?: unknown; documento?: unknown; fechaVencimiento?: unknown; documentoFisicoId?: unknown } | null };
type EstadoBancario = { codigo: string; nombre: string };
type OperacionBancaria = { codigo: string; nombre: string; estadoOrigen: string | null; estadoDestino: string | null };
type CuentaDestino = { codigo: string; nombre: string };
type EmpresaSucursal = { codigo: string; nombre: string };
type SearchOption = { value: string; label: string };
type SearchableSelectProps = {
  label: string;
  value: string;
  options: SearchOption[];
  onChange: (value: string) => void;
  placeholder: string;
  emptyLabel?: string;
  disabled?: boolean;
  dropUp?: boolean;
};
type AsientoPreview = { tipoDocumento: string; fecha: string; operacion: string; operacionId: string; empresaId: string; estadoOrigen: string; estadoDestino: string; cuentaDestino: string; cuentaDestinoId: string; documentos: Array<{ documentoFisicoId: string; referencia: string; importe: Cell; cuentaOrigen: string; fechaVencimiento: string | null }> };
type ApiError = { error?: string };
const expectedColumns = ['Descripcion', 'Fecha', 'Referencia', 'Importe'];

async function readJson<T>(response: Response) {
  return await response.json() as T & ApiError;
}

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

function accountNameKey(value: unknown) {
  return String(value ?? '')
    .replace(/\s*\([^)]*\)\s*$/, '')
    .trim()
    .toLocaleLowerCase('es');
}

function accountDisplayName(accounts: CuentaDestino[], value: unknown) {
  const accountValue = String(value ?? '').trim();
  if (!accountValue) return '—';
  return accounts.find((account) =>
    account.codigo === accountValue || accountNameKey(account.nombre) === accountNameKey(accountValue)
  )?.nombre ?? accountValue;
}

function SearchableSelect({ label, value, options, onChange, placeholder, emptyLabel, disabled = false, dropUp = false }: SearchableSelectProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const selected = options.find((option) => option.value === value);
  const filteredOptions = useMemo(() => {
    const term = search.trim().toLocaleLowerCase('es');
    if (!term) return options;
    return options.filter((option) => `${option.value} ${option.label}`.toLocaleLowerCase('es').includes(term));
  }, [options, search]);

  useEffect(() => {
    function closeOnOutsideClick(event: MouseEvent) {
      if (!containerRef.current?.contains(event.target as Node)) {
        setOpen(false);
        setSearch('');
      }
    }
    document.addEventListener('mousedown', closeOnOutsideClick);
    return () => document.removeEventListener('mousedown', closeOnOutsideClick);
  }, []);

  function choose(nextValue: string) {
    onChange(nextValue);
    setOpen(false);
    setSearch('');
  }

  return (
    <div className="searchable-select" ref={containerRef}>
      <span className="searchable-select-label">{label}</span>
      <div className="searchable-select-control">
        <input
          type="text"
          role="combobox"
          aria-expanded={open}
          aria-autocomplete="list"
          value={open ? search : selected?.label ?? ''}
          onFocus={() => { setOpen(true); setSearch(''); }}
          onChange={(event) => { setSearch(event.target.value); setOpen(true); }}
          onKeyDown={(event) => { if (event.key === 'Escape') { setOpen(false); setSearch(''); } }}
          placeholder={disabled ? placeholder : emptyLabel ?? `Buscar ${label.toLocaleLowerCase('es')}`}
          disabled={disabled}
          aria-label={label}
          className="searchable-select-search"
        />
        <button type="button" tabIndex={-1} aria-label={`Abrir lista de ${label.toLocaleLowerCase('es')}`} disabled={disabled} className="searchable-select-chevron" onMouseDown={(event) => event.preventDefault()} onClick={() => { setOpen((current) => !current); setSearch(''); }}>⌄</button>
      </div>
      {open && !disabled && <div className={`searchable-select-panel ${dropUp ? 'opens-up' : ''}`}>
        <div className="searchable-select-options" role="listbox" aria-label={label}>
          {emptyLabel && !search.trim() && <button type="button" role="option" aria-selected={value === ''} className={`searchable-select-option ${value === '' ? 'is-selected' : ''}`} onClick={() => choose('')}>{emptyLabel}</button>}
          {filteredOptions.map((option) => <button type="button" role="option" aria-selected={option.value === value} key={option.value} className={`searchable-select-option ${option.value === value ? 'is-selected' : ''}`} onClick={() => choose(option.value)}>{option.label}</button>)}
          {!filteredOptions.length && <p className="searchable-select-empty">No se encontraron resultados.</p>}
        </div>
      </div>}
    </div>
  );
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
  const [apiStatus, setApiStatus] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle');
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
  const [fechaContabilizacion, setFechaContabilizacion] = useState(todayInBuenosAires);
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
      .then(async (response) => { const body = await readJson<{ estados: EstadoBancario[] }>(response); if (!response.ok) throw new Error(body.error); return body; })
      .then((body) => {
        setEstadosBancarios(body.estados);
        if (body.estados.length && !body.estados.some((item: EstadoBancario) => item.codigo === estadoBancario)) {
          setEstadoBancario(body.estados[0].codigo);
        }
      })
      .catch(() => setError('No se pudieron cargar los estados bancarios.'));
    fetch('/api/operaciones-bancarias')
      .then(async (response) => { const body = await readJson<{ operaciones: OperacionBancaria[] }>(response); if (!response.ok) throw new Error(body.error); return body; })
      .then((body) => {
        setOperacionesBancarias(body.operaciones);
        if (body.operaciones.length) setOperacionBancaria(body.operaciones[0].codigo);
      })
      .catch(() => setError('No se pudieron cargar las operaciones bancarias.'));
    fetch('/api/cuentas')
      .then(async (response) => { const body = await readJson<{ cuentas: CuentaDestino[] }>(response); if (!response.ok) throw new Error(body.error); return body; })
      .then((body) => {
        setCuentasDestino(body.cuentas);
        if (body.cuentas.length) setCuentaDestino(body.cuentas[0].codigo);
      })
      .catch(() => setError('No se pudieron cargar las cuentas destino.'));
    fetch('/api/empresas-sucursales')
      .then(async (response) => { const body = await readJson<{ empresasSucursales: EmpresaSucursal[] }>(response); if (!response.ok) throw new Error(body.error); return body; })
      .then((body) => setEmpresasSucursales(body.empresasSucursales))
      .catch(() => setError('No se pudieron cargar las empresas y sucursales.'));
  }, []);

  useEffect(() => {
    if (refreshCounter === 0) return;
    void reconcile(rows, fechaHasta, tipoCheque, estadoBancario, cuentaContable, empresa, true);
  }, [refreshCounter]);

  function resetMovementCreation(clearForm = false) {
    setSelectedRows(new Set());
    if (clearForm) {
      setTipoDocumento('MOVFONDOS');
      setFechaContabilizacion(todayInBuenosAires());
      setOperacionBancaria('');
      setCuentaDestino('');
    }
    setMovementMessage('');
    setAsientoPreview(null);
    setMovementLoading(false);
    setMovementSending(false);
    setMovementSuccess('');
    setMovementJson(null);
    setEndpointResponse(null);
    setEndpointResponseOk(null);
  }

  function refreshFinnegans() {
    resetMovementCreation();
    setMatchResults([]);
    setError('');
    setRefreshCounter((value) => value + 1);
  }

  async function reconcile(parsedRows: Row[], selectedDate = fechaHasta, selectedType = tipoCheque, selectedStatus = estadoBancario, selectedAccount = cuentaContable, selectedCompany = empresa, forceRefresh = false) {
    if (forceRefresh) setApiStatus('loading');
    setMatching(true); setMatchResults([]);
    try {
      const response = await fetch('/api/situacion-cheques', {
        method: 'POST', headers: { 'content-type': 'application/json', 'cache-control': 'no-cache' }, cache: 'no-store',
        body: JSON.stringify({ fechaHasta: selectedDate, tipoCheque: selectedType, estado: selectedStatus, cuentaContable: selectedAccount, empresa: selectedCompany, refresh: forceRefresh, rows: parsedRows.map((row, index) => ({ index, referencia: row.Referencia, importe: row.Importe })) }),
      });
      const body = await readJson<{ results: MatchResult[]; count: number }>(response);
      if (!response.ok) throw new Error(body.error);
      setMatchResults(body.results);
      setSelectedRows(new Set<number>(body.results.filter((item: MatchResult) => item.matched).map((item: MatchResult) => item.index)));
      setApiCount(body.count);
      setApiStatus('ready');
    } catch (cause) {
      setApiStatus('error');
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
    resetMovementCreation(true);
    setMatchResults([]);
    setMatching(false);
    setApiStatus('idle');
    setApiCount(0);
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
  function clearImport() { setRows([]); setColumns([]); setFileName(''); setSheetName(''); setQuery(''); setError(''); setMatchResults([]); setApiStatus('idle'); setApiCount(0); resetMovementCreation(true); }

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
    if (!/^\d{4}-\d{2}-\d{2}$/.test(fechaContabilizacion)) { setMovementMessage('Ingresá una fecha de contabilización válida.'); return; }
    if (!empresa) { setMovementMessage('Seleccioná una empresa / sucursal antes de crear el movimiento.'); return; }
    setMovementLoading(true);
    try {
      const response = await fetch(`/api/operaciones-bancarias?codigo=${encodeURIComponent(selectedOperation.codigo)}`, { cache: 'no-store' });
      const body = await readJson<{ operacion: OperacionBancaria }>(response);
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
        cuentaOrigen: (() => {
          const reportedCode = String(item.cheque?.cuentaCodigo ?? '').trim();
          if (reportedCode && cuentasDestino.some((account) => account.codigo === reportedCode)) return reportedCode;
          const reportedAccount = String(item.cheque?.cuenta ?? '').trim();
          return cuentasDestino.find((account) =>
            account.codigo === reportedAccount ||
            accountNameKey(account.nombre) === accountNameKey(reportedAccount)
          )?.codigo ?? '';
        })(),
        fechaVencimiento: item.cheque?.fechaVencimiento ? String(item.cheque.fechaVencimiento) : null,
      }));
      if (documents.some((item) => !item.documentoFisicoId)) { setMovementMessage('Finnegans no devolvió el documentofisicoID de uno o más cheques seleccionados.'); return; }
      if (documents.some((item) => !item.cuentaOrigen)) { setMovementMessage('No se encontró el código de la cuenta origen de uno o más cheques en el listado de cuentas de Finnegans.'); return; }
      const preview = { tipoDocumento: tipoDocumento.trim(), fecha: fechaContabilizacion, operacion: operation.nombre, operacionId: operation.codigo, empresaId: empresa, estadoOrigen: operation.estadoOrigen, estadoDestino: operation.estadoDestino, cuentaDestino: destination.nombre, cuentaDestinoId: destination.codigo, documentos: documents };
      const previewResponse = await fetch('/api/movimientos-fondos', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ...preview, descripcion: `${preview.operacion} - Conciliación Excel`, previewOnly: true }),
      });
      const previewBody = await readJson<{ payload: unknown }>(previewResponse);
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
        body: JSON.stringify({ ...asientoPreview, descripcion: `${asientoPreview.operacion} - Conciliación Excel`, documentos: asientoPreview.documentos }),
      });
      const body = await readJson<{ result?: Record<string, unknown> }>(response);
      receivedResponse = true;
      setEndpointResponse(body);
      setEndpointResponseOk(response.ok);
      if (!response.ok) throw new Error(body.error);
      const transactionId = body.result?.TransaccionID ?? body.result?.transaccionID ?? body.result?.id;
      const successMessage = transactionId ? `Movimiento creado correctamente. Transacción: ${transactionId}.` : 'Movimiento creado correctamente en Finnegans.';
      window.alert(successMessage);
      window.location.reload();
    } catch (cause) {
      if (!receivedResponse) { setEndpointResponse({ error: cause instanceof Error ? cause.message : 'Error desconocido.' }); setEndpointResponseOk(false); }
      setMovementMessage(cause instanceof Error ? cause.message : 'No se pudo crear el movimiento en Finnegans.');
    } finally { setMovementSending(false); }
  }

  return (
    <main className="finnegans-shell min-h-screen bg-white text-[#1b2432]">
      <div className="finnegans-content mx-auto max-w-[1800px] px-5 py-7 lg:px-9">
        <div className="page-heading mb-5 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div><h2 className="text-[21px] font-medium text-[#3f4650]">Conciliación por Excel - Situación de Cheques</h2><p className="mt-1 text-sm text-[#747b84]">Importación y conciliación de documentos físicos</p></div>
          <div className="flex flex-wrap items-center gap-2">
            <a href="/plantilla-importacion.xlsx" download="Plantilla importacion conciliacion.xlsx" className="inline-flex items-center gap-2 rounded-lg border border-[#3985ff] bg-white px-3.5 py-2 text-xs font-semibold text-[#2675df] transition hover:bg-[#eef5ff]" aria-label="Descargar plantilla Excel vacía"><span aria-hidden="true">↓</span> Descargar plantilla Excel</a>
            <div className={`rounded-sm border px-3 py-1.5 text-xs font-medium ${apiStatus === 'ready' ? 'border-[#aee9d0] bg-[#effcf7] text-[#169568]' : apiStatus === 'error' ? 'border-[#f1c6c6] bg-[#fff4f4] text-[#d34a4a]' : apiStatus === 'loading' ? 'border-[#b9dfff] bg-[#f1f8ff] text-[#168df5]' : 'border-[#d8dce1] bg-[#f8f8f9] text-[#687383]'}`}>{apiStatus === 'ready' ? `Finnegans listo · ${apiCount.toLocaleString('es-AR')} cheques` : apiStatus === 'error' ? 'Finnegans no disponible' : apiStatus === 'loading' ? 'Consultando Finnegans…' : 'Pendiente de actualizar'}</div>
            <span className="rounded-full border border-[#dcdffc] bg-[#f0effa] px-2.5 py-1 font-mono text-[11px] font-semibold text-[#1529a0]" title="Versión publicada">v{packageJson.version}</span>
          </div>
        </div>

        <section className="finnegans-filters mb-5 rounded-2xl border border-[#e1e2e4] bg-white p-5 shadow-[0_8px_28px_rgba(31,52,69,.05)]">
          <div className="mb-4"><h3 className="font-semibold text-[#04102d]">Filtros de Finnegans</h3><p className="mt-1 text-xs text-[#898e95]">Definen qué cheques se consultan y se comparan con el archivo.</p></div>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
            <label className="block"><span className="mb-1.5 block text-xs font-semibold text-[#49505b]">Fecha hasta</span><input type="date" value={fechaHasta} onChange={(event) => setFechaHasta(event.target.value)} className="w-full rounded-lg border border-[#cdcfd2] bg-white px-3 py-2.5 text-sm text-[#04102d] outline-none transition focus:border-[#3985ff] focus:ring-2 focus:ring-[#3985ff]/15"/></label>
            <label className="block"><span className="mb-1.5 block text-xs font-semibold text-[#49505b]">Tipo de cheque</span><select value={tipoCheque} onChange={(event) => setTipoCheque(event.target.value)} className="w-full rounded-lg border border-[#cdcfd2] bg-white px-3 py-2.5 text-sm text-[#04102d] outline-none transition focus:border-[#3985ff] focus:ring-2 focus:ring-[#3985ff]/15"><option value="0">Propio</option><option value="1">Tercero</option></select></label>
            <SearchableSelect label="Estado bancario" value={estadoBancario} onChange={setEstadoBancario} disabled={!estadosBancarios.length} placeholder="Cargando estados…" options={estadosBancarios.map((estado) => ({ value: estado.codigo, label: estado.nombre }))}/>
            <SearchableSelect label="Cuenta contable" value={cuentaContable} onChange={setCuentaContable} disabled={!cuentasDestino.length} placeholder="Cargando cuentas…" emptyLabel="Todas las cuentas" options={cuentasDestino.map((cuenta) => ({ value: cuenta.codigo, label: `${cuenta.codigo} — ${cuenta.nombre}` }))}/>
            <SearchableSelect label="Empresa / sucursal" value={empresa} onChange={setEmpresa} disabled={!empresasSucursales.length} placeholder="Cargando empresas…" emptyLabel="Todas las empresas y sucursales" options={empresasSucursales.map((item) => ({ value: item.codigo, label: `${item.codigo} — ${item.nombre}` }))}/>
            <button type="button" onClick={refreshFinnegans} disabled={apiStatus === 'loading' || !estadoBancario} className="self-end rounded-lg bg-[#3fc58b] px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-[#2eae76] disabled:cursor-not-allowed disabled:opacity-60">{apiStatus === 'loading' ? 'Actualizando…' : 'Actualizar'}</button>
          </div>
        </section>

        {!rows.length ? <section className="finnegans-upload rounded-2xl border border-[#dfe4e8] bg-white p-4 shadow-[0_8px_28px_rgba(31,52,69,.06)] sm:p-7">
          <div className={`grid min-h-[330px] place-items-center rounded-xl border-2 border-dashed p-8 text-center transition ${dragging ? 'border-[#3985ff] bg-[#eef5ff]' : 'border-[#cdcfd2] bg-[#f8f8f9]'}`} onDragEnter={(e) => { e.preventDefault(); setDragging(true); }} onDragOver={(e) => e.preventDefault()} onDragLeave={() => setDragging(false)} onDrop={onDrop}>
            <div className="max-w-md"><div className="mx-auto mb-5 grid h-16 w-16 place-items-center rounded-2xl bg-gradient-to-br from-[#dcdffc] to-[#e8f7fb] text-3xl text-[#3985ff]">⇧</div><h3 className="text-xl font-semibold text-[#04102d]">Arrastrá tu archivo Excel acá</h3><p className="mt-2 text-sm leading-6 text-[#49505b]">Se admiten archivos .xls y .xlsx con las columnas Descripcion, Fecha, Referencia e Importe.</p>
              <button disabled={loading} onClick={() => inputRef.current?.click()} className="mt-6 rounded-lg bg-[#3fc58b] px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-[#2eae76] disabled:opacity-60">{loading ? 'Leyendo archivo…' : 'Seleccionar archivo'}</button>
              <input ref={inputRef} type="file" accept=".xls,.xlsx" className="sr-only" onChange={onChange}/><p className="mt-5 text-xs text-[#83909a]">El archivo se procesa localmente en tu navegador.</p>
            </div>
          </div>{error && <div role="alert" className="mt-4 rounded-lg border border-[#efc7c3] bg-[#fff5f4] px-4 py-3 text-sm text-[#a83c34]">{error}</div>}
        </section> : <>
          <section className="finnegans-stats mb-5 grid gap-4 md:grid-cols-[1.5fr_1fr_1fr_1fr]">
            <div className="rounded-xl border border-[#e1e2e4] bg-white p-5 shadow-sm"><p className="text-xs font-semibold uppercase tracking-wider text-[#898e95]">Archivo importado</p><div className="mt-3 flex items-center gap-3"><div className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-[#e8f7fb] font-bold text-[#3985ff]">XL</div><div className="min-w-0"><p className="truncate text-sm font-semibold text-[#04102d]">{fileName}</p><p className="mt-0.5 text-xs text-[#898e95]">Hoja: {sheetName}</p></div></div></div>
            <div className="rounded-xl border border-[#e1e2e4] bg-white p-5 shadow-sm"><p className="text-xs font-semibold uppercase tracking-wider text-[#898e95]">Registros</p><p className="mt-3 text-3xl font-semibold tabular-nums text-[#04102d]">{rows.length}</p></div>
            <div className="rounded-xl border border-[#e1e2e4] bg-white p-5 shadow-sm"><p className="text-xs font-semibold uppercase tracking-wider text-[#898e95]">Importe total</p><p className="mt-3 text-2xl font-semibold tabular-nums text-[#1529a0]">{formatMoney(total)}</p></div>
            <div className="rounded-xl border border-[#e1e2e4] bg-white p-5 shadow-sm"><p className="text-xs font-semibold uppercase tracking-wider text-[#898e95]">Coincidencias</p><p className="mt-3 text-3xl font-semibold tabular-nums text-[#006b33]">{matching ? '…' : matchResults.filter((item) => item.matched).length}</p></div>
          </section>
          <section className="finnegans-grid rounded-2xl border border-[#dce3e8] bg-white shadow-[0_8px_28px_rgba(31,52,69,.06)]">
            <div className="flex flex-col gap-3 border-b border-[#e1e2e4] px-5 py-4 sm:flex-row sm:items-center sm:justify-between"><div><h3 className="font-semibold text-[#04102d]">Detalle importado</h3><p className="mt-0.5 text-xs text-[#898e95]">{filteredRows.length} de {rows.length} registros · {selectedRows.size} seleccionados</p></div><div className="flex gap-2"><label className="relative flex-1 sm:w-72"><span className="sr-only">Buscar en los registros</span><span className="absolute left-3 top-2.5 text-sm text-[#898e95]">⌕</span><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Buscar descripción o referencia" className="w-full rounded-lg border border-[#cdcfd2] py-2 pl-9 pr-3 text-sm outline-none transition focus:border-[#3985ff] focus:ring-2 focus:ring-[#3985ff]/15"/></label><button onClick={clearImport} className="whitespace-nowrap rounded-lg border border-[#cdcfd2] px-4 py-2 text-sm font-semibold text-[#49505b] transition hover:border-[#3985ff] hover:bg-[#eef5ff] hover:text-[#1529a0]">Cambiar archivo</button></div></div>
            <div className="overflow-x-auto"><table className="w-full min-w-[1200px] border-collapse text-sm"><thead><tr className="bg-[#f0effa] text-left text-[11px] uppercase tracking-wider text-[#49505b]"><th className="w-12 border-b border-[#dcdffc] px-5 py-3"><input type="checkbox" aria-label="Seleccionar todos los registros visibles" checked={filteredRows.length > 0 && filteredRows.every((row) => selectedRows.has(rows.indexOf(row)))} onChange={toggleVisibleRows} className="h-4 w-4 accent-[#3985ff]"/></th>{columns.map((column) => <th key={column} className={`border-b border-[#dcdffc] px-5 py-3 font-semibold ${column === 'Importe' ? 'text-right' : ''}`}>{column}</th>)}<th className="border-b border-[#dcdffc] px-5 py-3 font-semibold">Situación</th><th className="border-b border-[#dcdffc] px-5 py-3 font-semibold">DOCUMENTOFISICOID</th><th className="border-b border-[#dcdffc] px-5 py-3 font-semibold">Cuenta</th><th className="border-b border-[#dcdffc] px-5 py-3 font-semibold">Banco / documento</th></tr></thead><tbody>{filteredRows.map((row) => { const originalIndex = rows.indexOf(row); const result = matchResults.find((item) => item.index === originalIndex); return <tr key={`${String(row.Referencia)}-${originalIndex}`} className={`border-b border-[#eff0f1] last:border-0 hover:bg-[#eef5ff] ${selectedRows.has(originalIndex) ? 'bg-[#eef5ff]' : ''}`}><td className="px-5 py-3.5"><input type="checkbox" aria-label={`Seleccionar referencia ${String(row.Referencia)}`} checked={selectedRows.has(originalIndex)} onChange={() => toggleRow(originalIndex)} className="h-4 w-4 accent-[#3985ff]"/></td>{columns.map((column) => <td key={column} className={`whitespace-nowrap px-5 py-3.5 ${column === 'Importe' ? 'text-right font-medium tabular-nums text-[#1529a0]' : column === 'Referencia' ? 'font-mono text-xs text-[#0847ae]' : 'text-[#49505b]'}`}>{displayValue(row[column], column)}</td>)}<td className="whitespace-nowrap px-5 py-3.5">{matching ? <span className="text-xs text-[#898e95]">Comparando…</span> : result?.matched ? <span className="rounded-full bg-[#ebfcf7] px-2.5 py-1 text-xs font-semibold text-[#006b33]">Coincide · {String(result.cheque?.estado ?? 'Emitido')}</span> : <span className="rounded-full bg-[#feeff0] px-2.5 py-1 text-xs font-semibold text-[#a83c34]">No encontrado</span>}</td><td className="whitespace-nowrap px-5 py-3.5 font-mono text-xs text-[#0847ae]">{result?.cheque ? String(result.cheque.documentoFisicoId ?? '—') : '—'}</td><td className="whitespace-nowrap px-5 py-3.5 text-xs font-medium text-[#04102d]">{result?.cheque ? String(result.cheque.cuenta ?? '—') : '—'}</td><td className="px-5 py-3.5 text-xs text-[#49505b]">{result?.cheque ? <><p className="font-semibold">{String(result.cheque.banco ?? '—')}</p><p className="mt-0.5 text-[#898e95]">{String(result.cheque.documento ?? '—')}</p></> : '—'}</td></tr>; })}</tbody></table>{!filteredRows.length && <div className="px-6 py-14 text-center text-sm text-[#898e95]">No hay registros que coincidan con la búsqueda.</div>}</div>
            <div className="flex flex-col border-t border-[#e1e2e4] bg-[#f8f8f9] px-5 py-5">
              <div className="mb-4"><h3 className="font-semibold text-[#04102d]">Crear movimiento bancario</h3><p className="mt-1 text-xs text-[#898e95]">Se aplicará a los {selectedRows.size} registros seleccionados.</p></div>
              <div className="movement-controls grid gap-4 md:grid-cols-2 xl:grid-cols-[180px_210px_minmax(260px,1fr)_minmax(300px,1.15fr)_auto] xl:items-end">
                <label className="block"><span className="mb-1.5 block text-xs font-semibold text-[#49505b]">Tipo de documento</span><input type="text" value={tipoDocumento} onChange={(event) => setTipoDocumento(event.target.value.toUpperCase())} className="w-full rounded-lg border border-[#cdcfd2] bg-white px-3 py-2.5 font-mono text-sm text-[#04102d] outline-none transition focus:border-[#3985ff] focus:ring-2 focus:ring-[#3985ff]/15"/></label>
                <label className="block"><span className="mb-1.5 block text-xs font-semibold text-[#49505b]">Fecha de contabilización</span><input type="date" value={fechaContabilizacion} onChange={(event) => setFechaContabilizacion(event.target.value)} className="w-full rounded-lg border border-[#cdcfd2] bg-white px-3 py-2.5 text-sm text-[#04102d] outline-none transition focus:border-[#3985ff] focus:ring-2 focus:ring-[#3985ff]/15"/></label>
                <SearchableSelect label="Operación bancaria" value={operacionBancaria} onChange={setOperacionBancaria} disabled={!operacionesBancarias.length} placeholder="Cargando operaciones…" dropUp options={operacionesBancarias.map((operacion) => ({ value: operacion.codigo, label: `${operacion.codigo} — ${operacion.nombre}` }))}/>
                <SearchableSelect label="Cuenta destino" value={cuentaDestino} onChange={setCuentaDestino} disabled={!cuentasDestino.length} placeholder="Cargando cuentas…" dropUp options={cuentasDestino.map((cuenta) => ({ value: cuenta.codigo, label: `${cuenta.codigo} — ${cuenta.nombre}` }))}/>
                <button type="button" onClick={() => void createMovementPreview()} disabled={movementLoading} className="movement-create-button whitespace-nowrap rounded-lg bg-[#3fc58b] px-6 py-2.5 text-sm font-semibold text-white transition hover:bg-[#2eae76] disabled:cursor-wait disabled:opacity-60">{movementLoading ? 'Consultando operación…' : 'Crear movimiento'}</button>
              </div>
              {movementJson != null && <div className="order-1 mt-3"><a href={`data:application/json;charset=utf-8,${encodeURIComponent(JSON.stringify(movementJson, null, 2))}`} download={`movimiento-finnegans-${asientoPreview?.fecha ?? fechaContabilizacion}.json`} className="inline-flex items-center gap-1.5 text-xs font-semibold text-[#2675df] underline decoration-[#2675df]/40 underline-offset-2 transition hover:text-[#0847ae]" aria-label="Descargar JSON que se enviará a Finnegans"><span aria-hidden="true">↓</span> Descargar JSON para revisión</a></div>}
              {asientoPreview && movementJson != null && <div className="order-2 mt-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"><p className="text-xs text-[#49505b]">Esta acción realizará un POST real en Finnegans.</p><button type="button" onClick={() => void submitMovement()} disabled={movementSending} className="rounded-lg bg-[#3fc58b] px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-[#2eae76] disabled:cursor-wait disabled:opacity-60">{movementSending ? 'Enviando a Finnegans…' : 'Confirmar y enviar a Finnegans'}</button></div>}
              {movementSuccess && <div role="status" className="order-3 mt-4 rounded-lg border border-[#b8e8d5] bg-[#ebfcf7] px-4 py-3 text-sm font-semibold text-[#006b33]">{movementSuccess}</div>}
              {endpointResponse != null && <details className={`order-4 mt-4 rounded-lg border px-4 py-3 ${endpointResponseOk ? 'border-[#b8e8d5] bg-[#ebfcf7]' : 'border-[#efc7c3] bg-[#fff5f4]'}`}><summary className={`cursor-pointer text-xs font-semibold underline decoration-current/40 underline-offset-2 ${endpointResponseOk ? 'text-[#006b33]' : 'text-[#a83c34]'}`}>{endpointResponseOk ? 'Ver respuesta de Finnegans' : 'Ver error devuelto por Finnegans'}</summary><pre className="mt-3 max-h-80 overflow-auto border-t border-current/10 pt-3 text-xs leading-5 text-[#1b2432]">{JSON.stringify(endpointResponse, null, 2)}</pre></details>}
              {movementMessage && <div role="alert" className="mt-4 rounded-lg border border-[#efc7c3] bg-[#fff5f4] px-4 py-3 text-sm text-[#a83c34]">{movementMessage}</div>}
              {asientoPreview && <div className="mt-5 overflow-hidden rounded-xl border border-[#dcdffc] bg-white"><div className="border-b border-[#dcdffc] bg-[#f0effa] px-4 py-3"><p className="text-sm font-semibold text-[#04102d]">Vista previa · MovimientoFondo</p><p className="mt-1 text-xs text-[#49505b]">{asientoPreview.operacion} · {asientoPreview.estadoOrigen} → {asientoPreview.estadoDestino}</p></div><div className="overflow-x-auto"><table className="w-full min-w-[820px] text-sm"><thead><tr className="border-b border-[#e1e2e4] text-left text-[11px] uppercase tracking-wider text-[#898e95]"><th className="px-4 py-3">documentofisicoID</th><th className="px-4 py-3">Referencia</th><th className="px-4 py-3">Cuenta</th><th className="px-4 py-3">Debe</th><th className="px-4 py-3">Haber</th><th className="px-4 py-3">Estado destino</th></tr></thead><tbody>{asientoPreview.documentos.flatMap((item) => [<tr key={`${item.documentoFisicoId}-origen`} className="border-b border-[#eff0f1]"><td className="px-4 py-3 font-mono text-xs">{item.documentoFisicoId}</td><td className="px-4 py-3">{item.referencia}</td><td className="px-4 py-3">{accountDisplayName(cuentasDestino, item.cuentaOrigen)}</td><td className="px-4 py-3 text-right font-medium">{formatMoney(item.importe)}</td><td className="px-4 py-3 text-right">—</td><td className="px-4 py-3">{asientoPreview.estadoOrigen}</td></tr>, <tr key={`${item.documentoFisicoId}-destino`} className="border-b border-[#eff0f1] bg-[#fbfcff]"><td className="px-4 py-3 font-mono text-xs">{item.documentoFisicoId}</td><td className="px-4 py-3">{item.referencia}</td><td className="px-4 py-3">{accountDisplayName(cuentasDestino, asientoPreview.cuentaDestinoId)}</td><td className="px-4 py-3 text-right">—</td><td className="px-4 py-3 text-right font-medium">{formatMoney(item.importe)}</td><td className="px-4 py-3 font-medium text-[#006b33]">{asientoPreview.estadoDestino}</td></tr>])}</tbody></table></div></div>}
            </div>
          </section>
        </>}
      </div>
    </main>
  );
}
