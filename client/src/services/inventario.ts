import { api } from './api';
import type { ItemInventario, ApiResponse, EstadisticasProveedor } from '../types';

export const inventarioService = {
  getAll: () =>
    api.get<ApiResponse<ItemInventario[]>>('/inventario'),

  getById: (id: string) =>
    api.get<ApiResponse<ItemInventario>>(`/inventario/${id}`),

  lookupCodigo: (codigo: string) =>
    api.get<ApiResponse<{
      encontrado: boolean;
      origen: 'inventario_existente' | 'nuevo_sugerido';
      item: Partial<ItemInventario> & { esMio?: boolean; fuenteInfo?: string };
    }>>(`/inventario/lookup/${encodeURIComponent(codigo)}`),

  create: (data: Omit<ItemInventario, 'id'>) =>
    api.post<ApiResponse<{ id: string }>>('/inventario', data),

  update: (id: string, data: Partial<ItemInventario>) =>
    api.put<ApiResponse<null>>(`/inventario/${id}`, data),

  // Estadísticas del proveedor con sesión (un admin puede pasar el id de un proveedor)
  getMisEstadisticas: (proveedorId?: string) =>
    api.get<ApiResponse<EstadisticasProveedor>>(
      `/inventario/mis-estadisticas${proveedorId ? `?proveedorId=${encodeURIComponent(proveedorId)}` : ''}`
    ),

  actualizarStock: (id: string, stock: number) =>
    api.put<ApiResponse<null>>(`/inventario/${id}/stock`, { stock }),

  delete: (id: string) =>
    api.delete<ApiResponse<null> & { woocommerce?: { eliminado: boolean; motivo?: string } }>(`/inventario/${id}`),
};