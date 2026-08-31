import { NextRequest, NextResponse } from 'next/server';

type ApiCheque = Record<string, unknown>;
type ExcelRow = { referencia: unknown; importe: unknown; index: number };

let chequePromise: Promise<ApiCheque[]> | null = null;
let loadedAt = 0;
const CACHE_TTL_MS = 15 * 60 * 1000;

function requiredEnv(name: string) {
  const value = process.env[name];
  if (!value) throw new Error(`Falta configurar ${name}.`);
  return value;
}

function todayInBuenosAires() {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Argentina/Buenos_Aires', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(new Date());
  const part = (type: string) => parts.find((item) => item.type === type)?.value;
  return `${part('year')}-${part('month')}-${part('day')}`;
}

function normalizeReference(value: unknown) {
  return String(value ?? '').trim();
}

function amountInCents(value: unknown) {
  if (typeof value === 'number') return Math.round(value * 100);
  const text = String(value ?? '').trim().replace(/[^0-9,.-]/g, '');
  const normalized = text.includes(',') && text.includes('.')
    ? text.replace(/\./g, '').replace(',', '.')
    : text.replace(',', '.');
  const amount = Number(normalized);
  return Number.isFinite(amount) ? Math.round(amount * 100) : Number.NaN;
}

function matchKey(reference: unknown, amount: unknown) {
  return `${normalizeReference(reference)}|${amountInCents(amount)}`;
}

async function requestToken() {
  const baseUrl = requiredEnv('FINNEGANS_API_BASE_URL').replace(/\/$/, '');
  const params = new URLSearchParams({
    grant_type: 'client_credentials',
    client_id: requiredEnv('FINNEGANS_CLIENT_ID'),
    client_secret: requiredEnv('FINNEGANS_CLIENT_SECRET'),
  });
  const response = await fetch(`${baseUrl}/oauth/token?${params}`, { cache: 'no-store' });
  if (!response.ok) throw new Error(`Finnegans rechazó la autenticación (${response.status}).`);
  const contentType = response.headers.get('content-type') ?? '';
  if (contentType.includes('json')) {
    const body = await response.json() as { access_token?: string };
    if (!body.access_token) throw new Error('Finnegans no devolvió un access token.');
    return body.access_token;
  }
  return (await response.text()).trim();
}

async function loadCheques() {
  if (chequePromise && Date.now() - loadedAt < CACHE_TTL_MS) return chequePromise;
  chequePromise = (async () => {
    const token = await requestToken();
    const params = new URLSearchParams({
      ACCESS_TOKEN: token,
      PARAMWEBREPORT_FechaHasta: todayInBuenosAires(),
      PARAMWEBREPORT_TipoCheque: '0',
      PARAMWEBREPORT_Estado: 'Emitido',
      PARAMWEBREPORT_Organizacion: '',
      PARAMWEBREPORT_CircuitoContable: '',
      PARAMWEBREPORT_CuentaContable: '',
      PARAMWEBREPORT_Empresa: '',
      PARAMWEBREPORT_FechaVencimientoDesde: '',
      PARAMWEBREPORT_FechaVencimientoHasta: '',
      PARAMWEBREPORT_MostrarSoloNoConciliados: 'true',
    });
    const reportBaseUrl = (process.env.FINNEGANS_REPORT_BASE_URL ?? 'https://api.finneg.com/api').replace(/\/$/, '');
    const response = await fetch(`${reportBaseUrl}/reports/ApiSituacionCheques?${params}`, { cache: 'no-store' });
    if (!response.ok) throw new Error(`No se pudo consultar Situación de Cheques (${response.status}).`);
    const result = await response.json();
    const rows = Array.isArray(result) ? result : result?.data ?? result?.rows;
    if (!Array.isArray(rows)) throw new Error('La API devolvió un formato inesperado.');
    loadedAt = Date.now();
    return rows as ApiCheque[];
  })().catch((error) => { chequePromise = null; throw error; });
  return chequePromise;
}

export async function GET() {
  try {
    const cheques = await loadCheques();
    return NextResponse.json({ ready: true, count: cheques.length, loadedAt: new Date(loadedAt).toISOString() });
  } catch (error) {
    return NextResponse.json({ ready: false, error: error instanceof Error ? error.message : 'Error al consultar Finnegans.' }, { status: 502 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json() as { rows?: ExcelRow[] };
    if (!Array.isArray(body.rows)) return NextResponse.json({ error: 'No se recibieron registros.' }, { status: 400 });
    const cheques = await loadCheques();
    const index = new Map<string, ApiCheque>();
    for (const cheque of cheques) {
      const key = matchKey(cheque.NUMERO, cheque.IMPORTEMONTRANSACCION);
      if (!index.has(key)) index.set(key, cheque);
    }
    const results = body.rows.map((row) => {
      const cheque = index.get(matchKey(row.referencia, row.importe));
      return {
        index: row.index,
        matched: Boolean(cheque),
        cheque: cheque ? {
          numero: cheque.NUMERO,
          importe: cheque.IMPORTEMONTRANSACCION,
          estado: cheque.ESTADO,
          banco: cheque.BANCO,
          cuenta: cheque.CUENTA,
          empresa: cheque.EMPRESA,
          documento: cheque.DOCUMENTO,
          fechaVencimiento: cheque.FECHAVENCIMIENTO,
        } : null,
      };
    });
    return NextResponse.json({ results, matched: results.filter((item) => item.matched).length, total: results.length });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Error al conciliar los registros.' }, { status: 502 });
  }
}
