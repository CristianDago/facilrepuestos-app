import { api } from './api';
import type { ApiResponse } from '../types';

export interface NuevoEventoCalendario {
  nombre:      string;
  correo?:     string;
  telefono:    string;
  patente?:    string;
  servicio:    string;
  descripcion?: string;
  fecha:       string; // YYYY-MM-DD
  horaInicio:  string; // HH:00
}

export interface EventoCalendario {
  id:          string;
  titulo:      string;
  descripcion: string;
  inicio:      string;
  fin:         string;
  htmlLink:    string;
}

export interface Disponibilidad {
  slots:    number[]; // horas de inicio permitidas para ese día, ej: [9,10,11,...]
  ocupadas: number[]; // horas ya reservadas dentro de esas
}

export const calendarioService = {
  crearEvento: (data: NuevoEventoCalendario) =>
    api.post<ApiResponse<{ id: string; htmlLink: string }>>('/calendario/eventos', data),

  getProximos: () =>
    api.get<ApiResponse<EventoCalendario[]>>('/calendario/eventos'),

  eliminarEvento: (id: string) =>
    api.delete<ApiResponse<null>>(`/calendario/eventos/${id}`),

  getDisponibilidad: (fecha: string) =>
    api.get<ApiResponse<Disponibilidad>>(`/calendario/disponibilidad?fecha=${fecha}`),
};