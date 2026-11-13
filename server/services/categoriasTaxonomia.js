/**
 * Taxonomía Oficial Unificada de 3 Niveles de FácilRepuestos
 * (WordPress / WooCommerce https://facilrepuestos.cl + Firebase `inventario` + Panel ERP).
 * Garantiza que ningún producto (ni de Soluparts, ni de Global, ni de proveedores locales)
 * cree categorías sueltas fuera del árbol oficial de 9 familias.
 */

export const ARBOL_CATEGORIAS_TIENDA = [
  {
    nombre: 'Motor',
    subcategorias: [
      { nombre: 'Soportes de Motor', hijas: [] },
      {
        nombre: 'Alimentación e Inyección',
        hijas: ['Inyectores', 'Bombas de Combustible', 'Cuerpo de Aceleración'],
      },
      {
        nombre: 'Escape',
        hijas: ['Múltiples y Catalizadores', 'Silenciadores', 'Sensores de Oxígeno'],
      },
      {
        nombre: 'Componentes Internos',
        hijas: ['Válvulas', 'Empaquetaduras y Juntas', 'Cigüeñal', 'Pistones'],
      },
      {
        nombre: 'Distribución',
        hijas: ['Kits de Distribución', 'Cadenas y Tensores'],
      },
    ],
  },
  {
    nombre: 'Refrigeración y Climatización',
    subcategorias: [
      { nombre: 'Radiadores y Electroventiladores', hijas: [] },
      { nombre: 'Bombas de Agua y Termostatos', hijas: [] },
      { nombre: 'Mangueras y Depósitos', hijas: [] },
      {
        nombre: 'Aire Acondicionado',
        hijas: ['Compresores y Condensadores', 'Evaporadores y Válvulas'],
      },
    ],
  },
  {
    nombre: 'Mantenimiento Rápido',
    subcategorias: [
      {
        nombre: 'Filtros',
        hijas: [
          'Filtro de Aceite',
          'Filtro de Aire',
          'Filtro de Combustible',
          'Filtro de Cabina y Polen',
        ],
      },
      {
        nombre: 'Lubricantes y Fluidos',
        hijas: [
          'Aceites de Motor',
          'Fluidos de Transmisión',
          'Líquido de Frenos',
          'Anticongelante y Refrigerante',
          'Aditivos',
        ],
      },
    ],
  },
  {
    nombre: 'Frenos',
    subcategorias: [
      { nombre: 'Pastillas y Balatas', hijas: [] },
      { nombre: 'Discos y Tambores', hijas: [] },
      { nombre: 'Calipers y Cilindros', hijas: [] },
      { nombre: 'Líneas y Bombas de Freno', hijas: [] },
      {
        nombre: 'Sensores y Cables de Freno',
        hijas: ['Sensores ABS', 'Cables de Freno de Mano'],
      },
    ],
  },
  {
    nombre: 'Suspensión y Dirección',
    subcategorias: [
      {
        nombre: 'Suspensión',
        hijas: ['Amortiguadores', 'Espirales y Resortes', 'Cazoletas y Rodamientos'],
      },
      {
        nombre: 'Dirección',
        hijas: ['Bandejas y Brazos', 'Terminales de Dirección', 'Cremalleras', 'Rótulas'],
      },
    ],
  },
  {
    nombre: 'Transmisión y Mando',
    subcategorias: [
      {
        nombre: 'Embrague y Ejes',
        hijas: ['Homocinéticas y Ejes', 'Kits de Embrague'],
      },
      { nombre: 'Rodamientos de Maza', hijas: [] },
    ],
  },
  {
    nombre: 'Sistema Eléctrico e Iluminación',
    subcategorias: [
      { nombre: 'Baterías y Alternadores', hijas: [] },
      { nombre: 'Motores de Arranque', hijas: [] },
      {
        nombre: 'Iluminación',
        hijas: ['Intermitentes', 'Faros y Focos Traseros', 'Ampolletas y Bulbos'],
      },
      {
        nombre: 'Sensores y Switches',
        hijas: ['Sensores CKP y CMP', 'Sensores de Temperatura y Presión'],
      },
      {
        nombre: 'Encendido',
        hijas: ['Bujías y Cables', 'Bobinas de Encendido'],
      },
    ],
  },
  {
    nombre: 'Carrocería y Espejos',
    subcategorias: [
      { nombre: 'Parachoques y Rejillas', hijas: [] },
      {
        nombre: 'Componentes de Chapa',
        hijas: ['Capó y Puertas', 'Tapabarros y Guardabarros'],
      },
      {
        nombre: 'Espejos Retrovisores',
        hijas: ['Cristales de Espejo', 'Espejos Completos'],
      },
      {
        nombre: 'Accesorios de Carrocería',
        hijas: ['Manillas y Chapas', 'Amortiguadores de Maleta'],
      },
      {
        nombre: 'Limpiaparabrisas',
        hijas: ['Plumillas'],
      },
    ],
  },
  {
    nombre: 'Correas y Piolas',
    subcategorias: [
      { nombre: 'Correas de Accesorios', hijas: [] },
      { nombre: 'Tensores y Poleas', hijas: [] },
      { nombre: 'Piolas y Cables', hijas: [] },
    ],
  },
];

