import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { api } from '../lib/api';
import { useAuth } from '../auth/AuthContext';
import type { Branch } from '../lib/types';

interface BranchState {
  branches: Branch[];
  /** Sucursal activa: 'all' solo para admin; para personal, siempre la suya. */
  activeBranch: string; // branchId | 'all'
  setActiveBranch: (id: string) => void;
  /** Sucursal actualmente resuelta (objeto) o null si 'all'. */
  active: Branch | null;
}

const Ctx = createContext<BranchState | null>(null);

export function BranchProvider({ children }: { children: ReactNode }) {
  const { staff } = useAuth();
  const [branches, setBranches] = useState<Branch[]>([]);
  const [activeBranch, setActiveBranch] = useState<string>(
    staff?.role === 'ADMIN' ? 'all' : (staff?.branchId ?? 'all'),
  );

  useEffect(() => {
    api.get<Branch[]>('/branches', 'staff').then(setBranches).catch(() => setBranches([]));
  }, []);

  const active = activeBranch === 'all' ? null : branches.find((b) => b.id === activeBranch) ?? null;

  return (
    <Ctx.Provider value={{ branches, activeBranch, setActiveBranch, active }}>
      {children}
    </Ctx.Provider>
  );
}

export function useBranch() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useBranch debe usarse dentro de BranchProvider');
  return ctx;
}
