import { api } from './api';
import type { ApiResponse, Liquidacion } from '../types';

export const liquidacionesService = {
  getAll: () =>
    api.get<ApiResponse<Liquidacion[]>>('/liquidaciones'),

  getByUsuario: (usuarioId: string) =>
    api.get<ApiResponse<Liquidacion[]>>(`/liquidaciones/${usuarioId}`),
};