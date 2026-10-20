import { api } from './api';
import type { ApiResponse } from '../types';

export interface TipoPieza {
  id?: string;
  nombre: string;
  custom?: boolean;
}

export const tiposPiezaService = {
  getAll: () =>
    api.get<ApiResponse<TipoPieza[]>>('/tipos-pieza'),

  create: (nombre: string) =>
    api.post<ApiResponse<TipoPieza>>('/tipos-pieza', { nombre }),

  delete: (id: string) =>
    api.delete<ApiResponse<null>>(`/tipos-pieza/${id}`),
};