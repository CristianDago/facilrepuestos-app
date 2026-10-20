import { api } from './api';
import type { Vehiculo, ApiResponse, BoostrVehiculo } from '../types';

export const vehiculosService = {
  getAll: () =>
    api.get<ApiResponse<Vehiculo[]>>('/vehiculos'),

  getByPatente: (patente: string) =>
    api.get<ApiResponse<Vehiculo>>(`/vehiculos/${patente}`),

  create: (data: Vehiculo) =>
    api.post<ApiResponse<{ patente: string }>>('/vehiculos', data),

  update: (patente: string, data: Partial<Vehiculo>) =>
    api.put<ApiResponse<{ patente: string }>>(`/vehiculos/${patente}`, data),

  delete: (patente: string) =>
    api.delete<ApiResponse<null>>(`/vehiculos/${patente}`),

  buscarEnBoostr: (patente: string) =>
    api.get<ApiResponse<BoostrVehiculo>>(`/boostr/${patente}`),
};