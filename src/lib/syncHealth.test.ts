import { describe, expect, it } from 'vitest';

import type { ExchangeAccount, SyncJobRecord } from './types';
import { deriveAccountSyncHealth, isStaleSync, summarizeSyncHealth } from './syncHealth';

const NOW = new Date('2026-04-03T03:00:00.000Z').getTime();

function makeAccount(overrides: Partial<ExchangeAccount> = {}): ExchangeAccount {
  return {
    id: 'acc-1',
    name: 'Alpha',
    exchange: 'blofin',
    accountMode: 'live',
    walletBalance: 1000,
    availableBalance: 800,
    snapshotEquity: 1020,
    currency: 'USDT',
    externalReference: 'alpha',
    notes: '',
    syncStatus: 'active',
    syncError: null,
    createdAt: '2026-04-03T00:00:00.000Z',
    lastSyncedAt: '2026-04-03T02:55:00.000Z',
    ...overrides,
  };
}

function makeJob(overrides: Partial<SyncJobRecord> = {}): SyncJobRecord {
  return {
    id: 'job-1',
    accountId: 'acc-1',
    accountName: 'Alpha',
    exchange: 'blofin',
    state: 'success',
    startedAt: '2026-04-03T02:55:00.000Z',
    finishedAt: '2026-04-03T02:55:03.000Z',
    attemptCount: 1,
    syncedPositions: 2,
    fundingEntries: 1,
    errorMessage: null,
    ...overrides,
  };
}

describe('syncHealth', () => {
  it('marks old live snapshots as stale', () => {
    const account = makeAccount({
      lastSyncedAt: '2026-04-03T02:30:00.000Z',
    });

    expect(isStaleSync(account.lastSyncedAt, NOW)).toBe(true);

    const health = deriveAccountSyncHealth(account, [makeJob()], { nowMs: NOW });
    expect(health.state).toBe('stale');
    expect(health.label).toBe('stale');
    expect(health.detail).toContain('30m ago');
  });

  it('marks failed live accounts as degraded while keeping last good sync detail', () => {
    const account = makeAccount({
      syncStatus: 'error',
      syncError: 'rate limit',
      lastSyncedAt: '2026-04-03T02:45:00.000Z',
    });
    const job = makeJob({
      state: 'failed',
      errorMessage: 'request error: timeout',
    });

    const health = deriveAccountSyncHealth(account, [job], { nowMs: NOW });
    expect(health.state).toBe('degraded');
    expect(health.errorMessage).toBe('request error: timeout');
    expect(health.detail).toContain('last good 15m ago');
  });

  it('marks unsynced live accounts as awaiting sync', () => {
    const account = makeAccount({
      lastSyncedAt: null,
    });

    const health = deriveAccountSyncHealth(account, [], { nowMs: NOW });
    expect(health.state).toBe('awaiting');
    expect(health.detail).toBe('no live snapshot yet');
  });

  it('summarizes degraded and syncing live scopes', () => {
    const fresh = makeAccount();
    const degraded = makeAccount({
      id: 'acc-2',
      name: 'Beta',
      syncStatus: 'error',
      syncError: 'bad auth',
      lastSyncedAt: '2026-04-03T02:40:00.000Z',
    });
    const degradedJob = makeJob({
      id: 'job-2',
      accountId: 'acc-2',
      accountName: 'Beta',
      state: 'failed',
      errorMessage: 'bad auth',
    });

    const degradedSummary = summarizeSyncHealth([fresh, degraded], [makeJob(), degradedJob], {
      nowMs: NOW,
    });
    expect(degradedSummary.state).toBe('degraded');
    expect(degradedSummary.degradedCount).toBe(1);

    const syncingSummary = summarizeSyncHealth([fresh, degraded], [makeJob(), degradedJob], {
      nowMs: NOW,
      forceSyncing: true,
    });
    expect(syncingSummary.state).toBe('syncing');
    expect(syncingSummary.detail).toContain('2 live accounts in flight');
  });
});
