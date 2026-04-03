import { useEffect, useMemo, useState, type Dispatch, type ReactNode, type SetStateAction } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import clsx from 'clsx';
import {
  Activity,
  FileSpreadsheet,
  Globe,
  Layers3,
  Link2,
  LoaderCircle,
  PencilLine,
  Plus,
  RefreshCw,
  Search,
  Settings2,
  Trash2,
  X,
} from 'lucide-react';
import {
  addManualPosition,
  createAccount,
  createLiveAccount,
  deleteAccount,
  deleteManualPosition,
  getExchangeMarketQuote,
  getExchangeMarkets,
  getBootstrapState,
  importCsvPositions,
  setLanProjection,
  syncAllLiveAccounts,
  syncLiveAccount,
  updateAccount,
  updateManualPosition,
  validateLiveAccount,
} from './lib/bridge';
import {
  deriveAccountSyncHealth,
  summarizeSyncHealth,
  type SyncHealthSnapshot,
  type SyncHealthSummary,
} from './lib/syncHealth';
import type {
  AccountHistorySeries,
  AutoSyncStatus,
  BalanceHistoryPoint,
  CreateAccountInput,
  CreateLiveAccountInput,
  ExchangeAccount,
  ExchangeMarket,
  ExchangeKind,
  FundingHistoryEntry,
  LiveAccountValidation,
  ManualPositionInput,
  MarketQuote,
  PerformanceMetrics,
  PortfolioPosition,
  PositionSide,
  SyncJobRecord,
  UpdateAccountInput,
  UpdateManualPositionInput,
} from './lib/types';

type TopView = 'overview' | 'positions' | 'history' | 'risk' | 'manage' | 'settings';
type FocusScope = 'portfolio' | string;
type OverlayMode =
  | null
  | 'account'
  | 'capture'
  | 'account-edit'
  | 'position-edit';
type AccountOverlayTab = 'live' | 'local';
type CaptureOverlayTab = 'position' | 'csv';
type CaptureStep = 'contract' | 'economics' | 'review';
type PositionSort = 'pnl' | 'size' | 'symbol';
type SideFilter = 'all' | PositionSide;
type HistoryGroupBy = 'time' | 'account' | 'exchange';
type HistoryWindow = '7d' | '30d' | '90d' | 'all';
type SupportedLiveExchange = Extract<ExchangeKind, 'blofin' | 'hyperliquid'>;

interface ScopeContext {
  kind: 'portfolio' | 'exchange' | 'account';
  label: string;
  detail: string;
  account: ExchangeAccount | null;
  accounts: ExchangeAccount[];
}

interface ExchangeGroup {
  exchange: ExchangeKind;
  accounts: ExchangeAccount[];
  totalEquity: number;
}

interface PositionGroup {
  account: ExchangeAccount;
  positions: PortfolioPosition[];
  grossExposure: number;
  openPnl: number;
  usedMargin: number;
  feeDrag: number;
}

interface HistoryRecord {
  id: string;
  accountId: string;
  accountName: string;
  exchange: ExchangeKind;
  symbol: string;
  side: PositionSide;
  sizeUsd: number;
  entryPrice: number;
  referencePrice: number;
  holdLabel: string;
  grossPnl: number;
  tradingFee: number;
  fundingFee: number;
  netPnl: number;
  eventTime: string;
}

interface RiskAccountCardModel {
  account: ExchangeAccount;
  grossExposure: number;
  usedMargin: number;
  freeMargin: number;
  ratio: number;
  openPnl: number;
  openPositions: number;
  averageLeverage: number;
  nearestLiquidationPrice: number | null;
  nearestLiquidationDistance: number | null;
}

interface Preferences {
  positionSide: SideFilter;
  positionSort: PositionSort;
  historySide: SideFilter;
  historyGroupBy: HistoryGroupBy;
  historyWindow: HistoryWindow;
  historyShowExchange: boolean;
  historyShowAccount: boolean;
  historyIncludeOpenRecords: boolean;
  showOverviewAccountCurves: boolean;
  showOverviewFeeBoard: boolean;
  showRiskEmptyAccounts: boolean;
  compactRows: boolean;
  drawerOpen: boolean;
}

const STORAGE_KEYS = {
  view: 'cassini.product.view',
  scope: 'cassini.product.scope',
  symbol: 'cassini.product.symbol',
  preferences: 'cassini.product.preferences',
  historyFrom: 'cassini.product.history.from',
  historyTo: 'cassini.product.history.to',
  historySymbol: 'cassini.product.history.symbol',
} as const;

const DEFAULT_PREFERENCES: Preferences = {
  positionSide: 'all',
  positionSort: 'pnl',
  historySide: 'all',
  historyGroupBy: 'time',
  historyWindow: '30d',
  historyShowExchange: true,
  historyShowAccount: true,
  historyIncludeOpenRecords: true,
  showOverviewAccountCurves: true,
  showOverviewFeeBoard: true,
  showRiskEmptyAccounts: true,
  compactRows: true,
  drawerOpen: true,
};

const EMPTY_ACCOUNTS: ExchangeAccount[] = [];
const EMPTY_POSITIONS: PortfolioPosition[] = [];
const EMPTY_HISTORY: BalanceHistoryPoint[] = [];
const EMPTY_ACCOUNT_HISTORY: AccountHistorySeries[] = [];
const EMPTY_FUNDING: FundingHistoryEntry[] = [];
const EMPTY_SYNC_JOBS: SyncJobRecord[] = [];
const EMPTY_MARKETS: ExchangeMarket[] = [];

const exchangeOptions: Array<{ value: ExchangeKind; label: string }> = [
  { value: 'manual', label: 'Manual / Local' },
  { value: 'blofin', label: 'BloFin' },
  { value: 'hyperliquid', label: 'Hyperliquid' },
  { value: 'import', label: 'Imported / Unsupported' },
];

const liveExchangeOptions: Array<{
  value: CreateLiveAccountInput['exchange'];
  label: string;
}> = [
  { value: 'blofin', label: 'BloFin' },
  { value: 'hyperliquid', label: 'Hyperliquid' },
];

