import { useCallback, useEffect, useState } from 'react';
import { useAppStore } from '../store/useAppStore';
import { calendarioService } from '../services/calendario';
import { contarCitasNoVistas, CITAS_VISTAS_EVENT } from '../utils/citasVistas';

const POLL_MS = 60000; // 1 minuto

// Único lugar que pide /api/calendario/eventos por sondeo periódico.
// Guarda el resultado en el store global (citasProximas) para que tanto el
// globo del sidebar como la página de Calendario lean del mismo pedido,
// en vez de que cada uno tenga su propio temporizador pidiendo lo mismo.
export function useCitasNotificaciones() {
  const { citasProximas, setCitasProximas } = useAppStore();
  const [citasNuevas, setCitasNuevas] = useState(0);

  const revisar = useCallback(async () => {
    try {
      const res = await calendarioService.getProximos();
      if (res.success && res.data) {
        setCitasProximas(res.data);
        setCitasNuevas(contarCitasNoVistas(res.data));
      }
    } catch {
      // Si Google no está autorizado o falla la red, se deja como está
    }
  }, [setCitasProximas]);

  useEffect(() => {
    revisar();
    const timer = setInterval(revisar, POLL_MS);
    return () => clearInterval(timer);
  }, [revisar]);

  // Si en otra parte de la app se marcan citas como vistas, se recalcula
  // el contador altiro (sin volver a pedir al backend, ya tenemos la lista)
  useEffect(() => {
    const handler = () => setCitasNuevas(contarCitasNoVistas(citasProximas));
    window.addEventListener(CITAS_VISTAS_EVENT, handler);
    return () => window.removeEventListener(CITAS_VISTAS_EVENT, handler);
  }, [citasProximas]);

  return { citasNuevas, refrescar: revisar };
}