import { api } from './api';
import type { ApiResponse, CostoFijo } from '../types';

export interface CategoriaCostoFijo {
  id?: string;
  nombre: string;
  custom?: boolean;
}

export const costosFijosService = {
  getAll: () =>
    api.get<ApiResponse<CostoFijo[]>>('/costos-fijos'),

  create: (data: Omit<CostoFijo, 'id' | 'iva' | 'totalConIva'>) =>
    api.post<ApiResponse<CostoFijo>>('/costos-fijos', data),

  update: (id: string, data: Partial<CostoFijo>) =>
    api.put<ApiResponse<null>>(`/costos-fijos/${id}`, data),

  delete: (id: string) =>
    api.delete<ApiResponse<null>>(`/costos-fijos/${id}`),
};

export const categoriasCostoFijoService = {
  getAll: () =>
    api.get<ApiResponse<CategoriaCostoFijo[]>>('/costos-fijos/categorias'),

  create: (nombre: string) =>
    api.post<ApiResponse<CategoriaCostoFijo>>('/costos-fijos/categorias', { nombre }),

  delete: (id: string) =>
    api.delete<ApiResponse<null>>(`/costos-fijos/categorias/${id}`),
};