import { NextResponse } from 'next/server';

const transiciones: Record<string, { estadoOrigen: string; estadoDestino: string }> = {
  CHDIF: { estadoOrigen: 'Emitido', estadoDestino: 'Diferido' },
  COBCHTERENCU: { estadoOrigen: 'Cheque Depositado', estadoDestino: 'Conciliado' },
  RECHCHTERCERO: { estadoOrigen: 'Cheque Depositado', estadoDestino: 'Rechazado' },
  DEPREALIZADO: { estadoOrigen: 'En Cartera', estadoDestino: 'Cheque Depositado' },
  CHENDOSADOS: { estadoOrigen: 'En Cartera', estadoDestino: 'Endosado' },
  RECHEEM: { estadoOrigen: 'Emitido', estadoDestino: 'Rechazado' },
  CANJE: { estadoOrigen: 'Diferido', estadoDestino: 'Canjeado' },
  RECHENDO: { estadoOrigen: 'Endosado', estadoDestino: 'Rechazado' },
};

function requiredEnv(name: string) {
  const value = process.env[name];
  if (!value) throw new Error(`Falta configurar ${name}.`);
  return value;
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

export async function GET() {
  try {
    const token = await requestToken();
    const reportBaseUrl = (process.env.FINNEGANS_REPORT_BASE_URL ?? 'https://api.finneg.com/api').replace(/\/$/, '');
    const params = new URLSearchParams({ ACCESS_TOKEN: token });
    let response: Response | null = null;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      response = await fetch(`${reportBaseUrl}/tipoOperacionBancaria/list?${params}`, { cache: 'no-store' });
      if (response.ok || response.status < 500) break;
      await new Promise((resolve) => setTimeout(resolve, 400 * (attempt + 1)));
    }
    if (!response) throw new Error('No se pudo iniciar la consulta de operaciones bancarias.');
    if (!response.ok) throw new Error(`No se pudieron consultar las operaciones bancarias (${response.status}).`);
    const result = await response.json();
    const rows = Array.isArray(result) ? result : result?.data ?? result?.rows;
    if (!Array.isArray(rows)) throw new Error('La API devolvió un formato inesperado.');
    const operaciones = rows
      .filter((item) => (item?.activo ?? item?.Activo) !== false)
      .map((item) => ({
        codigo: String(item.codigo ?? item.Codigo ?? ''),
        nombre: String(item.nombre ?? item.Nombre ?? ''),
        ...(transiciones[String(item.codigo ?? item.Codigo ?? '')] ?? { estadoOrigen: null, estadoDestino: null }),
      }))
      .filter((item) => item.codigo && item.nombre)
      .sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));
    return NextResponse.json({ operaciones });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Error al consultar operaciones bancarias.' }, { status: 502 });
  }
}
