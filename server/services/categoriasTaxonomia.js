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
  if (has(/\b(AMORTIGUADOR\s+(?:DE\s+)?(?:PORTALON|MALETA|CAPOT|CAPO|COMPUERTA)|BOMBIN\s+(?:DE\s+)?(?:PORTALON|MALETA|CAPOT))\b/)) {
    return construirResultado('Carrocería y Espejos', 'Accesorios de Carrocería', 'Amortiguadores de Maleta');
  }

  // Cremallera alzavidrio → Carrocería > Manillas y Chapas (NO Dirección)
  if (has(/\b(ALZAVIDRIO|ELEVAVIDRIO|CREMALLERA\s+ALZAVIDRIO)\b/)) {
    return construirResultado('Carrocería y Espejos', 'Accesorios de Carrocería', 'Manillas y Chapas');
  }

  // Depósito limpiaparabrisas / agua → Refrigeración > Mangueras y Depósitos
  if (has(/\b(DEPOSITO|RESERVORIO|BOTELLA)\b/)) {
    return construirResultado('Refrigeración y Climatización', 'Mangueras y Depósitos', '');
  }

  // ── 2. MANTENIMIENTO RÁPIDO (Filtros y Lubricantes) ────────────────────
  if (has(/\b(FILTRO|PORTAFILTRO|DECANTADOR)\b/)) {
    if (has(/\b(ACEITE)\b/)) {
      return construirResultado('Mantenimiento Rápido', 'Filtros', 'Filtro de Aceite');
    }
    if (has(/\b(COMBUSTIBLE|BENCINA|PETROLEO|DIESEL|GASOLINA|DECANTADOR)\b/)) {
      return construirResultado('Mantenimiento Rápido', 'Filtros', 'Filtro de Combustible');
    }
    if (has(/\b(POLEN|CABINA|AIRE\s+ACONDICIONADO|HABITACULO)\b/)) {
      return construirResultado('Mantenimiento Rápido', 'Filtros', 'Filtro de Cabina y Polen');
    }
    return construirResultado('Mantenimiento Rápido', 'Filtros', 'Filtro de Aire');
  }

  if (has(/\b(ACEITE\s+(?:DE\s+)?(?:CAJA|TRANSMISION|DIFERENCIAL)|ATF|75W\d+|80W\d+|CVT\s+FLUID)\b/)) {
    return construirResultado('Mantenimiento Rápido', 'Lubricantes y Fluidos', 'Fluidos de Transmisión');
  }
  if (has(/\b(ACEITE\s+(?:DE\s+)?MOTOR|LUBRICANTE\s+MOTOR|\d+W\d+)\b/) || (has(/\bACEITE\b/) && !has(/\b(BOMBA|ENFRIADOR|FILTRO|RETEN|SENSOR|BULBO|VARILLA|TAPA|CARTER)\b/))) {
    return construirResultado('Mantenimiento Rápido', 'Lubricantes y Fluidos', 'Aceites de Motor');
  }
  if (has(/\b(LIQUIDO\s+(?:DE\s+)?FRENO|DOT\s*[345])\b/)) {
    return construirResultado('Mantenimiento Rápido', 'Lubricantes y Fluidos', 'Líquido de Frenos');
  }
  if (has(/\b(COOLANT|ANTICONGELANTE|REFRIGERANTE|AGUA\s+VERDE|AGUA\s+ROJA|AGUA\s+DESMINERALIZADA)\b/)) {
    return construirResultado('Mantenimiento Rápido', 'Lubricantes y Fluidos', 'Anticongelante y Refrigerante');
  }
  if (has(/\b(ADITIVO|LIMPIA\s+INYECTOR|PINO\s+AROMATIZANTE|AROMATIZANTE)\b/)) {
    return construirResultado('Mantenimiento Rápido', 'Lubricantes y Fluidos', 'Aditivos');
  }

  // ── 3. FRENOS ──────────────────────────────────────────────────────────
  if (has(/\b(PASTILLA|BALATA|ZAPATA|PATIN\s+FRENO)\b/)) {
    return construirResultado('Frenos', 'Pastillas y Balatas', '');
  }
  if (has(/\b(DISCO\s+(?:DE\s+)?FRENO|TAMBOR\s+(?:DE\s+)?FRENO|TAMBOR)\b/) || (has(/\bDISCO\b/) && !has(/\bEMBRAGUE\b/))) {
    return construirResultado('Frenos', 'Discos y Tambores', '');
  }
  if (has(/\b(CALIPER|MORDAZA|CILINDRO\s+(?:DE\s+)?(?:FRENO|RUEDA))\b/)) {
    return construirResultado('Frenos', 'Calipers y Cilindros', '');
  }
  if (has(/\b(BOMBA\s+(?:DE\s+)?FRENO|SERVOFRENO|SERVO\s+FRENO|FLEXIBLE\s+(?:DE\s+)?FRENO|CAÑERIA\s+FRENO)\b/)) {
    return construirResultado('Frenos', 'Líneas y Bombas de Freno', '');
  }
  if (has(/\b(SENSOR\s+(?:DE\s+)?ABS|ABS)\b/) && has(/\bSENSOR\b/)) {
    return construirResultado('Frenos', 'Sensores y Cables de Freno', 'Sensores ABS');
  }
  if (has(/\b(CABLE\s+(?:DE\s+)?FRENO|PIOLA\s+(?:DE\s+)?FRENO)\b/)) {
    return construirResultado('Frenos', 'Sensores y Cables de Freno', 'Cables de Freno de Mano');
  }

  // ── 4. TRANSMISIÓN Y MANDO ─────────────────────────────────────────────
  if (has(/\b(RODAMIENTO\s+(?:DE\s+)?MAZA|RODAMIENTO\s+(?:DE\s+)?RUEDA|MAZA|CUBO\s+RUEDA)\b/)) {
    return construirResultado('Transmisión y Mando', 'Rodamientos de Maza', '');
  }
  if (has(/\b(EMBRAGUE|PRENSA|COLLARIN|BOMBIN\s+EMBRAGUE|BOMBA\s+EMBRAGUE|CILINDRO\s+EMBRAGUE|HORQUILLA\s+EMBRAGUE|VOLANTE\s+INERCIA|VOLANTE\s+MOTOR)\b/)) {
    return construirResultado('Transmisión y Mando', 'Embrague y Ejes', 'Kits de Embrague');
  }
  if (has(/\b(HOMOCINETICA|SEMI\s*EJE|PALIER|TRIPOIDE|CARDAN|CRUCETA|DIFERENCIAL|CAJA\s+CAMBIO|PALANCA\s+CAMBIO|FUELLE\s+HOMOCINETICA)\b/) || (has(/\bEJE\b/) && !has(/\bLEVA\b/))) {
    return construirResultado('Transmisión y Mando', 'Embrague y Ejes', 'Homocinéticas y Ejes');
  }

  // ── 5. SUSPENSIÓN Y DIRECCIÓN ──────────────────────────────────────────
  if (has(/\b(CAZOLETA|RODAMIENTO\s+AMORTIGUADOR)\b/)) {
    return construirResultado('Suspensión y Dirección', 'Suspensión', 'Cazoletas y Rodamientos');
  }
  if (has(/\b(ESPIRAL|RESORTE\s+SUSPENSION|BALLESTA|PAQUETE\s+RESORTE)\b/)) {
    return construirResultado('Suspensión y Dirección', 'Suspensión', 'Espirales y Resortes');
  }
  if (has(/\b(AMORTIGUADOR)\b/)) {
    return construirResultado('Suspensión y Dirección', 'Suspensión', 'Amortiguadores');
  }
  if (has(/\b(BANDEJA|BRAZO\s+SUSPENSION|BIELETA|BARRA\s+ESTABILIZADORA|BUJE|MUÑON|MUNON|CUNA|PUENTE\s+SUSPENSION)\b/)) {
    return construirResultado('Suspensión y Dirección', 'Dirección', 'Bandejas y Brazos');
  }
  if (has(/\b(TERMINAL|AXIAL|BARRA\s+DIRECCION)\b/)) {
    return construirResultado('Suspensión y Dirección', 'Dirección', 'Terminales de Dirección');
  }
  if (has(/\b(ROTULA)\b/)) {
    return construirResultado('Suspensión y Dirección', 'Dirección', 'Rótulas');
  }
  if (has(/\b(CREMALLERA|CAJA\s+DIRECCION|COLUMNA\s+DIRECCION|BOMBA\s+DIRECCION)\b/)) {
    return construirResultado('Suspensión y Dirección', 'Dirección', 'Cremalleras');
  }

  // ── 6. REFRIGERACIÓN Y CLIMATIZACIÓN ───────────────────────────────────
  if (has(/\b(COMPRESOR|CONDENSADOR)\b/)) {
    return construirResultado('Refrigeración y Climatización', 'Aire Acondicionado', 'Compresores y Condensadores');
  }
  if (has(/\b(EVAPORADOR|CALEFACCION|VALVULA\s+EXPANSION)\b/)) {
    return construirResultado('Refrigeración y Climatización', 'Aire Acondicionado', 'Evaporadores y Válvulas');
  }
  if (has(/\b(RADIADOR|ELECTROVENTILADOR|VENTILADOR|ASPAS|ENCACUZADOR|INTERCOOLER|ENFRIADOR)\b/)) {
    return construirResultado('Refrigeración y Climatización', 'Radiadores y Electroventiladores', '');
  }
  if (has(/\b(BOMBA\s+(?:DE\s+)?AGUA|TERMOSTATO|TAPA\s+TERMOSTATO|BASE\s+TERMOSTATO|CAJA\s+TERMOSTATO|CAÑERIA\s+AGUA|TUBO\s+AGUA)\b/)) {
    return construirResultado('Refrigeración y Climatización', 'Bombas de Agua y Termostatos', '');
  }
  if (has(/\b(MANGUERA|TAPA\s+RADIADOR)\b/)) {
    return construirResultado('Refrigeración y Climatización', 'Mangueras y Depósitos', '');
  }

  // ── 7. SISTEMA ELÉCTRICO E ILUMINACIÓN ─────────────────────────────────
  if (has(/\b(BATERIA|ALTERNADOR)\b/)) {
    return construirResultado('Sistema Eléctrico e Iluminación', 'Baterías y Alternadores', '');
  }
  if (has(/\b(MOTOR\s+(?:DE\s+)?(?:PARTIDA|ARRANQUE)|ARRANQUE|BENDIX)\b/)) {
    return construirResultado('Sistema Eléctrico e Iluminación', 'Motores de Arranque', '');
  }
  if (has(/\b(INTERMITENTE|CORNER|DIRECCIONAL)\b/)) {
    return construirResultado('Sistema Eléctrico e Iluminación', 'Iluminación', 'Intermitentes');
  }
  if (has(/\b(AMPOLLETA|BULBO\s+LUZ|HALOGENO)\b/)) {
    return construirResultado('Sistema Eléctrico e Iluminación', 'Iluminación', 'Ampolletas y Bulbos');
  }
  if (has(/\b(FAROL|FARO|OPTICO|NEBLINERO|FOCO|LUZ|REFLECTANTE|CATADIOPTRICO)\b/)) {
    return construirResultado('Sistema Eléctrico e Iluminación', 'Iluminación', 'Faros y Focos Traseros');
  }
  if (has(/\b(BOBINA)\b/)) {
    return construirResultado('Sistema Eléctrico e Iluminación', 'Encendido', 'Bobinas de Encendido');
  }
  if (has(/\b(BUJIA|CABLE\s+BUJIA|CABLES\s+BUJIA)\b/)) {
    return construirResultado('Sistema Eléctrico e Iluminación', 'Encendido', 'Bujías y Cables');
  }
  if (has(/\b(SENSOR\s+(?:DE\s+)?OXIGENO|SONDA\s+LAMBDA)\b/)) {
    return construirResultado('Motor', 'Escape', 'Sensores de Oxígeno');
  }
  if (has(/\b(SENSOR\s+(?:DE\s+)?(?:CKP|CMP|CIGUEÑAL|CIGUENAL|LEVA|POSICION))\b/)) {
    return construirResultado('Sistema Eléctrico e Iluminación', 'Sensores y Switches', 'Sensores CKP y CMP');
  }
  if (has(/\b(SENSOR\s+(?:DE\s+)?(?:TEMPERATURA|PRESION|MAP|MAF|ACEITE|AGUA)|BULBO)\b/)) {
    return construirResultado('Sistema Eléctrico e Iluminación', 'Sensores y Switches', 'Sensores de Temperatura y Presión');
  }
  if (has(/\b(SENSOR|TELECOMANDO|BOTONERA|BOTON|SWITCH|INTERRUPTOR|CINTA\s+AIRBAG|RELE|RELAY|MODULO|ECU|COMPUTADOR)\b/)) {
    return construirResultado('Sistema Eléctrico e Iluminación', 'Sensores y Switches', 'Sensores de Temperatura y Presión');
  }

  // ── 8. CORREAS Y PIOLAS ────────────────────────────────────────────────
  if (has(/\b(KIT\s+(?:DE\s+)?DISTRIBUCION|CORREA\s+(?:DE\s+)?DISTRIBUCION|RODILLO\s+DISTRIBUCION)\b/)) {
    return construirResultado('Motor', 'Distribución', 'Kits de Distribución');
  }
  if (has(/\b(CADENA\s+(?:DE\s+)?DISTRIBUCION|TENSOR\s+(?:DE\s+)?(?:DISTRIBUCION|CADENA)|GUIA\s+CADENA|KIT\s+CADENA)\b/)) {
    return construirResultado('Motor', 'Distribución', 'Cadenas y Tensores');
  }
  if (has(/\b(CORREA)\b/)) {
    return construirResultado('Correas y Piolas', 'Correas de Accesorios', '');
  }
  if (has(/\b(TENSOR|POLEA|DAMPER|RODILLO)\b/)) {
    return construirResultado('Correas y Piolas', 'Tensores y Poleas', '');
  }
  if (has(/\b(PIOLA|CABLE\s+ACELERADOR|CABLE\s+EMBRAGUE|CABLE\s+SELECTORA)\b/)) {
    return construirResultado('Correas y Piolas', 'Piolas y Cables', '');
  }

  // ── 9. CARROCERÍA Y ESPEJOS ────────────────────────────────────────────
  if (has(/\b(PLUMILLA|BRAZO\s+LIMPIAPARABRISAS|LIMPIAPARABRISAS)\b/)) {
    return construirResultado('Carrocería y Espejos', 'Limpiaparabrisas', 'Plumillas');
  }
  if (has(/\b(CRISTAL\s+(?:DE\s+)?ESPEJO|VIDRIO\s+(?:DE\s+)?ESPEJO)\b/)) {
    return construirResultado('Carrocería y Espejos', 'Espejos Retrovisores', 'Cristales de Espejo');
  }
  if (has(/\b(ESPEJO)\b/)) {
    return construirResultado('Carrocería y Espejos', 'Espejos Retrovisores', 'Espejos Completos');
  }
  if (has(/\b(CAPOT|CAPO|PUERTA|PORTALON|MALETERO|BISAGRA)\b/)) {
    return construirResultado('Carrocería y Espejos', 'Componentes de Chapa', 'Capó y Puertas');
  }
  if (has(/\b(TAPABARRO|GUARDAFANGO|GUARDABARRO|MOLDURA|ALETA|PASA\s+RUEDA)\b/)) {
    return construirResultado('Carrocería y Espejos', 'Componentes de Chapa', 'Tapabarros y Guardabarros');
  }
  if (has(/\b(MANILLA|CHAPA|CERRADURA|CILINDRO\s+CONTACTO)\b/)) {
    return construirResultado('Carrocería y Espejos', 'Accesorios de Carrocería', 'Manillas y Chapas');
  }
  if (has(/\b(PARACHOQUE|REJILLA|MASCARA|BISEL|CROMADO|MENSULA|DEFENSA|FRONTAL|EMBELLECEDOR|MARCO|PORTAPATENTE|LOGO|EMBLEMA|CUBIERTA|SPOILER|PISADERA)\b/)) {
    return construirResultado('Carrocería y Espejos', 'Parachoques y Rejillas', '');
  }

  // ── 10. MOTOR ──────────────────────────────────────────────────────────
  if (has(/\b(SOPORTE)\b/)) {
    return construirResultado('Motor', 'Soportes de Motor', '');
  }
  if (has(/\b(INYECTOR|RIEL\s+INYECTOR)\b/)) {
    return construirResultado('Motor', 'Alimentación e Inyección', 'Inyectores');
  }
  if (has(/\b(BOMBA\s+(?:DE\s+)?(?:BENCINA|COMBUSTIBLE|PETROLEO|INYECTORA))\b/)) {
    return construirResultado('Motor', 'Alimentación e Inyección', 'Bombas de Combustible');
  }
  if (has(/\b(CUERPO\s+(?:DE\s+)?ACELERACION|PEDAL\s+ACELERACION|ADMISION)\b/) && !has(/\bMULTIPLE\b/)) {
    return construirResultado('Motor', 'Alimentación e Inyección', 'Cuerpo de Aceleración');
  }
  if (has(/\b(MULTIPLE|CATALIZADOR|CATALITICO|TURBO)\b/)) {
    return construirResultado('Motor', 'Escape', 'Múltiples y Catalizadores');
  }
  if (has(/\b(SILENCIADOR|ESCAPE|TUBO\s+ESCAPE)\b/)) {
    return construirResultado('Motor', 'Escape', 'Silenciadores');
  }
  if (has(/\b(VALVULA|EJE\s+LEVA|LEVA|TAQUIES|TAQUE|BALANCIN|CULATA)\b/)) {
    return construirResultado('Motor', 'Componentes Internos', 'Válvulas');
  }
  if (has(/\b(EMPAQUETADURA|JUNTA|RETEN|SELLO|SILICONA|ORING|TAPA\s+VALVULA)\b/)) {
    return construirResultado('Motor', 'Componentes Internos', 'Empaquetaduras y Juntas');
  }
  if (has(/\b(CIGUEÑAL|CIGUENAL|METAL\s+BIELA|METAL\s+BANCADA|METAL|PIÑON\s+CIGUEÑAL|PINON\s+CIGUENAL)\b/)) {
    return construirResultado('Motor', 'Componentes Internos', 'Cigüeñal');
  }
  if (has(/\b(PISTON|ANILLO|BIELA|CARTER|BOMBA\s+ACEITE|ENSAMBLE\s+MOTOR|BLOCK)\b/)) {
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
