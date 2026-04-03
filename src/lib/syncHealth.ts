import type { ExchangeAccount, SyncJobRecord } from './types';

export type SyncHealthTone = 'positive' | 'negative' | 'neutral';
export type SyncHealthState =
  | 'local'
  | 'awaiting'
  | 'syncing'
  | 'stale'
  | 'degraded'
  | 'synced';

export interface SyncHealthSnapshot {
  state: SyncHealthState;
  label: string;
  tone: SyncHealthTone;
  detail: string;
  errorMessage?: string | null;
  lastSyncedAt?: string | null;
}

export interface SyncHealthSummary extends SyncHealthSnapshot {
  liveAccounts: number;
  staleCount: number;
  degradedCount: number;
  awaitingCount: number;
}

interface SyncHealthOptions {
  nowMs?: number;
  forceSyncing?: boolean;
  syncingAccountIds?: Iterable<string>;
}

const STALE_SYNC_MS = 15 * 60_000;

export function isStaleSync(value?: string | null, nowMs = Date.now()) {
  if (!value) {
    return false;
  }
  return nowMs - new Date(value).getTime() > STALE_SYNC_MS;
}

function formatRelativeAge(value: string, nowMs = Date.now()) {
  const diffMs = nowMs - new Date(value).getTime();
  const diffMinutes = Math.max(0, Math.floor(diffMs / 60_000));

  if (diffMinutes < 1) return 'just now';
  if (diffMinutes < 60) return `${diffMinutes}m ago`;

  const diffHours = Math.floor(diffMinutes / 60);
  if (diffHours < 24) return `${diffHours}h ago`;

  return `${Math.floor(diffHours / 24)}d ago`;
}

export function deriveAccountSyncHealth(
  account: ExchangeAccount,
  syncJobs: SyncJobRecord[],
  options: SyncHealthOptions = {},
): SyncHealthSnapshot {
  const nowMs = options.nowMs ?? Date.now();
  const syncingAccountIds = new Set(options.syncingAccountIds ?? []);
  const latestJob = syncJobs.find((job) => job.accountId === account.id) ?? null;

  if (account.accountMode !== 'live') {
    return {
      state: 'local',
      label: 'local',
      tone: 'neutral',
      detail: account.accountMode === 'import' ? 'import-managed book' : 'manual/local book',
      errorMessage: null,
      lastSyncedAt: account.lastSyncedAt ?? null,
    };
  }

  if (options.forceSyncing || syncingAccountIds.has(account.id) || latestJob?.state === 'running') {
    return {
      state: 'syncing',
      label: 'syncing',
      tone: 'neutral',
      detail: account.lastSyncedAt
        ? `last ${formatRelativeAge(account.lastSyncedAt, nowMs)}`
        : 'fetching first live snapshot',
      errorMessage: null,
      lastSyncedAt: account.lastSyncedAt ?? null,
    };
  }

  const errorMessage = latestJob?.errorMessage ?? account.syncError ?? null;
  if (account.syncStatus === 'error' || latestJob?.state === 'failed') {
    return {
      state: 'degraded',
      label: 'degraded',
      tone: 'negative',
      detail: account.lastSyncedAt
        ? `last good ${formatRelativeAge(account.lastSyncedAt, nowMs)}`
        : 'no successful sync recorded',
      errorMessage,
      lastSyncedAt: account.lastSyncedAt ?? null,
    };
  }

  if (!account.lastSyncedAt) {
    return {
      state: 'awaiting',
      label: 'awaiting sync',
      tone: 'neutral',
      detail: 'no live snapshot yet',
      errorMessage: null,
      lastSyncedAt: null,
    };
  }

  if (isStaleSync(account.lastSyncedAt, nowMs)) {
    return {
      state: 'stale',
      label: 'stale',
      tone: 'neutral',
      detail: `last ${formatRelativeAge(account.lastSyncedAt, nowMs)}`,
      errorMessage: null,
      lastSyncedAt: account.lastSyncedAt,
    };
  }

  return {
    state: 'synced',
    label: 'synced',
    tone: 'positive',
    detail: `last ${formatRelativeAge(account.lastSyncedAt, nowMs)}`,
    errorMessage: null,
    lastSyncedAt: account.lastSyncedAt,
  };
}

export function summarizeSyncHealth(
  accounts: ExchangeAccount[],
  syncJobs: SyncJobRecord[],
  options: SyncHealthOptions = {},
): SyncHealthSummary {
  const liveAccounts = accounts.filter((account) => account.accountMode === 'live');
  if (liveAccounts.length === 0) {
    return {
      state: 'local',
      label: 'local only',
      tone: 'neutral',
      detail: 'no live connectors in scope',
      errorMessage: null,
      lastSyncedAt: null,
      liveAccounts: 0,
      staleCount: 0,
      degradedCount: 0,
      awaitingCount: 0,
    };
  }

  if (options.forceSyncing) {
    return {
      state: 'syncing',
      label: 'syncing',
      tone: 'neutral',
      detail: `${liveAccounts.length} live accounts in flight`,
      errorMessage: null,
      lastSyncedAt: null,
      liveAccounts: liveAccounts.length,
      staleCount: 0,
      degradedCount: 0,
      awaitingCount: 0,
    };
  }

  const snapshots = liveAccounts.map((account) =>
    deriveAccountSyncHealth(account, syncJobs, options),
  );
  const degradedCount = snapshots.filter((snapshot) => snapshot.state === 'degraded').length;
  const staleCount = snapshots.filter((snapshot) => snapshot.state === 'stale').length;
  const awaitingCount = snapshots.filter((snapshot) => snapshot.state === 'awaiting').length;

  if (degradedCount > 0) {
    return {
      state: 'degraded',
      label: 'degraded',
      tone: 'negative',
      detail:
        staleCount > 0
          ? `${degradedCount} degraded · ${staleCount} stale`
          : `${degradedCount} degraded account${degradedCount === 1 ? '' : 's'}`,
      errorMessage: null,
      lastSyncedAt: null,
      liveAccounts: liveAccounts.length,
      staleCount,
      degradedCount,
      awaitingCount,
    };
  }

  if (staleCount > 0) {
    return {
      state: 'stale',
      label: 'stale',
      tone: 'neutral',
      detail: `${staleCount} stale · ${liveAccounts.length - staleCount} fresh`,
      errorMessage: null,
      lastSyncedAt: null,
      liveAccounts: liveAccounts.length,
      staleCount,
      degradedCount,
      awaitingCount,
    };
  }

  if (awaitingCount > 0) {
    return {
      state: 'awaiting',
      label: 'awaiting sync',
      tone: 'neutral',
      detail: `${awaitingCount} awaiting first pull`,
      errorMessage: null,
      lastSyncedAt: null,
      liveAccounts: liveAccounts.length,
      staleCount,
      degradedCount,
      awaitingCount,
    };
  }

  return {
    state: 'synced',
    label: 'synced',
    tone: 'positive',
    detail: `${liveAccounts.length} live fresh`,
    errorMessage: null,
    lastSyncedAt: null,
    liveAccounts: liveAccounts.length,
    staleCount,
    degradedCount,
    awaitingCount,
  };
}
