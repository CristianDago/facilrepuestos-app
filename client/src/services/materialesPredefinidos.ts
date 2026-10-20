import { api } from './api';
import type { ApiResponse, MaterialPredefinido } from '../types';

export const materialesPredefinidosService = {
  getAll: () =>
    api.get<ApiResponse<MaterialPredefinido[]>>('/materiales-predefinidos'),

  create: (data: Omit<MaterialPredefinido, 'id' | 'createdAt' | 'updatedAt'>) =>
    api.post<ApiResponse<{ id: string }>>('/materiales-predefinidos', data),

  update: (id: string, data: Partial<MaterialPredefinido>) =>
    api.put<ApiResponse<null>>(`/materiales-predefinidos/${id}`, data),

  delete: (id: string) =>
    api.delete<ApiResponse<null>>(`/materiales-predefinidos/${id}`),
};