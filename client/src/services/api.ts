import { getAuth } from 'firebase/auth';

const BASE_URL = `${import.meta.env.VITE_API_URL}/api`;

// Obtiene el token del usuario autenticado
async function getAuthHeaders(): Promise<Record<string, string>> {
  try {
    const auth = getAuth();
    const user = auth.currentUser;
    if (!user) return {};
    const token = await user.getIdToken();
    return { Authorization: `Bearer ${token}` };
  } catch {
    return {};
  }
}

async function request<T>(endpoint: string, options?: RequestInit): Promise<T> {
  const authHeaders = await getAuthHeaders();
  const response = await fetch(`${BASE_URL}${endpoint}`, {
    headers: {
      'Content-Type': 'application/json',
      ...authHeaders,
      ...options?.headers,
    },
    ...options,
  });

  const data = await response.json();

  if (!response.ok) {
    throw new Error(data.error || 'Error en la petición');
  }

  return data;
}

export const api = {
  get:    <T>(endpoint: string) => request<T>(endpoint),
  post:   <T>(endpoint: string, body: unknown) => request<T>(endpoint, { method: 'POST',   body: JSON.stringify(body) }),
  put:    <T>(endpoint: string, body: unknown) => request<T>(endpoint, { method: 'PUT',    body: JSON.stringify(body) }),
  delete: <T>(endpoint: string)                => request<T>(endpoint, { method: 'DELETE' }),
};
