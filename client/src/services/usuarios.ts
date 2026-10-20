import { api } from './api';
import type { ApiResponse, Usuario } from '../types';

export const usuariosService = {
  getAll: () =>
    api.get<ApiResponse<Usuario[]>>('/usuarios'),
};