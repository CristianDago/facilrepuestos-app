import { api } from './api';
import type { ApiResponse } from '../types';

export interface MarcaVehiculo {
  id?: string;
  nombre: string;
  custom?: boolean;
}

export const marcasVehiculoService = {
  getAll: () =>
    api.get<ApiResponse<MarcaVehiculo[]>>('/marcas-vehiculo'),

  create: (nombre: string) =>
    api.post<ApiResponse<MarcaVehiculo>>('/marcas-vehiculo', { nombre }),

  delete: (id: string) =>
    api.delete<ApiResponse<null>>(`/marcas-vehiculo/${id}`),
};