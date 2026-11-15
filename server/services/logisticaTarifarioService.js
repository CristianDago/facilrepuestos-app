// ============================================================================
// FácilRepuestos — Motor de Tarificación Logística, Volumetría y Multi-Taller
// ----------------------------------------------------------------------------
// Resuelve:
//  1. Tallas Logísticas Automotrices (XS, S, M, L, XL) con dimensiones de caja,
//     peso físico, peso volumétrico (L×A×H / 4000) y vehículo requerido
//     (Moto/Furgón vs Peugeot Partner).
//  2. Arquitectura Multi-Hub / Multi-Taller (por defecto: Enrique Olivares 224,
//     La Florida, Santiago; escalable a nuevos talleres en RM o regiones).
//  3. Cálculo de Despacho Pre-Pagado para Repuestín (WhatsApp/Web) y WordPress:
//     - Región Metropolitana (4 Anillos desde el taller más cercano en Peugeot Partner).
//     - Regiones de Chile (4 Macrozonas × Talla XS..XL referenciado en Starken/Courier).
// ============================================================================

const TALLAS_LOGISTICAS = {
  XS: {
    codigo: "XS",
    nombre: "Talla XS — Sobre / Caja Mini",
    descripcion: "Sensores, bujías, retenes, termostatos, chapas, manillas, filtros pequeños",
    dimensionesCm: { largo: 22, ancho: 16, alto: 12 },
    pesoFisicoKg: 0.8,
    pesoVolumetricoKg: 1.1, // (22*16*12)/4000 = 1.056
    pesoTarifableKg: 1.1,
    vehiculoRequerido: "moto_o_partner",
    orden: 1,
  },
  S: {
    codigo: "S",
    nombre: "Talla S — Caja Chica",
    descripcion: "Pastillas de freno, bombas de agua/aceite, espejos, faroles traseros, homocinéticas, soportes motor, kits distribución",
    dimensionesCm: { largo: 32, ancho: 25, alto: 18 },
    pesoFisicoKg: 2.5,
    pesoVolumetricoKg: 3.6, // (32*25*18)/4000 = 3.6
    pesoTarifableKg: 3.6,
    vehiculoRequerido: "moto_o_partner",
    orden: 2,
  },
  M: {
    codigo: "M",
    nombre: "Talla M — Caja Mediana",
    descripcion: "Kits de embrague, ópticos delanteros, alternadores, motores de partida, amortiguadores, bandejas, calipers",
    dimensionesCm: { largo: 50, ancho: 38, alto: 25 },
    pesoFisicoKg: 6.5,
    pesoVolumetricoKg: 11.9, // (50*38*25)/4000 = 11.875
    pesoTarifableKg: 11.9,
    vehiculoRequerido: "peugeot_partner",
    orden: 3,
  },
  L: {
    codigo: "L",
    nombre: "Talla L — Caja Grande / Pesada",
    descripcion: "Discos y tambores de freno, cremalleras de dirección, radiadores, condensadores, culatas, cigüeñales, espirales",
    dimensionesCm: { largo: 70, ancho: 45, alto: 30 },
    pesoFisicoKg: 14.0,
    pesoVolumetricoKg: 23.6, // (70*45*30)/4000 = 23.625
    pesoTarifableKg: 23.6,
    vehiculoRequerido: "peugeot_partner",
    orden: 4,
  },
  XL: {
    codigo: "XL",
    nombre: "Talla XL — Sobredimensionado / Carrocería",
    descripcion: "Parachoques, capots, tapabarros, máscaras frontales grandes, puertas, portalones, parabrisas",
    dimensionesCm: { largo: 155, ancho: 60, alto: 40 },
    pesoFisicoKg: 12.0,
    pesoVolumetricoKg: 93.0, // (155*60*40)/4000 = 93.0 (en Starken aplica factor volumétrico especial)
    pesoTarifableKg: 38.0,
    vehiculoRequerido: "peugeot_partner_exclusiva",
    orden: 5,
  },
};

