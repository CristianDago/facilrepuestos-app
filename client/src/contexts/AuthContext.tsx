import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import {
  signInWithEmailAndPassword,
  signOut,
  onAuthStateChanged,
  type User as FirebaseUser,
} from 'firebase/auth';
import { auth } from '../firebase';
import { rutToEmail } from '../utils/rutUtils';

// ─── TIPOS ────────────────────────────────────────────────
export type Rol = 'admin' | 'mecanico' | 'administrativo' | 'proveedor';

export interface AuthUser {
  uid:      string;
  email:    string | null;
  rol:      Rol;
  nombre:   string;
  apellido: string;
}

interface AuthContextType {
  user:          AuthUser | null;
  firebaseUser:  FirebaseUser | null;
  loading:       boolean;
  loginAdmin:    (email: string, password: string) => Promise<void>;
  loginMecanico: (rut: string, password: string) => Promise<void>;
  loginProveedor: (rut: string, password: string) => Promise<void>;
  loginDev:      (rol?: Rol, nombre?: string) => void;
  logout:        () => Promise<void>;
  getToken:      () => Promise<string | null>;
}

const AuthContext = createContext<AuthContextType | null>(null);


// ─── PROVIDER ─────────────────────────────────────────────
export function AuthProvider({ children }: { children: ReactNode }) {
  const [firebaseUser, setFirebaseUser] = useState<FirebaseUser | null>(null);
  const [user, setUser]                 = useState<AuthUser | null>(null);
  const [loading, setLoading]           = useState(true);

  const fetchPerfil = async (fbUser: FirebaseUser): Promise<AuthUser | null> => {
    try {
      const token = await fbUser.getIdToken();
      const res = await fetch(`${import.meta.env.VITE_API_URL}/api/usuarios/me`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        console.error('Error al obtener perfil /api/usuarios/me:', res.status, await res.text());
        return null;
      }
      const data = await res.json();
      if (!data.success) {
        console.error('Respuesta no exitosa en /api/usuarios/me:', data);
        return null;
      }
      return {
        uid:      fbUser.uid,
        email:    fbUser.email,
        rol:      data.data.rol,
        nombre:   data.data.nombre,
        apellido: data.data.apellido || '',
      };
    } catch (e) {
      console.error('Excepción de red al obtener perfil:', e);
      return null;
    }
  };

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (fbUser) => {
      setFirebaseUser(fbUser);
      if (fbUser) {
        // ← FIX: mantener loading=true mientras se obtiene el perfil.
        // Sin esto, hay una ventana donde loading=false y user=null al mismo
        // tiempo, lo que hace que ProtectedRoute redirija a /login antes de
        // que fetchPerfil termine.
        setLoading(true);
        const perfil = await fetchPerfil(fbUser);
        setUser(perfil);
      } else {
        const stored = localStorage.getItem('facilrepuestos_dev_user');
        if (stored) {
          try {
            setUser(JSON.parse(stored));
          } catch {
            setUser(null);
          }
        } else {
          setUser(null);
        }
      }
      setLoading(false);
    });
    return unsub;
  }, []);

  const loginAdmin = async (email: string, password: string) => {
    await signInWithEmailAndPassword(auth, email, password);
    // onAuthStateChanged se encarga del resto (setLoading + fetchPerfil + setUser)
  };

  const loginMecanico = async (rut: string, password: string) => {
    const email = rutToEmail(rut);
    await signInWithEmailAndPassword(auth, email, password);
    // onAuthStateChanged se encarga del resto
  };

  const loginProveedor = async (rut: string, password: string) => {
    const email = rutToEmail(rut);
    await signInWithEmailAndPassword(auth, email, password);
    // onAuthStateChanged se encarga del resto
  };

  const loginDev = (rol: Rol = 'admin', nombre: string = 'Taller Dr. Motors') => {
    const devUser: AuthUser = {
      uid: 'dev-user-001',
      email: 'taller@drmotors.cl',
      rol,
      nombre,
      apellido: '(Local)',
    };
    setUser(devUser);
    localStorage.setItem('facilrepuestos_dev_user', JSON.stringify(devUser));
  };

  const logout = async () => {
    localStorage.removeItem('facilrepuestos_dev_user');
    await signOut(auth);
    setUser(null);
  };

  const getToken = async (): Promise<string | null> => {
    if (!firebaseUser) return null;
    return firebaseUser.getIdToken();
  };

  return (
    <AuthContext.Provider value={{
      user, firebaseUser, loading,
      loginAdmin, loginMecanico, loginProveedor, loginDev, logout, getToken,
    }}>
      {children}
    </AuthContext.Provider>
  );
}

// ─── HOOK ─────────────────────────────────────────────────
export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth debe usarse dentro de AuthProvider');
  return ctx;
}