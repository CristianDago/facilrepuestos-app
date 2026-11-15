// ============================================================================
// FácilRepuestos — Configurador Automático de Zonas de Envío en WooCommerce
// ----------------------------------------------------------------------------
// Configura en WordPress (`https://facilrepuestos.cl/wp-json/wc/v3/shipping/zones`):
//  1. Zona "Región Metropolitana (Furgón FácilRepuestos — Enrique Olivares 224, La Florida)"
//     - Retiro Gratis en Taller (Enrique Olivares 224, La Florida, Santiago) — $0
//     - Delivery Propio FácilRepuestos RM (Furgón Peugeot Partner desde Enrique Olivares 224) — Prepagado
//  2. Zona "Regiones de Chile (Envío Pre-Pagado Starken / Courier según Talla)"
//     - Envío Pre-Pagado a Regiones (Caja Calculada por Talla del Repuesto)
// ============================================================================

import {
  NODOS_DESPACHO_DEFAULT,
  TARIFAS_RM_ANILLOS,
  MACROZONAS_REGIONES,
} from './logisticaTarifarioService.js';

function getWooConfig() {
  return {
    url: (process.env.WOOCOMMERCE_URL || '').replace(/\/+$/, ''),
    key: process.env.WOOCOMMERCE_CONSUMER_KEY || '',
    secret: process.env.WOOCOMMERCE_CONSUMER_SECRET || '',
  };
}

function wcAuthHeader() {
  const { key, secret } = getWooConfig();
  const token = Buffer.from(`${key}:${secret}`).toString('base64');
  return `Basic ${token}`;
}

async function wcFetchShipping(path, options = {}) {
  const { url } = getWooConfig();
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), 25000);
  try {
    const res = await fetch(`${url}/wp-json/wc/v3${path}`, {
      ...options,
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        Authorization: wcAuthHeader(),
        ...(options.headers || {}),
      },
    });
    const text = await res.text();
    let data = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = { raw: text };
    }
    return { ok: res.ok, status: res.status, data };
  } finally {
    clearTimeout(t);
  }
}

