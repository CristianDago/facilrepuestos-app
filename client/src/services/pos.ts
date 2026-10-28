import { api } from './api';

export interface ItemVentaPOS {
  id: string;
  nombre: string;
  codigo?: string;
  fabricante?: string;
  precioNeto: number;
  precioConIva: number;
  cantidad: number;
  subtotalNeto: number;
  subtotalConIva: number;
  disponible: number;
}

export interface ClientePOS {
  nombre?: string;
  rut?: string;
  telefono?: string;
  email?: string;
  patente?: string;
}

export type MetodoPagoPOS = 'EFECTIVO' | 'DEBITO' | 'CREDITO' | 'TRANSFERENCIA';

export interface VentaPOSPayload {
  items: Array<{
    id: string;
    nombre: string;
    codigo?: string;
    precioNeto: number;
    cantidad: number;
  }>;
  metodoPago: MetodoPagoPOS;
  cliente?: ClientePOS;
  tipoDocumento?: 'TICKET' | 'COTIZACION';
  notas?: string;
  proveedorId?: string | null;
}

export interface VentaPOSRegistrada {
  id: string;
  numeroTicket: string;
  tipoDocumento: 'TICKET' | 'COTIZACION';
  fecha: string;
  vendedorId: string;
  vendedorNombre: string;
  proveedorId?: string | null;
  items: Array<{
    id: string;
    nombre: string;
    codigo?: string;
    precioNeto: number;
    cantidad: number;
  }>;
  totalNeto: number;
  totalIva: number;
  total: number;
  metodoPago: MetodoPagoPOS;
  cliente?: ClientePOS;
  notas?: string;
  estado: string;
}

export const posService = {
  registrarVenta: (payload: VentaPOSPayload) =>
    api.post<{ success: boolean; data: VentaPOSRegistrada }>('/pos/venta', payload),

  obtenerVentas: () =>
    api.get<{ success: boolean; data: VentaPOSRegistrada[] }>('/pos/ventas'),
};
