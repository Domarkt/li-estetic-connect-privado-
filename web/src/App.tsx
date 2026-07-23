import { Suspense, lazy } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { ToastProvider } from './components/Toast';
import { AuthProvider, useAuth } from './auth/AuthContext';
import { RequireStaff, RequirePatient } from './auth/ProtectedRoute';
import { BranchProvider } from './layout/BranchContext';
import AppShell from './layout/AppShell';

// El login entra en el paquete inicial: es lo primero que se ve.
import StaffLogin from './pages/StaffLogin';
import PatientLogin from './pages/PatientLogin';

// El resto se carga por ruta. Así recepción no descarga reportes, puntos ni
// inventario solo para abrir la agenda: el arranque es mucho más liviano.
const PatientPortal = lazy(() => import('./pages/PatientPortal'));
const Dashboard = lazy(() => import('./pages/Dashboard'));
const PatientsPage = lazy(() => import('./pages/patients/PatientsPage'));
const CatalogPage = lazy(() => import('./pages/CatalogPage'));
const AgendaPage = lazy(() => import('./pages/agenda/AgendaPage'));
const BillingPage = lazy(() => import('./pages/billing/BillingPage'));
const MessagesPage = lazy(() => import('./pages/messaging/MessagesPage'));
const PipelinePage = lazy(() => import('./pages/messaging/PipelinePage'));
const PointsPage = lazy(() => import('./pages/points/PointsPage'));
const ConfigPage = lazy(() => import('./pages/config/ConfigPage'));
const PortalAdminPage = lazy(() => import('./pages/portal/PortalAdminPage'));
const EquipoPage = lazy(() => import('./pages/team/EquipoPage'));
const CashClosePage = lazy(() => import('./pages/cashclose/CashClosePage'));
const ReportsPage = lazy(() => import('./pages/reports/ReportsPage'));
const SucursalesPage = lazy(() => import('./pages/SucursalesPage'));
const InventarioPage = lazy(() => import('./pages/inventory/InventarioPage'));
const EquiposPage = lazy(() => import('./pages/inventory/EquiposPage'));
const ChatPage = lazy(() => import('./pages/team/ChatPage'));

/** Se muestra el instante que tarda en llegar el trozo de código de la pantalla. */
function CargandoPantalla() {
  return (
    <div className="flex min-h-[50vh] items-center justify-center">
      <div className="flex flex-col items-center gap-3">
        <div className="h-8 w-8 animate-spin rounded-full border-[3px] border-line" style={{ borderTopColor: 'var(--magenta)' }} />
        <span className="text-[12.5px] font-semibold text-muted">Cargando…</span>
      </div>
    </div>
  );
}

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
        <Suspense fallback={<CargandoPantalla />}>
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
            <Route path="portal" element={<PortalAdminPage />} />
            <Route path="inventario" element={<InventarioPage />} />
            <Route path="equipos" element={<EquiposPage />} />
            <Route path="chat" element={<ChatPage />} />
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
        </Suspense>
        </ToastProvider>
      </AuthProvider>
    </BrowserRouter>
  );
}
