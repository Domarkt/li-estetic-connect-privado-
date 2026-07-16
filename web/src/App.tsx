import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { ToastProvider } from './components/Toast';
import { AuthProvider, useAuth } from './auth/AuthContext';
import { RequireStaff, RequirePatient } from './auth/ProtectedRoute';
import { BranchProvider } from './layout/BranchContext';
import AppShell from './layout/AppShell';
import StaffLogin from './pages/StaffLogin';
import PatientLogin from './pages/PatientLogin';
import PatientPortal from './pages/PatientPortal';
import Dashboard from './pages/Dashboard';
import PatientsPage from './pages/patients/PatientsPage';
import CatalogPage from './pages/CatalogPage';
import AgendaPage from './pages/agenda/AgendaPage';
import BillingPage from './pages/billing/BillingPage';
import MessagesPage from './pages/messaging/MessagesPage';
import PipelinePage from './pages/messaging/PipelinePage';
import PointsPage from './pages/points/PointsPage';
import ConfigPage from './pages/config/ConfigPage';
import EquipoPage from './pages/team/EquipoPage';
import CashClosePage from './pages/cashclose/CashClosePage';
import ReportsPage from './pages/reports/ReportsPage';
import SucursalesPage from './pages/SucursalesPage';
import InventarioPage from './pages/inventory/InventarioPage';

function StaffArea() {
  return (
    <BranchProvider>
      <AppShell />
    </BranchProvider>
  );
}

// Redirige "/" según haya sesión activa.
function Home() {
  const { staff, patient, loading } = useAuth();
  if (loading) return null;
  if (staff) return <Navigate to="/app" replace />;
  if (patient) return <Navigate to="/portal" replace />;
  return <Navigate to="/login" replace />;
}

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <ToastProvider>
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/login" element={<StaffLogin />} />
          <Route path="/portal/login" element={<PatientLogin />} />

          {/* App interna (personal) */}
          <Route path="/app" element={<RequireStaff><StaffArea /></RequireStaff>}>
            <Route index element={<Navigate to="dashboard" replace />} />
            <Route path="dashboard" element={<Dashboard />} />
            <Route path="sucursales" element={<SucursalesPage />} />
            <Route path="pacientes" element={<PatientsPage />} />
            <Route path="agenda" element={<AgendaPage />} />
            <Route path="mensajes" element={<MessagesPage />} />
            <Route path="facturacion" element={<BillingPage />} />
            <Route path="catalogo" element={<CatalogPage />} />
            <Route path="inventario" element={<InventarioPage />} />
            <Route path="puntos" element={<PointsPage />} />
            <Route path="equipo" element={<EquipoPage />} />
            <Route path="configuracion" element={<ConfigPage />} />
            <Route path="seguimiento" element={<PipelinePage />} />
            <Route path="cierre" element={<CashClosePage />} />
            <Route path="reportes" element={<ReportsPage />} />
          </Route>

          {/* Portal del paciente (externo) */}
          <Route path="/portal" element={<RequirePatient><PatientPortal /></RequirePatient>} />

          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
        </ToastProvider>
      </AuthProvider>
    </BrowserRouter>
  );
}