function ProductApp() {
  const queryClient = useQueryClient();
  const [activeView, setActiveView] = useStoredState<TopView>(
    STORAGE_KEYS.view,
    'overview',
  );
  const [focusScope, setFocusScope] = useStoredState<FocusScope>(
    STORAGE_KEYS.scope,
    'portfolio',
  );
  const [focusedSymbol, setFocusedSymbol] = useStoredState<string | null>(
    STORAGE_KEYS.symbol,
    null,
  );
  const [preferences, setPreferences] = useStoredState<Preferences>(
    STORAGE_KEYS.preferences,
    DEFAULT_PREFERENCES,
  );
  const [historyFrom, setHistoryFrom] = useStoredState<string>(
    STORAGE_KEYS.historyFrom,
    defaultDateRange(DEFAULT_PREFERENCES.historyWindow).from,
  );
  const [historyTo, setHistoryTo] = useStoredState<string>(
    STORAGE_KEYS.historyTo,
    defaultDateRange(DEFAULT_PREFERENCES.historyWindow).to,
  );
  const [historySymbol, setHistorySymbol] = useStoredState<string>(
    STORAGE_KEYS.historySymbol,
    'all',
  );
  const [overlay, setOverlay] = useState<OverlayMode>(null);
  const [accountOverlayTab, setAccountOverlayTab] =
    useState<AccountOverlayTab>('live');
  const [captureOverlayTab, setCaptureOverlayTab] =
    useState<CaptureOverlayTab>('position');
  const [selectedPositionId, setSelectedPositionId] = useState<string | null>(null);
  const [accountEditForm, setAccountEditForm] = useState<UpdateAccountInput | null>(null);
  const [positionEditForm, setPositionEditForm] =
    useState<UpdateManualPositionInput | null>(null);

  const [accountForm, setAccountForm] = useState<CreateAccountInput>({
    name: '',
    exchange: 'manual',
    walletBalance: 0,
    notes: '',
  });
  const [liveAccountForm, setLiveAccountForm] = useState<CreateLiveAccountInput>({
    name: '',
    exchange: 'hyperliquid',
    connectionLabel: '',
    walletAddress: '',
    apiKey: '',
    apiSecret: '',
    apiPassphrase: '',
  });
  const [liveValidation, setLiveValidation] = useState<LiveAccountValidation | null>(
    null,
  );
  const [positionForm, setPositionForm] = useState<ManualPositionInput>({
    accountId: '',
    exchange: 'manual',
    exchangeSymbol: undefined,
    symbol: 'BTCUSDT',
    side: 'long',
    quantity: 0.01,
    entryPrice: 0,
    markPrice: undefined,
    leverage: 5,
    feePaid: 0,
    fundingPaid: 0,
    notes: '',
  });
  const [csvPayload, setCsvPayload] = useState(
    [
      'symbol,side,entry_price,quantity,leverage,mark_price,fee_paid,funding_paid',
      'BTCUSDT,long,96000,0.02,5,97120,4.2,0.0',
    ].join('\n'),
  );
  const [csvTargetAccount, setCsvTargetAccount] = useState('');
  const [csvSourceExchange, setCsvSourceExchange] = useState<ExchangeKind>('import');
  const [captureMarketQuery, setCaptureMarketQuery] = useState('BTCUSDT');

  const bootstrapQuery = useQuery({
    queryKey: ['bootstrap'],
    queryFn: getBootstrapState,
    refetchInterval: 10_000,
  });

  const bootstrap = bootstrapQuery.data;
  const accounts = bootstrap?.accounts ?? EMPTY_ACCOUNTS;
  const positions = bootstrap?.positions ?? EMPTY_POSITIONS;
  const portfolioHistory = bootstrap?.portfolioHistory ?? EMPTY_HISTORY;
  const accountHistory = bootstrap?.accountHistory ?? EMPTY_ACCOUNT_HISTORY;
  const recentFundingEntries = bootstrap?.recentFundingEntries ?? EMPTY_FUNDING;
  const recentSyncJobs = bootstrap?.recentSyncJobs ?? EMPTY_SYNC_JOBS;
  const lanStatus = bootstrap?.lanStatus;
  const autoSyncStatus = bootstrap?.autoSyncStatus;

  useEffect(() => {
    if (!isValidScope(focusScope, accounts)) {
      setFocusScope('portfolio');
    }
  }, [accounts, focusScope, setFocusScope]);

  useEffect(() => {
    if (!overlay) {
      return undefined;
    }

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOverlay(null);
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [overlay]);

  const scopeContext = useMemo(() => deriveScopeContext(focusScope, accounts), [
    focusScope,
    accounts,
  ]);
  const scopedAccounts = scopeContext.accounts;
  const scopedAccountIds = useMemo(
    () => new Set(scopedAccounts.map((account) => account.id)),
    [scopedAccounts],
  );
  const scopedPositions = useMemo(
    () => positions.filter((position) => scopedAccountIds.has(position.accountId)),
    [positions, scopedAccountIds],
  );
  const scopedFundingEntries = useMemo(
    () => recentFundingEntries.filter((entry) => scopedAccountIds.has(entry.accountId)),
    [recentFundingEntries, scopedAccountIds],
  );
  const scopedSyncJobs = useMemo(
    () => recentSyncJobs.filter((job) => scopedAccountIds.has(job.accountId)),
    [recentSyncJobs, scopedAccountIds],
  );
  const scopedHistory = useMemo(() => {
    if (scopeContext.kind === 'portfolio') {
      return portfolioHistory;
    }

    return aggregateHistory(
      accountHistory.filter((series) => scopedAccountIds.has(series.accountId)),
    );
  }, [accountHistory, portfolioHistory, scopeContext.kind, scopedAccountIds]);
  const scopedAccountSeries = useMemo(
    () => accountHistory.filter((series) => scopedAccountIds.has(series.accountId)),
    [accountHistory, scopedAccountIds],
  );

  const groupedAccounts = useMemo(() => groupAccounts(accounts), [accounts]);
  const groupedPositions = useMemo(
    () =>
      buildPositionGroups(scopedAccounts, scopedPositions, preferences.positionSide, preferences.positionSort),
    [preferences.positionSide, preferences.positionSort, scopedAccounts, scopedPositions],
  );
  const historyRecords = useMemo(
    () => buildHistoryRecords(scopedPositions),
    [scopedPositions],
  );
  const filteredHistoryRecords = useMemo(
    () =>
      filterHistoryRecords(historyRecords, {
        side: preferences.historySide,
        from: historyFrom,
        to: historyTo,
        symbol: historySymbol,
        includeOpenRecords: preferences.historyIncludeOpenRecords,
      }),
    [historyRecords, historyFrom, historyTo, historySymbol, preferences.historyIncludeOpenRecords, preferences.historySide],
  );
  const historyGroups = useMemo(
    () => groupHistoryRecords(filteredHistoryRecords, preferences.historyGroupBy),
    [filteredHistoryRecords, preferences.historyGroupBy],
  );
  const selectedPosition =
    scopedPositions.find((position) => position.id === selectedPositionId) ??
    groupedPositions[0]?.positions[0] ??
    null;
  const marketBackedSelectedPositionExchange =
    selectedPosition?.exchange === 'blofin' || selectedPosition?.exchange === 'hyperliquid'
      ? selectedPosition.exchange
      : null;
  const selectedPositionQuoteQuery = useQuery({
    queryKey: [
      'selected-position-quote',
      marketBackedSelectedPositionExchange,
      selectedPosition?.exchangeSymbol ?? null,
    ],
    enabled:
      preferences.drawerOpen &&
      activeView === 'positions' &&
      selectedPosition != null &&
      marketBackedSelectedPositionExchange != null &&
      Boolean(selectedPosition.exchangeSymbol),
    queryFn: () =>
      getExchangeMarketQuote(
        marketBackedSelectedPositionExchange as SupportedLiveExchange,
        selectedPosition?.exchangeSymbol ?? '',
      ),
    refetchInterval: 15_000,
  });

  const manualAccounts = useMemo(() => scopedManualAccounts(accounts), [accounts]);
  const selectedCaptureAccountId = positionForm.accountId || manualAccounts[0]?.id || '';
  const selectedCaptureAccount =
    manualAccounts.find((account) => account.id === selectedCaptureAccountId) ?? null;
  const captureExchange = selectedCaptureAccount?.exchange ?? positionForm.exchange;
  const marketBackedExchange =
    captureExchange === 'blofin' || captureExchange === 'hyperliquid'
      ? captureExchange
      : null;
  const exchangeMarketsQuery = useQuery({
    queryKey: ['manual-exchange-markets', marketBackedExchange],
    enabled:
      overlay === 'capture' &&
      captureOverlayTab === 'position' &&
      marketBackedExchange != null,
    queryFn: () => getExchangeMarkets(marketBackedExchange as SupportedLiveExchange),
    staleTime: 5 * 60_000,
  });
  const marketCatalog = exchangeMarketsQuery.data ?? EMPTY_MARKETS;
  const filteredMarkets = useMemo(() => {
    const query = normalizeMarketSearch(captureMarketQuery);
    if (!query) {
      return marketCatalog.slice(0, 12);
    }
    return marketCatalog
      .filter((market) => {
        const candidates = [
          market.exchangeSymbol,
          market.symbol,
          market.baseAsset,
          market.quoteAsset,
          market.settleAsset,
          `${market.baseAsset}${market.quoteAsset}`,
          `${market.baseAsset}${market.settleAsset ?? ''}`,
        ]
          .filter(Boolean)
          .map((value) => normalizeMarketSearch(value));
        return candidates.some((candidate) => candidate.includes(query));
      })
      .sort((left, right) => {
        const leftExact = marketCandidates(left).some((candidate) => candidate === query) ? 1 : 0;
        const rightExact = marketCandidates(right).some((candidate) => candidate === query) ? 1 : 0;
        if (leftExact !== rightExact) {
          return rightExact - leftExact;
        }
        return left.exchangeSymbol.localeCompare(right.exchangeSymbol);
      })
      .slice(0, 12);
  }, [captureMarketQuery, marketCatalog]);
  const selectedMarket = useMemo(
    () =>
      marketCatalog.find((market) =>
        positionForm.exchangeSymbol
          ? normalizeMarketSearch(market.exchangeSymbol) ===
            normalizeMarketSearch(positionForm.exchangeSymbol)
          : marketCandidates(market).some(
              (candidate) =>
                candidate === normalizeMarketSearch(positionForm.symbol) ||
                candidate === normalizeMarketSearch(captureMarketQuery),
            ),
      ) ?? null,
    [captureMarketQuery, marketCatalog, positionForm.exchangeSymbol, positionForm.symbol],
  );
  const captureQuoteQuery = useQuery({
    queryKey: [
      'manual-quote',
      marketBackedExchange,
      selectedMarket?.exchangeSymbol ?? positionForm.exchangeSymbol ?? null,
    ],
    enabled:
      overlay === 'capture' &&
      captureOverlayTab === 'position' &&
      marketBackedExchange != null &&
      Boolean(selectedMarket?.exchangeSymbol ?? positionForm.exchangeSymbol),
    queryFn: () =>
      getExchangeMarketQuote(
        marketBackedExchange as SupportedLiveExchange,
        selectedMarket?.exchangeSymbol ?? positionForm.exchangeSymbol ?? '',
      ),
    refetchInterval: 15_000,
  });
  const manualPreviewMark =
    positionForm.markPrice ??
    captureQuoteQuery.data?.markPrice ??
    selectedMarket?.markPrice ??
    positionForm.entryPrice;

  useEffect(() => {
    if (!scopedPositions.length) {
      setFocusedSymbol(null);
      return;
    }

    const symbols = new Set(scopedPositions.map((position) => position.symbol));
    if (focusedSymbol == null || !symbols.has(focusedSymbol)) {
      setFocusedSymbol(scopedPositions[0].symbol);
    }
  }, [focusedSymbol, scopedPositions, setFocusedSymbol]);

  const filteredSymbols = useMemo(
    () =>
      Array.from(new Set(historyRecords.map((record) => record.symbol))).sort((left, right) =>
        left.localeCompare(right),
      ),
    [historyRecords],
  );

  const performance = useMemo(
    () => buildPerformance(scopedPositions),
    [scopedPositions],
  );
  const scopedSummary = useMemo(
    () => ({
      totalEquity: scopedAccounts.reduce((total, account) => total + account.snapshotEquity, 0),
      availableBalance: scopedAccounts.reduce(
        (total, account) => total + account.availableBalance,
        0,
      ),
      walletBalance: scopedAccounts.reduce((total, account) => total + account.walletBalance, 0),
      openPositions: scopedPositions.length,
      accountCount: scopedAccounts.length,
      exchangeCount: new Set(scopedAccounts.map((account) => account.exchange)).size,
      grossExposure: scopedPositions.reduce(
        (total, position) =>
          total + Math.abs(position.quantity) * (position.markPrice ?? position.entryPrice),
        0,
      ),
      usedMargin: scopedPositions.reduce(
        (total, position) => total + estimatePositionMargin(position),
        0,
      ),
      feeBurned: scopedPositions.reduce((total, position) => total + position.feePaid, 0),
      fundingBurned: scopedPositions.reduce((total, position) => total + position.fundingPaid, 0),
      nextFundingEstimate: estimateFundingImpact(scopedPositions, scopedFundingEntries),
    }),
    [scopedAccounts, scopedFundingEntries, scopedPositions],
  );
  const riskCards = useMemo(
    () => buildRiskAccountCards(scopedAccounts, scopedPositions),
    [scopedAccounts, scopedPositions],
  );
  const riskHeadline = useMemo(
    () => buildRiskHeadline(riskCards, scopedSummary.totalEquity),
    [riskCards, scopedSummary.totalEquity],
  );
  const historyHeadline = useMemo(
    () => buildHistoryHeadline(filteredHistoryRecords),
    [filteredHistoryRecords],
  );

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['bootstrap'] });

  const createAccountMutation = useMutation({
    mutationFn: createAccount,
    onSuccess: () => {
      invalidate();
      setAccountForm({
        name: '',
        exchange: 'manual',
        walletBalance: 0,
        notes: '',
      });
      setOverlay(null);
    },
  });

  const updateAccountMutation = useMutation({
    mutationFn: updateAccount,
    onSuccess: () => {
      invalidate();
      setAccountEditForm(null);
      setOverlay(null);
    },
  });

  const deleteAccountMutation = useMutation({
    mutationFn: deleteAccount,
    onSuccess: () => {
      invalidate();
      setAccountEditForm(null);
      setOverlay(null);
    },
  });

  const validateLiveMutation = useMutation({
    mutationFn: validateLiveAccount,
    onSuccess: (result) => setLiveValidation(result),
  });

  const createLiveMutation = useMutation({
    mutationFn: createLiveAccount,
    onSuccess: () => {
      invalidate();
      setLiveValidation(null);
      setLiveAccountForm({
        name: '',
        exchange: 'hyperliquid',
        connectionLabel: '',
        walletAddress: '',
        apiKey: '',
        apiSecret: '',
        apiPassphrase: '',
      });
      setOverlay(null);
    },
  });

  const syncLiveMutation = useMutation({
    mutationFn: syncLiveAccount,
    onSuccess: () => invalidate(),
  });

  const syncAllMutation = useMutation({
    mutationFn: syncAllLiveAccounts,
    onSuccess: () => invalidate(),
  });

  const addPositionMutation = useMutation({
    mutationFn: addManualPosition,
    onSuccess: () => {
      invalidate();
      setPositionForm((current) => ({
        ...current,
        accountId: selectedCaptureAccountId,
        exchangeSymbol: undefined,
        symbol: 'BTCUSDT',
        side: 'long',
        quantity: 0.01,
        entryPrice: 0,
        markPrice: undefined,
        leverage: 5,
        feePaid: 0,
        fundingPaid: 0,
        notes: '',
      }));
      setOverlay(null);
    },
  });

  const updatePositionMutation = useMutation({
    mutationFn: updateManualPosition,
    onSuccess: () => {
      invalidate();
      setPositionEditForm(null);
      setOverlay(null);
    },
  });

  const deletePositionMutation = useMutation({
    mutationFn: deleteManualPosition,
    onSuccess: () => {
      invalidate();
      setPositionEditForm(null);
      setOverlay(null);
    },
  });

  const importCsvMutation = useMutation({
    mutationFn: importCsvPositions,
    onSuccess: () => {
      invalidate();
      setOverlay(null);
    },
  });

  const lanMutation = useMutation({
    mutationFn: setLanProjection,
    onSuccess: () => invalidate(),
  });

  const syncingAccountIds = useMemo(() => {
    const next = new Set<string>();
    if (syncLiveMutation.isPending && syncLiveMutation.variables) {
      next.add(syncLiveMutation.variables);
    }
    return next;
  }, [syncLiveMutation.isPending, syncLiveMutation.variables]);
  const syncHealthByAccountId = useMemo(() => {
    return new Map(
      scopedAccounts.map((account) => [
        account.id,
        deriveAccountSyncHealth(account, scopedSyncJobs, { syncingAccountIds }),
      ]),
    );
  }, [scopedAccounts, scopedSyncJobs, syncingAccountIds]);
  const topLevelStatus: SyncHealthSummary = useMemo(
    () =>
      summarizeSyncHealth(scopedAccounts, scopedSyncJobs, {
        syncingAccountIds,
        forceSyncing: syncAllMutation.isPending,
      }),
    [scopedAccounts, scopedSyncJobs, syncAllMutation.isPending, syncingAccountIds],
  );
  const staleLiveCount = useMemo(
    () =>
      Array.from(syncHealthByAccountId.values()).filter((health) => health.state === 'stale')
        .length,
    [syncHealthByAccountId],
  );
  const degradedLiveCount = useMemo(
    () =>
      Array.from(syncHealthByAccountId.values()).filter((health) => health.state === 'degraded')
        .length,
    [syncHealthByAccountId],
  );
  const awaitingLiveCount = useMemo(
    () =>
      Array.from(syncHealthByAccountId.values()).filter((health) => health.state === 'awaiting')
        .length,
    [syncHealthByAccountId],
  );

  return (
    <div className={clsx('terminal-product', preferences.compactRows && 'terminal-product-compact')}>
      <header className="product-header">
        <div className="product-header-main">
          <div className="product-brand">
            <span className="brand-dot" />
            <strong>CASSINI</strong>
          </div>

          <nav className="product-tabs" aria-label="Primary">
            {(['overview', 'positions', 'history', 'risk', 'manage', 'settings'] as const).map((view) => (
              <button
                key={view}
                className={clsx('product-tab', activeView === view && 'product-tab-active')}
                onClick={() => setActiveView(view)}
              >
                {titleCase(view)}
              </button>
            ))}
          </nav>
        </div>

        <div className="product-header-actions">
          <button
            className="header-action"
            disabled={syncAllMutation.isPending || scopedAccounts.length === 0}
            onClick={() => syncAllMutation.mutate()}
          >
            {syncAllMutation.isPending ? (
              <LoaderCircle className="spin" size={14} />
            ) : (
              <RefreshCw size={14} />
            )}
            Sync
          </button>

          <button
            className="header-action header-action-strong"
            onClick={() => {
              setCaptureOverlayTab('position');
              setCaptureMarketQuery(positionForm.exchangeSymbol ?? positionForm.symbol);
              setOverlay('capture');
            }}
          >
            <Plus size={14} />
            Add position
          </button>

          <button
            className="header-status"
            onClick={() => setActiveView('settings')}
          >
            <span className={clsx('status-dot', topLevelStatus.tone)} />
            {topLevelStatus.label}
          </button>

          <div className="header-count">
            {scopedSummary.exchangeCount} exchanges · {scopedSummary.accountCount} accounts ·{' '}
            {topLevelStatus.detail} · {formatAutoSyncInline(autoSyncStatus)}
          </div>
        </div>
      </header>

      <div className="scope-strip">
        <button
          className={clsx('scope-pill', focusScope === 'portfolio' && 'scope-pill-active')}
          onClick={() => setFocusScope('portfolio')}
        >
          All accounts
        </button>

        {groupedAccounts.map((group) => (
          <button
            key={`exchange-${group.exchange}`}
            className={clsx(
              'scope-pill',
              'scope-pill-exchange',
              `exchange-${group.exchange}`,
              focusScope === `exchange:${group.exchange}` && 'scope-pill-active',
            )}
            onClick={() => setFocusScope(`exchange:${group.exchange}`)}
          >
            <span className="scope-dot" />
            {prettyExchange(group.exchange)}
          </button>
        ))}

        {groupedAccounts.flatMap((group) =>
          group.accounts.map((account) => (
            <button
              key={account.id}
              className={clsx(
                'scope-pill',
                'scope-pill-account',
                `exchange-${account.exchange}`,
                focusScope === account.id && 'scope-pill-active',
              )}
              onClick={() => setFocusScope(account.id)}
            >
              <span className="scope-dot" />
              {account.name}
            </button>
          )),
        )}

        <button
          className="scope-pill scope-pill-ghost"
          onClick={() => {
            setAccountOverlayTab('live');
            setOverlay('account');
          }}
        >
          + Account
        </button>
      </div>

      <main className="product-main">
        {activeView === 'overview' ? (
          <OverviewPage
            scope={scopeContext}
            summary={scopedSummary}
            performance={performance}
            portfolioHistory={scopedHistory}
            accountHistory={scopedAccountSeries}
            historyRecords={filteredHistoryRecords}
            syncHealthByAccountId={syncHealthByAccountId}
            showAccountCurves={preferences.showOverviewAccountCurves}
            showFeeBoard={preferences.showOverviewFeeBoard}
          />
        ) : null}

        {activeView === 'positions' ? (
          <PositionsPage
            summary={scopedSummary}
            groupedPositions={groupedPositions}
            fundingEntries={scopedFundingEntries}
            syncJobs={scopedSyncJobs}
            selectedPosition={preferences.drawerOpen ? selectedPosition : null}
            selectedQuote={selectedPositionQuoteQuery.data ?? null}
            drawerPending={selectedPositionQuoteQuery.isPending}
            syncingAccountId={
              syncLiveMutation.isPending ? syncLiveMutation.variables ?? null : null
            }
            syncHealthByAccountId={syncHealthByAccountId}
            positionSide={preferences.positionSide}
            positionSort={preferences.positionSort}
            focusedSymbol={focusedSymbol}
            onSelectPosition={(position) => {
              setSelectedPositionId(position.id);
              setFocusedSymbol(position.symbol);
              setPreferences((current) => ({ ...current, drawerOpen: true }));
            }}
            onSyncAccount={(accountId) => syncLiveMutation.mutate(accountId)}
            onToggleDrawer={() =>
              setPreferences((current) => ({ ...current, drawerOpen: !current.drawerOpen }))
            }
            onChangeSide={(value) =>
              setPreferences((current) => ({ ...current, positionSide: value }))
            }
            onChangeSort={(value) =>
              setPreferences((current) => ({ ...current, positionSort: value }))
            }
          />
        ) : null}

        {activeView === 'history' ? (
          <HistoryPage
            records={filteredHistoryRecords}
            groups={historyGroups}
            headline={historyHeadline}
            availableSymbols={filteredSymbols}
            groupBy={preferences.historyGroupBy}
            sideFilter={preferences.historySide}
            historySymbol={historySymbol}
            historyFrom={historyFrom}
            historyTo={historyTo}
            showExchange={preferences.historyShowExchange}
            showAccount={preferences.historyShowAccount}
            onChangeGroupBy={(value) =>
              setPreferences((current) => ({ ...current, historyGroupBy: value }))
            }
            onChangeSide={(value) =>
              setPreferences((current) => ({ ...current, historySide: value }))
            }
            onChangeSymbol={setHistorySymbol}
            onChangeFrom={setHistoryFrom}
            onChangeTo={setHistoryTo}
          />
        ) : null}

        {activeView === 'risk' ? (
          <RiskPage
            headline={riskHeadline}
            cards={preferences.showRiskEmptyAccounts ? riskCards : riskCards.filter((card) => card.openPositions > 0)}
            totalEquity={scopedSummary.totalEquity}
            totalUsedMargin={scopedSummary.usedMargin}
          />
        ) : null}

        {activeView === 'manage' ? (
          <ManagePage
            accounts={scopedAccounts}
            positions={scopedPositions}
            syncJobs={scopedSyncJobs}
            onEditAccount={(account) => {
              setAccountEditForm({
                id: account.id,
                name: account.name,
                walletBalance:
                  account.accountMode === 'live' ? undefined : account.walletBalance,
                notes: account.notes ?? '',
              });
              setOverlay('account-edit');
            }}
            onDeleteAccount={(account) => {
              if (
                window.confirm(
                  `Delete account "${account.name}" and all positions/history linked to it?`,
                )
              ) {
                deleteAccountMutation.mutate(account.id);
              }
            }}
            onEditPosition={(position) => {
              setPositionEditForm({
                id: position.id,
                accountId: position.accountId,
                exchangeSymbol: position.exchangeSymbol ?? undefined,
                symbol: position.symbol,
                side: position.side,
                quantity: position.quantity,
                entryPrice: position.entryPrice,
                markPrice: position.markPrice ?? undefined,
                leverage: position.leverage,
                feePaid: position.feePaid,
                fundingPaid: position.fundingPaid,
                notes: position.notes ?? '',
              });
              setOverlay('position-edit');
            }}
            onDeletePosition={(position) => {
              if (window.confirm(`Delete position "${position.symbol}" from ${position.accountName}?`)) {
                deletePositionMutation.mutate(position.id);
              }
            }}
            onSyncAccount={(accountId) => syncLiveMutation.mutate(accountId)}
            syncingAccountId={
              syncLiveMutation.isPending ? syncLiveMutation.variables ?? null : null
            }
            syncHealthByAccountId={syncHealthByAccountId}
          />
        ) : null}

        {activeView === 'settings' ? (
          <SettingsPage
            preferences={preferences}
            lanStatus={lanStatus}
            autoSyncStatus={autoSyncStatus}
            syncPending={syncAllMutation.isPending}
            lanPending={lanMutation.isPending}
            syncSummary={topLevelStatus}
            liveAccountsCount={topLevelStatus.liveAccounts}
            staleLiveCount={staleLiveCount}
            degradedLiveCount={degradedLiveCount}
            awaitingLiveCount={awaitingLiveCount}
            onChangePreferences={setPreferences}
            onResetPreferences={() => {
              setPreferences(DEFAULT_PREFERENCES);
              const nextRange = defaultDateRange(DEFAULT_PREFERENCES.historyWindow);
              setHistoryFrom(nextRange.from);
              setHistoryTo(nextRange.to);
              setHistorySymbol('all');
            }}
            onApplyHistoryWindow={(windowValue) => {
              const nextRange = defaultDateRange(windowValue);
              setHistoryFrom(nextRange.from);
              setHistoryTo(nextRange.to);
            }}
            onSyncAll={() => syncAllMutation.mutate()}
            onToggleLan={() => lanMutation.mutate(!lanStatus?.enabled)}
            onOpenAccountOverlay={() => {
              setAccountOverlayTab('live');
              setOverlay('account');
            }}
            onOpenManualOverlay={() => {
              setCaptureOverlayTab('position');
              setCaptureMarketQuery(positionForm.exchangeSymbol ?? positionForm.symbol);
              setOverlay('capture');
            }}
            onOpenImportOverlay={() => {
              setCaptureOverlayTab('csv');
              setOverlay('capture');
            }}
          />
        ) : null}
      </main>

      {overlay === 'account' ? (
        <OverlayShell
          title="Account"
          subtitle="Read-only exchange links and local books stay layered."
          onClose={() => setOverlay(null)}
        >
          <div className="overlay-tab-row">
            <button
              className={clsx('overlay-tab', accountOverlayTab === 'live' && 'overlay-tab-active')}
              onClick={() => setAccountOverlayTab('live')}
            >
              Live read-only
            </button>
            <button
              className={clsx('overlay-tab', accountOverlayTab === 'local' && 'overlay-tab-active')}
              onClick={() => setAccountOverlayTab('local')}
            >
              Local / import
            </button>
          </div>

          {accountOverlayTab === 'live' ? (
            <LiveAccountForm
              form={liveAccountForm}
              liveAccountsCount={accounts.filter((account) => account.accountMode === 'live').length}
              validation={liveValidation}
              validatePending={validateLiveMutation.isPending}
              createPending={createLiveMutation.isPending}
              syncAllPending={syncAllMutation.isPending}
              onFormChange={setLiveAccountForm}
              onValidate={() => validateLiveMutation.mutate(liveAccountForm)}
              onCreate={() => createLiveMutation.mutate(liveAccountForm)}
              onSyncAll={() => syncAllMutation.mutate()}
            />
          ) : (
            <LocalAccountForm
              form={accountForm}
              pending={createAccountMutation.isPending}
              onChange={setAccountForm}
              onCreate={() => createAccountMutation.mutate(accountForm)}
            />
          )}
        </OverlayShell>
      ) : null}

      {overlay === 'capture' ? (
        <OverlayShell
          title="Capture"
          subtitle="Manual positions and imported rows live behind layered flows."
          onClose={() => setOverlay(null)}
        >
          <div className="overlay-tab-row">
            <button
              className={clsx(
                'overlay-tab',
                captureOverlayTab === 'position' && 'overlay-tab-active',
              )}
              onClick={() => {
                setCaptureOverlayTab('position');
                setCaptureMarketQuery(positionForm.exchangeSymbol ?? positionForm.symbol);
              }}
            >
              Manual position
            </button>
            <button
              className={clsx('overlay-tab', captureOverlayTab === 'csv' && 'overlay-tab-active')}
              onClick={() => setCaptureOverlayTab('csv')}
            >
              CSV import
            </button>
          </div>

          {captureOverlayTab === 'position' ? (
            <ManualPositionForm
              activeAccountOptions={manualAccounts.map((account) => ({
                value: account.id,
                label: `${account.name} · ${account.exchange.toUpperCase()}`,
              }))}
              selectedAccount={selectedCaptureAccount}
              selectedAccountId={selectedCaptureAccountId}
              marketBackedExchange={marketBackedExchange}
              marketQuery={captureMarketQuery}
              availableMarkets={filteredMarkets}
              selectedMarket={selectedMarket}
              marketQuote={captureQuoteQuery.data ?? null}
              marketCatalogPending={exchangeMarketsQuery.isPending}
              marketCatalogError={exchangeMarketsQuery.error ? String(exchangeMarketsQuery.error) : null}
              marketQuotePending={captureQuoteQuery.isPending}
              marketQuoteError={captureQuoteQuery.error ? String(captureQuoteQuery.error) : null}
              previewNotional={positionForm.quantity * positionForm.entryPrice}
              previewPnl={computePnl(
                positionForm.side,
                positionForm.entryPrice,
                manualPreviewMark,
                positionForm.quantity,
              )}
              previewMark={manualPreviewMark}
              form={positionForm}
              pending={addPositionMutation.isPending}
              onChange={setPositionForm}
              onChangeMarketQuery={setCaptureMarketQuery}
              onSelectMarket={(market) => {
                setCaptureMarketQuery(market.exchangeSymbol);
                setPositionForm((current) => ({
                  ...current,
                  exchange: market.exchange,
                  exchangeSymbol: market.exchangeSymbol,
                  symbol: market.symbol,
                  leverage: market.maxLeverage
                    ? Math.min(Math.max(current.leverage, 1), market.maxLeverage)
                    : current.leverage,
                  markPrice: undefined,
                }));
              }}
              onSave={() =>
                addPositionMutation.mutate({
                  ...positionForm,
                  accountId: selectedCaptureAccountId,
                  exchange: selectedCaptureAccount?.exchange ?? positionForm.exchange,
                  exchangeSymbol: selectedMarket?.exchangeSymbol ?? positionForm.exchangeSymbol,
                  symbol: selectedMarket?.symbol ?? positionForm.symbol,
                  markPrice:
                    positionForm.markPrice ??
                    captureQuoteQuery.data?.markPrice ??
                    selectedMarket?.markPrice ??
                    undefined,
                })
              }
            />
          ) : (
            <CsvImportForm
              activeAccountOptions={scopedManualAccounts(accounts).map((account) => ({
                value: account.id,
                label: `${account.name} · ${account.exchange.toUpperCase()}`,
              }))}
              csvPayload={csvPayload}
              csvSourceExchange={csvSourceExchange}
              csvTargetAccount={csvTargetAccount}
              importResult={importCsvMutation.data}
              pending={importCsvMutation.isPending}
              onPayloadChange={setCsvPayload}
              onSourceExchangeChange={setCsvSourceExchange}
              onTargetAccountChange={setCsvTargetAccount}
              onImport={() =>
                importCsvMutation.mutate({
                  csv: csvPayload,
                  exchange: csvSourceExchange,
                  targetAccountId: csvTargetAccount || undefined,
                })
              }
            />
          )}
        </OverlayShell>
      ) : null}

      {overlay === 'account-edit' && accountEditForm ? (
        <OverlayShell
          title="Manage account"
          subtitle="Rename, rebalance local books, or remove unused accounts."
          onClose={() => {
            setAccountEditForm(null);
            setOverlay(null);
          }}
        >
          <AccountEditorForm
            account={
              accounts.find((account) => account.id === accountEditForm.id) ?? null
            }
            form={accountEditForm}
            pending={updateAccountMutation.isPending}
            deletePending={deleteAccountMutation.isPending}
            onChange={setAccountEditForm}
            onSave={() => updateAccountMutation.mutate(accountEditForm)}
            onDelete={() => {
              const account = accounts.find((item) => item.id === accountEditForm.id);
              if (
                account &&
                window.confirm(
                  `Delete account "${account.name}" and all positions/history linked to it?`,
                )
              ) {
                deleteAccountMutation.mutate(account.id);
              }
            }}
          />
        </OverlayShell>
      ) : null}

      {overlay === 'position-edit' && positionEditForm ? (
        <OverlayShell
          title="Manage position"
          subtitle="Edit local/manual records without touching live exchange state."
          onClose={() => {
            setPositionEditForm(null);
            setOverlay(null);
          }}
        >
          <PositionEditorForm
            form={positionEditForm}
            accountOptions={scopedManualAccounts(accounts).map((account) => ({
              value: account.id,
              label: `${account.name} · ${account.exchange.toUpperCase()}`,
            }))}
            pending={updatePositionMutation.isPending}
            deletePending={deletePositionMutation.isPending}
            onChange={setPositionEditForm}
            onSave={() => updatePositionMutation.mutate(positionEditForm)}
            onDelete={() => {
              const position = positions.find((item) => item.id === positionEditForm.id);
              if (
                position &&
                window.confirm(
                  `Delete position "${position.symbol}" from ${position.accountName}?`,
                )
              ) {
                deletePositionMutation.mutate(position.id);
              }
            }}
          />
        </OverlayShell>
      ) : null}
    </div>
  );
}

