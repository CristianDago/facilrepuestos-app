import { db } from '../config/firebase.js';

// Catálogo interno de prefijos y patrones comunes en autopartes de Chile y Latinoamérica
const FABRICANTES_CONOCIDOS = [
  { match: /^(0986|0\s*986|F002|0204|0250)/i, fabricante: 'BOSCH', tipoPieza: 'FRENOS / INYECCION', categoria: 'FRENOS' },
  { match: /^(W\s*\d|C\s*\d|HU\s*\d|WK\s*\d|CU\s*\d|FP\s*\d)/i, fabricante: 'MANN-FILTER', tipoPieza: 'FILTRO', categoria: 'FILTROS' },
  { match: /^(BKR|LFR|LZKR|DILFR|ILFR|PFR|BPR)/i, fabricante: 'NGK', tipoPieza: 'BUJIAS', categoria: 'MOTOR' },
  { match: /^(FDB|FRP|DS|DDF)/i, fabricante: 'FERODO', tipoPieza: 'PASTILLAS DE FRENO', categoria: 'FRENOS' },
  { match: /^(P\s*\d{2}\s*\d{3}|09\.\w{4}\.\w{2})/i, fabricante: 'BREMBO', tipoPieza: 'PASTILLAS / DISCOS', categoria: 'FRENOS' },
  { match: /^(58\d{3}|69\d{3}|82\d{3})/i, fabricante: 'VALEO', tipoPieza: 'EMBRAGUE / ELECTRICIDAD', categoria: 'EMBRAGUE' },
  { match: /^(33\d{4}|34\d{4}|55\d{4}|66\d{4})/i, fabricante: 'KYB', tipoPieza: 'AMORTIGUADOR', categoria: 'SUSPENSIÓN' },
  { match: /^(GDB\d{3,4}|DF\d{3,4})/i, fabricante: 'TRW', tipoPieza: 'FRENOS', categoria: 'FRENOS' },
  { match: /^(CT\d{3,4}|5PK|6PK|4PK|7PK)/i, fabricante: 'CONTINENTAL / GATES', tipoPieza: 'CORREA DE DISTRIBUCION', categoria: 'DISTRIBUCIÓN' },
  { match: /^(VKMA|VKMC|VKBA|6\d{3}|6\d{4})/i, fabricante: 'SKF', tipoPieza: 'RODAMIENTOS / DISTRIBUCION', categoria: 'DISTRIBUCIÓN' },
];

const CATEGORIAS_KEYWORDS = [
  { palabras: ['PASTILLA', 'FRENO', 'DISCO', 'BALATA', 'CALIPER', 'TAMBOR'], categoria: 'FRENOS', tipo: 'PASTILLAS DE FRENO' },
  { palabras: ['FILTRO', 'ACEITE', 'AIRE', 'COMBUSTIBLE', 'CABINA', 'POLEN'], categoria: 'FILTROS', tipo: 'FILTRO' },
  { palabras: ['ACEITE', 'LUBRICANTE', 'GRASA', 'LIQUIDO FRENO', 'REFRIGERANTE'], categoria: 'LUBRICANTES', tipo: 'LUBRICANTE' },
  { palabras: ['AMORTIGUADOR', 'ESPIRAL', 'BIELETA', 'TERMINAL', 'ROTULA', 'BANDEJA', 'BUJE'], categoria: 'SUSPENSIÓN', tipo: 'AMORTIGUADOR' },
  { palabras: ['BUJIA', 'CORREA', 'KIT DISTRIBUCION', 'VALVULA', 'PISTON', 'EMPAQUETADURA', 'BOMBA AGUA', 'TERMOSTATO'], categoria: 'MOTOR', tipo: 'REPUESTO MOTOR' },
  { palabras: ['EMBRAGUE', 'DISCO EMBRAGUE', 'PRENSA', 'VOLANTE', 'BOMBIN'], categoria: 'EMBRAGUE', tipo: 'KIT EMBRAGUE' },
  { palabras: ['AMPOLLETA', 'SENSOR', 'ALTERNADOR', 'MOTOR PARTIDA', 'BOBINA', 'FUSIBLE', 'BATERIA'], categoria: 'ELÉCTRICO', tipo: 'ELECTRICO' },
];

const MARCAS_AUTOS = [
  'TOYOTA', 'HYUNDAI', 'KIA', 'CHEVROLET', 'NISSAN', 'FORD', 'VOLKSWAGEN',
  'SUZUKI', 'MAZDA', 'MITSUBISHI', 'PEUGEOT', 'RENAULT', 'CITROEN', 'CHERY',
  'MG', 'HAVAL', 'GREAT WALL', 'JAC', 'CHANGAN', 'HONDA', 'SUBARU', 'FIAT', 'JEEP'
];

/**
 * Busca un repuesto primero en la base de datos Firestore local.
 * Si no existe, realiza una búsqueda y enriquecimiento en la web por código/EAN/OEM.
 */
