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


function getInitialDevUser(): AuthUser | null {
  if (!import.meta.env.DEV) return null;
  if (typeof window === 'undefined') return null;
  if (sessionStorage.getItem('facilrepuestos_dev_logout') === 'true') return null;

  const stored = localStorage.getItem('facilrepuestos_dev_user');
  if (stored) {
    try {
      return JSON.parse(stored) as AuthUser;
    } catch {
      // Continuar a usuario por defecto
    }
  }

  const defaultDevUser: AuthUser = {
    uid: 'dev-user-001',
    email: 'taller@drmotors.cl',
    rol: 'admin',
    nombre: 'Taller Dr. Motors',
    apellido: '(Local)',
  };
  localStorage.setItem('facilrepuestos_dev_user', JSON.stringify(defaultDevUser));
  return defaultDevUser;
}

// ─── PROVIDER ─────────────────────────────────────────────
export function AuthProvider({ children }: { children: ReactNode }) {
  const initialDevUser = getInitialDevUser();
  const [firebaseUser, setFirebaseUser] = useState<FirebaseUser | null>(null);
  const [user, setUser]                 = useState<AuthUser | null>(initialDevUser);
  const [loading, setLoading]           = useState<boolean>(!initialDevUser);

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
        if (!import.meta.env.DEV) {
          setLoading(true);
        }
        const perfil = await fetchPerfil(fbUser);
        setUser(perfil || getInitialDevUser());
      } else {
        const stored = localStorage.getItem('facilrepuestos_dev_user');
        if (stored) {
          try {
            setUser(JSON.parse(stored));
          } catch {
            setUser(null);
          }
        } else if (import.meta.env.DEV && sessionStorage.getItem('facilrepuestos_dev_logout') !== 'true') {
          const defaultDevUser: AuthUser = {
            uid: 'dev-user-001',
            email: 'taller@drmotors.cl',
            rol: 'admin',
            nombre: 'Taller Dr. Motors',
            apellido: '(Local)',
          };
          localStorage.setItem('facilrepuestos_dev_user', JSON.stringify(defaultDevUser));
          setUser(defaultDevUser);
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
    sessionStorage.removeItem('facilrepuestos_dev_logout');
    setUser(devUser);
    localStorage.setItem('facilrepuestos_dev_user', JSON.stringify(devUser));
  };

  const logout = async () => {
    sessionStorage.setItem('facilrepuestos_dev_logout', 'true');
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