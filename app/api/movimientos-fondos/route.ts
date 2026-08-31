import { NextRequest, NextResponse } from 'next/server';

type MovimientoDocument = {
  documentoFisicoId?: unknown;
  referencia?: unknown;
  importe?: unknown;
  cuentaOrigen?: unknown;
  fechaVencimiento?: unknown;
};

function requiredEnv(name: string) {
  const value = process.env[name];
  if (!value) throw new Error(`Falta configurar ${name}.`);
  return value;
}

function amount(value: unknown) {
  if (typeof value === 'number') return value;
  const text = String(value ?? '').trim().replace(/[^0-9,.-]/g, '');
  const normalized = text.includes(',') && text.includes('.') ? text.replace(/\./g, '').replace(',', '.') : text.replace(',', '.');
  return Number(normalized);
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

export async function POST(request: NextRequest) {
  try {
    const body = await request.json() as {
      tipoDocumento?: string; descripcion?: string; empresaId?: string; fecha?: string;
      operacionId?: string; estadoDestino?: string; cuentaDestinoId?: string; documentos?: MovimientoDocument[];
    };
    const tipoDocumento = String(body.tipoDocumento ?? '').trim();
    const empresaId = String(body.empresaId ?? '').trim();
    const operacionId = String(body.operacionId ?? '').trim();
    const estadoDestino = String(body.estadoDestino ?? '').trim();
    const cuentaDestinoId = String(body.cuentaDestinoId ?? '').trim();
    const fecha = String(body.fecha ?? '').trim();
    if (!tipoDocumento || !empresaId || !operacionId || !estadoDestino || !cuentaDestinoId || !/^\d{4}-\d{2}-\d{2}$/.test(fecha)) {
      return NextResponse.json({ error: 'Faltan datos obligatorios para crear el movimiento.' }, { status: 400 });
    }
    if (!Array.isArray(body.documentos) || !body.documentos.length) {
      return NextResponse.json({ error: 'No se recibieron documentos físicos.' }, { status: 400 });
    }
    const documents = body.documentos.map((item) => ({
      documentoFisicoId: Number(item.documentoFisicoId),
      referencia: String(item.referencia ?? '').trim(),
      importe: amount(item.importe),
      cuentaOrigen: String(item.cuentaOrigen ?? '').trim(),
      fechaVencimiento: item.fechaVencimiento ? String(item.fechaVencimiento) : null,
    }));
    if (documents.some((item) => !Number.isFinite(item.documentoFisicoId) || !item.referencia || !Number.isFinite(item.importe) || item.importe <= 0 || !item.cuentaOrigen)) {
      return NextResponse.json({ error: 'Uno o más documentos contienen datos inválidos.' }, { status: 400 });
    }
    const asientoItems = documents.flatMap((item) => [
      {
        Descripcion: item.referencia, OperacionBancariaID: operacionId, Control1: 1, DebeHaber: 1,
        CuentaID: item.cuentaOrigen, ImporteMonTransaccion: item.importe, ImporteMonPrincipal: item.importe,
        DocumentoFisicoID: item.documentoFisicoId, MonedaIDTransaccion: 'PES', FechaVto: item.fechaVencimiento,
        EstadoIDDocumentoFisico: null, CotizacionMonTransaccion: 1,
      },
      {
        Descripcion: item.referencia, OperacionBancariaID: operacionId, Control1: 0, DebeHaber: -1,
        CuentaID: cuentaDestinoId, ImporteMonTransaccion: item.importe, ImporteMonPrincipal: item.importe,
        DocumentoFisicoID: item.documentoFisicoId, MonedaIDTransaccion: 'PES', FechaVto: item.fechaVencimiento,
        EstadoIDDocumentoFisico: estadoDestino, CotizacionMonTransaccion: 1,
      },
    ]);
    const payload = {
      TransaccionSubtipoID: tipoDocumento,
      TransaccionTipoID: tipoDocumento,
      Descripcion: String(body.descripcion ?? `Conciliación Excel - ${operacionId}`).trim(),
      Firmada: false,
      EmpresaID: empresaId,
      TalonarioID: null,
      MonedaID: 'PES',
      Fecha: fecha,
      FechaComprobante: fecha,
      AsientoItems: asientoItems,
    };
    const token = await requestToken();
    const apiBaseUrl = (process.env.FINNEGANS_REPORT_BASE_URL ?? 'https://api.finneg.com/api').replace(/\/$/, '');
    const params = new URLSearchParams({ ACCESS_TOKEN: token });
    const response = await fetch(`${apiBaseUrl}/MovimientoFondo?${params}`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload), cache: 'no-store',
    });
    const responseText = await response.text();
    let result: unknown = responseText;
    try { result = responseText ? JSON.parse(responseText) : null; } catch { /* Finnegans may return plain text. */ }
    if (!response.ok) {
      const message = typeof result === 'object' && result && 'error' in result ? String((result as { error: unknown }).error) : responseText;
      return NextResponse.json({ error: message || `Finnegans rechazó el movimiento (${response.status}).` }, { status: 502 });
    }
    return NextResponse.json({ success: true, result });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'No se pudo crear el movimiento.' }, { status: 502 });
  }
}
