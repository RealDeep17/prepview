import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { vi } from 'vitest';
import ProductApp from './ProductApp';

const bridge = vi.hoisted(() => ({
  addManualPosition: vi.fn(),
  createAccount: vi.fn(),
  createLiveAccount: vi.fn(),
  deleteAccount: vi.fn(),
  deleteManualPosition: vi.fn(),
  getExchangeMarketQuote: vi.fn(),
  getExchangeMarkets: vi.fn(),
  getBootstrapState: vi.fn(),
  importCsvPositions: vi.fn(),
  setLanProjection: vi.fn(),
  syncAllLiveAccounts: vi.fn(),
  syncLiveAccount: vi.fn(),
  updateAccount: vi.fn(),
  updateManualPosition: vi.fn(),
  validateLiveAccount: vi.fn(),
}));

vi.mock('./lib/bridge', () => bridge);

describe('ProductApp', () => {
  beforeEach(() => {
    bridge.getBootstrapState.mockResolvedValue({
      accounts: [],
      accountSyncHealth: [],
      syncHealthSummary: {
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
        syncingCount: 0,
      },
      positions: [],
      exposure: [],
      summary: {
        totalEquity: 0,
        totalUnrealizedPnl: 0,
        grossNotional: 0,
        portfolioHeatPercent: 0,
        openPositions: 0,
        accountCount: 0,
        updatedAt: '2026-04-02T12:00:00Z',
        sourceLabel: 'Local state only',
      },
      performance: {
        realizedPnl: 0,
        unrealizedPnl: 0,
        closedPositions: 0,
        winRate: 0,
        averageHoldHours: 0,
        feeDrag: 0,
      },
      portfolioHistory: [],
      accountHistory: [],
      recentFundingEntries: [],
      recentSyncJobs: [],
      lanStatus: {
        enabled: false,
        exposeToLan: false,
        bindAddress: null,
        publicUrl: null,
        token: null,
      },
      autoSyncStatus: {
        enabled: false,
        running: false,
        intervalSeconds: 0,
        nextScheduledAt: null,
        lastStartedAt: null,
        lastFinishedAt: null,
        lastCycleAccounts: 0,
        lastCycleSucceeded: 0,
        lastCycleFailed: 0,
        lastError: null,
      },
    });
    bridge.getExchangeMarkets.mockResolvedValue([]);
    bridge.getExchangeMarketQuote.mockResolvedValue({
      exchange: 'blofin',
      exchangeSymbol: 'BTC-USDT',
      symbol: 'BTCUSDT',
      markPrice: 67000,
      oraclePrice: 66950,
      fundingRate: 0.0001,
      nextFundingTime: '2026-04-03T03:00:00Z',
      asOf: '2026-04-03T02:00:00Z',
    });
    window.localStorage.clear();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('renders the reference-driven portfolio shell from bootstrap data', async () => {
    const queryClient = new QueryClient({
      defaultOptions: {
        queries: {
          retry: false,
        },
      },
    });

    render(
      <QueryClientProvider client={queryClient}>
        <ProductApp />
      </QueryClientProvider>,
    );

    expect(screen.getByText('CASSINI')).toBeInTheDocument();

    await waitFor(() => {
      expect(bridge.getBootstrapState).toHaveBeenCalledTimes(1);
    });

    expect(screen.getByRole('button', { name: 'All accounts' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Overview' })).toBeInTheDocument();
  });

  it('loads exchange markets for manual capture even when the current scope has no manual account', async () => {
    bridge.getBootstrapState.mockResolvedValue({
      accounts: [
        {
          id: 'live-hl',
          name: 'HL Live',
          exchange: 'hyperliquid',
          accountMode: 'live',
          walletBalance: 1000,
          availableBalance: 800,
          snapshotEquity: 1050,
          currency: 'USDC',
          syncStatus: 'active',
          createdAt: '2026-04-03T00:00:00Z',
          lastSyncedAt: '2026-04-03T01:00:00Z',
        },
        {
          id: 'manual-blofin',
          name: 'BloFin Base',
          exchange: 'blofin',
          accountMode: 'manual',
          walletBalance: 500,
          availableBalance: 500,
          snapshotEquity: 500,
          currency: 'USDT',
          syncStatus: 'manual',
          createdAt: '2026-04-03T00:00:00Z',
          lastSyncedAt: null,
        },
      ],
      accountSyncHealth: [],
      syncHealthSummary: {
        state: 'synced',
        label: 'synced',
        tone: 'positive',
        detail: '1 live fresh',
        errorMessage: null,
        lastSyncedAt: null,
        liveAccounts: 1,
        staleCount: 0,
        degradedCount: 0,
        awaitingCount: 0,
        syncingCount: 0,
      },
      positions: [],
      exposure: [],
      summary: {
        totalEquity: 1550,
        totalUnrealizedPnl: 0,
        grossNotional: 0,
        portfolioHeatPercent: 0,
        openPositions: 0,
        accountCount: 2,
        updatedAt: '2026-04-03T02:00:00Z',
        sourceLabel: 'Mixed state',
      },
      performance: {
        realizedPnl: 0,
        unrealizedPnl: 0,
        closedPositions: 0,
        winRate: 0,
        averageHoldHours: 0,
        feeDrag: 0,
      },
      portfolioHistory: [],
      accountHistory: [],
      recentFundingEntries: [],
      recentSyncJobs: [],
      lanStatus: {
        enabled: false,
        exposeToLan: false,
        bindAddress: null,
        publicUrl: null,
        token: null,
      },
      autoSyncStatus: {
        enabled: false,
        running: false,
        intervalSeconds: 0,
        nextScheduledAt: null,
        lastStartedAt: null,
        lastFinishedAt: null,
        lastCycleAccounts: 0,
        lastCycleSucceeded: 0,
        lastCycleFailed: 0,
        lastError: null,
      },
    });
    window.localStorage.setItem('cassini.product.scope', JSON.stringify('live-hl'));

    const queryClient = new QueryClient({
      defaultOptions: {
        queries: {
          retry: false,
        },
      },
    });

    render(
      <QueryClientProvider client={queryClient}>
        <ProductApp />
      </QueryClientProvider>,
    );

    await waitFor(() => {
      expect(bridge.getBootstrapState).toHaveBeenCalledTimes(1);
    });

    fireEvent.click(screen.getByRole('button', { name: /add position/i }));

    await waitFor(() => {
      expect(bridge.getExchangeMarkets).toHaveBeenCalledWith('blofin');
    });
  });
});
