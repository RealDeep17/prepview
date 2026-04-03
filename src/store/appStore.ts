import { create } from 'zustand';
import { getBootstrapState } from '../lib/bridge';
import type { BootstrapState, ExchangeAccount, ExchangeKind, PortfolioPosition } from '../lib/types';

export interface AppState {
  bootstrap: BootstrapState | null;
  loading: boolean;
  error: string | null;
  selectedAccountId: string | null;
  selectedPositionId: string | null;
  activeTab: 'positions' | 'exposure' | 'history' | 'journal' | 'closed';
  scopeExchange: ExchangeKind | 'all';
  scopeAccountId: string | null;
  activeOverlay: 'add-account' | 'edit-account' | 'add-position' | 'edit-position' | 'csv-import' | null;
  editingPositionId: string | null;
  fetchBootstrap: () => Promise<void>;
  setScopeExchange: (exchange: ExchangeKind | 'all') => void;
  setScopeAccountId: (id: string | null) => void;
  setSelectedAccountId: (id: string | null) => void;
  setSelectedPositionId: (id: string | null) => void;
  setActiveTab: (tab: AppState['activeTab']) => void;
  openOverlay: (overlay: AppState['activeOverlay'], positionId?: string) => void;
  closeOverlay: () => void;
}

export const useAppStore = create<AppState>((set) => ({
  bootstrap: null,
  loading: true,
  error: null,
  selectedAccountId: null,
  selectedPositionId: null,
  activeTab: 'positions',
  scopeExchange: 'all',
  scopeAccountId: null,
  activeOverlay: null,
  editingPositionId: null,

  fetchBootstrap: async () => {
    set((state) => ({
      loading: state.bootstrap === null,
      error: null,
    }));
    try {
      const state = await getBootstrapState();
      set({ bootstrap: state, loading: false, error: null });
    } catch (e) {
      set({ error: String(e), loading: false });
    }
  },

  setScopeExchange: (exchange) => set({ scopeExchange: exchange, scopeAccountId: null }),
  setScopeAccountId: (id) => set({ scopeAccountId: id }),
  setSelectedAccountId: (id) => set({ selectedAccountId: id }),
  setSelectedPositionId: (id) => set({ selectedPositionId: id }),
  setActiveTab: (tab) => set({ activeTab: tab }),
  openOverlay: (overlay, positionId) => set({
    activeOverlay: overlay,
    editingPositionId: positionId ?? null,
  }),
  closeOverlay: () => set({ activeOverlay: null, editingPositionId: null }),
}));

export function scopedAccounts(state: AppState): ExchangeAccount[] {
  if (!state.bootstrap) return [];
  let accounts = state.bootstrap.accounts;
  if (state.scopeExchange !== 'all') {
    accounts = accounts.filter((account) => account.exchange === state.scopeExchange);
  }
  if (state.scopeAccountId) {
    accounts = accounts.filter((account) => account.id === state.scopeAccountId);
  }
  return accounts;
}

export function scopedPositions(state: AppState): PortfolioPosition[] {
  const accountIds = new Set(scopedAccounts(state).map((account) => account.id));
  return (state.bootstrap?.positions ?? []).filter((position) => accountIds.has(position.accountId));
}

export function selectedPosition(state: AppState): PortfolioPosition | null {
  if (!state.selectedPositionId || !state.bootstrap) return null;
  return state.bootstrap.positions.find((position) => position.id === state.selectedPositionId) ?? null;
}

export function selectedAccount(state: AppState): ExchangeAccount | null {
  if (!state.selectedAccountId || !state.bootstrap) return null;
  return state.bootstrap.accounts.find((account) => account.id === state.selectedAccountId) ?? null;
}
