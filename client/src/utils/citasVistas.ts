// Trackea qué citas del calendario ya fueron vistas por este navegador,
// para poder mostrar un contador de "citas nuevas" sin necesitar un campo
// extra en el backend — el estado de "visto" es local a cada dispositivo.
const STORAGE_KEY = 'dm_citas_vistas';

// Evento propio para avisar al resto de la app (ej. el badge del sidebar)
// que se marcaron citas como vistas, sin esperar al próximo sondeo periódico.
export const CITAS_VISTAS_EVENT = 'dm-citas-vistas-actualizadas';

export function getCitasVistas(): Set<string> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return new Set(raw ? (JSON.parse(raw) as string[]) : []);
  } catch {
    return new Set();
  }
}

export function marcarCitasVistas(ids: string[]): void {
  const vistas = getCitasVistas();
  ids.forEach(id => vistas.add(id));
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify([...vistas]));
  } catch { /* localStorage no disponible, se ignora */ }
  window.dispatchEvent(new Event(CITAS_VISTAS_EVENT));
}

export function contarCitasNoVistas(citas: { id: string }[]): number {
  const vistas = getCitasVistas();
  return citas.filter(c => !vistas.has(c.id)).length;
}