export async function buscarRepuestoPorCodigo(codigoInput, proveedorId = null) {
  const codigoLimpio = String(codigoInput || '').trim().toUpperCase();
  if (!codigoLimpio) {
    throw new Error('Código no proporcionado');
  }

  // ── 1. BUSCAR EN FIRESTORE LOCAL (Inventario existente) ──
  const snapExacto = await db.collection('inventario').where('codigo', '==', codigoLimpio).get();

  if (!snapExacto.empty) {
    const doc = snapExacto.docs[0];
    const data = doc.data();
    return {
      encontrado: true,
      origen: 'inventario_existente',
      item: {
        id: doc.id,
        nombre: data.nombre,
        codigo: data.codigo,
        fabricante: data.fabricante || '',
        categoria: data.categoria || 'OTROS',
        tipoPieza: data.tipoPieza || '',
        stock: data.stock || 0,
        stockMinimo: data.stockMinimo || 2,
        precioCompra: data.precioCompra || 0,
        precioVenta: data.precioVenta || 0,
        posicion: data.posicion || 'NO APLICA',
        lado: data.lado || 'NO APLICA',
        marcasCompatibles: data.marcasCompatibles || [],
        modelosCompatibles: data.modelosCompatibles || {},
        anioDesde: data.anioDesde || null,
        anioHasta: data.anioHasta || null,
        proveedorId: data.proveedorId || null,
        esMio: proveedorId ? data.proveedorId === proveedorId : true,
      },
    };
  }

  // ── 2. ENRIQUECIMIENTO WEB / METADATOS POR CÓDIGO (EAN / OEM / Fabricante) ──
  let datosSugeridos = {
    nombre: '',
    codigo: codigoLimpio,
    fabricante: '',
    categoria: 'OTROS',
    tipoPieza: '',
    posicion: 'NO APLICA',
    lado: 'NO APLICA',
    marcasCompatibles: [],
    modelosCompatibles: {},
    anioDesde: null,
    anioHasta: null,
    stockSugerido: 1,
    precioCompraSugerido: 0,
    precioVentaSugerido: 0,
    descripcion: '',
    fuenteInfo: 'patron_automotriz',
  };

  // 2.1 Coincidencia de patrones conocidos de autopartes
  for (const fab of FABRICANTES_CONOCIDOS) {
    if (fab.match.test(codigoLimpio)) {
      datosSugeridos.fabricante = fab.fabricante;
      datosSugeridos.tipoPieza = fab.tipoPieza;
      datosSugeridos.categoria = fab.categoria;
      datosSugeridos.nombre = `${fab.tipoPieza} ${fab.fabricante} ${codigoLimpio}`.trim();
      break;
    }
  }

  // 2.2 Consulta web en tiempo real usando motores de búsqueda públicos y catálogo automotriz
  try {
    const consultaWeb = `${codigoLimpio} repuesto auto`;
    const searchUrl = `https://api.duckduckgo.com/?q=${encodeURIComponent(consultaWeb)}&format=json&no_html=1&skip_disambig=1`;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 2500); // 2.5s máx para respuesta ágil en mostrador

    const res = await fetch(searchUrl, {
      signal: controller.signal,
      headers: { 'User-Agent': 'FacilRepuestos/1.0 (Automotive Lookup)' },
    });
    clearTimeout(timeout);

    if (res.ok) {
      const ddgData = await res.json();
      const texto = `${ddgData.Heading || ''} ${ddgData.AbstractText || ''} ${JSON.stringify(ddgData.RelatedTopics || [])}`.toUpperCase();

      if (texto.length > 20) {
        datosSugeridos.fuenteInfo = 'web_lookup';
        datosSugeridos.descripcion = ddgData.AbstractText ? ddgData.AbstractText.slice(0, 200) : '';

        // Detectar categoría y tipo
        for (const cat of CATEGORIAS_KEYWORDS) {
          if (cat.palabras.some(p => texto.includes(p))) {
            datosSugeridos.categoria = cat.categoria;
            datosSugeridos.tipoPieza = cat.tipo;
            break;
          }
        }

        // Detectar marcas compatibles mencionadas en la web
        const marcasDetectadas = MARCAS_AUTOS.filter(m => texto.includes(m));
        if (marcasDetectadas.length > 0) {
          datosSugeridos.marcasCompatibles = marcasDetectadas;
        }

        // Si tenemos título o heading claro
        if (ddgData.Heading) {
          datosSugeridos.nombre = `${datosSugeridos.tipoPieza || 'REPUESTO'} ${datosSugeridos.fabricante || ''} ${codigoLimpio}`.trim();
        }
      }
    }
  } catch (err) {
    // Si la llamada web falla o timeout, usamos los datos inferidos por patrón
    console.log(`[Lookup] Consulta web silenciosa para ${codigoLimpio}: ${err.message}`);
  }

  // Si no se asignó nombre, usar tipo de pieza y código
  if (!datosSugeridos.nombre) {
    datosSugeridos.nombre = `REPUESTO ${datosSugeridos.fabricante ? datosSugeridos.fabricante + ' ' : ''}${codigoLimpio}`.trim();
  }

  return {
    encontrado: false,
    origen: 'nuevo_sugerido',
    item: datosSugeridos,
  };
}
