import { api } from './api';
import type { Cotizacion, EstadoCotizacion, ApiResponse } from '../types';

export const cotizacionesService = {
  getAll: () =>
    api.get<ApiResponse<Cotizacion[]>>('/cotizaciones'),

  getById: (id: string) =>
    api.get<ApiResponse<Cotizacion>>(`/cotizaciones/${id}`),

  create: (data: Omit<Cotizacion, 'id' | 'numero'>) =>
    api.post<ApiResponse<{ id: string; numero: string }>>('/cotizaciones', data),

  update: (id: string, data: Partial<Cotizacion>) =>
    api.put<ApiResponse<null>>(`/cotizaciones/${id}`, data),

  cambiarEstado: (id: string, estado: EstadoCotizacion) =>
    api.put<ApiResponse<null>>(`/cotizaciones/${id}/estado`, { estado }),  

  aprobar: (id: string) =>
    api.put<ApiResponse<{ otId: string; otNumero: string }>>(
      `/cotizaciones/${id}/aprobar`,
      {}
    ),

  actualizarCostos: (
    id: string,
    costos: Cotizacion['costos'],
    totalCostos: number
  ) =>
    api.put<ApiResponse<null>>(`/cotizaciones/${id}/costos`, {
      costos,
      totalCostos,
    }),

  delete: (id: string) =>
    api.delete<ApiResponse<null>>(`/cotizaciones/${id}`),

    registrarEnvio: (id: string, canal: 'WhatsApp' | 'Email') =>
    api.put<ApiResponse<{ envios: any[] }>>(`/cotizaciones/${id}/registrar-envio`, { canal }),

};