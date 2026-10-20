import { useState } from 'react';
import { vehiculosService } from '../services/vehiculos';
import { useAppStore } from '../store/useAppStore';
import type { BoostrVehiculo } from '../types';

interface VehiculoFormData {
  make: string;
  model: string;
  year: string;
  type: string;
  engine: string;
}

interface UseVehiculoReturn {
  buscando: boolean;
  encontrado: boolean;
  error: string | null;
  buscarPatente: (patente: string) => Promise<VehiculoFormData | null>;
}

export function useVehiculo(): UseVehiculoReturn {
  const [buscando, setBuscando] = useState(false);
  const [encontrado, setEncontrado] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { vehiculos } = useAppStore();

  const buscarPatente = async (patente: string): Promise<VehiculoFormData | null> => {
    if (!patente || patente.length < 5) return null;

    setBuscando(true);
    setError(null);
    setEncontrado(false);

    try {
      // Primero buscar en vehiculos ya guardados
      const local = vehiculos.find(
        (v) => v.patente.toUpperCase() === patente.toUpperCase()
      );

      if (local) {
        setEncontrado(true);
        return {
          make: local.make,
          model: local.model,
          year: local.year,
          type: local.type,
          engine: local.engine,
        };
      }

      // Si no está local, consultar Boostr via servidor
      const response = await vehiculosService.buscarEnBoostr(patente);

      if (response.success && response.data) {
        const data = response.data as BoostrVehiculo;
        setEncontrado(true);
        return {
          make: data.make,
          model: data.model,
          year: String(data.year),
          type: data.type,
          engine: data.engine,
        };
      }

      setError('Vehículo no encontrado');
      return null;
    } catch {
      setError('Error al consultar la patente');
      return null;
    } finally {
      setBuscando(false);
    }
  };

  return { buscando, encontrado, error, buscarPatente };
}