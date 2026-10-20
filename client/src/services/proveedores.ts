import { api } from './api';
import type { Proveedor, ApiResponse } from '../types';

export const proveedoresService = {
  getAll: () =>
    api.get<ApiResponse<Proveedor[]>>('/proveedores'),

  getById: (id: string) =>
    api.get<ApiResponse<Proveedor>>(`/proveedores/${id}`),

  create: (data: Omit<Proveedor, 'id'>) =>
    api.post<ApiResponse<{ id: string }>>('/proveedores', data),

  update: (id: string, data: Partial<Proveedor>) =>
    api.put<ApiResponse<null>>(`/proveedores/${id}`, data),

  delete: (id: string) =>
    api.delete<ApiResponse<null>>(`/proveedores/${id}`),

  darAcceso: (id: string, password: string) =>
    api.post<ApiResponse<{ uid: string }>>(`/proveedores/${id}/acceso`, { password }),

  resetPassword: (id: string, password: string) =>
    api.put<ApiResponse<null>>(`/proveedores/${id}/password`, { password }),

  revocarAcceso: (id: string) =>
    api.delete<ApiResponse<null>>(`/proveedores/${id}/acceso`),
};