function OverviewPage({
  scope,
  summary,
  performance,
  portfolioHistory,
  accountHistory,
  historyRecords,
  syncHealthByAccountId,
  showAccountCurves,
  showFeeBoard,
}: {
  scope: ScopeContext;
  summary: SummaryModel;
  performance: PerformanceMetrics;
  portfolioHistory: BalanceHistoryPoint[];
  accountHistory: AccountHistorySeries[];
  historyRecords: HistoryRecord[];
  syncHealthByAccountId: Map<string, SyncHealthSnapshot>;
  showAccountCurves: boolean;
  showFeeBoard: boolean;
}) {
  const historyByAccountId = new Map(
    accountHistory.map((series) => [series.accountId, series] as const),
  );
  const rankedAccounts = scope.accounts
    .map((account) => {
      const series = historyByAccountId.get(account.id);
      const latest = series?.points[series.points.length - 1];
      return {
        accountId: account.id,
        accountName: account.name,
        exchange: account.exchange,
        latestEquity: latest?.equity ?? account.snapshotEquity,
        points: series?.points ?? [],
        accountMode: account.accountMode,
        availableBalance: account.availableBalance,
        lastSyncedAt: account.lastSyncedAt,
        syncHealth:
          syncHealthByAccountId.get(account.id) ??
          deriveAccountSyncHealth(account, []),
      };
    })
    .sort((left, right) => right.latestEquity - left.latestEquity);

  const winCount = historyRecords.filter((record) => record.netPnl > 0).length;
  const lossCount = historyRecords.filter((record) => record.netPnl < 0).length;
  const totalRecords = historyRecords.length;
  const portfolioDelta = historyDelta(portfolioHistory);
  const recentRecords = historyRecords.slice(0, 6);
  const feeRows = buildFeeRows(historyRecords).slice(0, 4);
  const topAccount = rankedAccounts[0] ?? null;
  const averageRecord = totalRecords > 0
    ? historyRecords.reduce((total, record) => total + record.netPnl, 0) / totalRecords
    : 0;

  return (
    <div className="view-stack">
      <MetricStrip
        items={[
          {
            label: 'Total equity',
            value: formatCurrency(summary.totalEquity),
            detail: `${summary.accountCount} acc`,
          },
          {
            label: 'Open PnL',
            value: formatSignedCurrency(performance.unrealizedPnl),
            detail: `${summary.openPositions} pos`,
            tone: performance.unrealizedPnl >= 0 ? 'positive' : 'negative',
          },
          {
            label: 'Gross exposure',
            value: formatCurrency(summary.grossExposure),
            detail: formatCurrency(summary.usedMargin),
          },
          {
            label: 'Fees',
            value: formatSignedCurrency(-summary.feeBurned),
            detail: 'trade',
            tone: 'negative',
          },
          {
            label: 'Funding',
            value: formatSignedCurrency(-summary.fundingBurned),
            detail: 'carry',
            tone: summary.fundingBurned <= 0 ? 'negative' : 'positive',
          },
          {
            label: 'W / L',
            value: `${winCount}/${lossCount}`,
            detail: `${totalRecords} rows`,
          },
        ]}
      />

      <div className="overview-ref-layout">
        <section className="desk-surface desk-surface-chart">
          <div className="surface-toolbar">
            <div className="surface-id">
              <strong>{scope.label}</strong>
              <span>{scope.detail}</span>
            </div>
            <div className="surface-chip-row">
              <span>{formatCurrency(summary.walletBalance)}</span>
              <span>{formatCurrency(summary.availableBalance)}</span>
              <span>{summary.openPositions} pos</span>
            </div>
          </div>

          <div className="surface-chart-value">
            <strong>{formatCurrency(summary.totalEquity)}</strong>
            <span className={clsx(portfolioDelta >= 0 ? 'tone-positive' : 'tone-negative')}>
              {formatSignedCurrency(portfolioDelta)}
            </span>
          </div>

          <Sparkline
            points={portfolioHistory.map((point) => point.equity)}
            tone={historyTone(portfolioHistory)}
            label="Total equity history"
          />

          <div className="surface-micro-strip">
            <div>
              <span>Open</span>
              <strong className={clsx(performance.unrealizedPnl >= 0 ? 'tone-positive' : 'tone-negative')}>
                {formatSignedCurrency(performance.unrealizedPnl)}
              </strong>
            </div>
            <div>
              <span>Realized</span>
              <strong className={clsx(performance.realizedPnl >= 0 ? 'tone-positive' : 'tone-negative')}>
                {formatSignedCurrency(performance.realizedPnl)}
              </strong>
            </div>
            <div>
              <span>Exposure</span>
              <strong>{formatCurrency(summary.grossExposure)}</strong>
            </div>
            <div>
              <span>Used margin</span>
              <strong>{formatCurrency(summary.usedMargin)}</strong>
            </div>
          </div>
        </section>

        <aside className="overview-side-rail">
          <section className="desk-surface">
            <div className="surface-mini-head">
              <strong>Accounts</strong>
              <span>{rankedAccounts.length}</span>
            </div>
            {showAccountCurves && rankedAccounts.length > 0 ? (
              <div className="surface-account-list">
                {rankedAccounts.map((series) => (
                  <div key={series.accountId} className="surface-account-row">
                    <div className="surface-account-copy">
                      <div className="surface-account-title">
                        <strong>{series.accountName}</strong>
                        <SyncHealthPill health={series.syncHealth} />
                      </div>
                      <span>
                        {prettyExchange(series.exchange)} · {series.syncHealth.detail}
                      </span>
                      {series.syncHealth.errorMessage ? (
                        <span
                          className="account-sync-error"
                          title={series.syncHealth.errorMessage}
                        >
                          {series.syncHealth.errorMessage}
                        </span>
                      ) : null}
                    </div>
                    <div className="surface-account-line">
                      <Sparkline
                        points={
                          series.points.length > 0
                            ? series.points.map((point) => point.equity)
                            : [series.latestEquity, series.latestEquity]
                        }
                        tone={series.points.length > 0 ? historyTone(series.points) : 'accent'}
                        label={`${series.accountName} history`}
                        dense
                      />
                    </div>
                    <div className="surface-account-value">
                      <strong>{formatCurrency(series.latestEquity)}</strong>
                      <span>{formatCurrency(series.availableBalance)}</span>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <CompactEmpty copy="No account history." />
            )}
          </section>

          <section className="desk-surface">
            <div className="surface-mini-head">
              <strong>Perf</strong>
              <span>{totalRecords}</span>
            </div>
            <div className="surface-stat-list">
              <div className="surface-stat-row">
                <span>Hit rate</span>
                <strong>{totalRecords > 0 ? formatPercent((winCount / totalRecords) * 100) : '0.0%'}</strong>
              </div>
              <div className="surface-stat-row">
                <span>Avg row</span>
                <strong className={clsx(averageRecord >= 0 ? 'tone-positive' : 'tone-negative')}>
                  {formatSignedCurrency(averageRecord)}
                </strong>
              </div>
              <div className="surface-stat-row">
                <span>Fees</span>
                <strong className="tone-negative">{formatSignedCurrency(-performance.feeDrag)}</strong>
              </div>
              <div className="surface-stat-row">
                <span>Funding</span>
                <strong className="tone-negative">{formatSignedCurrency(-summary.fundingBurned)}</strong>
              </div>
              {topAccount ? (
                <div className="surface-stat-row">
                  <span>Lead</span>
                  <strong>{topAccount.accountName}</strong>
                </div>
              ) : null}
            </div>
          </section>
        </aside>

        <section className="desk-surface desk-surface-tape">
          <div className="surface-mini-head">
            <strong>Tape</strong>
            <span>{recentRecords.length}</span>
          </div>
          {recentRecords.length > 0 ? (
            <div className="surface-tape-list">
              {recentRecords.map((record) => (
                <div key={record.id} className="surface-tape-row">
                  <div className="surface-tape-contract">
                    <strong>{record.symbol}</strong>
                    <span>{record.accountName}</span>
                  </div>
                  <div className="surface-tape-side">
                    <span className={clsx('side-pill', `side-pill-${record.side}`)}>
                      {record.side.toUpperCase()}
                    </span>
                  </div>
                  <div className="surface-tape-size">
                    <strong>{formatCurrency(record.sizeUsd)}</strong>
                    <span>{record.holdLabel}</span>
                  </div>
                  <div className="surface-tape-pnl">
                    <strong className={clsx(record.netPnl >= 0 ? 'tone-positive' : 'tone-negative')}>
                      {formatSignedCurrency(record.netPnl)}
                    </strong>
                    <span>{formatDateTime(record.eventTime)}</span>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <CompactEmpty copy="No rows." />
          )}
        </section>

        {showFeeBoard ? (
          <section className="desk-surface">
            <div className="surface-mini-head">
              <strong>Costs</strong>
              <span>{feeRows.length}</span>
            </div>
            {feeRows.length > 0 ? (
              <div className="surface-cost-list">
                {feeRows.map((row) => (
                  <div key={row.accountId} className="surface-cost-row">
                    <div>
                      <strong>{row.accountName}</strong>
                      <span>{prettyExchange(row.exchange)}</span>
                    </div>
                    <div className="surface-cost-values">
                      <span>{formatSignedCurrency(-row.tradingFees)}</span>
                      <span>{formatSignedCurrency(-row.fundingFees)}</span>
                      <span className={clsx(row.netPnl >= 0 ? 'tone-positive' : 'tone-negative')}>
                        {formatSignedCurrency(row.netPnl)}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <CompactEmpty copy="No costs." />
            )}
          </section>
        ) : null}
      </div>
    </div>
  );
}

function PositionsPage({
  summary,
  groupedPositions,
  fundingEntries,
  syncJobs,
  selectedPosition,
  selectedQuote,
  drawerPending,
  syncingAccountId,
  syncHealthByAccountId,
  positionSide,
  positionSort,
  focusedSymbol,
  onSelectPosition,
  onSyncAccount,
  onToggleDrawer,
  onChangeSide,
  onChangeSort,
}: {
  summary: SummaryModel;
  groupedPositions: PositionGroup[];
  fundingEntries: FundingHistoryEntry[];
  syncJobs: SyncJobRecord[];
  selectedPosition: PortfolioPosition | null;
  selectedQuote: MarketQuote | null;
  drawerPending: boolean;
  syncingAccountId: string | null;
  syncHealthByAccountId: Map<string, SyncHealthSnapshot>;
  positionSide: SideFilter;
  positionSort: PositionSort;
  focusedSymbol: string | null;
  onSelectPosition: (position: PortfolioPosition) => void;
  onSyncAccount: (accountId: string) => void;
  onToggleDrawer: () => void;
  onChangeSide: (value: SideFilter) => void;
  onChangeSort: (value: PositionSort) => void;
}) {
  const totalOpenPnl = groupedPositions.reduce((total, group) => total + group.openPnl, 0);
  const selectedAccount = selectedPosition
    ? groupedPositions.find((group) => group.account.id === selectedPosition.accountId)?.account ?? null
    : null;
  const leadGroup = groupedPositions[0] ?? null;

  return (
    <div className="view-stack">
      <MetricStrip
        items={[
          {
            label: 'Total equity',
            value: formatCurrency(summary.totalEquity),
            detail: `${summary.accountCount} acc`,
          },
          {
            label: 'Open PnL',
            value: formatSignedCurrency(totalOpenPnl),
            detail: `${summary.openPositions} pos`,
            tone: totalOpenPnl >= 0 ? 'positive' : 'negative',
          },
          {
            label: 'Gross exposure',
            value: formatCurrency(summary.grossExposure),
            detail: formatSignedCurrency(
              groupedPositions.reduce(
                (total, group) =>
                  total +
                  group.positions.reduce(
                    (sum, position) =>
                      sum +
                      (position.side === 'long' ? 1 : -1) *
                        (position.markPrice ?? position.entryPrice) *
                        Math.abs(position.quantity),
                    0,
                  ),
                0,
              ),
            ),
          },
          {
            label: 'Free margin',
            value: formatCurrency(summary.availableBalance),
            detail: formatCurrency(summary.usedMargin),
          },
          {
            label: 'Funding',
            value: formatSignedCurrency(summary.nextFundingEstimate),
            detail: `${fundingEntries.length} rows`,
            tone: summary.nextFundingEstimate >= 0 ? 'positive' : 'negative',
          },
        ]}
      />

      <div className="positions-toolbar-ref">
        <div className="subfilter-strip">
          <SubfilterGroup
            label="Side"
            items={[
              { id: 'all', label: 'All' },
              { id: 'long', label: 'Long' },
              { id: 'short', label: 'Short' },
            ]}
            active={positionSide}
            onChange={(value) => onChangeSide(value as SideFilter)}
          />

          <SubfilterGroup
            label="Sort"
            items={[
              { id: 'pnl', label: 'P&L' },
              { id: 'size', label: 'Size' },
              { id: 'symbol', label: 'Symbol' },
            ]}
            active={positionSort}
            onChange={(value) => onChangeSort(value as PositionSort)}
          />

          <button className="inline-control" onClick={onToggleDrawer}>
            {selectedPosition ? 'Hide inspector' : 'Show inspector'}
          </button>
        </div>

        <div className="positions-focus-strip positions-focus-strip-ref">
          {selectedPosition ? (
            <>
              <strong>{selectedPosition.symbol}</strong>
              <span>{selectedPosition.accountName}</span>
              <span>
                {selectedAccount
                  ? prettyExchange(selectedAccount.exchange)
                  : prettyExchange(selectedPosition.exchange)}
              </span>
              <span className={clsx(selectedPosition.unrealizedPnl >= 0 ? 'tone-positive' : 'tone-negative')}>
                {formatSignedCurrency(selectedPosition.unrealizedPnl)}
              </span>
            </>
          ) : leadGroup ? (
            <>
              <strong>{leadGroup.account.name}</strong>
              <span>{leadGroup.positions.length} positions in lead book</span>
              <span>{formatCurrency(leadGroup.grossExposure)} gross</span>
            </>
          ) : (
            <>
              <strong>{summary.openPositions}</strong>
              <span>positions in scope</span>
              <span>{groupedPositions.length} account groups</span>
            </>
          )}
        </div>
      </div>

      <div className={clsx('positions-ref-layout', selectedPosition && 'positions-ref-layout-with-drawer')}>
        <section className="desk-surface desk-surface-blotter">
          {groupedPositions.map((group) => {
            const health =
              syncHealthByAccountId.get(group.account.id) ??
              deriveAccountSyncHealth(group.account, syncJobs, {
                syncingAccountIds: syncingAccountId ? [syncingAccountId] : [],
              });
            return (
              <div key={group.account.id} className="blotter-account-section">
                <div className="blotter-account-bar">
                  <div className="blotter-account-id">
                    <div className="blotter-account-title">
                      <strong>{group.account.name}</strong>
                      <SyncHealthPill health={health} />
                    </div>
                    <span>
                      {prettyExchange(group.account.exchange)} · {group.account.accountMode.toUpperCase()} ·{' '}
                      {group.positions.length} open
                    </span>
                    {health.errorMessage ? (
                      <span className="account-sync-error" title={health.errorMessage}>
                        {health.errorMessage}
                      </span>
                    ) : null}
                  </div>

                  <div className="blotter-account-metrics">
                    <span>{formatCurrency(group.account.snapshotEquity)}</span>
                    <span>{formatCurrency(group.usedMargin)}</span>
                    <span>{formatCurrency(group.account.availableBalance)}</span>
                    <span className={clsx(group.openPnl >= 0 ? 'tone-positive' : 'tone-negative')}>
                      {formatSignedCurrency(group.openPnl)}
                    </span>
                    <span>
                      {group.account.snapshotEquity > 0
                        ? formatPercent((group.usedMargin / group.account.snapshotEquity) * 100)
                        : '0.0%'}
                    </span>
                  </div>

                  <div className="blotter-account-actions">
                    <span className="blotter-sync-stamp">
                      {health.detail}
                    </span>
                    {group.account.accountMode === 'live' ? (
                      <button
                        className="group-sync-button"
                        disabled={syncingAccountId === group.account.id}
                        onClick={(event) => {
                          event.stopPropagation();
                          onSyncAccount(group.account.id);
                        }}
                      >
                        {syncingAccountId === group.account.id ? (
                          <LoaderCircle className="spin" size={13} />
                        ) : (
                          <RefreshCw size={13} />
                        )}
                        Sync
                      </button>
                    ) : null}
                  </div>
                </div>

                <table className="product-table product-table-ref">
                  <thead>
                    <tr>
                      <th>Symbol</th>
                      <th>Side</th>
                      <th>Size</th>
                      <th>Entry</th>
                      <th>Mark</th>
                      <th>Margin / Ratio</th>
                      <th>Liq / Dist</th>
                      <th>Funding</th>
                      <th>Fees</th>
                      <th>Unreal. PnL</th>
                      <th>Opened</th>
                    </tr>
                  </thead>
                  <tbody>
                    {group.positions.map((position) => {
                      const marginUsed = estimatePositionMargin(position);
                      const pnlOnMargin = marginUsed > 0 ? (position.unrealizedPnl / marginUsed) * 100 : 0;
                      const funding = latestFundingForPosition(position, fundingEntries);
                      const rowSize = Math.abs(position.quantity) * (position.markPrice ?? position.entryPrice);

                      return (
                        <tr
                          key={position.id}
                          className={clsx(
                            selectedPosition?.id === position.id && 'product-row-active',
                            focusedSymbol === position.symbol && 'product-row-focused',
                          )}
                          onClick={() => onSelectPosition(position)}
                        >
                          <td>
                            <div className="table-symbol-cell">
                              <strong>{position.symbol}</strong>
                              <span>{position.exchangeSymbol ?? prettyExchange(position.exchange)} · {position.accountName}</span>
                            </div>
                          </td>
                          <td>
                            <span className={clsx('side-pill', `side-pill-${position.side}`)}>
                              {position.side.toUpperCase()}
                            </span>
                          </td>
                          <td>
                            <div className="table-stack">
                              <strong>{formatCurrency(rowSize)}</strong>
                              <span>{position.leverage.toFixed(1)}x</span>
                            </div>
                          </td>
                          <td>{formatNumber(position.entryPrice)}</td>
                          <td>
                            <div className="table-stack">
                              <strong>{formatNumber(position.markPrice ?? position.entryPrice)}</strong>
                              <span>{formatPercent(distanceFromReference(position.entryPrice, position.markPrice ?? position.entryPrice))}</span>
                            </div>
                          </td>
                          <td>
                            <div className="table-stack">
                              <strong>{formatCurrency(marginUsed)}</strong>
                              <span>{formatPercent(pnlOnMargin)}</span>
                            </div>
                          </td>
                          <td>
                            <div className="table-stack">
                              <strong>
                                {position.liquidationPrice != null
                                  ? formatNumber(position.liquidationPrice)
                                  : 'n/a'}
                              </strong>
                              <span>
                                {formatLiquidationDistance(position)}
                              </span>
                            </div>
                          </td>
                          <td className={clsx(funding >= 0 ? 'tone-negative' : 'tone-positive')}>
                            {funding === 0 ? 'n/a' : `${(funding * 100).toFixed(4)}%`}
                          </td>
                          <td>{formatSignedCurrency(-(position.feePaid + position.fundingPaid))}</td>
                          <td>
                            <div className="table-stack">
                              <strong className={clsx(position.unrealizedPnl >= 0 ? 'tone-positive' : 'tone-negative')}>
                                {formatSignedCurrency(position.unrealizedPnl)}
                              </strong>
                              <span>{position.quantity.toFixed(4)}</span>
                            </div>
                          </td>
                          <td>
                            <div className="table-stack">
                              <span>{formatHold(position.openedAt)}</span>
                              <span>{formatDateTime(position.openedAt)}</span>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            );
          })}

          {groupedPositions.length === 0 ? (
            <CompactEmpty copy="No open positions." />
          ) : null}
        </section>

        {selectedPosition ? (
          <PositionDrawer
            position={selectedPosition}
            quote={selectedQuote}
            pending={drawerPending}
            syncJobs={syncJobs}
            fundingEntries={fundingEntries}
          />
        ) : null}
      </div>
    </div>
  );
}

function HistoryPage({
  records,
  groups,
  headline,
  availableSymbols,
  groupBy,
  sideFilter,
  historySymbol,
  historyFrom,
  historyTo,
  showExchange,
  showAccount,
  onChangeGroupBy,
  onChangeSide,
  onChangeSymbol,
  onChangeFrom,
  onChangeTo,
}: {
  records: HistoryRecord[];
  groups: Array<{ label: string; rows: HistoryRecord[] }>;
  headline: HistoryHeadline;
  availableSymbols: string[];
  groupBy: HistoryGroupBy;
  sideFilter: SideFilter;
  historySymbol: string;
  historyFrom: string;
  historyTo: string;
  showExchange: boolean;
  showAccount: boolean;
  onChangeGroupBy: (value: HistoryGroupBy) => void;
  onChangeSide: (value: SideFilter) => void;
  onChangeSymbol: (value: string) => void;
  onChangeFrom: (value: string) => void;
  onChangeTo: (value: string) => void;
}) {
  return (
    <div className="view-stack">
      <div className="history-filter-bar">
        <FilterSelect
          label="Symbol"
          value={historySymbol}
          onChange={onChangeSymbol}
          options={[{ value: 'all', label: 'All symbols' }, ...availableSymbols.map((symbol) => ({ value: symbol, label: symbol }))]}
        />

        <FilterDate label="From" value={historyFrom} onChange={onChangeFrom} />
        <FilterDate label="To" value={historyTo} onChange={onChangeTo} />

        <SubfilterGroup
          label="Side"
          items={[
            { id: 'all', label: 'All sides' },
            { id: 'long', label: 'Long' },
            { id: 'short', label: 'Short' },
          ]}
          active={sideFilter}
          onChange={(value) => onChangeSide(value as SideFilter)}
        />

        <SubfilterGroup
          label="View"
          items={[
            { id: 'time', label: 'Time' },
            { id: 'account', label: 'Account' },
            { id: 'exchange', label: 'Exchange' },
          ]}
          active={groupBy}
          onChange={(value) => onChangeGroupBy(value as HistoryGroupBy)}
        />

        <button className="inline-control" onClick={() => exportHistoryCsv(records)}>
          Export CSV
        </button>
      </div>

      <MetricStrip
        items={[
          { label: 'Records', value: `${headline.records}`, detail: 'Stored position journal' },
          { label: 'Hit rate', value: formatPercent(headline.winRate), detail: 'Net positive records' },
          { label: 'Gross PnL', value: formatSignedCurrency(headline.grossPnl), detail: 'Before fees and funding', tone: headline.grossPnl >= 0 ? 'positive' : 'negative' },
          { label: 'Trading fees', value: formatSignedCurrency(-headline.tradingFees), detail: 'Captured trading fees', tone: 'negative' },
          { label: 'Net PnL', value: formatSignedCurrency(headline.netPnl), detail: 'Current stored net', tone: headline.netPnl >= 0 ? 'positive' : 'negative' },
          { label: 'Avg win / loss', value: `${formatSignedCurrency(headline.avgWin)} / ${formatSignedCurrency(headline.avgLoss)}`, detail: 'Per record' },
        ]}
      />

      <SectionCard title="Cumulative PnL" subtitle="Filtered record curve">
        <Sparkline
          points={headline.cumulative}
          tone={headline.netPnl >= 0 ? 'positive' : 'negative'}
          label="Cumulative pnl"
        />
      </SectionCard>

      <SectionCard title="History" subtitle="Scoped record journal">
        {groups.length > 0 ? (
          <div className="history-group-list">
            {groups.map((group) => (
              <div key={group.label} className="history-group">
                <div className="history-group-header">{group.label}</div>
                <table className="product-table">
                  <thead>
                    <tr>
                      <th>Symbol</th>
                      <th>Side</th>
                      <th>Size</th>
                      <th>Entry</th>
                      <th>Reference</th>
                      <th>Hold</th>
                      <th>Gross PnL</th>
                      <th>Trading fee</th>
                      <th>Funding</th>
                      <th>Net PnL</th>
                      {showAccount ? <th>Account</th> : null}
                      {showExchange ? <th>Exchange</th> : null}
                      <th>Time</th>
                    </tr>
                  </thead>
                  <tbody>
                    {group.rows.map((record) => (
                      <tr key={record.id}>
                        <td>{record.symbol}</td>
                        <td>
                          <span className={clsx('side-pill', `side-pill-${record.side}`)}>
                            {record.side.toUpperCase()}
                          </span>
                        </td>
                        <td>{formatCurrency(record.sizeUsd)}</td>
                        <td>{formatNumber(record.entryPrice)}</td>
                        <td>{formatNumber(record.referencePrice)}</td>
                        <td>{record.holdLabel}</td>
                        <td className={clsx(record.grossPnl >= 0 ? 'tone-positive' : 'tone-negative')}>
                          {formatSignedCurrency(record.grossPnl)}
                        </td>
                        <td>{formatSignedCurrency(-record.tradingFee)}</td>
                        <td>{formatSignedCurrency(-record.fundingFee)}</td>
                        <td className={clsx(record.netPnl >= 0 ? 'tone-positive' : 'tone-negative')}>
                          {formatSignedCurrency(record.netPnl)}
                        </td>
                        {showAccount ? <td>{record.accountName}</td> : null}
                        {showExchange ? <td>{prettyExchange(record.exchange)}</td> : null}
                        <td>{formatDateTime(record.eventTime)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ))}
          </div>
        ) : (
          <CompactEmpty copy="No history records match the current filters." />
        )}
      </SectionCard>
    </div>
  );
}

function RiskPage({
  headline,
  cards,
  totalEquity,
  totalUsedMargin,
}: {
  headline: RiskHeadline;
  cards: RiskAccountCardModel[];
  totalEquity: number;
  totalUsedMargin: number;
}) {
  return (
    <div className="view-stack">
      <MetricStrip
        items={[
          {
            label: 'Portfolio margin ratio',
            value: formatPercent(headline.portfolioMarginRatio),
            detail: 'Used margin across scoped accounts',
          },
          {
            label: 'Total used margin',
            value: formatCurrency(totalUsedMargin),
            detail: `Of ${formatCurrency(totalEquity)} total equity`,
          },
          {
            label: 'Highest-risk account',
            value: headline.highestRiskAccount ?? 'n/a',
            detail: headline.highestRiskRatio ? `${formatPercent(headline.highestRiskRatio)}` : 'No open pressure',
          },
          {
            label: 'Nearest liquidation',
            value: headline.nearestLiquidationLabel ?? 'n/a',
            detail: headline.highestPressureSymbol ?? formatCurrency(headline.freeMarginReserve),
          },
        ]}
      />

      <SectionCard title="Account breakdown" subtitle="Portfolio margin using Cassini-derived values">
        <div className="risk-card-grid">
          {cards.map((card) => (
            <div key={card.account.id} className="risk-card">
              <div className="risk-card-header">
                <div>
                  <strong>{card.account.name}</strong>
                  <span>{prettyExchange(card.account.exchange)}</span>
                </div>
                <span className={clsx('mode-pill', `mode-pill-${card.account.accountMode}`)}>
                  {card.account.accountMode.toUpperCase()}
                </span>
              </div>

              <div className="risk-card-body">
                <DonutMeter value={card.ratio} tone={card.ratio >= 50 ? 'warning' : 'positive'} />

                <div className="risk-card-metrics">
                  <RiskMetric label="Balance" value={formatCurrency(card.account.snapshotEquity)} />
                  <RiskMetric label="Used margin" value={formatCurrency(card.usedMargin)} />
                  <RiskMetric label="Free margin" value={formatCurrency(card.freeMargin)} />
                  <RiskMetric label="Gross exposure" value={formatCurrency(card.grossExposure)} />
                  <RiskMetric label="Open positions" value={`${card.openPositions}`} />
                  <RiskMetric label="Avg leverage" value={`${card.averageLeverage.toFixed(1)}x`} />
                  <RiskMetric
                    label="Nearest liq"
                    value={card.nearestLiquidationPrice != null ? formatNumber(card.nearestLiquidationPrice) : 'n/a'}
                  />
                  <RiskMetric
                    label="Liq distance"
                    value={card.nearestLiquidationDistance != null ? formatPercent(card.nearestLiquidationDistance) : 'n/a'}
                  />
                </div>
              </div>

              <div className="risk-card-footer">
                <span>{formatSignedCurrency(card.openPnl)} open PnL</span>
                <span>{formatPercent(card.ratio)} ratio</span>
              </div>
            </div>
          ))}

          {cards.length === 0 ? <CompactEmpty copy="No account pressure in the current scope." /> : null}
        </div>
      </SectionCard>

      <SectionCard title="Margin allocation across accounts" subtitle="Used margin vs free balance">
        <div className="allocation-bar">
          {cards.map((card) => (
            <div
              key={card.account.id}
              className={clsx('allocation-segment', `exchange-fill-${card.account.exchange}`)}
              style={{
                width: `${totalEquity > 0 ? (card.usedMargin / totalEquity) * 100 : 0}%`,
              }}
            />
          ))}
          <div
            className="allocation-segment allocation-segment-free"
            style={{
              width: `${totalEquity > 0 ? (Math.max(totalEquity - totalUsedMargin, 0) / totalEquity) * 100 : 0}%`,
            }}
          />
        </div>
        <div className="allocation-legend">
          {cards.map((card) => (
            <span key={card.account.id}>
              {card.account.name} {formatCurrency(card.usedMargin)}
            </span>
          ))}
          <span>Free {formatCurrency(Math.max(totalEquity - totalUsedMargin, 0))}</span>
        </div>
      </SectionCard>
    </div>
  );
}

function ManagePage({
  accounts,
  positions,
  syncJobs,
  onEditAccount,
  onDeleteAccount,
  onEditPosition,
  onDeletePosition,
  onSyncAccount,
  syncingAccountId,
  syncHealthByAccountId,
}: {
  accounts: ExchangeAccount[];
  positions: PortfolioPosition[];
  syncJobs: SyncJobRecord[];
  onEditAccount: (account: ExchangeAccount) => void;
  onDeleteAccount: (account: ExchangeAccount) => void;
  onEditPosition: (position: PortfolioPosition) => void;
  onDeletePosition: (position: PortfolioPosition) => void;
  onSyncAccount: (accountId: string) => void;
  syncingAccountId: string | null;
  syncHealthByAccountId: Map<string, SyncHealthSnapshot>;
}) {
  return (
    <div className="view-stack">
      <SectionCard
        title="Account management"
        subtitle="Real account ownership, sync control, and local book maintenance"
      >
        {accounts.length > 0 ? (
          <table className="product-table">
            <thead>
              <tr>
                <th>Account</th>
                <th>Exchange</th>
                <th>Mode</th>
                <th>Equity</th>
                <th>Sync health</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {accounts.map((account) => {
                const health =
                  syncHealthByAccountId.get(account.id) ??
                  deriveAccountSyncHealth(account, syncJobs, {
                    syncingAccountIds: syncingAccountId ? [syncingAccountId] : [],
                  });
                return (
                  <tr key={account.id}>
                    <td>
                      <div className="table-symbol-cell">
                        <strong>{account.name}</strong>
                        <span>{account.notes ?? 'No notes'}</span>
                      </div>
                    </td>
                    <td>{prettyExchange(account.exchange)}</td>
                    <td>{account.accountMode.toUpperCase()}</td>
                    <td>{formatCurrency(account.snapshotEquity)}</td>
                    <td>
                      <div className="account-sync-stack">
                        <SyncHealthPill health={health} />
                        <span className="sync-health-detail">{health.detail}</span>
                        {health.errorMessage ? (
                          <span className="account-sync-error" title={health.errorMessage}>
                            {health.errorMessage}
                          </span>
                        ) : null}
                      </div>
                    </td>
                    <td>
                      <div className="management-actions">
                        {account.accountMode === 'live' ? (
                          <button
                            className="inline-control"
                            disabled={syncingAccountId === account.id}
                            onClick={() => onSyncAccount(account.id)}
                          >
                            {syncingAccountId === account.id ? (
                              <LoaderCircle className="spin" size={13} />
                            ) : (
                              <RefreshCw size={13} />
                            )}
                            Sync
                          </button>
                        ) : null}
                        <button className="inline-control" onClick={() => onEditAccount(account)}>
                          <PencilLine size={13} />
                          Edit
                        </button>
                        <button
                          className="inline-control inline-control-danger"
                          onClick={() => onDeleteAccount(account)}
                        >
                          <Trash2 size={13} />
                          Delete
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        ) : (
          <CompactEmpty copy="No accounts in the current scope." />
        )}
      </SectionCard>

      <SectionCard
        title="Position management"
        subtitle="Edit or remove local/manual positions. Live exchange rows remain sync-owned."
      >
        {positions.length > 0 ? (
          <table className="product-table">
            <thead>
              <tr>
                <th>Symbol</th>
                <th>Account</th>
                <th>Side</th>
                <th>Size</th>
                <th>Entry</th>
                <th>Mark</th>
                <th>PnL</th>
                <th>Source</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {positions.map((position) => {
                const editable =
                  accounts.find((account) => account.id === position.accountId)?.accountMode !==
                  'live';
                return (
                  <tr key={position.id}>
                    <td>
                      <div className="table-symbol-cell">
                        <strong>{position.symbol}</strong>
                        <span>{position.exchangeSymbol ?? prettyExchange(position.exchange)}</span>
                      </div>
                    </td>
                    <td>{position.accountName}</td>
                    <td>
                      <span className={clsx('side-pill', `side-pill-${position.side}`)}>
                        {position.side.toUpperCase()}
                      </span>
                    </td>
                    <td>
                      {formatCurrency(
                        Math.abs(position.quantity) *
                          (position.markPrice ?? position.entryPrice),
                      )}
                    </td>
                    <td>{formatNumber(position.entryPrice)}</td>
                    <td>{formatNumber(position.markPrice ?? position.entryPrice)}</td>
                    <td
                      className={clsx(
                        position.unrealizedPnl >= 0 ? 'tone-positive' : 'tone-negative',
                      )}
                    >
                      {formatSignedCurrency(position.unrealizedPnl)}
                    </td>
                    <td>{editable ? 'Local' : 'Live sync'}</td>
                    <td>
                      <div className="management-actions">
                        <button
                          className="inline-control"
                          disabled={!editable}
                          onClick={() => onEditPosition(position)}
                        >
                          <PencilLine size={13} />
                          Edit
                        </button>
                        <button
                          className="inline-control inline-control-danger"
                          disabled={!editable}
                          onClick={() => onDeletePosition(position)}
                        >
                          <Trash2 size={13} />
                          Delete
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        ) : (
          <CompactEmpty copy="No positions in the current scope." />
        )}
      </SectionCard>
    </div>
  );
}

function SettingsPage({
  preferences,
  lanStatus,
  autoSyncStatus,
  syncPending,
  lanPending,
  syncSummary,
  liveAccountsCount,
  staleLiveCount,
  degradedLiveCount,
  awaitingLiveCount,
  onChangePreferences,
  onResetPreferences,
  onApplyHistoryWindow,
  onSyncAll,
  onToggleLan,
  onOpenAccountOverlay,
  onOpenManualOverlay,
  onOpenImportOverlay,
}: {
  preferences: Preferences;
  lanStatus?: { enabled: boolean } | null;
  autoSyncStatus?: AutoSyncStatus | null;
  syncPending: boolean;
  lanPending: boolean;
  syncSummary: SyncHealthSummary;
  liveAccountsCount: number;
  staleLiveCount: number;
  degradedLiveCount: number;
  awaitingLiveCount: number;
  onChangePreferences: Dispatch<SetStateAction<Preferences>>;
  onResetPreferences: () => void;
  onApplyHistoryWindow: (windowValue: HistoryWindow) => void;
  onSyncAll: () => void;
  onToggleLan: () => void;
  onOpenAccountOverlay: () => void;
  onOpenManualOverlay: () => void;
  onOpenImportOverlay: () => void;
}) {
  return (
    <div className="view-stack">
      <div className="settings-grid">
        <SectionCard title="History defaults" subtitle="How the journal opens">
          <SettingsOption
            label="Group records by"
            controls={
              <ChoiceRow
                items={[
                  { id: 'time', label: 'Time' },
                  { id: 'account', label: 'Account' },
                  { id: 'exchange', label: 'Exchange' },
                ]}
                active={preferences.historyGroupBy}
                onChange={(value) =>
                  onChangePreferences((current) => ({
                    ...current,
                    historyGroupBy: value as HistoryGroupBy,
                  }))
                }
              />
            }
          />
          <SettingsOption
            label="Default window"
            controls={
              <ChoiceRow
                items={[
                  { id: '7d', label: '7D' },
                  { id: '30d', label: '30D' },
                  { id: '90d', label: '90D' },
                  { id: 'all', label: 'All' },
                ]}
                active={preferences.historyWindow}
                onChange={(value) => {
                  onChangePreferences((current) => ({
                    ...current,
                    historyWindow: value as HistoryWindow,
                  }));
                  onApplyHistoryWindow(value as HistoryWindow);
                }}
              />
            }
          />
          <SettingsToggle
            label="Show exchange column"
            checked={preferences.historyShowExchange}
            onChange={(checked) =>
              onChangePreferences((current) => ({
                ...current,
                historyShowExchange: checked,
              }))
            }
          />
          <SettingsToggle
            label="Show account column"
            checked={preferences.historyShowAccount}
            onChange={(checked) =>
              onChangePreferences((current) => ({
                ...current,
                historyShowAccount: checked,
              }))
            }
          />
          <SettingsToggle
            label="Include open records"
            checked={preferences.historyIncludeOpenRecords}
            onChange={(checked) =>
              onChangePreferences((current) => ({
                ...current,
                historyIncludeOpenRecords: checked,
              }))
            }
          />
        </SectionCard>

        <SectionCard title="Positions" subtitle="Open-position defaults and drawer behavior">
          <SettingsOption
            label="Default side filter"
            controls={
              <ChoiceRow
                items={[
                  { id: 'all', label: 'All' },
                  { id: 'long', label: 'Long' },
                  { id: 'short', label: 'Short' },
                ]}
                active={preferences.positionSide}
                onChange={(value) =>
                  onChangePreferences((current) => ({
                    ...current,
                    positionSide: value as SideFilter,
                  }))
                }
              />
            }
          />
          <SettingsOption
            label="Default sort"
            controls={
              <ChoiceRow
                items={[
                  { id: 'pnl', label: 'P&L' },
                  { id: 'size', label: 'Size' },
                  { id: 'symbol', label: 'Symbol' },
                ]}
                active={preferences.positionSort}
                onChange={(value) =>
                  onChangePreferences((current) => ({
                    ...current,
                    positionSort: value as PositionSort,
                  }))
                }
              />
            }
          />
          <SettingsToggle
            label="Keep detail drawer open"
            checked={preferences.drawerOpen}
            onChange={(checked) =>
              onChangePreferences((current) => ({
                ...current,
                drawerOpen: checked,
              }))
            }
          />
        </SectionCard>

        <SectionCard title="Overview and Risk" subtitle="Visibility and density">
          <SettingsToggle
            label="Show per-account curves"
            checked={preferences.showOverviewAccountCurves}
            onChange={(checked) =>
              onChangePreferences((current) => ({
                ...current,
                showOverviewAccountCurves: checked,
              }))
            }
          />
          <SettingsToggle
            label="Show fee board"
            checked={preferences.showOverviewFeeBoard}
            onChange={(checked) =>
              onChangePreferences((current) => ({
                ...current,
                showOverviewFeeBoard: checked,
              }))
            }
          />
          <SettingsToggle
            label="Show empty accounts in risk"
            checked={preferences.showRiskEmptyAccounts}
            onChange={(checked) =>
              onChangePreferences((current) => ({
                ...current,
                showRiskEmptyAccounts: checked,
              }))
            }
          />
          <SettingsToggle
            label="Compact rows"
            checked={preferences.compactRows}
            onChange={(checked) =>
              onChangePreferences((current) => ({
                ...current,
                compactRows: checked,
              }))
            }
          />
        </SectionCard>

        <SectionCard title="Sync and freshness" subtitle="Live connector health and stale-state visibility">
          <SettingsOption
            label="Portfolio sync"
            controls={
              <div className="settings-health-row">
                <SyncHealthPill health={syncSummary} />
                <span className="sync-health-detail">{syncSummary.detail}</span>
              </div>
            }
          />
          <SettingsOption
            label="Live accounts"
            controls={<span className="settings-kpi">{liveAccountsCount}</span>}
          />
          <SettingsOption
            label="Scheduler"
            controls={<span className="settings-kpi">{formatAutoSyncState(autoSyncStatus)}</span>}
          />
          <SettingsOption
            label="Interval"
            controls={
              <span className="settings-kpi">
                {autoSyncStatus?.intervalSeconds ? `${autoSyncStatus.intervalSeconds}s` : 'off'}
              </span>
            }
          />
          <SettingsOption
            label="Next cycle"
            controls={
              <span className="settings-kpi">
                {autoSyncStatus?.nextScheduledAt
                  ? formatFutureAge(autoSyncStatus.nextScheduledAt)
                  : 'n/a'}
              </span>
            }
          />
          <SettingsOption
            label="Last finish"
            controls={
              <span className="settings-kpi">
                {autoSyncStatus?.lastFinishedAt
                  ? formatRelativeAge(autoSyncStatus.lastFinishedAt)
                  : 'n/a'}
              </span>
            }
          />
          <SettingsOption
            label="Last cycle"
            controls={
              <span className="settings-kpi">
                {autoSyncStatus
                  ? `${autoSyncStatus.lastCycleSucceeded}/${autoSyncStatus.lastCycleAccounts}`
                  : 'n/a'}
              </span>
            }
          />
          <SettingsOption
            label="Stale"
            controls={<span className="settings-kpi">{staleLiveCount}</span>}
          />
          <SettingsOption
            label="Degraded"
            controls={<span className="settings-kpi">{degradedLiveCount}</span>}
          />
          <SettingsOption
            label="Awaiting first sync"
            controls={<span className="settings-kpi">{awaitingLiveCount}</span>}
          />
          {autoSyncStatus?.lastError ? (
            <div className="settings-inline-error" title={autoSyncStatus.lastError}>
              {autoSyncStatus.lastError}
            </div>
          ) : null}
        </SectionCard>

        <SectionCard title="Operations" subtitle="Workflow actions and LAN">
          <div className="settings-action-list">
            <button className="settings-action" onClick={onOpenAccountOverlay}>
              <Link2 size={14} />
              Connect live account
            </button>
            <button className="settings-action" onClick={onOpenManualOverlay}>
              <Layers3 size={14} />
              Add manual position
            </button>
            <button className="settings-action" onClick={onOpenImportOverlay}>
              <FileSpreadsheet size={14} />
              Import CSV
            </button>
            <button className="settings-action" disabled={syncPending} onClick={onSyncAll}>
              {syncPending ? <LoaderCircle className="spin" size={14} /> : <RefreshCw size={14} />}
              Sync live accounts
            </button>
            <button className="settings-action" disabled={lanPending} onClick={onToggleLan}>
              {lanPending ? <LoaderCircle className="spin" size={14} /> : <Globe size={14} />}
              {lanStatus?.enabled ? 'Disable LAN' : 'Enable LAN'}
            </button>
            <button className="settings-action settings-action-danger" onClick={onResetPreferences}>
              <Settings2 size={14} />
              Reset UI preferences
            </button>
          </div>
        </SectionCard>
      </div>
    </div>
  );
}

function SyncHealthPill({ health }: { health: SyncHealthSnapshot }) {
  return (
    <span
      className={clsx('sync-health-pill', `sync-health-${health.tone}`)}
      title={health.errorMessage ?? health.detail}
    >
      {health.label}
    </span>
  );
}

function MetricStrip({
  items,
}: {
  items: Array<{
    label: string;
    value: string;
    detail: string;
    tone?: 'positive' | 'negative' | 'neutral';
  }>;
}) {
  return (
    <section className="metric-strip">
      {items.map((item) => (
        <article key={item.label} className="metric-tile-clean">
          <span>{item.label}</span>
          <strong className={clsx(item.tone && `tone-${item.tone}`)}>{item.value}</strong>
          <p>{item.detail}</p>
        </article>
      ))}
    </section>
  );
}

function PositionDrawer({
  position,
  quote,
  pending,
  syncJobs,
  fundingEntries,
}: {
  position: PortfolioPosition;
  quote: MarketQuote | null;
  pending: boolean;
  syncJobs: SyncJobRecord[];
  fundingEntries: FundingHistoryEntry[];
}) {
  const currentPrice = quote?.markPrice ?? position.markPrice ?? position.entryPrice;
  const positionSize = Math.abs(position.quantity) * currentPrice;
  const marginUsed = estimatePositionMargin(position);
  const pnlOnMargin = marginUsed > 0 ? (position.unrealizedPnl / marginUsed) * 100 : 0;
  const feeAndFunding = position.feePaid + position.fundingPaid;
  const breakEvenPrice =
    position.quantity > 0
      ? position.side === 'long'
        ? position.entryPrice + feeAndFunding / position.quantity
        : position.entryPrice - feeAndFunding / position.quantity
      : position.entryPrice;
  const marketLevels = [
    {
      label: 'Entry',
      price: position.entryPrice,
      detail: 'Average fill',
      tone: 'neutral',
    },
    {
      label: 'Break-even',
      price: breakEvenPrice,
      detail: 'Fees and funding applied',
      tone: 'neutral',
    },
    {
      label: 'Mark',
      price: currentPrice,
      detail: pending ? 'Refreshing' : 'Current quote',
      tone: 'accent',
    },
    position.liquidationPrice
      ? {
          label: 'Liq',
          price: position.liquidationPrice,
          detail: 'Exchange liquidation',
          tone: 'neutral',
        }
      : null,
    quote?.oraclePrice
      ? {
          label: 'Oracle',
          price: quote.oraclePrice,
          detail: 'Exchange oracle',
          tone: 'neutral',
        }
      : null,
  ].filter(Boolean) as Array<{ label: string; price: number; detail: string; tone: 'neutral' | 'accent' }>;
  const latestFunding = latestFundingForPosition(position, fundingEntries);
  const latestJob = syncJobs.find((job) => job.accountId === position.accountId) ?? null;

  return (
    <aside className="position-drawer">
      <div className="position-drawer-header">
        <div className="drawer-title-row">
          <h3>{position.symbol}</h3>
          <span className={clsx('side-pill', `side-pill-${position.side}`)}>
            {position.side.toUpperCase()}
          </span>
          <span className="mode-pill mode-pill-live">{prettyExchange(position.exchange)}</span>
        </div>
        <p>
          {position.accountName} · {position.leverage.toFixed(1)}x leverage · Opened{' '}
          {formatDateTime(position.openedAt)}
        </p>
      </div>

      <div className="drawer-summary-ribbon">
        <span>{position.exchangeSymbol ?? 'Local symbol'}</span>
        <span>{latestJob ? `Synced ${formatRelativeAge(latestJob.startedAt)}` : 'Local record'}</span>
        <span>{latestFunding === 0 ? 'Funding n/a' : `${(latestFunding * 100).toFixed(4)}% funding`}</span>
      </div>

      <div className="drawer-desk-grid">
        <div className="drawer-hero-tile">
          <span>Unreal.</span>
          <strong className={clsx(position.unrealizedPnl >= 0 ? 'tone-positive' : 'tone-negative')}>
            {formatSignedCurrency(position.unrealizedPnl)}
          </strong>
          <p>{formatPercent(pnlOnMargin)}</p>
        </div>
        <div className="drawer-hero-tile">
          <span>Notional</span>
          <strong>{formatCurrency(positionSize)}</strong>
          <p>{position.quantity.toFixed(4)}</p>
        </div>
        <div className="drawer-hero-tile">
          <span>Margin</span>
          <strong>{formatCurrency(marginUsed)}</strong>
          <p>{position.leverage.toFixed(1)}x</p>
        </div>
        <div className="drawer-hero-tile">
          <span>Mark</span>
          <strong>{formatNumber(currentPrice)}</strong>
          <p>{pending ? 'Refreshing' : 'Live'}</p>
        </div>
      </div>

      <div className="drawer-panel">
        <div className="drawer-panel-header drawer-panel-header-compact">
          <strong>Levels</strong>
        </div>
        <div className="price-level-list">
          {marketLevels.map((level) => (
            <div key={level.label} className="price-level-row">
              <div className="price-level-label">
                <span className={clsx('price-bullet', `price-bullet-${level.tone}`)} />
                {level.label}
              </div>
              <div className="price-level-value">
                <strong>{formatNumber(level.price)}</strong>
                <span>
                  {level.detail} · {formatPercent(distanceFromReference(level.price, currentPrice))}
                </span>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="drawer-panel">
        <div className="drawer-panel-header drawer-panel-header-compact">
          <strong>Details</strong>
        </div>
        <div className="drawer-context-grid">
          <DrawerMetric label="Gross notional" value={formatCurrency(positionSize)} detail="Marked notional" />
          <DrawerMetric label="Fee drag" value={formatSignedCurrency(-feeAndFunding)} detail="Trade + funding" tone="negative" />
          <DrawerMetric
            label="Mark drift"
            value={formatPercent(distanceFromReference(position.entryPrice, currentPrice))}
            detail="Entry vs current mark"
            tone={currentPrice >= position.entryPrice ? 'positive' : 'negative'}
          />
          <DrawerMetric
            label="Hold"
            value={formatHold(position.openedAt)}
            detail="Time since opening"
          />
        </div>
        <div className="drawer-detail-list">
          <DrawerDetail label="Margin mode" value={position.marginMode ? position.marginMode.toUpperCase() : 'n/a'} />
          <DrawerDetail label="Margin used" value={formatCurrency(marginUsed)} />
          <DrawerDetail label="Liquidation" value={position.liquidationPrice != null ? formatNumber(position.liquidationPrice) : 'n/a'} />
          <DrawerDetail label="Liq distance" value={formatLiquidationDistance(position)} />
          <DrawerDetail label="Maintenance" value={position.maintenanceMargin != null ? formatCurrency(position.maintenanceMargin) : 'n/a'} />
          <DrawerDetail label="Trading fee" value={formatSignedCurrency(-position.feePaid)} />
          <DrawerDetail label="Funding paid" value={formatSignedCurrency(-position.fundingPaid)} />
          <DrawerDetail label="Latest funding rate" value={latestFunding === 0 ? 'n/a' : `${(latestFunding * 100).toFixed(4)}%`} />
          <DrawerDetail label="Oracle price" value={quote?.oraclePrice != null ? formatNumber(quote.oraclePrice) : 'n/a'} />
          <DrawerDetail label="Last sync" value={latestJob ? formatRelativeAge(latestJob.startedAt) : 'Local record'} />
          <DrawerDetail label="Exchange symbol" value={position.exchangeSymbol ?? 'n/a'} />
        </div>
      </div>

      {position.notes ? (
        <div className="drawer-panel">
          <div className="drawer-panel-header drawer-panel-header-compact">
            <strong>Notes</strong>
          </div>
          <div className="inline-note">{position.notes}</div>
        </div>
      ) : null}
    </aside>
  );
}

function SectionCard({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle: string;
  children: ReactNode;
}) {
  return (
    <section className="panel-card">
      <div className="panel-card-header">
        <div>
          <h2>{title}</h2>
          <p>{subtitle}</p>
        </div>
      </div>
      {children}
    </section>
  );
}

function CompactEmpty({ copy }: { copy: string }) {
  return <div className="compact-empty-clean">{copy}</div>;
}

function SubfilterGroup({
  label,
  items,
  active,
  onChange,
}: {
  label: string;
  items: Array<{ id: string; label: string }>;
  active: string;
  onChange: (value: string) => void;
}) {
  return (
    <div className="subfilter-group">
      <span>{label}</span>
      <div className="subfilter-pills">
        {items.map((item) => (
          <button
            key={item.id}
            className={clsx('subfilter-pill', active === item.id && 'subfilter-pill-active')}
            onClick={() => onChange(item.id)}
          >
            {item.label}
          </button>
        ))}
      </div>
    </div>
  );
}

function ChoiceRow({
  items,
  active,
  onChange,
}: {
  items: Array<{ id: string; label: string }>;
  active: string;
  onChange: (value: string) => void;
}) {
  return (
    <div className="choice-row">
      {items.map((item) => (
        <button
          key={item.id}
          className={clsx('choice-chip', active === item.id && 'choice-chip-active')}
          onClick={() => onChange(item.id)}
        >
          {item.label}
        </button>
      ))}
    </div>
  );
}

function SettingsOption({
  label,
  controls,
}: {
  label: string;
  controls: ReactNode;
}) {
  return (
    <div className="settings-row">
      <span>{label}</span>
      {controls}
    </div>
  );
}

function SettingsToggle({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className="settings-toggle-clean">
      <span>{label}</span>
      <input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} />
    </label>
  );
}

function FilterSelect({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: Array<{ value: string; label: string }>;
}) {
  return (
    <label className="filter-field">
      <span>{label}</span>
      <select value={value} onChange={(event) => onChange(event.target.value)}>
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}

function FilterDate({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <label className="filter-field">
      <span>{label}</span>
      <input type="date" value={value} onChange={(event) => onChange(event.target.value)} />
    </label>
  );
}

function DonutMeter({
  value,
  tone,
}: {
  value: number;
  tone: 'positive' | 'warning';
}) {
  const radius = 42;
  const circumference = 2 * Math.PI * radius;
  const dash = circumference * Math.min(value, 100) / 100;

  return (
    <svg className="donut-meter" viewBox="0 0 120 120" aria-label="Margin ratio">
      <circle cx="60" cy="60" r={radius} className="donut-meter-track" />
      <circle
        cx="60"
        cy="60"
        r={radius}
        className={clsx('donut-meter-value', `donut-meter-${tone}`)}
        strokeDasharray={`${dash} ${circumference}`}
      />
      <text x="60" y="58" textAnchor="middle" className="donut-meter-number">
        {value.toFixed(0)}%
      </text>
      <text x="60" y="74" textAnchor="middle" className="donut-meter-label">
        ratio
      </text>
    </svg>
  );
}

function RiskMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="risk-metric">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function DrawerMetric({
  label,
  value,
  detail,
  tone = 'neutral',
}: {
  label: string;
  value: string;
  detail: string;
  tone?: 'neutral' | 'positive' | 'negative';
}) {
  return (
    <div className="drawer-metric">
      <span>{label}</span>
      <strong className={clsx(tone !== 'neutral' && `tone-${tone}`)}>{value}</strong>
      <p>{detail}</p>
    </div>
  );
}

function DrawerDetail({ label, value }: { label: string; value: string }) {
  return (
    <div className="drawer-detail">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function OverlayShell({
  title,
  subtitle,
  onClose,
  children,
}: {
  title: string;
  subtitle: string;
  onClose: () => void;
  children: ReactNode;
}) {
  return (
    <div className="overlay-backdrop-clean" onClick={onClose}>
      <div className="overlay-shell-clean" onClick={(event) => event.stopPropagation()}>
        <div className="overlay-header-clean">
          <div>
            <h2>{title}</h2>
            <p>{subtitle}</p>
          </div>
          <button className="overlay-close" onClick={onClose}>
            <X size={16} />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

function LiveAccountForm({
  form,
  liveAccountsCount,
  validation,
  validatePending,
  createPending,
  syncAllPending,
  onFormChange,
  onValidate,
  onCreate,
  onSyncAll,
}: {
  form: CreateLiveAccountInput;
  liveAccountsCount: number;
  validation: LiveAccountValidation | null;
  validatePending: boolean;
  createPending: boolean;
  syncAllPending: boolean;
  onFormChange: Dispatch<SetStateAction<CreateLiveAccountInput>>;
  onValidate: () => void;
  onCreate: () => void;
  onSyncAll: () => void;
}) {
  return (
    <div className="overlay-form">
      <div className="field-grid-clean">
        <Field label="Account name">
          <input
            value={form.name}
            onChange={(event) =>
              onFormChange((current) => ({ ...current, name: event.target.value }))
            }
            placeholder="BloFin 01 / HL vault"
          />
        </Field>
        <Field label="Exchange">
          <select
            value={form.exchange}
            onChange={(event) =>
              onFormChange((current) => ({
                ...current,
                exchange: event.target.value as CreateLiveAccountInput['exchange'],
              }))
            }
          >
            {liveExchangeOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </Field>
      </div>

      <div className="field-grid-clean">
        <Field label="Connection label">
          <input
            value={form.connectionLabel ?? ''}
            onChange={(event) =>
              onFormChange((current) => ({
                ...current,
                connectionLabel: event.target.value,
              }))
            }
            placeholder="Desk wallet / sub-account alias"
          />
        </Field>

        {form.exchange === 'hyperliquid' ? (
          <Field label="Wallet address">
            <input
              value={form.walletAddress ?? ''}
              onChange={(event) =>
                onFormChange((current) => ({
                  ...current,
                  walletAddress: event.target.value,
                }))
              }
              placeholder="0x..."
            />
          </Field>
        ) : (
          <Field label="API key">
            <input
              value={form.apiKey ?? ''}
              onChange={(event) =>
                onFormChange((current) => ({
                  ...current,
                  apiKey: event.target.value,
                }))
              }
              placeholder="Read-only BloFin API key"
            />
          </Field>
        )}
      </div>

      {form.exchange === 'blofin' ? (
        <div className="field-grid-clean">
          <Field label="API secret">
            <input
              type="password"
              value={form.apiSecret ?? ''}
              onChange={(event) =>
                onFormChange((current) => ({
                  ...current,
                  apiSecret: event.target.value,
                }))
              }
            />
          </Field>
          <Field label="Passphrase">
            <input
              type="password"
              value={form.apiPassphrase ?? ''}
              onChange={(event) =>
                onFormChange((current) => ({
                  ...current,
                  apiPassphrase: event.target.value,
                }))
              }
            />
          </Field>
        </div>
      ) : null}

      <div className="overlay-button-row">
        <button className="overlay-button" disabled={validatePending} onClick={onValidate}>
          {validatePending ? <LoaderCircle className="spin" size={16} /> : <Link2 size={16} />}
          Validate
        </button>
        <button className="overlay-button overlay-button-strong" disabled={createPending} onClick={onCreate}>
          {createPending ? <LoaderCircle className="spin" size={16} /> : <Activity size={16} />}
          Connect and sync
        </button>
        {liveAccountsCount > 0 ? (
          <button className="overlay-button" disabled={syncAllPending} onClick={onSyncAll}>
            {syncAllPending ? <LoaderCircle className="spin" size={16} /> : <RefreshCw size={16} />}
            Sync all live
          </button>
        ) : null}
      </div>

      {validation ? (
        <div className="inline-note">
          {validation.exchange.toUpperCase()} validated for {validation.externalReference}. Equity{' '}
          {formatCurrency(validation.snapshotEquity)}.
        </div>
      ) : null}
    </div>
  );
}

function LocalAccountForm({
  form,
  pending,
  onChange,
  onCreate,
}: {
  form: CreateAccountInput;
  pending: boolean;
  onChange: Dispatch<SetStateAction<CreateAccountInput>>;
  onCreate: () => void;
}) {
  return (
    <div className="overlay-form">
      <div className="field-grid-clean">
        <Field label="Account name">
          <input
            value={form.name}
            onChange={(event) =>
              onChange((current) => ({ ...current, name: event.target.value }))
            }
            placeholder="Desk alpha / imported book"
          />
        </Field>
        <Field label="Exchange base">
          <select
            value={form.exchange}
            onChange={(event) =>
              onChange((current) => ({
                ...current,
                exchange: event.target.value as ExchangeKind,
              }))
            }
          >
            {exchangeOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </Field>
      </div>

      <div className="field-grid-clean">
        <Field label="Wallet balance">
          <input
            type="number"
            value={form.walletBalance}
            onChange={(event) =>
              onChange((current) => ({
                ...current,
                walletBalance: Number(event.target.value),
              }))
            }
          />
        </Field>
        <Field label="Notes">
          <input
            value={form.notes ?? ''}
            onChange={(event) =>
              onChange((current) => ({ ...current, notes: event.target.value }))
            }
            placeholder="Desk purpose or funding notes"
          />
        </Field>
      </div>

      <button className="overlay-button overlay-button-strong overlay-button-wide" disabled={pending} onClick={onCreate}>
        <Plus size={16} />
        Add account
      </button>
    </div>
  );
}

function AccountEditorForm({
  account,
  form,
  pending,
  deletePending,
  onChange,
  onSave,
  onDelete,
}: {
  account: ExchangeAccount | null;
  form: UpdateAccountInput;
  pending: boolean;
  deletePending: boolean;
  onChange: Dispatch<SetStateAction<UpdateAccountInput | null>>;
  onSave: () => void;
  onDelete: () => void;
}) {
  return (
    <div className="overlay-form">
      <div className="field-grid-clean">
        <Field label="Account name">
          <input
            value={form.name}
            onChange={(event) =>
              onChange((current) =>
                current ? { ...current, name: event.target.value } : current,
              )
            }
          />
        </Field>
        <Field label="Account type">
          <input
            disabled
            value={
              account
                ? `${prettyExchange(account.exchange)} · ${account.accountMode.toUpperCase()}`
                : 'Unknown'
            }
          />
        </Field>
      </div>

      <div className="field-grid-clean">
        <Field label="Wallet balance">
          <input
            type="number"
            disabled={account?.accountMode === 'live'}
            value={form.walletBalance ?? 0}
            onChange={(event) =>
              onChange((current) =>
                current
                  ? { ...current, walletBalance: Number(event.target.value) }
                  : current,
              )
            }
          />
        </Field>
        <Field label="Notes">
          <input
            value={form.notes ?? ''}
            onChange={(event) =>
              onChange((current) =>
                current ? { ...current, notes: event.target.value } : current,
              )
            }
            placeholder="Desk notes or account purpose"
          />
        </Field>
      </div>

      {account?.accountMode === 'live' ? (
        <div className="inline-note">
          Live account balances stay exchange-owned. You can rename the account and keep notes,
          but equity updates from sync.
        </div>
      ) : null}

      <div className="overlay-button-row">
        <button className="overlay-button overlay-button-strong" disabled={pending} onClick={onSave}>
          <PencilLine size={16} />
          Save changes
        </button>
        <button
          className="overlay-button overlay-button-danger"
          disabled={deletePending}
          onClick={onDelete}
        >
          <Trash2 size={16} />
          Delete account
        </button>
      </div>
    </div>
  );
}

function PositionEditorForm({
  form,
  accountOptions,
  pending,
  deletePending,
  onChange,
  onSave,
  onDelete,
}: {
  form: UpdateManualPositionInput;
  accountOptions: Array<{ value: string; label: string }>;
  pending: boolean;
  deletePending: boolean;
  onChange: Dispatch<SetStateAction<UpdateManualPositionInput | null>>;
  onSave: () => void;
  onDelete: () => void;
}) {
  return (
    <div className="overlay-form">
      <div className="field-grid-clean field-grid-clean-3">
        <Field label="Account">
          <select
            value={form.accountId}
            onChange={(event) =>
              onChange((current) =>
                current ? { ...current, accountId: event.target.value } : current,
              )
            }
          >
            {accountOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Symbol">
          <input
            value={form.symbol}
            onChange={(event) =>
              onChange((current) =>
                current
                  ? { ...current, symbol: event.target.value.toUpperCase() }
                  : current,
              )
            }
          />
        </Field>
        <Field label="Exchange symbol">
          <input
            value={form.exchangeSymbol ?? ''}
            onChange={(event) =>
              onChange((current) =>
                current
                  ? { ...current, exchangeSymbol: event.target.value.toUpperCase() }
                  : current,
              )
            }
            placeholder="Optional"
          />
        </Field>
      </div>

      <div className="field-grid-clean field-grid-clean-3">
        <Field label="Side">
          <select
            value={form.side}
            onChange={(event) =>
              onChange((current) =>
                current ? { ...current, side: event.target.value as PositionSide } : current,
              )
            }
          >
            <option value="long">Long</option>
            <option value="short">Short</option>
          </select>
        </Field>
        <Field label="Quantity">
          <input
            type="number"
            value={form.quantity}
            onChange={(event) =>
              onChange((current) =>
                current ? { ...current, quantity: Number(event.target.value) } : current,
              )
            }
          />
        </Field>
        <Field label="Leverage">
          <input
            type="number"
            value={form.leverage}
            onChange={(event) =>
              onChange((current) =>
                current ? { ...current, leverage: Number(event.target.value) } : current,
              )
            }
          />
        </Field>
      </div>

      <div className="field-grid-clean field-grid-clean-3">
        <Field label="Entry price">
          <input
            type="number"
            value={form.entryPrice}
            onChange={(event) =>
              onChange((current) =>
                current ? { ...current, entryPrice: Number(event.target.value) } : current,
              )
            }
          />
        </Field>
        <Field label="Mark price">
          <input
            type="number"
            value={form.markPrice ?? ''}
            onChange={(event) =>
              onChange((current) =>
                current
                  ? {
                      ...current,
                      markPrice: event.target.value
                        ? Number(event.target.value)
                        : undefined,
                    }
                  : current,
              )
            }
          />
        </Field>
        <Field label="Fees paid">
          <input
            type="number"
            value={form.feePaid ?? 0}
            onChange={(event) =>
              onChange((current) =>
                current ? { ...current, feePaid: Number(event.target.value) } : current,
              )
            }
          />
        </Field>
      </div>

      <div className="field-grid-clean">
        <Field label="Funding paid">
          <input
            type="number"
            value={form.fundingPaid ?? 0}
            onChange={(event) =>
              onChange((current) =>
                current ? { ...current, fundingPaid: Number(event.target.value) } : current,
              )
            }
          />
        </Field>
        <Field label="Notes">
          <input
            value={form.notes ?? ''}
            onChange={(event) =>
              onChange((current) =>
                current ? { ...current, notes: event.target.value } : current,
              )
            }
            placeholder="Reason, setup, context"
          />
        </Field>
      </div>

      <div className="overlay-button-row">
        <button className="overlay-button overlay-button-strong" disabled={pending} onClick={onSave}>
          <PencilLine size={16} />
          Save changes
        </button>
        <button
          className="overlay-button overlay-button-danger"
          disabled={deletePending}
          onClick={onDelete}
        >
          <Trash2 size={16} />
          Delete position
        </button>
      </div>
    </div>
  );
}

function ManualPositionForm({
  activeAccountOptions,
  selectedAccount,
  selectedAccountId,
  marketBackedExchange,
  marketQuery,
  availableMarkets,
  selectedMarket,
  marketQuote,
  marketCatalogPending,
  marketCatalogError,
  marketQuotePending,
  marketQuoteError,
  previewNotional,
  previewPnl,
  previewMark,
  form,
  pending,
  onChange,
  onChangeMarketQuery,
  onSelectMarket,
  onSave,
}: {
  activeAccountOptions: Array<{ value: string; label: string }>;
  selectedAccount: ExchangeAccount | null;
  selectedAccountId: string;
  marketBackedExchange: SupportedLiveExchange | null;
  marketQuery: string;
  availableMarkets: ExchangeMarket[];
  selectedMarket: ExchangeMarket | null;
  marketQuote: MarketQuote | null;
  marketCatalogPending: boolean;
  marketCatalogError: string | null;
  marketQuotePending: boolean;
  marketQuoteError: string | null;
  previewNotional: number;
  previewPnl: number;
  previewMark: number;
  form: ManualPositionInput;
  pending: boolean;
  onChange: Dispatch<SetStateAction<ManualPositionInput>>;
  onChangeMarketQuery: (value: string) => void;
  onSelectMarket: (market: ExchangeMarket) => void;
  onSave: () => void;
}) {
  const [step, setStep] = useState<CaptureStep>('contract');
  const usingLiveMark = form.markPrice == null;
  const saveBlocked =
    pending ||
    !selectedAccountId ||
    form.entryPrice <= 0 ||
    (marketBackedExchange != null && !selectedMarket && !form.exchangeSymbol);

  return (
    <div className="capture-studio">
      <aside className="capture-browser-pane">
        <div className="capture-pane-header">
          <div>
            <span className="panel-kicker">Contracts</span>
            <h3>Browser</h3>
            <p>{marketBackedExchange ? prettyExchange(marketBackedExchange) : 'Local'}</p>
          </div>
          <Search size={16} />
        </div>

        <Field label="Account">
          <select
            value={selectedAccountId}
            onChange={(event) =>
              onChange((current) => ({
                ...current,
                accountId: event.target.value,
                exchangeSymbol: undefined,
              }))
            }
          >
            {activeAccountOptions.length === 0 ? (
              <option value="">Create an account first</option>
            ) : null}
            {activeAccountOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </Field>

        {marketBackedExchange ? (
          <>
            <Field label={`${prettyExchange(marketBackedExchange)} contract`}>
              <input
                value={marketQuery}
                onChange={(event) => onChangeMarketQuery(event.target.value.toUpperCase())}
                placeholder="BTCUSDT / BTC-USDT / BTC"
              />
            </Field>

            <div className="capture-market-status">
              <span>{marketCatalogPending ? 'Loading catalog' : `${availableMarkets.length} matches`}</span>
              <span>{selectedMarket ? `Selected ${selectedMarket.exchangeSymbol}` : 'Select a contract'}</span>
            </div>

            {marketCatalogError ? (
              <div className="inline-note">Market catalog error: {marketCatalogError}</div>
            ) : null}

            <div className="capture-market-list">
              {availableMarkets.length > 0 ? (
                availableMarkets.map((market) => (
                  <button
                    key={market.exchangeSymbol}
                    className={clsx(
                      'capture-market-row',
                      selectedMarket?.exchangeSymbol === market.exchangeSymbol &&
                        'capture-market-row-active',
                    )}
                    onClick={() => onSelectMarket(market)}
                  >
                    <div className="capture-market-copy">
                      <strong>{market.exchangeSymbol}</strong>
                      <span>{market.symbol}</span>
                    </div>
                    <div className="capture-market-meta">
                      <span>{market.contractType}</span>
                      <span>{market.maxLeverage ? `${market.maxLeverage}x max` : 'n/a'}</span>
                    </div>
                  </button>
                ))
              ) : (
                <div className="compact-empty-clean">
                  {marketCatalogPending
                    ? 'Loading market catalog...'
                    : 'No contract matches the current search.'}
                </div>
              )}
            </div>
          </>
        ) : (
          <div className="capture-local-hint">
            <strong>Local base</strong>
            <p>Symbol + mark stay manual.</p>
          </div>
        )}
      </aside>

      <div className="capture-builder-pane">
        <div className="capture-pane-header">
          <div>
            <span className="panel-kicker">Builder</span>
            <h3>Position</h3>
            <p>{selectedAccount?.name ?? 'Select account'}</p>
          </div>
          <div className="capture-step-list">
            {(['contract', 'economics', 'review'] as const).map((item) => (
              <button
                key={item}
                className={clsx('capture-step', step === item && 'capture-step-active')}
                onClick={() => setStep(item)}
              >
                {titleCase(item)}
              </button>
            ))}
          </div>
        </div>

        <div className="capture-selection-bar">
          <div>
            <span>Selected contract</span>
            <strong>{selectedMarket?.exchangeSymbol ?? form.exchangeSymbol ?? form.symbol}</strong>
          </div>
          <div>
            <span>Account</span>
            <strong>{selectedAccount?.name ?? 'Select account'}</strong>
          </div>
          <div>
            <span>Mark source</span>
            <strong>{usingLiveMark ? 'Live quote' : 'Manual override'}</strong>
          </div>
        </div>

        {step === 'contract' ? (
          <div className="capture-panel-grid">
            <div className="capture-editor-card">
              <div className="field-grid-clean field-grid-clean-3">
                <Field label="Symbol">
                  <input
                    value={form.symbol}
                    onChange={(event) => {
                      const nextSymbol = event.target.value.toUpperCase();
                      onChangeMarketQuery(nextSymbol);
                      onChange((current) => ({
                        ...current,
                        exchangeSymbol: undefined,
                        symbol: nextSymbol,
                        exchange: selectedAccount?.exchange ?? current.exchange,
                      }));
                    }}
                  />
                </Field>
                <Field label="Side">
                  <select
                    value={form.side}
                    onChange={(event) =>
                      onChange((current) => ({
                        ...current,
                        side: event.target.value as PositionSide,
                      }))
                    }
                  >
                    <option value="long">Long</option>
                    <option value="short">Short</option>
                  </select>
                </Field>
                <Field label="Quantity">
                  <input
                    type="number"
                    value={form.quantity}
                    onChange={(event) =>
                      onChange((current) => ({
                        ...current,
                        quantity: Number(event.target.value),
                      }))
                    }
                  />
                </Field>
              </div>

              <div className="field-grid-clean field-grid-clean-2">
                <Field label="Leverage">
                  <input
                    type="number"
                    value={form.leverage}
                    onChange={(event) =>
                      onChange((current) => ({
                        ...current,
                        leverage: Number(event.target.value),
                      }))
                    }
                  />
                </Field>
                <Field label="Notes">
                  <input
                    value={form.notes ?? ''}
                    onChange={(event) =>
                      onChange((current) => ({ ...current, notes: event.target.value }))
                    }
                    placeholder="Setup, thesis, or annotation"
                  />
                </Field>
              </div>
            </div>

            <div className="capture-summary-card">
              <div className="capture-summary-row">
                <span>Contract</span>
                <strong>{selectedMarket?.exchangeSymbol ?? form.symbol}</strong>
              </div>
              <div className="capture-summary-row">
                <span>Tick / step</span>
                <strong>
                  {selectedMarket?.priceTickSize ?? 'n/a'} / {selectedMarket?.quantityStep ?? 'n/a'}
                </strong>
              </div>
              <div className="capture-summary-row">
                <span>Leverage cap</span>
                <strong>{selectedMarket?.maxLeverage ? `${selectedMarket.maxLeverage}x` : 'n/a'}</strong>
              </div>
              <div className="capture-summary-row">
                <span>Current mark</span>
                <strong>{marketQuote?.markPrice != null ? formatNumber(marketQuote.markPrice) : 'n/a'}</strong>
              </div>
            </div>
          </div>
        ) : null}

        {step === 'economics' ? (
          <div className="capture-panel-grid">
            <div className="capture-editor-card">
              <div className="capture-mark-mode">
                <button
                  className={clsx('choice-chip', usingLiveMark && 'choice-chip-active')}
                  onClick={() =>
                    onChange((current) => ({
                      ...current,
                      markPrice: undefined,
                    }))
                  }
                >
                  Live mark
                </button>
                <button
                  className={clsx('choice-chip', !usingLiveMark && 'choice-chip-active')}
                  onClick={() =>
                    onChange((current) => ({
                      ...current,
                      markPrice:
                        current.markPrice ??
                        marketQuote?.markPrice ??
                        selectedMarket?.markPrice ??
                        current.entryPrice,
                    }))
                  }
                >
                  Manual override
                </button>
              </div>

              {marketQuoteError ? (
                <div className="inline-note">Quote error: {marketQuoteError}</div>
              ) : null}

              <div className="field-grid-clean field-grid-clean-3">
                <Field label="Entry price">
                  <input
                    type="number"
                    value={form.entryPrice}
                    onChange={(event) =>
                      onChange((current) => ({
                        ...current,
                        entryPrice: Number(event.target.value),
                      }))
                    }
                  />
                </Field>
                <Field label="Mark price">
                  <input
                    type="number"
                    value={usingLiveMark ? marketQuote?.markPrice ?? selectedMarket?.markPrice ?? '' : form.markPrice ?? ''}
                    disabled={usingLiveMark}
                    onChange={(event) =>
                      onChange((current) => ({
                        ...current,
                        markPrice: event.target.value ? Number(event.target.value) : undefined,
                      }))
                    }
                  />
                </Field>
                <Field label="Fees paid">
                  <input
                    type="number"
                    value={form.feePaid ?? 0}
                    onChange={(event) =>
                      onChange((current) => ({
                        ...current,
                        feePaid: Number(event.target.value),
                      }))
                    }
                  />
                </Field>
              </div>

              <div className="field-grid-clean field-grid-clean-2">
                <Field label="Funding paid">
                  <input
                    type="number"
                    value={form.fundingPaid ?? 0}
                    onChange={(event) =>
                      onChange((current) => ({
                        ...current,
                        fundingPaid: Number(event.target.value),
                      }))
                    }
                  />
                </Field>
              </div>
            </div>

            <div className="capture-quote-card">
              <div className="quote-card-header">
                <strong>{selectedMarket?.exchangeSymbol ?? form.exchangeSymbol ?? 'Select market'}</strong>
                <span>{marketQuotePending ? 'Refreshing' : 'Live quote'}</span>
              </div>
              <div className="quote-card-grid">
                <DrawerMetric
                  label="Mark"
                  value={
                    marketQuote?.markPrice != null ? formatNumber(marketQuote.markPrice) : 'n/a'
                  }
                  detail="Current"
                />
                <DrawerMetric
                  label="Oracle"
                  value={
                    marketQuote?.oraclePrice != null ? formatNumber(marketQuote.oraclePrice) : 'n/a'
                  }
                  detail="Reference"
                />
                <DrawerMetric
                  label="Funding"
                  value={
                    marketQuote?.fundingRate != null
                      ? `${(marketQuote.fundingRate * 100).toFixed(4)}%`
                      : 'n/a'
                  }
                  detail="Latest"
                />
              </div>
              <div className="capture-quote-foot">
                <span>{usingLiveMark ? 'Mark tracks the live quote until you switch to manual override.' : 'Manual override is active. The saved mark will use your explicit value.'}</span>
              </div>
            </div>
          </div>
        ) : null}

        {step === 'review' ? (
          <div className="review-card-clean">
            <div className="review-headline">
              <div>
                <strong>{form.symbol}</strong>
                <span>
                  {selectedAccount?.name ?? 'Select account'} · {form.side.toUpperCase()} · {form.leverage.toFixed(1)}x
                </span>
              </div>
              {form.exchangeSymbol ? <span className="mode-pill mode-pill-live">{form.exchangeSymbol}</span> : null}
            </div>

            <div className="drawer-metric-grid">
              <DrawerMetric label="Notional" value={formatCurrency(previewNotional)} detail="Entry notional" />
              <DrawerMetric
                label="Preview PnL"
                value={formatSignedCurrency(previewPnl)}
                detail="Marked with current reference"
                tone={previewPnl >= 0 ? 'positive' : 'negative'}
              />
              <DrawerMetric label="Mark" value={formatNumber(previewMark)} detail="Current reference" />
              <DrawerMetric
                label="Fees + funding"
                value={formatSignedCurrency(-((form.feePaid ?? 0) + (form.fundingPaid ?? 0)))}
                detail="Captured cost basis"
                tone="negative"
              />
            </div>

            <button
              className="overlay-button overlay-button-strong overlay-button-wide"
              disabled={saveBlocked}
              onClick={onSave}
            >
              <Layers3 size={16} />
              Save position
            </button>
          </div>
        ) : null}

        <div className="capture-footer-clean">
          <button
            className="overlay-button"
            disabled={step === 'contract'}
            onClick={() =>
              setStep((current) => (current === 'review' ? 'economics' : 'contract'))
            }
          >
            Back
          </button>
          <button
            className="overlay-button"
            disabled={step === 'review'}
            onClick={() =>
              setStep((current) => (current === 'contract' ? 'economics' : 'review'))
            }
          >
            Continue
          </button>
        </div>
      </div>
    </div>
  );
}

function CsvImportForm({
  activeAccountOptions,
  csvPayload,
  csvSourceExchange,
  csvTargetAccount,
  importResult,
  pending,
  onPayloadChange,
  onSourceExchangeChange,
  onTargetAccountChange,
  onImport,
}: {
  activeAccountOptions: Array<{ value: string; label: string }>;
  csvPayload: string;
  csvSourceExchange: ExchangeKind;
  csvTargetAccount: string;
  importResult:
    | {
        importedCount: number;
        rejectedRows: string[];
        snapshotId: string;
      }
    | undefined;
  pending: boolean;
  onPayloadChange: (value: string) => void;
  onSourceExchangeChange: (value: ExchangeKind) => void;
  onTargetAccountChange: (value: string) => void;
  onImport: () => void;
}) {
  return (
    <div className="overlay-form">
      <div className="field-grid-clean">
        <Field label="Target account">
          <select value={csvTargetAccount} onChange={(event) => onTargetAccountChange(event.target.value)}>
            <option value="">Create imported account automatically</option>
            {activeAccountOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Source exchange">
          <select
            value={csvSourceExchange}
            onChange={(event) => onSourceExchangeChange(event.target.value as ExchangeKind)}
          >
            {exchangeOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </Field>
      </div>

      <Field label="CSV payload">
        <textarea value={csvPayload} onChange={(event) => onPayloadChange(event.target.value)} />
      </Field>

      <button className="overlay-button overlay-button-strong overlay-button-wide" disabled={pending} onClick={onImport}>
        <FileSpreadsheet size={16} />
        Import CSV snapshot
      </button>

      {importResult ? (
        <div className="inline-note">
          Imported {importResult.importedCount} rows into snapshot {importResult.snapshotId}.
        </div>
      ) : null}
    </div>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="field-clean">
      <span>{label}</span>
      {children}
    </label>
  );
}

function Sparkline({
  points,
  tone,
  label,
  dense = false,
}: {
  points: number[];
  tone: 'positive' | 'negative' | 'accent';
  label: string;
  dense?: boolean;
}) {
  if (points.length === 0) {
    return <div className={clsx('sparkline-shell-clean', dense && 'sparkline-shell-clean-dense')} />;
  }

  const min = Math.min(...points);
  const max = Math.max(...points);
  const range = max - min || 1;
  const coordinates = points
    .map((point, index) => {
      const x = points.length === 1 ? 50 : (index / (points.length - 1)) * 100;
      const y = 100 - ((point - min) / range) * 100;
      return `${x},${y}`;
    })
    .join(' ');

  return (
    <div className={clsx('sparkline-shell-clean', dense && 'sparkline-shell-clean-dense', `sparkline-${tone}`)}>
      <svg viewBox="0 0 100 100" preserveAspectRatio="none" role="img" aria-label={label}>
        <polyline points={coordinates} className="sparkline-line-clean" />
      </svg>
    </div>
  );
}

function useStoredState<T>(
  key: string,
  initialValue: T,
): [T, Dispatch<SetStateAction<T>>] {
  const [value, setValue] = useState<T>(() => {
    if (typeof window === 'undefined') {
      return initialValue;
    }
    const stored = window.localStorage.getItem(key);
    if (!stored) {
      return initialValue;
    }
    try {
      return JSON.parse(stored) as T;
    } catch {
      return initialValue;
    }
  });

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }
    window.localStorage.setItem(key, JSON.stringify(value));
  }, [key, value]);

  return [value, setValue];
}

interface SummaryModel {
  totalEquity: number;
  availableBalance: number;
  walletBalance: number;
  openPositions: number;
  accountCount: number;
  exchangeCount: number;
  grossExposure: number;
  usedMargin: number;
  feeBurned: number;
  fundingBurned: number;
  nextFundingEstimate: number;
}

interface HistoryHeadline {
  records: number;
  winRate: number;
  grossPnl: number;
  tradingFees: number;
  netPnl: number;
  avgWin: number;
  avgLoss: number;
  cumulative: number[];
}

interface RiskHeadline {
  portfolioMarginRatio: number;
  highestRiskAccount: string | null;
  highestRiskRatio: number;
  freeMarginReserve: number;
  highestPressureSymbol: string | null;
  nearestLiquidationLabel: string | null;
}

function isValidScope(scope: FocusScope, accounts: ExchangeAccount[]) {
  if (scope === 'portfolio') {
    return true;
  }
  const exchange = getExchangeScope(scope);
  if (exchange) {
    return accounts.some((account) => account.exchange === exchange);
  }
  return accounts.some((account) => account.id === scope);
}

function deriveScopeContext(scope: FocusScope, accounts: ExchangeAccount[]): ScopeContext {
  if (scope === 'portfolio') {
    return {
      kind: 'portfolio',
      label: 'All accounts',
      detail: 'Cross-exchange portfolio view',
      account: null,
      accounts,
    };
  }

  const exchange = getExchangeScope(scope);
  if (exchange) {
    const exchangeAccounts = accounts.filter((account) => account.exchange === exchange);
    return {
      kind: 'exchange',
      label: prettyExchange(exchange),
      detail: `${exchangeAccounts.length} accounts`,
      account: null,
      accounts: exchangeAccounts,
    };
  }

  const account = accounts.find((item) => item.id === scope) ?? null;
  if (!account) {
    return {
      kind: 'portfolio',
      label: 'All accounts',
      detail: 'Cross-exchange portfolio view',
      account: null,
      accounts,
    };
  }

  return {
    kind: 'account',
    label: account.name,
    detail: `${prettyExchange(account.exchange)} · ${account.accountMode.toUpperCase()}`,
    account,
    accounts: [account],
  };
}

function getExchangeScope(scope: FocusScope): ExchangeKind | null {
  if (!scope.startsWith('exchange:')) {
    return null;
  }
  const exchange = scope.replace('exchange:', '') as ExchangeKind;
  return exchangeOptions.some((option) => option.value === exchange) ? exchange : null;
}

function prettyExchange(exchange: ExchangeKind) {
  switch (exchange) {
    case 'blofin':
      return 'BloFin';
    case 'hyperliquid':
      return 'Hyperliquid';
    case 'manual':
      return 'Manual';
    case 'import':
      return 'Imported';
    default:
      return exchange;
  }
}

function titleCase(value: string) {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function groupAccounts(accounts: ExchangeAccount[]): ExchangeGroup[] {
  const grouped = new Map<ExchangeKind, ExchangeAccount[]>();
  for (const account of accounts) {
    const current = grouped.get(account.exchange) ?? [];
    current.push(account);
    grouped.set(account.exchange, current);
  }

  return Array.from(grouped.entries())
    .map(([exchange, groupedAccounts]) => ({
      exchange,
      accounts: groupedAccounts.sort((left, right) => right.snapshotEquity - left.snapshotEquity),
      totalEquity: groupedAccounts.reduce((total, account) => total + account.snapshotEquity, 0),
    }))
    .sort((left, right) => right.totalEquity - left.totalEquity);
}

function buildPositionGroups(
  accounts: ExchangeAccount[],
  positions: PortfolioPosition[],
  sideFilter: SideFilter,
  sort: PositionSort,
): PositionGroup[] {
  return accounts
    .map((account) => {
      let scoped = positions.filter((position) => position.accountId === account.id);
      if (sideFilter !== 'all') {
        scoped = scoped.filter((position) => position.side === sideFilter);
      }
      scoped = [...scoped].sort((left, right) => {
        if (sort === 'size') {
          return (
            Math.abs((right.markPrice ?? right.entryPrice) * right.quantity) -
            Math.abs((left.markPrice ?? left.entryPrice) * left.quantity)
          );
        }
        if (sort === 'symbol') {
          return left.symbol.localeCompare(right.symbol);
        }
        return right.unrealizedPnl - left.unrealizedPnl;
      });
      return {
        account,
        positions: scoped,
        grossExposure: scoped.reduce(
          (total, position) =>
            total + Math.abs(position.quantity) * (position.markPrice ?? position.entryPrice),
          0,
        ),
        openPnl: scoped.reduce((total, position) => total + position.unrealizedPnl, 0),
        usedMargin: scoped.reduce((total, position) => total + estimatePositionMargin(position), 0),
        feeDrag: scoped.reduce((total, position) => total + position.feePaid + position.fundingPaid, 0),
      };
    })
    .filter((group) => group.positions.length > 0);
}

function buildRiskAccountCards(
  accounts: ExchangeAccount[],
  positions: PortfolioPosition[],
): RiskAccountCardModel[] {
  return accounts
    .map((account) => {
      const accountPositions = positions.filter((position) => position.accountId === account.id);
      const grossExposure = accountPositions.reduce(
        (total, position) =>
          total + Math.abs(position.quantity) * (position.markPrice ?? position.entryPrice),
        0,
      );
      const usedMargin = accountPositions.reduce(
        (total, position) => total + estimatePositionMargin(position),
        0,
      );
      const equityBase = account.snapshotEquity > 0 ? account.snapshotEquity : account.walletBalance;
      const freeMargin = Math.max(equityBase - usedMargin, 0);
      const liquidationDistances = accountPositions
        .map((position) => ({
          price: position.liquidationPrice ?? null,
          distance: positionLiquidationDistance(position),
        }))
        .filter(
          (item): item is { price: number; distance: number } =>
            item.price != null && item.distance != null,
        )
        .sort((left, right) => Math.abs(left.distance) - Math.abs(right.distance));
      const nearestLiquidation = liquidationDistances[0] ?? null;

      return {
        account,
        grossExposure,
        usedMargin,
        freeMargin,
        ratio: equityBase > 0 ? (usedMargin / equityBase) * 100 : 0,
        openPnl: accountPositions.reduce((total, position) => total + position.unrealizedPnl, 0),
        openPositions: accountPositions.length,
        averageLeverage:
          accountPositions.length > 0
            ? accountPositions.reduce((total, position) => total + position.leverage, 0) /
              accountPositions.length
            : 0,
        nearestLiquidationPrice: nearestLiquidation?.price ?? null,
        nearestLiquidationDistance: nearestLiquidation?.distance ?? null,
      };
    })
    .sort((left, right) => right.ratio - left.ratio);
}

function buildRiskHeadline(cards: RiskAccountCardModel[], totalEquity: number): RiskHeadline {
  const highest = cards[0] ?? null;
  const nearestLiq = cards
    .filter((card) => card.nearestLiquidationPrice != null && card.nearestLiquidationDistance != null)
    .sort(
      (left, right) =>
        Math.abs((left.nearestLiquidationDistance ?? Number.MAX_SAFE_INTEGER)) -
        Math.abs((right.nearestLiquidationDistance ?? Number.MAX_SAFE_INTEGER)),
    )[0] ?? null;

  return {
    portfolioMarginRatio:
      totalEquity > 0
        ? (cards.reduce((total, card) => total + card.usedMargin, 0) / totalEquity) * 100
        : 0,
    highestRiskAccount: highest?.account.name ?? null,
    highestRiskRatio: highest?.ratio ?? 0,
    freeMarginReserve: cards.reduce((total, card) => total + card.freeMargin, 0),
    highestPressureSymbol: highest?.openPositions ? `${highest.account.name} pressure` : null,
    nearestLiquidationLabel:
      nearestLiq?.nearestLiquidationPrice != null && nearestLiq.nearestLiquidationDistance != null
        ? `${formatNumber(nearestLiq.nearestLiquidationPrice)} · ${formatPercent(nearestLiq.nearestLiquidationDistance)}`
        : null,
  };
}

function buildHistoryRecords(positions: PortfolioPosition[]): HistoryRecord[] {
  return [...positions]
    .map((position) => {
      const referencePrice = position.markPrice ?? position.entryPrice;
      const sizeUsd = Math.abs(position.quantity) * referencePrice;
      const grossPnl =
        computePnl(position.side, position.entryPrice, referencePrice, position.quantity) +
        position.realizedPnl;
      const netPnl = grossPnl - position.feePaid - position.fundingPaid;
      return {
        id: position.id,
        accountId: position.accountId,
        accountName: position.accountName,
        exchange: position.exchange,
        symbol: position.symbol,
        side: position.side,
        sizeUsd,
        entryPrice: position.entryPrice,
        referencePrice,
        holdLabel: formatHold(position.openedAt),
        grossPnl,
        tradingFee: position.feePaid,
        fundingFee: position.fundingPaid,
        netPnl,
        eventTime: position.openedAt,
      };
    })
    .sort(
      (left, right) =>
        new Date(right.eventTime).getTime() - new Date(left.eventTime).getTime(),
    );
}

function filterHistoryRecords(
  records: HistoryRecord[],
  filters: {
    side: SideFilter;
    from: string;
    to: string;
    symbol: string;
    includeOpenRecords: boolean;
  },
) {
  const fromMs = filters.from ? new Date(`${filters.from}T00:00:00`).getTime() : 0;
  const toMs = filters.to ? new Date(`${filters.to}T23:59:59`).getTime() : Number.MAX_SAFE_INTEGER;

  return records.filter((record) => {
    if (filters.side !== 'all' && record.side !== filters.side) {
      return false;
    }
    if (filters.symbol !== 'all' && record.symbol !== filters.symbol) {
      return false;
    }
    const eventMs = new Date(record.eventTime).getTime();
    if (eventMs < fromMs || eventMs > toMs) {
      return false;
    }
    if (!filters.includeOpenRecords && Math.abs(record.netPnl) < Number.EPSILON) {
      return false;
    }
    return true;
  });
}

function groupHistoryRecords(records: HistoryRecord[], groupBy: HistoryGroupBy) {
  const grouped = new Map<string, HistoryRecord[]>();
  for (const record of records) {
    const label =
      groupBy === 'account'
        ? record.accountName
        : groupBy === 'exchange'
          ? prettyExchange(record.exchange)
          : new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric' }).format(
              new Date(record.eventTime),
            );
    const current = grouped.get(label) ?? [];
    current.push(record);
    grouped.set(label, current);
  }

  return Array.from(grouped.entries()).map(([label, rows]) => ({ label, rows }));
}

function buildHistoryHeadline(records: HistoryRecord[]): HistoryHeadline {
  const wins = records.filter((record) => record.netPnl > 0);
  const losses = records.filter((record) => record.netPnl < 0);
  let cumulative = 0;
  return {
    records: records.length,
    winRate: records.length > 0 ? (wins.length / records.length) * 100 : 0,
    grossPnl: records.reduce((total, record) => total + record.grossPnl, 0),
    tradingFees: records.reduce((total, record) => total + record.tradingFee, 0),
    netPnl: records.reduce((total, record) => total + record.netPnl, 0),
    avgWin:
      wins.length > 0 ? wins.reduce((total, record) => total + record.netPnl, 0) / wins.length : 0,
    avgLoss:
      losses.length > 0
        ? losses.reduce((total, record) => total + record.netPnl, 0) / losses.length
        : 0,
    cumulative: records
      .slice()
      .sort(
        (left, right) =>
          new Date(left.eventTime).getTime() - new Date(right.eventTime).getTime(),
      )
      .map((record) => {
        cumulative += record.netPnl;
        return cumulative;
      }),
  };
}

function buildFeeRows(records: HistoryRecord[]) {
  const grouped = new Map<string, { accountId: string; accountName: string; exchange: ExchangeKind; tradingFees: number; fundingFees: number; netPnl: number }>();
  for (const record of records) {
    const current = grouped.get(record.accountId) ?? {
      accountId: record.accountId,
      accountName: record.accountName,
      exchange: record.exchange,
      tradingFees: 0,
      fundingFees: 0,
      netPnl: 0,
    };
    current.tradingFees += record.tradingFee;
    current.fundingFees += record.fundingFee;
    current.netPnl += record.netPnl;
    grouped.set(record.accountId, current);
  }
  return Array.from(grouped.values()).sort((left, right) => right.netPnl - left.netPnl);
}

function aggregateHistory(series: AccountHistorySeries[]) {
  const grouped = new Map<string, { balance: number; equity: number }>();
  for (const accountSeries of series) {
    for (const point of accountSeries.points) {
      const current = grouped.get(point.recordedAt) ?? { balance: 0, equity: 0 };
      current.balance += point.balance;
      current.equity += point.equity;
      grouped.set(point.recordedAt, current);
    }
  }

  return Array.from(grouped.entries())
    .map(([recordedAt, values]) => ({
      recordedAt,
      balance: values.balance,
      equity: values.equity,
    }))
    .sort(
      (left, right) =>
        new Date(left.recordedAt).getTime() - new Date(right.recordedAt).getTime(),
    );
}

function scopedManualAccounts(accounts: ExchangeAccount[]) {
  return accounts.filter((account) => account.accountMode !== 'live');
}

function latestFundingForPosition(position: PortfolioPosition, entries: FundingHistoryEntry[]) {
  return (
    entries.find(
      (entry) =>
        entry.accountId === position.accountId && entry.symbol === position.symbol,
    )?.rate ?? 0
  );
}

function estimateFundingImpact(
  positions: PortfolioPosition[],
  entries: FundingHistoryEntry[],
) {
  return positions.reduce((total, position) => {
    const rate = latestFundingForPosition(position, entries);
    const notional = Math.abs(position.quantity) * (position.markPrice ?? position.entryPrice);
    const signedImpact = position.side === 'long' ? -notional * rate : notional * rate;
    return total + signedImpact;
  }, 0);
}

function estimatePositionMargin(position: PortfolioPosition) {
  return position.marginUsed ?? (
    Math.abs(position.quantity) * (position.markPrice ?? position.entryPrice)
  ) / Math.max(position.leverage, 1);
}

function positionLiquidationDistance(position: PortfolioPosition) {
  if (position.liquidationPrice == null) {
    return null;
  }

  const current = position.markPrice ?? position.entryPrice;
  if (!current || !Number.isFinite(current)) {
    return null;
  }

  return Math.abs(((position.liquidationPrice - current) / current) * 100);
}

function formatLiquidationDistance(position: PortfolioPosition) {
  const distance = positionLiquidationDistance(position);
  return distance == null ? 'n/a' : formatPercent(distance);
}

function defaultDateRange(windowValue: HistoryWindow) {
  const end = new Date();
  const start = new Date(end);
  if (windowValue === '7d') start.setDate(end.getDate() - 7);
  if (windowValue === '30d') start.setDate(end.getDate() - 30);
  if (windowValue === '90d') start.setDate(end.getDate() - 90);
  if (windowValue === 'all') start.setFullYear(end.getFullYear() - 2);

  return {
    from: start.toISOString().slice(0, 10),
    to: end.toISOString().slice(0, 10),
  };
}

function exportHistoryCsv(records: HistoryRecord[]) {
  const header = [
    'symbol',
    'side',
    'size_usd',
    'entry_price',
    'reference_price',
    'hold',
    'gross_pnl',
    'trading_fee',
    'funding_fee',
    'net_pnl',
    'account',
    'exchange',
    'time',
  ];
  const rows = records.map((record) => [
    record.symbol,
    record.side,
    record.sizeUsd.toString(),
    record.entryPrice.toString(),
    record.referencePrice.toString(),
    record.holdLabel,
    record.grossPnl.toString(),
    record.tradingFee.toString(),
    record.fundingFee.toString(),
    record.netPnl.toString(),
    record.accountName,
    record.exchange,
    record.eventTime,
  ]);
  const csv = [header, ...rows].map((row) => row.join(',')).join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `cassini-history-${new Date().toISOString().slice(0, 10)}.csv`;
  anchor.click();
  URL.revokeObjectURL(url);
}

function computePnl(
  side: PositionSide,
  entryPrice: number,
  markPrice: number,
  quantity: number,
) {
  if (side === 'long') {
    return (markPrice - entryPrice) * quantity;
  }
  return (entryPrice - markPrice) * quantity;
}

function historyDelta(points: BalanceHistoryPoint[]) {
  if (points.length === 0) return 0;
  return points[points.length - 1].equity - points[0].equity;
}

function historyTone(points: BalanceHistoryPoint[]) {
  const delta = historyDelta(points);
  if (delta > 0) return 'positive';
  if (delta < 0) return 'negative';
  return 'accent';
}

function buildPerformance(positions: PortfolioPosition[]): PerformanceMetrics {
  let realizedPnl = 0;
  let unrealizedPnl = 0;
  let closedPositions = 0;
  let wins = 0;
  let totalHoldHours = 0;
  let feeDrag = 0;

  for (const position of positions) {
    unrealizedPnl += position.unrealizedPnl;
    feeDrag += position.feePaid + position.fundingPaid;
    if (position.realizedPnl !== 0) {
      closedPositions += 1;
      realizedPnl += position.realizedPnl;
      if (position.realizedPnl > 0) wins += 1;
    }
    totalHoldHours +=
      (Date.now() - new Date(position.openedAt).getTime()) / 3_600_000;
  }

  return {
    realizedPnl,
    unrealizedPnl,
    closedPositions,
    winRate: closedPositions > 0 ? (wins / closedPositions) * 100 : 0,
    averageHoldHours: positions.length > 0 ? totalHoldHours / positions.length : 0,
    feeDrag,
  };
}

function formatCurrency(value: number) {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 2,
  }).format(value);
}

function formatSignedCurrency(value: number) {
  const formatted = formatCurrency(Math.abs(value));
  return value >= 0 ? `+${formatted}` : `-${formatted}`;
}

function formatPercent(value: number) {
  return `${value.toFixed(1)}%`;
}

function formatNumber(value: number) {
  return new Intl.NumberFormat('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}

function formatDateTime(value: string) {
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value));
}

function formatRelativeAge(value: string) {
  const diffMs = Date.now() - new Date(value).getTime();
  const diffMinutes = Math.max(0, Math.floor(diffMs / 60_000));
  if (diffMinutes < 1) return 'just now';
  if (diffMinutes < 60) return `${diffMinutes}m ago`;
  const diffHours = Math.floor(diffMinutes / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  return `${Math.floor(diffHours / 24)}d ago`;
}

function formatFutureAge(value: string) {
  const diffMs = new Date(value).getTime() - Date.now();
  const diffMinutes = Math.max(0, Math.floor(diffMs / 60_000));
  if (diffMinutes < 1) return 'under 1m';
  if (diffMinutes < 60) return `in ${diffMinutes}m`;
  const diffHours = Math.floor(diffMinutes / 60);
  if (diffHours < 24) return `in ${diffHours}h`;
  return `in ${Math.floor(diffHours / 24)}d`;
}

function formatAutoSyncState(status?: AutoSyncStatus | null) {
  if (!status?.enabled) return 'off';
  if (status.running) return 'running';
  if (status.lastCycleAccounts === 0 && !status.lastError) return 'idle';
  if (status.lastCycleFailed > 0) return 'degraded';
  return 'armed';
}

function formatAutoSyncInline(status?: AutoSyncStatus | null) {
  if (!status?.enabled) return 'auto off';
  if (status.running) return 'auto cycle active';
  if (status.lastCycleAccounts === 0 && !status.lastError) return 'auto idle';
  if (status.nextScheduledAt) return `auto ${formatFutureAge(status.nextScheduledAt)}`;
  return `auto ${status.intervalSeconds}s`;
}

function formatHold(value: string) {
  const diffMs = Date.now() - new Date(value).getTime();
  const diffMinutes = Math.max(1, Math.floor(diffMs / 60_000));
  const hours = Math.floor(diffMinutes / 60);
  const minutes = diffMinutes % 60;
  if (hours === 0) return `${minutes}m`;
  return `${hours}h ${minutes}m`;
}

function distanceFromReference(reference: number, current: number) {
  if (!current || !Number.isFinite(current) || !Number.isFinite(reference)) {
    return 0;
  }
  return ((reference - current) / current) * 100;
}

function marketCandidates(market: ExchangeMarket) {
  return [
    market.exchangeSymbol,
    market.symbol,
    market.baseAsset,
    market.quoteAsset,
    market.settleAsset,
    `${market.baseAsset}${market.quoteAsset}`,
    `${market.baseAsset}${market.settleAsset ?? ''}`,
  ]
    .filter(Boolean)
    .map((value) => normalizeMarketSearch(value));
}

function normalizeMarketSearch(value: string | null | undefined) {
  return (value ?? '').trim().toLowerCase().replace(/[^a-z0-9]/g, '');
}

export default ProductApp;
