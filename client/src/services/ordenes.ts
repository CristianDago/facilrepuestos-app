import { api } from "./api";
import type { OrdenTrabajo, EstadoOT, RepuestoOT, ApiResponse } from "../types";

export const ordenesService = {
  getAll: () => api.get<ApiResponse<OrdenTrabajo[]>>("/ordenes"),

  getById: (id: string) => api.get<ApiResponse<OrdenTrabajo>>(`/ordenes/${id}`),

  create: (data: Omit<OrdenTrabajo, "id" | "numero">) =>
    api.post<ApiResponse<{ id: string; numero: string }>>("/ordenes", data),

  update: (id: string, data: Partial<OrdenTrabajo>) =>
    api.put<ApiResponse<null>>(`/ordenes/${id}`, data),

  actualizarEstado: (
    id: string,
    estado: EstadoOT,
    fechaEntregaReal?: string,
    usuarioNombre?: string,
    usuarioId?: string,
    metodoPago?: string,
    pagoSinIva?: boolean,
    puesto?: string,
  ) =>
    api.put(`/ordenes/${id}/estado`, {
      estado, fechaEntregaReal, usuarioNombre, usuarioId, metodoPago, pagoSinIva, puesto,
    }),

  actualizarRepuestos: (id: string, repuestos: RepuestoOT[]) =>
    api.put<ApiResponse<null>>(`/ordenes/${id}/repuestos`, { repuestos }),

  registrarEnvio: (id: string, canal: "WhatsApp" | "Email" | "Físico") =>
    api.put<ApiResponse<{ envios: any[] }>>(`/ordenes/${id}/registrar-envio`, {
      canal,
    }),

  delete: (id: string) => api.delete<ApiResponse<null>>(`/ordenes/${id}`),
};