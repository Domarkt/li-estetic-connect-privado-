import { useEffect, useState } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { useBranch } from './BranchContext';
import { Icon, NAV_ICON } from '../components/icons';
import { ROLE_LABEL, type Role } from '../lib/types';
import NotificationBell from './NotificationBell';

interface NavItem { key: string; label: string; badge?: number }

const NAV: Record<Role, NavItem[]> = {
  ADMIN: [
    { key: 'dashboard', label: 'Vista General' },
    { key: 'sucursales', label: 'Sucursales' },
    { key: 'pacientes', label: 'Pacientes' },
    { key: 'agenda', label: 'Agenda' },
    { key: 'mensajes', label: 'Mensajes', badge: 6 },
    { key: 'facturacion', label: 'Facturación' },
    { key: 'catalogo', label: 'Catálogo' },
    { key: 'inventario', label: 'Inventario' },
    { key: 'puntos', label: 'Puntos & Comisiones' },
    { key: 'reportes', label: 'Reportes' },
    { key: 'equipo', label: 'Equipo' },
    { key: 'cierre', label: 'Cierre de caja' },
    { key: 'configuracion', label: 'Configuración' },
  ],
  RECEPCIONISTA: [
    { key: 'agenda', label: 'Agenda', badge: 3 },
    { key: 'mensajes', label: 'Mensajes', badge: 6 },
    { key: 'pacientes', label: 'Pacientes' },
    { key: 'facturacion', label: 'Cobro & Facturación' },
    { key: 'inventario', label: 'Inventario' },
    { key: 'cierre', label: 'Cierre de caja' },
    { key: 'seguimiento', label: 'Seguimiento' },
  ],
  ESTETICISTA: [
    { key: 'agenda', label: 'Mi Agenda', badge: 4 },
    { key: 'pacientes', label: 'Pacientes' },
    { key: 'equipos', label: 'Equipos' },
    { key: 'puntos', label: 'Mis Puntos' },
  ],
};

const PAGE_TITLE: Record<string, { title: string; sub: string }> = {
  dashboard: { title: 'Vista General', sub: 'Resumen consolidado de las sucursales' },
  sucursales: { title: 'Sucursales', sub: 'Desempeño por sucursal' },
  pacientes: { title: 'Pacientes', sub: 'Expediente y ficha clínica' },
  agenda: { title: 'Agenda', sub: 'Citas del día' },
  mensajes: { title: 'Mensajes', sub: 'Bandeja omnicanal' },
  facturacion: { title: 'Facturación', sub: 'Cobros y recibos' },
  catalogo: { title: 'Catálogo', sub: 'Servicios, paquetes, combos y productos' },
  inventario: { title: 'Inventario', sub: 'Stock de productos e insumos por sucursal' },
  equipos: { title: 'Equipos y suministros', sub: 'Consulta y reporta averías o incidentes' },
  puntos: { title: 'Puntos & Comisiones', sub: 'Programa Líderes LI' },
  reportes: { title: 'Reportes', sub: 'Ventas, operación, equipo y campañas' },
  equipo: { title: 'Equipo', sub: 'Colaboradoras y usuarios del sistema' },
  seguimiento: { title: 'Seguimiento', sub: 'Pipeline de ventas' },
  cierre: { title: 'Cierre de caja', sub: 'Conteo diario y cuadre por sucursal' },
  configuracion: { title: 'Configuración', sub: 'Metas, reglas de puntos y premios' },
};

const today = new Date().toLocaleDateString('es-DO', { weekday: 'long', day: '2-digit', month: 'long' });

