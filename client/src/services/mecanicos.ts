import { api } from './api';
import type { ApiResponse } from '../types';

export interface Mecanico {
  id?: string;
  uid?: string;
  nombre: string;
  apellido?: string;
  telefono: string;
  especialidad: string;
  activo: boolean;
}

export const mecanicosService = {
  getAll: () => api.get<ApiResponse<Mecanico[]>>('/usuarios/mecanicos'),
};