// Nodos de Despacho / Talleres Habilitados (Hub #1: Enrique Olivares 224, La Florida)
const NODOS_DESPACHO_DEFAULT = [
  {
    id: "hub-la-florida-olivares-224",
    nombre: "Casa Matriz / Taller FácilRepuestos — La Florida",
    direccion: "Enrique Olivares 224, La Florida, Santiago",
    comuna: "La Florida",
    region: "Región Metropolitana",
    lat: -33.5268,
    lng: -70.5885,
    vehiculoFlota: "Peugeot Partner / Furgón Utilitario",
    activo: true,
    esPrincipal: true,
    permiteRetiroTienda: true,
    permiteDeliveryExpress: true,
    coberturaAnillos: {
      1: [
        "la florida",
        "macul",
        "penalolen",
        "peñalolen",
        "puente alto",
        "la granja",
        "san joaquin",
      ],
      2: [
        "nunoa",
        "ñuñoa",
        "providencia",
        "santiago",
        "santiago centro",
        "san miguel",
        "la cisterna",
        "la reina",
        "las condes",
        "san ramon",
        "la pintana",
        "pirque",
      ],
      3: [
        "maipu",
        "pudahuel",
        "estacion central",
        "cerrillos",
        "quilicura",
        "huechuraba",
        "recoleta",
        "independencia",
        "conchali",
        "renca",
        "vitacura",
        "lo barnechea",
        "san bernardo",
        "el bosque",
        "lo espejo",
        "pedro aguirre cerda",
        "cerro navia",
        "lo prado",
        "quinta normal",
      ],
      4: [
        "colina",
        "chicura",
        "chicureo",
        "lampa",
        "padre hurtado",
        "penaflor",
        "peñaflor",
        "talagante",
        "buin",
        "paine",
        "calera de tango",
        "melipilla",
        "curacavi",
        "isla de maipo",
        "el monte",
        "san jose de maipo",
        "tiltil",
        "maria pinto",
      ],
    },
  },
];

// Tarifas RM en Furgón Peugeot Partner desde el Taller asignado (IVA incluido)
const TARIFAS_RM_ANILLOS = {
  1: {
    anillo: 1,
    nombre: "Anillo 1 RM (0–7 km desde Taller)",
    tiempoEstimado: "Despacho Hoy / 2 a 4 hrs hábiles en Furgón",
    preciosPorTalla: {
      XS: 3990,
      S: 3990,
      M: 3990,
      L: 5990,
      XL: 9990,
    },
  },
  2: {
    anillo: 2,
    nombre: "Anillo 2 RM (7–15 km desde Taller)",
    tiempoEstimado: "Despacho Same-Day / 3 a 6 hrs hábiles en Furgón",
    preciosPorTalla: {
      XS: 5490,
      S: 5490,
      M: 5490,
      L: 7990,
      XL: 12990,
    },
  },
  3: {
    anillo: 3,
    nombre: "Anillo 3 RM (15–26 km Gran Santiago)",
    tiempoEstimado: "Despacho en Ruta Furgón (24 hrs hábiles)",
    preciosPorTalla: {
      XS: 6990,
      S: 6990,
      M: 6990,
      L: 9990,
      XL: 15990,
    },
  },
  4: {
    anillo: 4,
    nombre: "Anillo 4 RM Periferia (26–45 km)",
    tiempoEstimado: "Despacho en Ruta Extendida o Courier RM (24 a 48 hrs hábiles)",
    preciosPorTalla: {
      XS: 9990,
      S: 9990,
      M: 9990,
      L: 13990,
      XL: 21990,
    },
  },
};

