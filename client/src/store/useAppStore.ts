import { create } from 'zustand';
import type {
  Cotizacion,
  OrdenTrabajo,
  Vehiculo,
  ItemInventario,
  Proveedor,
} from '../types';
import type { EventoCalendario } from '../services/calendario';

interface AppState {
  cotizaciones: Cotizacion[];
  ordenes: OrdenTrabajo[];
  vehiculos: Vehiculo[];
  inventario: ItemInventario[];
  proveedores: Proveedor[];
  citasProximas: EventoCalendario[];
  loading: boolean;
  notification: {
    message: string;
    type: 'success' | 'error' | 'info';
  } | null;

  setCotizaciones: (data: Cotizacion[]) => void;
  setOrdenes: (data: OrdenTrabajo[]) => void;
  setVehiculos: (data: Vehiculo[]) => void;
  setInventario: (data: ItemInventario[]) => void;
  setProveedores: (data: Proveedor[]) => void;
  setCitasProximas: (data: EventoCalendario[]) => void;
  setLoading: (value: boolean) => void;
  notify: (message: string, type?: 'success' | 'error' | 'info') => void;
  clearNotification: () => void;
}

export const useAppStore = create<AppState>((set) => ({
  cotizaciones: [],
  ordenes: [],
  vehiculos: [],
  inventario: [],
  proveedores: [],
  citasProximas: [],
  loading: false,
  notification: null,

  setCotizaciones: (data) => set({ cotizaciones: data }),
  setOrdenes: (data) => set({ ordenes: data }),
  setVehiculos: (data) => set({ vehiculos: data }),
  setInventario: (data) => set({ inventario: data }),
  setProveedores: (data) => set({ proveedores: data }),
  setCitasProximas: (data) => set({ citasProximas: data }),
  setLoading: (value) => set({ loading: value }),
  notify: (message, type = 'info') => set({ notification: { message, type } }),
  clearNotification: () => set({ notification: null }),
}));