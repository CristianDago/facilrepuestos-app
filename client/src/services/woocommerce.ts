import { api } from './api';
import type { ApiResponse } from '../types';

export interface SyncResultado {
  total: number;
  creados: number;
  actualizados: number;
  ocultados?: number;
}

export const woocommerceService = {
  sync: () => api.post<ApiResponse<SyncResultado>>('/woocommerce/sync', {}),
};