// Tarifas Regiones Pre-Pagadas (Referencia Starken / Blue Express Domicilio o Agencia)
const MACROZONAS_REGIONES = {
  ZONA_CENTRO: {
    codigo: "ZONA_CENTRO",
    nombre: "Zona Centro (Valparaíso, O'Higgins, Maule, Coquimbo)",
    courierReferencia: "Starken / Courier Prepagado",
    tiempoEstimado: "24 a 48 hrs hábiles",
    preciosPorTalla: {
      XS: 4990,
      S: 6490,
      M: 9490,
      L: 14990,
      XL: 26990,
    },
    keywords: [
      "valparaiso",
      "vina del mar",
      "viña del mar",
      "quilpue",
      "villa alemana",
      "concon",
      "quillota",
      "la calera",
      "san antonio",
      "los andes",
      "san felipe",
      "limache",
      "casablanca",
      "la ligua",
      "rancagua",
      "machali",
      "san fernando",
      "rengo",
      "santa cruz",
      "san vicente",
      "graneros",
      "pichilemu",
      "chimbarongo",
      "talca",
      "curico",
      "linares",
      "constitucion",
      "cauquenes",
      "parral",
      "molina",
      "san javier",
      "san clemente",
      "la serena",
      "coquimbo",
      "ovalle",
      "illapel",
      "los vilos",
      "vicuna",
      "vicuña",
      "salamanca",
      "quinta region",
      "sexta region",
      "septima region",
      "cuarta region",
      "ohiggins",
      "o'higgins",
      "maule",
    ],
  },
  ZONA_SUR: {
    codigo: "ZONA_SUR",
    nombre: "Zona Centro-Sur y Sur (Ñuble, Biobío, Araucanía, Los Ríos, Los Lagos, Atacama)",
    courierReferencia: "Starken / Courier Prepagado",
    tiempoEstimado: "48 a 72 hrs hábiles",
    preciosPorTalla: {
      XS: 5990,
      S: 7990,
      M: 12490,
      L: 19990,
      XL: 34990,
    },
    keywords: [
      "chillan",
      "san carlos",
      "bulnes",
      "nuble",
      "ñuble",
      "concepcion",
      "talcahuano",
      "san pedro de la paz",
      "chiguayante",
      "coronel",
      "lota",
      "tome",
      "penco",
      "los angeles",
      "arauco",
      "curanilahue",
      "canete",
      "cañete",
      "mulchen",
      "cabrero",
      "biobio",
      "bio bio",
      "temuco",
      "padre las casas",
      "villarrica",
      "pucon",
      "angol",
      "victoria",
      "lautaro",
      "nueva imperial",
      "pitrufquen",
      "collipulli",
      "araucania",
      "valdivia",
      "la union",
      "rio bueno",
      "panguipulli",
      "paillaco",
      "los rios",
      "puerto montt",
      "puerto varas",
      "osorno",
      "castro",
      "ancud",
      "quellon",
      "chiloe",
      "frutillar",
      "llanquihue",
      "calbuco",
      "los lagos",
      "copiapo",
      "vallenar",
      "chanaral",
      "chañaral",
      "caldera",
      "atacama",
      "octava region",
      "novena region",
      "decima region",
    ],
  },
  ZONA_NORTE: {
    codigo: "ZONA_NORTE",
    nombre: "Zona Norte Grande (Antofagasta, Tarapacá, Arica y Parinacota)",
    courierReferencia: "Starken / Courier Prepagado",
    tiempoEstimado: "3 a 5 días hábiles",
    preciosPorTalla: {
      XS: 7490,
      S: 10490,
      M: 16990,
      L: 26990,
      XL: 46990,
    },
    keywords: [
      "antofagasta",
      "calama",
      "tocopilla",
      "mejillones",
      "tal tal",
      "taltal",
      "san pedro de atacama",
      "iquique",
      "alto hospicio",
      "pozo almonte",
      "tarapaca",
      "arica",
      "parinacota",
      "segunda region",
      "primera region",
    ],
  },
  ZONA_AUSTRAL: {
    codigo: "ZONA_AUSTRAL",
    nombre: "Zona Austral Extrema (Aysén y Magallanes)",
    courierReferencia: "Starken / Carga Austral Prepagada",
    tiempoEstimado: "5 a 8 días hábiles",
    preciosPorTalla: {
      XS: 10990,
      S: 15990,
      M: 24990,
      L: 39990,
      XL: 64990,
    },
    keywords: [
      "coyhaique",
      "puerto aysen",
      "aysen",
      "chile chico",
      "cochrane",
      "punta arenas",
      "puerto natales",
      "porvenir",
      "magallanes",
    ],
  },
};

