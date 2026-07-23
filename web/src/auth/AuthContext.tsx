import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { api, tokenStore } from '../lib/api';
import type { Role, StaffUser, PatientUser } from '../lib/types';

interface AuthState {
  staff: StaffUser | null;
  patient: PatientUser | null;
  loading: boolean;
  loginStaff: (email: string, password: string, role?: Role, branchId?: string) => Promise<void>;
  /** Paso 1: pide el código de acceso al correo/WhatsApp del paciente. */
  requestPatientCode: (email: string, phone: string) => Promise<string>;
  /** Paso 2: verifica el código y abre la sesión. */
  loginPatient: (email: string, phone: string, code: string) => Promise<void>;
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

  const requestPatientCode: AuthState['requestPatientCode'] = async (email, phone) => {
    const res = await api.post<{ ok: boolean; message: string }>(
      '/auth/patient/request-code',
      { email, phone },
      'none',
    );
    return res.message;
  };

  const loginPatient: AuthState['loginPatient'] = async (email, phone, code) => {
    const res = await api.post<{ token: string; patient: PatientUser }>(
      '/auth/patient/verify-code',
      { email, phone, code },
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
    <AuthContext.Provider value={{ staff, patient, loading, loginStaff, requestPatientCode, loginPatient, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth debe usarse dentro de AuthProvider');
  return ctx;
}
