import { api } from './api';

export interface ResultadoMantenimiento {
  success: boolean;
  corregidos: number;
  detalle: any[];
  error?: string;
}

export const mantenimientoService = {
  reconciliarStockReservado: () =>
    api.post<ResultadoMantenimiento>('/mantenimiento/reconciliar-stock-reservado', {}),

  fixLocalhostUrls: () =>
    api.post<ResultadoMantenimiento>('/mantenimiento/fix-localhost-urls', {}),

  limpiarProductosHuerfanosWoo: () =>
    api.post<ResultadoMantenimiento>('/mantenimiento/limpiar-productos-huerfanos-woocommerce', {}),
};