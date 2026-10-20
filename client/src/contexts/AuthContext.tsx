import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import {
  signInWithEmailAndPassword,
  signOut,
  onAuthStateChanged,
  type User as FirebaseUser,
} from 'firebase/auth';
import { auth } from '../firebase';

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
  logout:        () => Promise<void>;
  getToken:      () => Promise<string | null>;
}

const AuthContext = createContext<AuthContextType | null>(null);

// ─── HELPER RUT → EMAIL ───────────────────────────────────
export const rutToEmail = (rut: string): string => {
  const clean = rut.replace(/\./g, '').replace(/-/g, '').toLowerCase();
  return `${clean}@drmotors.internal`;
};

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
      if (!res.ok) return null;
      const data = await res.json();
      if (!data.success) return null;
      return {
        uid:      fbUser.uid,
        email:    fbUser.email,
        rol:      data.data.rol,
        nombre:   data.data.nombre,
        apellido: data.data.apellido || '',
      };
    } catch {
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
        setUser(null);
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

  const logout = async () => {
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
      loginAdmin, loginMecanico, loginProveedor, logout, getToken,
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