// Alias compatible
export const ARBOL_CATEGORIAS_FRP = ARBOL_CATEGORIAS_TIENDA;

export function normCat(str = '') {
  return String(str || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function construirResultado(categoria, subcategoria, subcategoriaDetalle = '') {
  const detLimpia = subcategoriaDetalle || '';
  const niveles = [categoria, subcategoria, detLimpia].filter(Boolean);
  return {
    categoria,
    subcategoria,
    subcategoriaDetalle: detLimpia,
    categoriaRaiz: categoria,
    categoriaHoja: detLimpia || null,
    categoriaFinal: detLimpia || subcategoria || categoria,
    jerarquiaNombres: niveles,
    categoriaRuta: niveles.join(' > '),
  };
}

/**
 * Clasifica determinísticamente cualquier repuesto en una de las ramas exactas
 * del árbol de 9 categorías de FácilRepuestos:
 * 1. Si el ítem ya trae `categoria` / `subcategoria` / `subcategoriaDetalle` válidos del árbol, los respeta.
 * 2. Si viene de Soluparts / Global / Ailoo o categorías legadas en mayúsculas, infiere los 3 niveles exactos.
 */
export function clasificarProductoEnTaxonomiaFrp(item = {}) {
  const catRaw = normCat(item.categoria);
  const subRaw = normCat(item.subcategoria);
  const detRaw = normCat(item.subcategoriaDetalle || item.categoriaHoja);
  const tipoRaw = normCat(item.tipoPieza);

  // ── 0. Coincidencia explícita con el árbol oficial (ítems editados manualmente en UI) ──
  const catMatch = ARBOL_CATEGORIAS_TIENDA.find((c) => normCat(c.nombre) === catRaw);
  if (catMatch && (subRaw || detRaw)) {
    const subMatch =
      catMatch.subcategorias.find((s) => normCat(s.nombre) === subRaw) ||
      catMatch.subcategorias.find((s) => normCat(s.nombre) === tipoRaw) ||
      catMatch.subcategorias.find((s) =>
        (s.hijas || []).some((h) => normCat(h) === detRaw || normCat(h) === subRaw || normCat(h) === tipoRaw)
      );

    if (subMatch) {
      const detMatch = (subMatch.hijas || []).find(
        (h) => normCat(h) === detRaw || normCat(h) === subRaw || normCat(h) === tipoRaw
      );
      return construirResultado(catMatch.nombre, subMatch.nombre, detMatch || '');
    }
  }

  // Búsqueda directa si subcategoria o subcategoriaDetalle coinciden con un nodo oficial del árbol
  if (detRaw || subRaw) {
    for (const c of ARBOL_CATEGORIAS_TIENDA) {
      for (const s of c.subcategorias) {
        if (subRaw && normCat(s.nombre) === subRaw) {
          const detMatch = (s.hijas || []).find((h) => normCat(h) === detRaw || normCat(h) === tipoRaw) || '';
          return construirResultado(c.nombre, s.nombre, detMatch);
        }
        for (const h of s.hijas || []) {
          if ((detRaw && normCat(h) === detRaw) || (subRaw && normCat(h) === subRaw)) {
            return construirResultado(c.nombre, s.nombre, h);
          }
        }
      }
    }
  }

  // Analizamos primero tipoPieza + parte del nombre previa a "PARA" para no confundir
  // palabras del modelo del vehículo con el tipo de repuesto.
  const nombreAntesDePara = String(item.nombre || '').split(/\s+para\s+/i)[0];
  const baseText = normCat(`${item.tipoPieza || ''} ${nombreAntesDePara} ${item.categoria || ''}`);
  const fullText = normCat(`${item.tipoPieza || ''} ${item.nombre || ''} ${item.categoria || ''}`);

  const has = (regex) => regex.test(baseText) || regex.test(fullText);

  // ── 1. DESAMBIGUACIONES CRÍTICAS (Orden de prioridad estricto) ─────────
  // Amortiguadores de portalón / maleta / capot → Carrocería
  if (has(/\b(AMORTIGUADOR(?:ES)?\s+(?:DE\s+)?(?:PORTALON|MALETA|CAPOT|CAPO|COMPUERTA)|BOMBIN(?:ES)?\s+(?:DE\s+)?(?:PORTALON|MALETA|CAPOT))\b/)) {
    return construirResultado('Carrocería y Espejos', 'Accesorios de Carrocería', 'Amortiguadores de Maleta');
  }

  // Cremallera alzavidrio → Carrocería > Manillas y Chapas (NO Dirección)
  if (has(/\b(ALZAVIDRIOS?|ELEVAVIDRIOS?|CREMALLERAS?\s+ALZAVIDRIOS?)\b/)) {
    return construirResultado('Carrocería y Espejos', 'Accesorios de Carrocería', 'Manillas y Chapas');
  }

  // Depósito limpiaparabrisas / agua → Refrigeración > Mangueras y Depósitos
  if (has(/\b(DEPOSITOS?|RESERVORIOS?|BOTELLAS?)\b/)) {
    return construirResultado('Refrigeración y Climatización', 'Mangueras y Depósitos', '');
  }

  // ── 2. MANTENIMIENTO RÁPIDO (Filtros y Lubricantes) ────────────────────
  if (has(/\b(FILTROS?|PORTAFILTROS?|DECANTADOR(?:ES)?)\b/)) {
    if (has(/\b(ACEITES?)\b/)) {
      return construirResultado('Mantenimiento Rápido', 'Filtros', 'Filtro de Aceite');
    }
    if (has(/\b(COMBUSTIBLES?|BENCINAS?|PETROLEOS?|DIESEL|GASOLINAS?|DECANTADOR(?:ES)?)\b/)) {
      return construirResultado('Mantenimiento Rápido', 'Filtros', 'Filtro de Combustible');
    }
    if (has(/\b(POLEN|CABINAS?|AIRE\s+ACONDICIONADO|HABITACULOS?)\b/)) {
      return construirResultado('Mantenimiento Rápido', 'Filtros', 'Filtro de Cabina y Polen');
    }
    return construirResultado('Mantenimiento Rápido', 'Filtros', 'Filtro de Aire');
  }

  if (has(/\b(ACEITES?\s+(?:DE\s+)?(?:CAJA|TRANSMISION|DIFERENCIAL)|ATF|75W\d+|80W\d+|CVT\s+FLUID)\b/)) {
    return construirResultado('Mantenimiento Rápido', 'Lubricantes y Fluidos', 'Fluidos de Transmisión');
  }
  if (has(/\b(ACEITES?\s+(?:DE\s+)?MOTOR|LUBRICANTES?\s+MOTOR|\d+W\d+)\b/) || (has(/\bACEITES?\b/) && !has(/\b(BOMBAS?|ENFRIADOR(?:ES)?|FILTROS?|RETEN(?:ES)?|SENSOR(?:ES)?|BULBOS?|VARILLAS?|TAPAS?|CARTER)\b/))) {
    return construirResultado('Mantenimiento Rápido', 'Lubricantes y Fluidos', 'Aceites de Motor');
  }
  if (has(/\b(LIQUIDOS?\s+(?:DE\s+)?FRENOS?|DOT\s*[345])\b/)) {
    return construirResultado('Mantenimiento Rápido', 'Lubricantes y Fluidos', 'Líquido de Frenos');
  }
  if (has(/\b(COOLANT|ANTICONGELANTES?|REFRIGERANTES?|AGUA\s+VERDE|AGUA\s+ROJA|AGUA\s+DESMINERALIZADA)\b/)) {
    return construirResultado('Mantenimiento Rápido', 'Lubricantes y Fluidos', 'Anticongelante y Refrigerante');
  }
  if (has(/\b(ADITIVOS?|LIMPIA\s+INYECTOR(?:ES)?|PINOS?\s+AROMATIZANTES?|AROMATIZANTES?)\b/)) {
    return construirResultado('Mantenimiento Rápido', 'Lubricantes y Fluidos', 'Aditivos');
  }

  // ── 3. FRENOS ──────────────────────────────────────────────────────────
  if (has(/\b(PASTILLAS?|BALATAS?|ZAPATAS?|PATIN(?:ES)?\s+FRENO)\b/)) {
    return construirResultado('Frenos', 'Pastillas y Balatas', '');
  }
  if (has(/\b(DISCOS?\s+(?:DE\s+)?FRENOS?|TAMBOR(?:ES)?\s+(?:DE\s+)?FRENOS?|TAMBOR(?:ES)?)\b/) || (has(/\bDISCOS?\b/) && !has(/\bEMBRAGUES?\b/))) {
    return construirResultado('Frenos', 'Discos y Tambores', '');
  }
  if (has(/\b(CALIPERS?|MORDAZAS?|CILINDROS?\s+(?:DE\s+)?(?:FRENOS?|RUEDAS?))\b/)) {
    return construirResultado('Frenos', 'Calipers y Cilindros', '');
  }
  if (has(/\b(BOMBAS?\s+(?:DE\s+)?FRENOS?|SERVOFRENOS?|SERVO\s+FRENOS?|FLEXIBLES?\s+(?:DE\s+)?FRENOS?|CAÑERIAS?\s+FRENOS?)\b/)) {
    return construirResultado('Frenos', 'Líneas y Bombas de Freno', '');
  }
  if (has(/\b(SENSOR(?:ES)?\s+(?:DE\s+)?ABS|ABS)\b/) && has(/\bSENSOR(?:ES)?\b/)) {
    return construirResultado('Frenos', 'Sensores y Cables de Freno', 'Sensores ABS');
  }
  if (has(/\b(CABLES?\s+(?:DE\s+)?FRENOS?|PIOLAS?\s+(?:DE\s+)?FRENOS?)\b/)) {
    return construirResultado('Frenos', 'Sensores y Cables de Freno', 'Cables de Freno de Mano');
  }

  // ── 4. TRANSMISIÓN Y MANDO ─────────────────────────────────────────────
  if (has(/\b(RODAMIENTOS?\s+(?:DE\s+)?MAZAS?|RODAMIENTOS?\s+(?:DE\s+)?RUEDAS?|MAZAS?|CUBOS?\s+RUEDAS?)\b/)) {
    return construirResultado('Transmisión y Mando', 'Rodamientos de Maza', '');
  }
  if (has(/\b(EMBRAGUES?|PRENSAS?|COLLARIN(?:ES)?|BOMBIN(?:ES)?\s+EMBRAGUES?|BOMBAS?\s+EMBRAGUES?|CILINDROS?\s+EMBRAGUES?|HORQUILLAS?\s+EMBRAGUES?|VOLANTES?\s+INERCIA|VOLANTES?\s+MOTOR)\b/)) {
    return construirResultado('Transmisión y Mando', 'Embrague y Ejes', 'Kits de Embrague');
  }
  if (has(/\b(HOMOCINETICAS?|SEMI\s*EJES?|PALIER(?:ES)?|TRIPOIDES?|CARDAN(?:ES)?|CRUCETAS?|DIFERENCIAL(?:ES)?|CAJAS?\s+CAMBIOS?|PALANCAS?\s+CAMBIOS?|FUELLES?\s+HOMOCINETICAS?)\b/) || (has(/\bEJES?\b/) && !has(/\bLEVAS?\b/))) {
    return construirResultado('Transmisión y Mando', 'Embrague y Ejes', 'Homocinéticas y Ejes');
  }

  // ── 5. SUSPENSIÓN Y DIRECCIÓN ──────────────────────────────────────────
  if (has(/\b(CAZOLETAS?|RODAMIENTOS?\s+AMORTIGUADOR(?:ES)?)\b/)) {
    return construirResultado('Suspensión y Dirección', 'Suspensión', 'Cazoletas y Rodamientos');
  }
  if (has(/\b(ESPIRAL(?:ES)?|RESORTES?\s+SUSPENSION|BALLESTAS?|PAQUETES?\s+RESORTES?)\b/)) {
    return construirResultado('Suspensión y Dirección', 'Suspensión', 'Espirales y Resortes');
  }
  if (has(/\b(AMORTIGUADOR(?:ES)?)\b/)) {
    return construirResultado('Suspensión y Dirección', 'Suspensión', 'Amortiguadores');
  }
  if (has(/\b(BANDEJAS?|BRAZOS?\s+SUSPENSION|BIELETAS?|BARRAS?\s+ESTABILIZADORAS?|BUJES?|MUÑON(?:ES)?|MUNON(?:ES)?|CUNAS?|PUENTES?\s+SUSPENSION)\b/)) {
    return construirResultado('Suspensión y Dirección', 'Dirección', 'Bandejas y Brazos');
  }
  if (has(/\b(TERMINAL(?:ES)?|AXIAL(?:ES)?|BARRAS?\s+DIRECCION)\b/)) {
    return construirResultado('Suspensión y Dirección', 'Dirección', 'Terminales de Dirección');
  }
  if (has(/\b(ROTULAS?)\b/)) {
    return construirResultado('Suspensión y Dirección', 'Dirección', 'Rótulas');
  }
  if (has(/\b(CREMALLERAS?|CAJAS?\s+DIRECCION|COLUMNAS?\s+DIRECCION|BOMBAS?\s+DIRECCION)\b/)) {
    return construirResultado('Suspensión y Dirección', 'Dirección', 'Cremalleras');
  }

  // ── 6. REFRIGERACIÓN Y CLIMATIZACIÓN ───────────────────────────────────
  if (has(/\b(COMPRESOR(?:ES)?|CONDENSADOR(?:ES)?)\b/)) {
    return construirResultado('Refrigeración y Climatización', 'Aire Acondicionado', 'Compresores y Condensadores');
  }
  if (has(/\b(EVAPORADOR(?:ES)?|CALEFACCION|VALVULAS?\s+EXPANSION)\b/)) {
    return construirResultado('Refrigeración y Climatización', 'Aire Acondicionado', 'Evaporadores y Válvulas');
  }
  if (has(/\b(RADIADOR(?:ES)?|ELECTROVENTILADOR(?:ES)?|VENTILADOR(?:ES)?|ASPAS|ENCACUZADOR(?:ES)?|INTERCOOLER(?:ES)?|ENFRIADOR(?:ES)?)\b/)) {
    return construirResultado('Refrigeración y Climatización', 'Radiadores y Electroventiladores', '');
  }
  if (has(/\b(BOMBAS?\s+(?:DE\s+)?AGUA|TERMOSTATOS?|TAPAS?\s+TERMOSTATOS?|BASES?\s+TERMOSTATOS?|CAJAS?\s+TERMOSTATOS?|CAÑERIAS?\s+AGUA|TUBOS?\s+AGUA)\b/)) {
    return construirResultado('Refrigeración y Climatización', 'Bombas de Agua y Termostatos', '');
  }
  if (has(/\b(MANGUERAS?|TAPAS?\s+RADIADOR(?:ES)?)\b/)) {
    return construirResultado('Refrigeración y Climatización', 'Mangueras y Depósitos', '');
  }

  // ── 7. SISTEMA ELÉCTRICO E ILUMINACIÓN ─────────────────────────────────
  if (has(/\b(BATERIAS?|ALTERNADOR(?:ES)?)\b/)) {
    return construirResultado('Sistema Eléctrico e Iluminación', 'Baterías y Alternadores', '');
  }
  if (has(/\b(MOTOR(?:ES)?\s+(?:DE\s+)?(?:PARTIDA|ARRANQUE)|ARRANQUES?|BENDIX)\b/)) {
    return construirResultado('Sistema Eléctrico e Iluminación', 'Motores de Arranque', '');
  }
  if (has(/\b(INTERMITENTES?|CORNER|DIRECCIONAL(?:ES)?)\b/)) {
    return construirResultado('Sistema Eléctrico e Iluminación', 'Iluminación', 'Intermitentes');
  }
  if (has(/\b(AMPOLLETAS?|BULBOS?\s+LUZ|HALOGENOS?)\b/)) {
    return construirResultado('Sistema Eléctrico e Iluminación', 'Iluminación', 'Ampolletas y Bulbos');
  }
  if (has(/\b(FAROL(?:ES)?|FAROS?|OPTICOS?|NEBLINEROS?|FOCOS?|LUZ|LUCES|REFLECTANTES?|CATADIOPTRICOS?)\b/)) {
    return construirResultado('Sistema Eléctrico e Iluminación', 'Iluminación', 'Faros y Focos Traseros');
  }
  if (has(/\b(BOBINAS?)\b/)) {
    return construirResultado('Sistema Eléctrico e Iluminación', 'Encendido', 'Bobinas de Encendido');
  }
  if (has(/\b(BUJIAS?|CABLES?\s+BUJIAS?)\b/)) {
    return construirResultado('Sistema Eléctrico e Iluminación', 'Encendido', 'Bujías y Cables');
  }
  if (has(/\b(SENSOR(?:ES)?\s+(?:DE\s+)?OXIGENO|SONDAS?\s+LAMBDA)\b/)) {
    return construirResultado('Motor', 'Escape', 'Sensores de Oxígeno');
  }
  if (has(/\b(SENSOR(?:ES)?\s+(?:DE\s+)?(?:CKP|CMP|CIGUEÑAL|CIGUENAL|LEVAS?|POSICION))\b/)) {
    return construirResultado('Sistema Eléctrico e Iluminación', 'Sensores y Switches', 'Sensores CKP y CMP');
  }
  if (has(/\b(SENSOR(?:ES)?\s+(?:DE\s+)?(?:TEMPERATURA|PRESION|MAP|MAF|ACEITE|AGUA)|BULBOS?)\b/)) {
    return construirResultado('Sistema Eléctrico e Iluminación', 'Sensores y Switches', 'Sensores de Temperatura y Presión');
  }
  if (has(/\b(SENSOR(?:ES)?|TELECOMANDOS?|BOTONERAS?|BOTON(?:ES)?|SWITCH(?:ES)?|INTERRUPTOR(?:ES)?|CINTAS?\s+AIRBAG|RELES?|RELAYS?|MODULOS?|ECU|COMPUTADOR(?:ES)?)\b/)) {
    return construirResultado('Sistema Eléctrico e Iluminación', 'Sensores y Switches', 'Sensores de Temperatura y Presión');
  }

  // ── 8. CORREAS Y PIOLAS ────────────────────────────────────────────────
  if (has(/\b(KITS?\s+(?:DE\s+)?DISTRIBUCION|CORREAS?\s+(?:DE\s+)?DISTRIBUCION|RODILLOS?\s+DISTRIBUCION)\b/)) {
    return construirResultado('Motor', 'Distribución', 'Kits de Distribución');
  }
  if (has(/\b(CADENAS?\s+(?:DE\s+)?DISTRIBUCION|TENSOR(?:ES)?\s+(?:DE\s+)?(?:DISTRIBUCION|CADENA)|GUIAS?\s+CADENA|KITS?\s+CADENA)\b/)) {
    return construirResultado('Motor', 'Distribución', 'Cadenas y Tensores');
  }
  if (has(/\b(CORREAS?)\b/)) {
    return construirResultado('Correas y Piolas', 'Correas de Accesorios', '');
  }
  if (has(/\b(TENSOR(?:ES)?|POLEAS?|DAMPERS?|RODILLOS?)\b/)) {
    return construirResultado('Correas y Piolas', 'Tensores y Poleas', '');
  }
  if (has(/\b(PIOLAS?|CABLES?\s+ACELERADOR|CABLES?\s+EMBRAGUE|CABLES?\s+SELECTORA)\b/)) {
    return construirResultado('Correas y Piolas', 'Piolas y Cables', '');
  }

  // ── 9. CARROCERÍA Y ESPEJOS ────────────────────────────────────────────
  if (has(/\b(PLUMILLAS?|BRAZOS?\s+LIMPIAPARABRISAS|LIMPIAPARABRISAS)\b/)) {
    return construirResultado('Carrocería y Espejos', 'Limpiaparabrisas', 'Plumillas');
  }
  if (has(/\b(CRISTAL(?:ES)?\s+(?:DE\s+)?ESPEJOS?|VIDRIOS?\s+(?:DE\s+)?ESPEJOS?)\b/)) {
    return construirResultado('Carrocería y Espejos', 'Espejos Retrovisores', 'Cristales de Espejo');
  }
  if (has(/\b(ESPEJOS?)\b/)) {
    return construirResultado('Carrocería y Espejos', 'Espejos Retrovisores', 'Espejos Completos');
  }
  if (has(/\b(CAPOT|CAPO|PUERTAS?|PORTALON(?:ES)?|MALETEROS?|BISAGRAS?)\b/)) {
    return construirResultado('Carrocería y Espejos', 'Componentes de Chapa', 'Capó y Puertas');
  }
  if (has(/\b(TAPABARROS?|GUARDAFANGOS?|GUARDABARROS?|MOLDURAS?|ALETAS?|PASA\s+RUEDAS?)\b/)) {
    return construirResultado('Carrocería y Espejos', 'Componentes de Chapa', 'Tapabarros y Guardabarros');
  }
  if (has(/\b(MANILLAS?|CHAPAS?|CERRADURAS?|CILINDROS?\s+CONTACTO)\b/)) {
    return construirResultado('Carrocería y Espejos', 'Accesorios de Carrocería', 'Manillas y Chapas');
  }
  if (has(/\b(PARACHOQUES?|REJILLAS?|MASCARAS?|BISEL(?:ES)?|CROMADOS?|MENSULAS?|DEFENSAS?|FRONTAL(?:ES)?|EMBELLECEDOR(?:ES)?|MARCOS?|PORTAPATENTES?|LOGOS?|EMBLEMAS?|CUBIERTAS?|SPOILERS?|PISADERAS?)\b/)) {
    return construirResultado('Carrocería y Espejos', 'Parachoques y Rejillas', '');
  }

  // ── 10. MOTOR ──────────────────────────────────────────────────────────
  if (has(/\b(SOPORTES?)\b/)) {
    return construirResultado('Motor', 'Soportes de Motor', '');
  }
  if (has(/\b(INYECTOR(?:ES)?|RIEL(?:ES)?\s+INYECTOR(?:ES)?)\b/)) {
    return construirResultado('Motor', 'Alimentación e Inyección', 'Inyectores');
  }
  if (has(/\b(BOMBAS?\s+(?:DE\s+)?(?:BENCINA|COMBUSTIBLE|PETROLEO|INYECTORAS?))\b/)) {
    return construirResultado('Motor', 'Alimentación e Inyección', 'Bombas de Combustible');
  }
  if (has(/\b(CUERPOS?\s+(?:DE\s+)?ACELERACION|PEDAL(?:ES)?\s+ACELERACION|ADMISION)\b/) && !has(/\bMULTIPLES?\b/)) {
    return construirResultado('Motor', 'Alimentación e Inyección', 'Cuerpo de Aceleración');
  }
  if (has(/\b(MULTIPLES?|CATALIZADOR(?:ES)?|CATALITICOS?|TURBOS?)\b/)) {
    return construirResultado('Motor', 'Escape', 'Múltiples y Catalizadores');
  }
  if (has(/\b(SILENCIADOR(?:ES)?|ESCAPES?|TUBOS?\s+ESCAPE)\b/)) {
    return construirResultado('Motor', 'Escape', 'Silenciadores');
  }
  if (has(/\b(VALVULAS?|EJES?\s+LEVAS?|LEVAS?|TAQUIES|TAQUES?|BALANCIN(?:ES)?|CULATAS?)\b/)) {
    return construirResultado('Motor', 'Componentes Internos', 'Válvulas');
  }
  if (has(/\b(EMPAQUETADURAS?|JUNTAS?|RETEN(?:ES)?|SELLOS?|SILICONAS?|ORING|TAPAS?\s+VALVULAS?)\b/)) {
    return construirResultado('Motor', 'Componentes Internos', 'Empaquetaduras y Juntas');
  }
  if (has(/\b(CIGUEÑAL(?:ES)?|CIGUENAL(?:ES)?|METAL(?:ES)?\s+BIELAS?|METAL(?:ES)?\s+BANCADAS?|METAL(?:ES)?|PIÑON(?:ES)?\s+CIGUEÑAL|PINON(?:ES)?\s+CIGUENAL)\b/)) {
    return construirResultado('Motor', 'Componentes Internos', 'Cigüeñal');
  }
  if (has(/\b(PISTON(?:ES)?|ANILLOS?|BIELAS?|CARTER|BOMBAS?\s+ACEITE|ENSAMBLES?\s+MOTOR|BLOCK)\b/)) {
    return construirResultado('Motor', 'Componentes Internos', 'Pistones');
  }

  // Fallback seguro dentro del árbol oficial:
  if (catMatch) {
    const firstSub = catMatch.subcategorias[0];
    return construirResultado(catMatch.nombre, firstSub?.nombre || 'Componentes Internos', firstSub?.hijas?.[0] || '');
  }
  return construirResultado('Motor', 'Componentes Internos', 'Empaquetaduras y Juntas');
}

/**
 * Resuelve la ruta jerárquica `[categoria, subcategoria, subcategoriaDetalle]` (filtrando vacíos)
 * para usar en WooCommerce y en etiquetas de ruta.
 */
export function resolverRutaCategoriasTienda(item = {}) {
  return clasificarProductoEnTaxonomiaFrp(item).jerarquiaNombres;
}
