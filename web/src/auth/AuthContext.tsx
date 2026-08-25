import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { api, tokenStore } from '../lib/api';
import type { Role, StaffUser, PatientUser } from '../lib/types';

interface AuthState {
  staff: StaffUser | null;
  patient: PatientUser | null;
  loading: boolean;
  loginStaff: (email: string, password: string, role?: Role, branchId?: string) => Promise<void>;
  /** Portal: correo O celular + contraseña (la inicial es su teléfono). */
  loginPatient: (usuario: string, password: string) => Promise<void>;
  logout: () => void;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [staff, setStaff] = useState<StaffUser | null>(null);
  const [patient, setPatient] = useState<PatientUser | null>(null);
  const [loading, setLoading] = useState(true);

  // Rehidratar sesión desde tokens guardados
  useEffect(() => {
    (async () => {
      try {
        // Previsualización del portal (admin): abre /portal?preview=<token> para VER
        // lo que ve el paciente. Tiene prioridad sobre el token de staff (que sigue
        // guardado para la app del personal en sus otras pestañas).
        const preview = new URLSearchParams(window.location.search).get('preview');
        if (preview) {
          tokenStore.setPatient(preview);
          // Quita el token de la URL visible (queda guardado en el token del portal).
          window.history.replaceState({}, '', '/portal');
          setPatient(await api.get<PatientUser>('/auth/patient/me', 'patient'));
          setLoading(false);
          return;
        }
        if (tokenStore.getStaff()) {
          setStaff(await api.get<StaffUser>('/auth/staff/me', 'staff'));
        } else if (tokenStore.getPatient()) {
          setPatient(await api.get<PatientUser>('/auth/patient/me', 'patient'));
        }
      } catch {
        tokenStore.clearStaff();
        tokenStore.clearPatient();
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const loginStaff: AuthState['loginStaff'] = async (email, password, role, branchId) => {
    const res = await api.post<{ token: string; user: StaffUser }>(
      '/auth/staff/login',
      { email, password, role, branchId },
      'none',
    );
    tokenStore.setStaff(res.token);
    tokenStore.clearPatient();
    setPatient(null);
    setStaff(res.user);
  };

  const loginPatient: AuthState['loginPatient'] = async (usuario, password) => {
    const res = await api.post<{ token: string; patient: PatientUser }>(
      '/auth/patient/login',
      { usuario, password },
      'none',
    );
    tokenStore.setPatient(res.token);
    tokenStore.clearStaff();
    setStaff(null);
    setPatient(res.patient);
  };

  const logout = () => {
    tokenStore.clearStaff();
    tokenStore.clearPatient();
    setStaff(null);
    setPatient(null);
  };

  return (
    <AuthContext.Provider value={{ staff, patient, loading, loginStaff, loginPatient, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth debe usarse dentro de AuthProvider');
  return ctx;
}
