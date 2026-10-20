import { api } from './api';
import type { ApiResponse } from '../types';

export interface Categoria {
  id?: string;
  nombre: string;
  custom?: boolean;
}

export const categoriasService = {
  getAll: () =>
    api.get<ApiResponse<Categoria[]>>('/categorias'),

  create: (nombre: string) =>
    api.post<ApiResponse<Categoria>>('/categorias', { nombre }),

  delete: (id: string) =>
    api.delete<ApiResponse<null>>(`/categorias/${id}`),
};