export async function sincronizarZonasDespachoWooCommerce() {
  const { url, key, secret } = getWooConfig();
  if (!url || !key || !secret) {
    return {
      sincronizado: false,
      motivo: 'Credenciales WooCommerce no configuradas en entorno local',
    };
  }

  const zonasRes = await wcFetchShipping('/shipping/zones');
  if (!zonasRes.ok || !Array.isArray(zonasRes.data)) {
    return {
      sincronizado: false,
      motivo: `No se pudieron leer las zonas de WooCommerce (${zonasRes.status})`,
    };
  }

  const zonasExistentes = zonasRes.data;
  const hubPrincipal = NODOS_DESPACHO_DEFAULT[0];

  // 1. Asegurar Zona Región Metropolitana (CL:RM)
  let zonaRM = zonasExistentes.find((z) =>
    /metropolitana|santiago|\brm\b/i.test(String(z.name || ''))
  );
  if (!zonaRM) {
    const creada = await wcFetchShipping('/shipping/zones', {
      method: 'POST',
      body: JSON.stringify({
        name: 'Región Metropolitana (Desde Enrique Olivares 224, La Florida)',
        order: 1,
      }),
    });
    zonaRM = creada.data;
  }

  if (zonaRM?.id) {
    await wcFetchShipping(`/shipping/zones/${zonaRM.id}/locations`, {
      method: 'PUT',
      body: JSON.stringify([{ code: 'CL:RM', type: 'state' }]),
    });

    const metodosRMRes = await wcFetchShipping(`/shipping/zones/${zonaRM.id}/methods`);
    const metodosRM = Array.isArray(metodosRMRes.data) ? metodosRMRes.data : [];

    // Asegurar Retiro Gratis en Enrique Olivares 224, La Florida
    const tienePickup = metodosRM.find((m) => m.method_id === 'local_pickup');
    if (!tienePickup) {
      await wcFetchShipping(`/shipping/zones/${zonaRM.id}/methods`, {
        method: 'POST',
        body: JSON.stringify({
          method_id: 'local_pickup',
          enabled: true,
          settings: {
            title: `Retiro Gratis en Taller (${hubPrincipal.direccion})`,
            cost: '0',
          },
        }),
      });
    } else {
      await wcFetchShipping(`/shipping/zones/${zonaRM.id}/methods/${tienePickup.instance_id}`, {
        method: 'PUT',
        body: JSON.stringify({
          enabled: true,
          settings: {
            title: `Retiro Gratis en Taller (${hubPrincipal.direccion})`,
            cost: '0',
          },
        }),
      });
    }

    // Asegurar Delivery Furgón FácilRepuestos en RM
    const tieneFlatRM = metodosRM.find((m) => m.method_id === 'flat_rate');
    if (!tieneFlatRM) {
      await wcFetchShipping(`/shipping/zones/${zonaRM.id}/methods`, {
        method: 'POST',
        body: JSON.stringify({
          method_id: 'flat_rate',
          enabled: true,
          settings: {
            title: 'Delivery Furgón FácilRepuestos RM (Desde Enrique Olivares 224)',
            cost: String(TARIFAS_RM_ANILLOS[2].preciosPorTalla.S),
          },
        }),
      });
    } else {
      await wcFetchShipping(`/shipping/zones/${zonaRM.id}/methods/${tieneFlatRM.instance_id}`, {
        method: 'PUT',
        body: JSON.stringify({
          enabled: true,
          settings: {
            title: 'Delivery Furgón FácilRepuestos RM (Desde Enrique Olivares 224)',
            cost: String(TARIFAS_RM_ANILLOS[2].preciosPorTalla.S),
          },
        }),
      });
    }
  }

  // 2. Asegurar Zona Regiones de Chile (CL)
  let zonaRegiones = zonasExistentes.find((z) =>
    /regiones|chile/i.test(String(z.name || '')) && z.id !== zonaRM?.id
  );
  if (!zonaRegiones) {
    const creadaReg = await wcFetchShipping('/shipping/zones', {
      method: 'POST',
      body: JSON.stringify({
        name: 'Regiones de Chile (Despacho Pre-Pagado Starken / Courier)',
        order: 2,
      }),
    });
    zonaRegiones = creadaReg.data;
  }

  if (zonaRegiones?.id) {
    await wcFetchShipping(`/shipping/zones/${zonaRegiones.id}/locations`, {
      method: 'PUT',
      body: JSON.stringify([{ code: 'CL', type: 'country' }]),
    });

    const metodosRegRes = await wcFetchShipping(`/shipping/zones/${zonaRegiones.id}/methods`);
    const metodosReg = Array.isArray(metodosRegRes.data) ? metodosRegRes.data : [];
    const tieneFlatReg = metodosReg.find((m) => m.method_id === 'flat_rate');

    if (!tieneFlatReg) {
      await wcFetchShipping(`/shipping/zones/${zonaRegiones.id}/methods`, {
        method: 'POST',
        body: JSON.stringify({
          method_id: 'flat_rate',
          enabled: true,
          settings: {
            title: 'Despacho Pre-Pagado Regiones (Starken / Courier a Domicilio)',
            cost: String(MACROZONAS_REGIONES.ZONA_SUR.preciosPorTalla.S),
          },
        }),
      });
    } else {
      await wcFetchShipping(`/shipping/zones/${zonaRegiones.id}/methods/${tieneFlatReg.instance_id}`, {
        method: 'PUT',
        body: JSON.stringify({
          enabled: true,
          settings: {
            title: 'Despacho Pre-Pagado Regiones (Starken / Courier a Domicilio)',
            cost: String(MACROZONAS_REGIONES.ZONA_SUR.preciosPorTalla.S),
          },
        }),
      });
    }
  }

  return {
    sincronizado: true,
    zonaRMId: zonaRM?.id || null,
    zonaRegionesId: zonaRegiones?.id || null,
  };
}
