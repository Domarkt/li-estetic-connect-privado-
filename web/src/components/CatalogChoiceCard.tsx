import { fmtRD, type CatalogItem } from '../lib/types';

const KIND_TAG: Record<string, string> = { SERVICIO: 'Servicio', PAQUETE: 'Paquete', COMBO: 'Combo', PRODUCTO: 'Producto' };

interface Props {
  item: CatalogItem;
  selected?: boolean;
  action: 'Agregar' | 'Seleccionar';
  onClick: () => void;
}

/** El mismo resumen del catálogo en Pacientes y Facturación. */
export default function CatalogChoiceCard({ item, selected = false, action, onClick }: Props) {
  const plan = item.kind === 'COMBO' || item.kind === 'PAQUETE';
  const services = item.services ?? [];

  return (
    <button type="button" onClick={onClick} aria-pressed={selected}
      className={`w-full rounded-xl border px-3.5 py-3 text-left transition hover:border-magenta focus-visible:outline focus-visible:outline-2 focus-visible:outline-magenta ${selected ? 'border-magenta bg-magenta-soft' : 'border-line bg-card'}`}>
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <div className="mb-1 flex flex-wrap items-center gap-1.5">
            <span className="rounded-full bg-navy-soft px-2 py-0.5 text-[10px] font-bold text-navy">{KIND_TAG[item.kind] ?? item.kind}</span>
            {plan && <span className="rounded-full bg-teal-soft px-2 py-0.5 text-[10px] font-bold text-teal">{item.sessions} {item.sessions === 1 ? 'sesión' : 'sesiones'}</span>}
          </div>
          <div className="text-[13px] font-extrabold leading-snug text-navy">{item.name}</div>
        </div>
        <div className="flex-none text-right">
          <div className="text-[13px] font-extrabold text-magenta">{item.price ? fmtRD(item.price) : 'Sin precio'}</div>
          <span className="text-[11px] font-bold text-magenta">{selected ? '✓ Seleccionado' : `+ ${action}`}</span>
        </div>
      </div>
      {plan && (services.length > 0 || (item.defaultAreas?.length ?? 0) > 0) && (
        <div className="mt-2 border-t border-line-2 pt-2 text-[11px] leading-relaxed text-muted">
          {services.length > 0 && <div><span className="font-bold text-navy">Incluye: </span>{services.map((service) => `${service.name}${service.qty ? ` ×${service.qty}` : ''}`).join(' · ')}</div>}
          {(item.defaultAreas?.length ?? 0) > 0 && <div><span className="font-bold text-navy">Áreas: </span>{item.defaultAreas!.map((area) => area.replaceAll('_', ' ').toLowerCase()).join(' · ')}</div>}
        </div>
      )}
    </button>
  );
}