export default function AppShell() {
  const { staff, logout } = useAuth();
  const { branches, activeBranch, setActiveBranch, active } = useBranch();
  const navigate = useNavigate();
  const location = useLocation();
  const [sidebarOpen, setSidebarOpen] = useState(false);

  if (!staff) return null;
  const items = NAV[staff.role];
  const current = location.pathname.split('/')[2] ?? 'dashboard';
  const page = PAGE_TITLE[current] ?? PAGE_TITLE.dashboard;

  const initials = staff.name.split(' ').map((w) => w[0]).slice(0, 2).join('').toUpperCase();
  const sidebarBranch = staff.role === 'ADMIN'
    ? { name: 'Todas las sucursales', place: 'Panel general', dot: '#B31C86' }
    : { name: staff.branch?.name ?? '', place: staff.branch?.place ?? '', dot: staff.branch?.dotColor ?? '#B31C86' };

  function doLogout() {
    logout();
    navigate('/login');
  }

  return (
    <div className="flex min-h-screen bg-bg">
      {/* Backdrop (solo móvil, cuando el menú está abierto) */}
      {sidebarOpen && <div onClick={() => setSidebarOpen(false)} className="fixed inset-0 z-40 bg-black/40 md:hidden" />}

      {/* Sidebar: fijo en escritorio, cajón deslizable en móvil */}
      <aside className={`fixed z-50 flex h-[100dvh] w-[244px] flex-none flex-col text-white transition-transform duration-200 md:sticky md:top-0 md:z-auto md:h-screen md:translate-x-0 ${sidebarOpen ? 'translate-x-0' : '-translate-x-full'}`} style={{ background: 'var(--navy)' }}>
        <div className="flex items-center gap-2.5 px-5 pb-4 pt-5">
          <div className="flex rounded-[10px] bg-white px-2.5 py-[7px]"><img src="/li-logo.png" className="block h-[26px]" /></div>
          <div className="text-[15px] font-extrabold tracking-tight">Connect</div>
        </div>
        <div className="mb-1.5 px-3">
          <div className="flex items-center gap-2.5 rounded-[10px] px-3 py-2.5" style={{ background: 'var(--navy-2)' }}>
            <span className="h-2 w-2 flex-none rounded-full" style={{ background: sidebarBranch.dot }} />
            <div className="min-w-0 flex-1">
              <div className="truncate text-[12.5px] font-bold">{sidebarBranch.name}</div>
              <div className="truncate text-[10.5px]" style={{ color: '#9AA0C0' }}>{sidebarBranch.place}</div>
            </div>
          </div>
        </div>
        <nav className="flex flex-1 flex-col gap-[3px] overflow-y-auto px-3 py-2.5">
          {items.map((n) => (
            <NavLink key={n.key} to={`/app/${n.key}`} onClick={() => setSidebarOpen(false)}
              className={({ isActive }) =>
                `flex items-center gap-2.5 rounded-[10px] px-3 py-2.5 text-[13.5px] font-semibold transition ${
                  isActive ? 'bg-magenta text-white' : 'text-[#C6CBDE] hover:bg-white/5'
                }`
              }>
              <span className="flex opacity-90"><Icon name={NAV_ICON[n.key]} size={18} /></span>
              <span className="flex-1 text-left">{n.label}</span>
              {n.badge ? <span className="rounded-full bg-magenta px-[7px] py-px text-[10.5px] font-bold text-white">{n.badge}</span> : null}
            </NavLink>
          ))}
        </nav>
        <div className="border-t border-white/10 p-3" style={{ paddingBottom: 'calc(0.75rem + env(safe-area-inset-bottom))' }}>
          <div className="flex items-center gap-2.5 px-1 py-1">
            <div className="flex h-[34px] w-[34px] flex-none items-center justify-center rounded-full text-[13px] font-bold" style={{ background: staff.avatarColor }}>{initials}</div>
            <div className="min-w-0 flex-1">
              <div className="truncate text-[13px] font-bold">{staff.name}</div>
              <div className="text-[11px]" style={{ color: '#9AA0C0' }}>{ROLE_LABEL[staff.role]}</div>
            </div>
            <button onClick={doLogout} title="Cerrar sesión" className="flex items-center gap-1.5 rounded-lg bg-white/10 px-3 py-2 text-[12px] font-bold text-white hover:bg-white/20">
              <Icon name="logout" size={17} /> Salir
            </button>
          </div>
        </div>
      </aside>

      {/* Main */}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-20 flex h-16 items-center gap-2 border-b border-line bg-card px-3 sm:gap-4 sm:px-7">
          <button onClick={() => setSidebarOpen(true)} className="flex h-9 w-9 flex-none items-center justify-center rounded-lg border border-line bg-bg text-muted md:hidden" title="Menú">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M3 6h18M3 12h18M3 18h18"/></svg>
          </button>
          <div className="min-w-0 flex-1">
            <h1 className="m-0 truncate text-base font-extrabold tracking-tight sm:text-lg">{page.title}</h1>
            <div className="truncate text-xs text-muted">{page.sub}</div>
          </div>

          {staff.role === 'ADMIN' && (
            <div className="hidden gap-1.5 rounded-[10px] border border-line bg-bg p-1 sm:flex">
              {[{ id: 'all', label: 'Todas' }, ...branches.map((b) => ({ id: b.id, label: b.name.replace('Estética ', 'E') }))].map((b) => {
                const on = activeBranch === b.id;
                return (
                  <button key={b.id} onClick={() => setActiveBranch(b.id)}
                    className={`rounded-[7px] px-3 py-1.5 text-[12.5px] font-bold transition ${on ? 'bg-magenta text-white' : 'text-muted hover:text-ink'}`}>
                    {b.label}
                  </button>
                );
              })}
            </div>
          )}

          <NotificationBell />

          <Clock />

          <div className="hidden items-center gap-2 rounded-[10px] border border-line bg-bg px-3 py-2.5 text-[13px] font-semibold capitalize text-muted sm:flex">
            <Icon name="calDay" size={15} />
            {today}
          </div>
        </header>

        {/* Banner de sucursal activa (admin filtrando) */}
        {staff.role === 'ADMIN' && active && (
          <div className="mx-4 mt-4 flex items-center gap-3 rounded-xl border border-line bg-card px-4 py-3 shadow-card sm:mx-7"
            style={{ borderLeft: `4px solid ${active.dotColor}` }}>
            <span className="h-2.5 w-2.5 flex-none rounded-full" style={{ background: active.dotColor }} />
            <div className="flex-1">
              <div className="text-[15px] font-extrabold">{active.name}</div>
              <div className="text-[12.5px] text-muted">{active.place}</div>
            </div>
            <span className="rounded-full bg-bg px-3 py-1 text-[11.5px] font-bold" style={{ color: active.dotColor }}>Sucursal activa</span>
          </div>
        )}

        <main className="flex-1 overflow-y-auto px-4 py-4 sm:px-7 sm:py-[26px]">
          <Outlet />
        </main>
      </div>
    </div>
  );
}

/** Reloj en vivo con la hora local de República Dominicana (UTC-4). Visible en
 *  todos los paneles (recepción/esteticista/admin), también en móvil. */
function Clock() {
  const fmt = () =>
    new Date().toLocaleTimeString('es-DO', {
      timeZone: 'America/Santo_Domingo',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: true,
    });
  const [now, setNow] = useState(fmt);
  useEffect(() => {
    const id = setInterval(() => setNow(fmt()), 1000);
    return () => clearInterval(id);
  }, []);
  return (
    <div className="flex items-center gap-1.5 rounded-[10px] border border-line bg-bg px-2.5 py-2.5 text-[13px] font-bold tabular-nums text-text sm:px-3">
      <Icon name="clock" size={15} />
      <span>{now}</span>
    </div>
  );
}