function normalizarTextoLogistica(texto = "") {
  return String(texto || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

/**
 * Clasifica automáticamente cualquier repuesto del catálogo en su Talla Logística
 * (XS, S, M, L, XL) a partir de su nombre, subcategoría y categoría.
 */
function clasificarTallaLogisticaRepuesto(item = {}) {
  if (item.tallaLogistica && TALLAS_LOGISTICAS[item.tallaLogistica]) {
    const t = TALLAS_LOGISTICAS[item.tallaLogistica];
    return {
      tallaLogistica: t.codigo,
      nombreTalla: t.nombre,
      dimensionesCm: t.dimensionesCm,
      pesoFisicoKg: t.pesoFisicoKg,
      pesoVolumetricoKg: t.pesoVolumetricoKg,
      pesoTarifableKg: t.pesoTarifableKg,
      vehiculoRequerido: t.vehiculoRequerido,
    };
  }

  const texto = normalizarTextoLogistica(
    `${item.nombre || item.name || ""} ${item.subcategoria || ""} ${item.categoria || ""}`
  );

  let codigo = "S"; // Default seguro: Caja Chica

  // 1. XL — Sobredimensionado / Carrocería Grande
  if (
    /\b(parachoque|parachoques|capot|capo|tapabarro|guardafango|puerta\b|portalon|maletero|parabrisas|luneta|panel frontal|frontal completo|techo|pick up|pickup|pisadera|barra antivuelco|mascara frontal|rejilla frontal grande)\b/.test(
      texto
    ) &&
    !/\b(soporte|guia|broche|clip|moldura chica|sensor|luz|foco|emblema|logo|bisagra|chapa|manilla|amortiguador portalon)\b/.test(
      texto
    )
  ) {
    codigo = "XL";
  }
  // 2. L — Pesado o Voluminoso Mediano-Grande
  else if (
    /\b(disco de freno|disco freno|tambor de freno|tambor freno|cremallera|radiador|condensador|intercooler|culata|ciguenal|cigüeñal|eje trasero|puente trasero|cuna motor|subchasis|espiral|resorte suspension|paquete resorte|ballesta|volante motor|volante bimasa|catalitico|silenciador|escape completo|cardan|diferencial|caja de cambio|transmision completa)\b/.test(
      texto
    )
  ) {
    codigo = "L";
  }
  // 3. M — Caja Mediana
  else if (
    /\b(kit de embrague|kit embrague|prensa embrague|disco embrague|optico|faro delantero|focos delanteros|alternador|motor de partida|arranque|amortiguador|bandeja|brazo suspension|caliper|mordaza|compresor aire|compresor a\/c|electroventilador|ventilador radiador|multiple admision|multiple escape|bomba direccion|servo freno|servofreno|semieje|palier|eje completo|faro neblinero kit|mascara)\b/.test(
      texto
    )
  ) {
    codigo = "M";
  }
  // 4. XS — Sobre / Caja Mini
  else if (
    /\b(sensor|bujia|reten|termostato|chapa|manilla|interruptor|switch|rele|relay|fusible|ampolleta|bulbo|foco led|filtro de aceite|filtro aceite|filtro combustible|filtro bencina|filtro petroleo|tapa radiador|tapa aceite|emblema|logo|clip|broche|goma barra|buje|bieleta|terminal direccion|terminal de direccion|rotula|bulbo temperatura|valvula pcv|valvula iac|inyector|bobina encendido|bobina|cable bujia|piola|cilindro puerta|llave)\b/.test(
      texto
    )
  ) {
    codigo = "XS";
  }
  // 5. S — Caja Chica (Pastillas, bombas de agua/aceite, espejos, faroles traseros, correas, kits distribución, filtros aire/cabina, etc.)
  else {
    codigo = "S";
  }

  const talla = TALLAS_LOGISTICAS[codigo];
  return {
    tallaLogistica: talla.codigo,
    nombreTalla: talla.nombre,
    dimensionesCm: talla.dimensionesCm,
    pesoFisicoKg: talla.pesoFisicoKg,
    pesoVolumetricoKg: talla.pesoVolumetricoKg,
    pesoTarifableKg: talla.pesoTarifableKg,
    vehiculoRequerido: talla.vehiculoRequerido,
  };
}

/**
 * Calcula la talla consolidada de un carrito (1 o más productos).
 * Toma la talla dominante del ítem más grande y suma los pesos; si la suma
 * de pesos supera el umbral de la talla dominante, escala 1 nivel.
 */
function calcularVolumetriaCarrito(itemsCarrito = []) {
  const lista = Array.isArray(itemsCarrito) && itemsCarrito.length > 0 ? itemsCarrito : [{}];

  let ordenMax = 1;
  let codigoDominante = "XS";
  let pesoFisicoTotalKg = 0;
  let pesoVolumetricoTotalKg = 0;
  let cantidadTotalUnidades = 0;

  const detalleItems = lista.map((item) => {
    const cantidad = Math.max(1, Number(item.cantidad || item.quantity || 1));
    const info = clasificarTallaLogisticaRepuesto(item);
    const def = TALLAS_LOGISTICAS[info.tallaLogistica] || TALLAS_LOGISTICAS.S;
    if (def.orden > ordenMax) {
      ordenMax = def.orden;
      codigoDominante = def.codigo;
    }
    pesoFisicoTotalKg += info.pesoFisicoKg * cantidad;
    pesoVolumetricoTotalKg += info.pesoVolumetricoKg * cantidad;
    cantidadTotalUnidades += cantidad;
    return {
      nombre: item.nombre || item.name || "Repuesto",
      cantidad,
      tallaLogistica: info.tallaLogistica,
      pesoFisicoUnitarioKg: info.pesoFisicoKg,
      pesoVolumetricoUnitarioKg: info.pesoVolumetricoKg,
    };
  });

  // Escalamiento por consolidación si lleva muchas unidades chicas
  const pesoTarifableConsolidadoKg = Number(
    Math.max(pesoFisicoTotalKg, pesoVolumetricoTotalKg).toFixed(1)
  );

  if (codigoDominante === "XS" && (pesoTarifableConsolidadoKg > 2.2 || cantidadTotalUnidades >= 4)) {
    codigoDominante = "S";
  } else if (codigoDominante === "S" && pesoTarifableConsolidadoKg > 7.5) {
    codigoDominante = "M";
  } else if (codigoDominante === "M" && pesoTarifableConsolidadoKg > 18.0) {
    codigoDominante = "L";
  }

  const tallaConsolidada = TALLAS_LOGISTICAS[codigoDominante] || TALLAS_LOGISTICAS.S;

  return {
    tallaConsolidada: tallaConsolidada.codigo,
    nombreTallaConsolidada: tallaConsolidada.nombre,
    dimensionesReferencialesCm: tallaConsolidada.dimensionesCm,
    pesoFisicoTotalKg: Number(pesoFisicoTotalKg.toFixed(1)),
    pesoVolumetricoTotalKg: Number(pesoVolumetricoTotalKg.toFixed(1)),
    pesoTarifableConsolidadoKg,
    vehiculoRequerido: tallaConsolidada.vehiculoRequerido,
    cantidadTotalUnidades,
    detalleItems,
  };
}

/**
 * Detecta si la dirección o comuna ingresada pertenece a la Región Metropolitana
 * (y en qué Anillo respecto al taller más cercano) o a una Macrozona de Regiones.
 */
function resolverZonaDestinoYHub(direccionOComuna = "", nodosActivos = NODOS_DESPACHO_DEFAULT) {
  const textoNorm = normalizarTextoLogistica(direccionOComuna);
  const listaNodos =
    Array.isArray(nodosActivos) && nodosActivos.length > 0
      ? nodosActivos.filter((n) => n.activo !== false)
      : NODOS_DESPACHO_DEFAULT;

  // 1. Revisar si calza con algún anillo de alguno de los talleres activos (eligiendo el anillo menor / más cercano)
  let mejorMatchRM = null;

  for (const nodo of listaNodos) {
    const anillos = nodo.coberturaAnillos || NODOS_DESPACHO_DEFAULT[0].coberturaAnillos;
    for (const numAnillo of [1, 2, 3, 4]) {
      const comunas = anillos[numAnillo] || [];
      for (const comunaKey of comunas) {
        const keyNorm = normalizarTextoLogistica(comunaKey);
        const regex = new RegExp(`(^|[^a-z0-9])${keyNorm.replace(/\s+/g, "\\s+")}($|[^a-z0-9])`, "i");
        if (regex.test(textoNorm)) {
          if (!mejorMatchRM || numAnillo < mejorMatchRM.anillo) {
            mejorMatchRM = {
              esRegionMetropolitana: true,
              anillo: numAnillo,
              comunaDetectada: comunaKey.replace(/\b\w/g, (l) => l.toUpperCase()),
              nodoOrigen: {
                id: nodo.id,
                nombre: nodo.nombre,
                direccion: nodo.direccion,
                comuna: nodo.comuna,
                vehiculoFlota: nodo.vehiculoFlota || "Peugeot Partner",
              },
            };
          }
        }
      }
    }
  }

  if (mejorMatchRM) {
    return mejorMatchRM;
  }

  // 2. Revisar si calza con una Macrozona de Regiones
  for (const [codigoZona, defZona] of Object.entries(MACROZONAS_REGIONES)) {
    for (const kw of defZona.keywords) {
      const kwNorm = normalizarTextoLogistica(kw);
      const regex = new RegExp(`(^|[^a-z0-9])${kwNorm.replace(/\s+/g, "\\s+")}($|[^a-z0-9])`, "i");
      if (regex.test(textoNorm)) {
        const nodoPrincipal = listaNodos.find((n) => n.esPrincipal) || listaNodos[0];
        return {
          esRegionMetropolitana: false,
          macrozona: codigoZona,
          nombreZona: defZona.nombre,
          ciudadORegionDetectada: kw.replace(/\b\w/g, (l) => l.toUpperCase()),
          courierReferencia: defZona.courierReferencia,
          tiempoEstimado: defZona.tiempoEstimado,
          nodoOrigen: {
            id: nodoPrincipal.id,
            nombre: nodoPrincipal.nombre,
            direccion: nodoPrincipal.direccion,
            comuna: nodoPrincipal.comuna,
            vehiculoFlota: "Traslado a Agencia Courier en Peugeot Partner",
          },
        };
      }
    }
  }

  // 3. Si menciona explícitamente "region" o "starken" sin ciudad específica -> Zona Sur (promedio nacional seguro)
  const nodoPrincipal = listaNodos.find((n) => n.esPrincipal) || listaNodos[0];
  if (/\b(region|regiones|starken|chilexpress|blue express|provincia)\b/.test(textoNorm)) {
    const defZona = MACROZONAS_REGIONES.ZONA_SUR;
    return {
      esRegionMetropolitana: false,
      macrozona: defZona.codigo,
      nombreZona: defZona.nombre,
      ciudadORegionDetectada: "Regiones de Chile",
      courierReferencia: defZona.courierReferencia,
      tiempoEstimado: defZona.tiempoEstimado,
      nodoOrigen: {
        id: nodoPrincipal.id,
        nombre: nodoPrincipal.nombre,
        direccion: nodoPrincipal.direccion,
        comuna: nodoPrincipal.comuna,
        vehiculoFlota: "Traslado a Agencia Courier en Peugeot Partner",
      },
    };
  }

  // 4. Fallback por defecto en RM (Anillo 2 Gran Santiago desde Enrique Olivares 224)
  return {
    esRegionMetropolitana: true,
    anillo: 2,
    comunaDetectada: "Santiago RM (Referencial)",
    esFallbackReferencial: true,
    nodoOrigen: {
      id: nodoPrincipal.id,
      nombre: nodoPrincipal.nombre,
      direccion: nodoPrincipal.direccion,
      comuna: nodoPrincipal.comuna,
      vehiculoFlota: nodoPrincipal.vehiculoFlota || "Peugeot Partner",
    },
  };
}

/**
 * Cotiza el despacho pre-pagado exacto (RM en Peugeot Partner desde el taller más cercano
 * o Regiones vía Courier Prepagado según Talla Volumétrica XS..XL).
 */
function cotizarDespachoAnticipado({
  direccionOComuna = "",
  itemsCarrito = [],
  nodosActivos = NODOS_DESPACHO_DEFAULT,
  modalidad = "Despacho a domicilio",
} = {}) {
  const esRetiro = /retiro/i.test(String(modalidad || ""));
  const volumetria = calcularVolumetriaCarrito(itemsCarrito);
  const nodoPrincipal =
    (Array.isArray(nodosActivos) && nodosActivos.find((n) => n.esPrincipal)) ||
    NODOS_DESPACHO_DEFAULT[0];

  if (esRetiro) {
    return {
      modalidad: "Retiro en tienda",
      costoDespachoConIva: 0,
      esPrepagado: true,
      esRegionMetropolitana: true,
      tituloTarifa: `Retiro Gratis en Taller (${nodoPrincipal.direccion})`,
      tiempoEstimado: "Listo para retiro previa coordinación",
      nodoOrigen: {
        id: nodoPrincipal.id,
        nombre: nodoPrincipal.nombre,
        direccion: nodoPrincipal.direccion,
        comuna: nodoPrincipal.comuna,
      },
      volumetria,
      explicacionCliente: `Retiro sin costo en nuestro taller ubicado en ${nodoPrincipal.direccion}.`,
    };
  }

  const destino = resolverZonaDestinoYHub(direccionOComuna, nodosActivos);
  const talla = volumetria.tallaConsolidada;

  if (destino.esRegionMetropolitana) {
    const defAnillo = TARIFAS_RM_ANILLOS[destino.anillo] || TARIFAS_RM_ANILLOS[2];
    const costo = defAnillo.preciosPorTalla[talla] || defAnillo.preciosPorTalla.S;

    return {
      modalidad: "Despacho a domicilio",
      costoDespachoConIva: costo,
      esPrepagado: true,
      esRegionMetropolitana: true,
      anillo: defAnillo.anillo,
      comunaDetectada: destino.comunaDetectada,
      esFallbackReferencial: Boolean(destino.esFallbackReferencial),
      tituloTarifa: `Delivery Propio FácilRepuestos — ${defAnillo.nombre} (${volumetria.tallaConsolidada})`,
      tiempoEstimado: defAnillo.tiempoEstimado,
      medioTransporte: destino.nodoOrigen.vehiculoFlota || "Peugeot Partner",
      nodoOrigen: destino.nodoOrigen,
      volumetria,
      explicacionCliente: `Despacho directo en nuestro furgón desde ${destino.nodoOrigen.direccion} hacia ${destino.comunaDetectada} (Caja Talla ${talla}, ~${volumetria.pesoTarifableConsolidadoKg} kg volumétricos).`,
    };
  }

  const defMacrozona =
    MACROZONAS_REGIONES[destino.macrozona] || MACROZONAS_REGIONES.ZONA_SUR;
  const costoRegion =
    defMacrozona.preciosPorTalla[talla] || defMacrozona.preciosPorTalla.S;

  return {
    modalidad: "Despacho a domicilio (Regiones Prepagado)",
    costoDespachoConIva: costoRegion,
    esPrepagado: true,
    esRegionMetropolitana: false,
    macrozona: defMacrozona.codigo,
    nombreZona: defMacrozona.nombre,
    comunaDetectada: destino.ciudadORegionDetectada,
    tituloTarifa: `Envío Prepagado a Regiones — ${defMacrozona.nombre} (Talla ${talla})`,
    tiempoEstimado: defMacrozona.tiempoEstimado,
    medioTransporte: defMacrozona.courierReferencia,
    nodoOrigen: destino.nodoOrigen,
    volumetria,
    explicacionCliente: `Envío 100% prepagado (sin sorpresas por pagar al recibir) saliendo desde ${destino.nodoOrigen.direccion} vía ${defMacrozona.courierReferencia} hacia ${destino.ciudadORegionDetectada} (Caja Talla ${talla}: ${volumetria.dimensionesReferencialesCm.largo}×${volumetria.dimensionesReferencialesCm.ancho}×${volumetria.dimensionesReferencialesCm.alto} cm, ~${volumetria.pesoTarifableConsolidadoKg} kg).`,
  };
}

/**
 * Carga la lista de nodos/talleres desde Firestore (`nodos_despacho`).
 * Si aún no existe la colección, inicializa el Hub #1 (Enrique Olivares 224, La Florida).
 */
async function obtenerNodosDespachoActivos(db) {
  if (!db) return NODOS_DESPACHO_DEFAULT;
  try {
    const snap = await db.collection("nodos_despacho").get();
    if (snap.empty) {
      const hubDefault = NODOS_DESPACHO_DEFAULT[0];
      await db
        .collection("nodos_despacho")
        .doc(hubDefault.id)
        .set({
          ...hubDefault,
          actualizadoEn: new Date().toISOString(),
        });
      return NODOS_DESPACHO_DEFAULT;
    }
    const nodos = [];
    snap.forEach((doc) => {
      const d = doc.data();
      if (d && d.activo !== false) {
        nodos.push({ id: doc.id, ...d });
      }
    });
    return nodos.length > 0 ? nodos : NODOS_DESPACHO_DEFAULT;
  } catch (_err) {
    return NODOS_DESPACHO_DEFAULT;
  }
}

export {
  TALLAS_LOGISTICAS,
  NODOS_DESPACHO_DEFAULT,
  TARIFAS_RM_ANILLOS,
  MACROZONAS_REGIONES,
  clasificarTallaLogisticaRepuesto,
  calcularVolumetriaCarrito,
  resolverZonaDestinoYHub,
  cotizarDespachoAnticipado,
  obtenerNodosDespachoActivos,
};

