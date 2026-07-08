import { Navigate } from 'react-router-dom';
import type { ReactNode } from 'react';
import { useAuth } from './AuthContext';

export function RequireStaff({ children }: { children: ReactNode }) {
  const { staff, loading } = useAuth();
  if (loading) return <FullLoader />;
  if (!staff) return <Navigate to="/login" replace />;
  return <>{children}</>;
}

export function RequirePatient({ children }: { children: ReactNode }) {
  const { patient, loading } = useAuth();
  if (loading) return <FullLoader />;
  if (!patient) return <Navigate to="/portal/login" replace />;
  return <>{children}</>;
}

function FullLoader() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-bg">
      <div className="text-sm font-semibold text-muted">Cargando…</div>
    </div>
  );
}
