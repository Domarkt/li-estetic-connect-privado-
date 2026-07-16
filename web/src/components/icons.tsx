type IconProps = { size?: number; className?: string };

const base = (size: number, className?: string) => ({
  width: size,
  height: size,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.8,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  className,
});

const paths: Record<string, string[]> = {
  home: ['M3 11.5 12 4l9 7.5', 'M5.5 10v9.5h13V10'],
  grid: ['M4 4h6v6H4z', 'M14 4h6v6h-6z', 'M14 14h6v6h-6z', 'M4 14h6v6H4z'],
  users: [
    'M16 20v-1.5a3.5 3.5 0 0 0-3.5-3.5h-5A3.5 3.5 0 0 0 4 18.5V20',
    'M10 11.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7',
    'M20 20v-1.5a3.5 3.5 0 0 0-2.6-3.4',
    'M15 4.6a3.5 3.5 0 0 1 0 6.8',
  ],
  cal: ['M4 5h16v15H4z', 'M16 3v4M8 3v4M4 10h16'],
  money: ['M12 2v20', 'M16.5 5.5H9.75a3.25 3.25 0 0 0 0 6.5h4.5a3.25 3.25 0 0 1 0 6.5H7'],
  star: ['M12 3.2 14.6 8.5l5.8.8-4.2 4.1 1 5.8L12 16.7 6.8 19.2l1-5.8L3.6 9.3l5.8-.8z'],
  funnel: ['M3 4.5h18l-7 8v6.5l-4 2v-8.5z'],
  chart: ['M4 20V10M10 20V4M16 20v-7M22 20H2'],
  chat: ['M21 15a2 2 0 0 1-2 2H8l-5 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z'],
  box: ['M21 8 12 3 3 8l9 5 9-5z', 'M3 8v8l9 5 9-5V8', 'M12 13v8'],
  search: ['M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14z', 'M21 21l-4-4'],
  logout: ['M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4', 'M16 17l5-5-5-5', 'M21 12H9'],
  calDay: ['M4 5h16v15H4z', 'M16 3v4M8 3v4M4 10h16'],
  bell: ['M18 8a6 6 0 1 0-12 0c0 7-3 9-3 9h18s-3-2-3-9', 'M13.7 21a2 2 0 0 1-3.4 0'],
  clock: ['M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z', 'M12 7v5l3.5 2'],
  boxes: ['M3 8 7.5 5.5 12 8v4.5L7.5 15 3 12.5z', 'M12 8l4.5-2.5L21 8v4.5L16.5 15 12 12.5', 'M7.5 15v4l4.5 2.5 4.5-2.5v-4'],
  wrench: ['M14.7 6.3a4 4 0 0 0-5.4 5.2l-6 6 2.2 2.2 6-6a4 4 0 0 0 5.2-5.4l-2.4 2.4-2.2-.6-.6-2.2z'],
  settings: [
    'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z',
    'M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z',
  ],
};

export function Icon({ name, size = 18, className }: IconProps & { name: string }) {
  return (
    <svg {...base(size, className)}>
      {(paths[name] ?? []).map((d, i) => (
        <path key={i} d={d} />
      ))}
    </svg>
  );
}

export const NAV_ICON: Record<string, string> = {
  dashboard: 'home',
  sucursales: 'grid',
  pacientes: 'users',
  agenda: 'cal',
  mensajes: 'chat',
  facturacion: 'money',
  catalogo: 'box',
  inventario: 'boxes',
  equipos: 'wrench',
  puntos: 'star',
  equipo: 'chart',
  reportes: 'chart',
  seguimiento: 'funnel',
  cierre: 'money',
  configuracion: 'settings',
};
