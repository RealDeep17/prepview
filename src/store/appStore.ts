import { create } from 'zustand';
import { getBootstrapState } from '../lib/bridge';
import type { BootstrapState, ExchangeAccount, ExchangeKind, PortfolioPosition } from '../lib/types';
import {
  DEFAULT_POSITION_COLUMNS,
  POSITION_COLUMN_KEYS,
  type PositionColumnKey,
  type PositionSortDirection,
} from '../lib/positionView';

const POSITION_COLUMNS_STORAGE_KEY = 'prepview.positions.columns';
const POSITION_SORT_KEY_STORAGE_KEY = 'prepview.positions.sortKey';
const POSITION_SORT_DIRECTION_STORAGE_KEY = 'prepview.positions.sortDirection';

function loadPositionColumns(): PositionColumnKey[] {
  const raw = localStorage.getItem(POSITION_COLUMNS_STORAGE_KEY);
  if (!raw) return DEFAULT_POSITION_COLUMNS;

  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return DEFAULT_POSITION_COLUMNS;

    const next = parsed.filter(
      (value, index): value is PositionColumnKey =>
        POSITION_COLUMN_KEYS.includes(value as PositionColumnKey) && parsed.indexOf(value) === index,
    );
    return next.length > 0 ? next : DEFAULT_POSITION_COLUMNS;
  } catch {
    return DEFAULT_POSITION_COLUMNS;
  }
}

function loadPositionSortKey(): PositionColumnKey | null {
  const raw = localStorage.getItem(POSITION_SORT_KEY_STORAGE_KEY);
  return raw && POSITION_COLUMN_KEYS.includes(raw as PositionColumnKey)
    ? (raw as PositionColumnKey)
    : null;
}

function loadPositionSortDirection(): PositionSortDirection {
  return localStorage.getItem(POSITION_SORT_DIRECTION_STORAGE_KEY) === 'asc' ? 'asc' : 'desc';
}

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
  positionColumns: PositionColumnKey[];
  positionSortKey: PositionColumnKey | null;
  positionSortDirection: PositionSortDirection;
  // Layout panel visibility
  leftPanelOpen: boolean;
  rightPanelOpen: boolean;
  chartOpen: boolean;
  fetchBootstrap: () => Promise<void>;
  setScopeExchange: (exchange: ExchangeKind | 'all') => void;
  setScopeAccountId: (id: string | null) => void;
  setSelectedAccountId: (id: string | null) => void;
  setSelectedPositionId: (id: string | null) => void;
  setActiveTab: (tab: AppState['activeTab']) => void;
  addPositionColumn: (column: PositionColumnKey) => void;
  removePositionColumn: (column: PositionColumnKey) => void;
  movePositionColumn: (column: PositionColumnKey, direction: 'left' | 'right') => void;
  setPositionSort: (key: PositionColumnKey | null, direction?: PositionSortDirection) => void;
  togglePositionSort: (key: PositionColumnKey) => void;
  resetPositionView: () => void;
  openOverlay: (overlay: AppState['activeOverlay'], positionId?: string) => void;
  closeOverlay: () => void;
  toggleLeftPanel: () => void;
  toggleRightPanel: () => void;
  toggleChart: () => void;
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
  positionColumns: loadPositionColumns(),
  positionSortKey: loadPositionSortKey(),
  positionSortDirection: loadPositionSortDirection(),
  leftPanelOpen:  localStorage.getItem('prepview.lo') !== 'false',
  rightPanelOpen: localStorage.getItem('prepview.ro') !== 'false',
  chartOpen:      localStorage.getItem('prepview.co') === 'true',

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
  addPositionColumn: (column) => set((state) => {
    if (state.positionColumns.includes(column)) return state;
    const next = [...state.positionColumns, column];
    localStorage.setItem(POSITION_COLUMNS_STORAGE_KEY, JSON.stringify(next));
    return { positionColumns: next };
  }),
  removePositionColumn: (column) => set((state) => {
    if (state.positionColumns.length <= 1) return state;
    const next = state.positionColumns.filter((item) => item !== column);
    localStorage.setItem(POSITION_COLUMNS_STORAGE_KEY, JSON.stringify(next));
    if (state.positionSortKey === column) {
      localStorage.removeItem(POSITION_SORT_KEY_STORAGE_KEY);
    }
    return {
      positionColumns: next,
      positionSortKey: state.positionSortKey === column ? null : state.positionSortKey,
    };
  }),
  movePositionColumn: (column, direction) => set((state) => {
    const index = state.positionColumns.indexOf(column);
    if (index === -1) return state;
    const targetIndex = direction === 'left' ? index - 1 : index + 1;
    if (targetIndex < 0 || targetIndex >= state.positionColumns.length) return state;
    const next = [...state.positionColumns];
    [next[index], next[targetIndex]] = [next[targetIndex], next[index]];
    localStorage.setItem(POSITION_COLUMNS_STORAGE_KEY, JSON.stringify(next));
    return { positionColumns: next };
  }),
  setPositionSort: (key, direction) => set((state) => {
    const nextDirection = direction ?? state.positionSortDirection;
    if (key) {
      localStorage.setItem(POSITION_SORT_KEY_STORAGE_KEY, key);
    } else {
      localStorage.removeItem(POSITION_SORT_KEY_STORAGE_KEY);
    }
    localStorage.setItem(POSITION_SORT_DIRECTION_STORAGE_KEY, nextDirection);
    return {
      positionSortKey: key,
      positionSortDirection: nextDirection,
    };
  }),
  togglePositionSort: (key) => set((state) => {
    const nextDirection =
      state.positionSortKey === key && state.positionSortDirection === 'asc' ? 'desc' : 'asc';
    localStorage.setItem(POSITION_SORT_KEY_STORAGE_KEY, key);
    localStorage.setItem(POSITION_SORT_DIRECTION_STORAGE_KEY, nextDirection);
    return {
      positionSortKey: key,
      positionSortDirection: nextDirection,
    };
  }),
  resetPositionView: () => set(() => {
    localStorage.setItem(POSITION_COLUMNS_STORAGE_KEY, JSON.stringify(DEFAULT_POSITION_COLUMNS));
    localStorage.removeItem(POSITION_SORT_KEY_STORAGE_KEY);
    localStorage.setItem(POSITION_SORT_DIRECTION_STORAGE_KEY, 'desc');
    return {
      positionColumns: DEFAULT_POSITION_COLUMNS,
      positionSortKey: null,
      positionSortDirection: 'desc',
    };
  }),
  openOverlay: (overlay, positionId) => set({
    activeOverlay: overlay,
    editingPositionId: positionId ?? null,
  }),
  closeOverlay: () => set({ activeOverlay: null, editingPositionId: null }),
  toggleLeftPanel: () => set((s) => {
    const v = !s.leftPanelOpen; localStorage.setItem('prepview.lo', String(v)); return { leftPanelOpen: v };
  }),
  toggleRightPanel: () => set((s) => {
    const v = !s.rightPanelOpen; localStorage.setItem('prepview.ro', String(v)); return { rightPanelOpen: v };
  }),
  toggleChart: () => set((s) => {
    const v = !s.chartOpen; localStorage.setItem('prepview.co', String(v)); return { chartOpen: v };
  }),
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
