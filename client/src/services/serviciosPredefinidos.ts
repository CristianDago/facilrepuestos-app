import { api } from './api';
import type { ApiResponse } from '../types';

export interface ServicioPredefinido {
  id?: string;
  nombre: string;
  precioAuto: number;
  precioSUV: number;
  precioCamioneta: number;
  detalle?: string;   // descripción técnica detallada
}

export const serviciosPredefinidosService = {
  getAll: () =>
    api.get<ApiResponse<ServicioPredefinido[]>>('/servicios-predefinidos'),

  create: (data: Omit<ServicioPredefinido, 'id'>) =>
    api.post<ApiResponse<{ id: string }>>('/servicios-predefinidos', data),

  update: (id: string, data: Partial<ServicioPredefinido>) =>
    api.put<ApiResponse<null>>(`/servicios-predefinidos/${id}`, data),

  delete: (id: string) =>
    api.delete<ApiResponse<null>>(`/servicios-predefinidos/${id}`),
};