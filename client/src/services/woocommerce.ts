import { api } from './api';
import type { ApiResponse } from '../types';

export interface SyncResultado {
  modoSync?: 'delta_incremental' | 'catalogo_completo';
  modoConexion?: 'woocommerce_rest_live' | 'simulacion_local_delta';
  total: number;
  procesados?: number;
  pendientesRestantes?: number;
  creados: number;
  actualizados: number;
  ocultados?: number;
  omitidosSinCambio?: number;
  procesadosDetalle?: {
    id: string;
    skuPublicoFrp: string;
    nombre: string;
    proveedor: string;
    accion: string;
    wooProductId?: number | null;
  }[];
  sincronizadoEn?: string;
}

export interface ItemPendienteWoo {
  id: string;
  skuPublicoFrp: string;
  codigoInterno: string;
  nombre: string;
  categoria: string;
  proveedor: string;
  origenDatos: string;
  nodoAilooId?: string | null;
  stock: number;
  precioCompra: number;
  precioVenta: number;
  wooSyncMotivo: string;
  actualizadoEn?: string | null;
}

export interface EstadoColaWooCommerce {
  credencialesConfiguradas: boolean;
  modoOperacion: 'woocommerce_rest_live' | 'simulacion_local_delta';
  tiendaUrl: string;
  totalInventario: number;
  pendientesSync: number;
  sincronizados: number;
  desglosePorOrigen: {
    soluparts: { total: number; pendientes: number };
    global: { total: number; pendientes: number };
    locales: { total: number; pendientes: number };
  };
  itemsPendientes: ItemPendienteWoo[];
}

export interface ResumenIngestaNodoAiloo {
  nodoId: string;
  nombreNodo: string;
  prefijoSku: string;
  margenPct: number;
  vistaOrigen: string;
  modoOrigen: string;
  totalLeidos: number;
  nuevos: number;
  actualizados: number;
  sinCambiosOmitidos: number;
  itemsConDelta: {
    id: string;
    skuPublicoFrp: string;
    nombre: string;
    accion: string;
    stock: number;
    precioVenta: number;
  }[];
  sincronizadoEn: string;
}

export interface RespuestaIngestaMultiAiloo {
  ingesta: {
    totalNodos: number;
    totalLeidos: number;
    totalNuevos: number;
    totalActualizados: number;
    totalSinCambiosOmitidos: number;
    nodos: ResumenIngestaNodoAiloo[];
    sincronizadoEn: string;
  };
  wooSync?: SyncResultado | null;
}

export interface RespuestaSyncMarcasCompatibilidad {
  modoConexion: string;
  resumenCatalogo: {
    totalProductosVisibles: number;
    productosConCompatibilidad: number;
    totalMarcasVehiculo: number;
    totalModelosVehiculo: number;
    totalRangosAnios: number;
  };
  taxonomiaMarcasWoo: {
    endpointMarcasDisponible: boolean;
    marcasExistentesEnWoo: number;
    marcasNuevasCreadasEnWoo: number;
    pendientesPorCrearEnWoo?: number;
    totalRutasAseguradas: number;
  };
  productosEncoladosParaAsignacion: number;
  loteSincronizado?: {
    procesados: number;
    actualizados: number;
    creados: number;
    pendientesRestantes: number;
  } | null;
}

export const woocommerceService = {
  getStatus: () =>
    api.get<ApiResponse<EstadoColaWooCommerce>>('/woocommerce/status'),

  sync: (opciones?: { soloDelta?: boolean; maxItems?: number }) =>
    api.post<ApiResponse<SyncResultado>>('/woocommerce/sync', {
      soloDelta: opciones?.soloDelta !== false,
      maxItems: opciones?.maxItems || 150,
    }),

  syncMarcasCompatibilidad: (opciones?: {
    encolarProductos?: boolean;
    sincronizarLoteInmediato?: boolean;
    maxProductosLote?: number;
    maxCreacionesTaxonomia?: number;
  }) =>
    api.post<ApiResponse<RespuestaSyncMarcasCompatibilidad>>(
      '/woocommerce/sync-marcas-compatibilidad',
      {
        encolarProductos: opciones?.encolarProductos !== false,
        sincronizarLoteInmediato: opciones?.sincronizarLoteInmediato !== false,
        maxProductosLote: opciones?.maxProductosLote || 100,
        maxCreacionesTaxonomia: opciones?.maxCreacionesTaxonomia || 180,
      }
    ),

  syncAilooTodos: (opciones?: { forzar?: boolean; autoSyncWoo?: boolean }) =>
    api.post<ApiResponse<RespuestaIngestaMultiAiloo>>('/woocommerce/sync-ailoo', {
      forzar: Boolean(opciones?.forzar),
      autoSyncWoo: Boolean(opciones?.autoSyncWoo),
    }),

  syncAilooNodo: (
    nodoId: string,
    opciones?: { forzar?: boolean; autoSyncWoo?: boolean }
  ) =>
    api.post<ApiResponse<{ ingesta: ResumenIngestaNodoAiloo; wooSync?: SyncResultado | null }>>(
      `/woocommerce/sync-ailoo/${nodoId}`,
      {
        forzar: Boolean(opciones?.forzar),
        autoSyncWoo: Boolean(opciones?.autoSyncWoo),
      }
    ),
};
