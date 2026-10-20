import { api } from './api';
import type { ApiResponse } from '../types';

export interface Fabricante {
  id?: string;
  nombre: string;
  default?: boolean;
  custom?: boolean;
}

export const fabricantesService = {
  getAll: () => api.get<ApiResponse<Fabricante[]>>('/fabricantes'),
  create: (nombre: string) => api.post<ApiResponse<Fabricante>>('/fabricantes', { nombre }),
  delete: (id: string) => api.delete<ApiResponse<null>>(`/fabricantes/${id}`),
};
