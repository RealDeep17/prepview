import {
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type Dispatch,
  type ReactNode,
  type SetStateAction,
} from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import clsx from 'clsx';
import {
  Activity,
  ArrowUpRight,
  FileSpreadsheet,
  Globe,
  Layers3,
  Link2,
  LoaderCircle,
  PanelLeftClose,
  PanelLeftOpen,
  Plus,
  Radar,
  RefreshCw,
  Search,
  Settings2,
  ShieldCheck,
  WalletCards,
} from 'lucide-react';
import {
  addManualPosition,
  createAccount,
  createLiveAccount,
  getExchangeMarketQuote,
  getExchangeMarkets,
  getBootstrapState,
  importCsvPositions,
  setLanProjection,
  syncAllLiveAccounts,
  syncLiveAccount,
  validateLiveAccount,
} from './lib/bridge';
import type {
  AccountHistorySeries,
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
} from './lib/types';

type FocusScope = 'portfolio' | string;
type DataTab = 'positions' | 'exposure' | 'funding' | 'sync' | 'history';
type OverlayMode = null | 'account' | 'capture' | 'settings';
type AccountOverlayTab = 'live' | 'local';
type CaptureOverlayTab = 'position' | 'csv';
type CaptureStep = 'contract' | 'economics' | 'review';
type DragTarget = 'left' | 'right' | 'bottom';

interface LayoutState {
  left: number;
  right: number;
  bottom: number;
  showInspector: boolean;
  showPulse: boolean;
  denseRows: boolean;
}

interface ExposureRow {
  symbol: string;
  longNotional: number;
  shortNotional: number;
  netNotional: number;
  accountIds: string[];
}

interface AccountGroup {
  exchange: ExchangeKind;
  accounts: ExchangeAccount[];
  totalEquity: number;
}

interface FocusCluster {
  symbol: string;
  longNotional: number;
  shortNotional: number;
  netNotional: number;
  grossNotional: number;
  unrealizedPnl: number;
  avgLeverage: number;
  positionCount: number;
  accountIds: string[];
  exchanges: ExchangeKind[];
}

interface ScopeContext {
  kind: 'portfolio' | 'exchange' | 'account';
  label: string;
  detail: string;
  account: ExchangeAccount | null;
  accounts: ExchangeAccount[];
}

type SupportedLiveExchange = Extract<ExchangeKind, 'blofin' | 'hyperliquid'>;

const EMPTY_ACCOUNTS: ExchangeAccount[] = [];
const EMPTY_MARKETS: ExchangeMarket[] = [];
const EMPTY_POSITIONS: PortfolioPosition[] = [];
const EMPTY_HISTORY: BalanceHistoryPoint[] = [];
const EMPTY_ACCOUNT_HISTORY: AccountHistorySeries[] = [];
const EMPTY_FUNDING: FundingHistoryEntry[] = [];
const EMPTY_SYNC_JOBS: SyncJobRecord[] = [];

const STORAGE_KEYS = {
  scope: 'cassini.workspace.scope',
  tab: 'cassini.workspace.tab',
  layout: 'cassini.workspace.layout',
  symbol: 'cassini.workspace.symbol',
} as const;

const DEFAULT_LAYOUT: LayoutState = {
  left: 304,
  right: 356,
  bottom: 284,
  showInspector: true,
  showPulse: true,
  denseRows: true,
};

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

function App() {
  const queryClient = useQueryClient();
  const workspaceRef = useRef<HTMLDivElement | null>(null);
  const [focusScope, setFocusScope] = useStoredState<FocusScope>(
    STORAGE_KEYS.scope,
    'portfolio',
  );
  const [activeTab, setActiveTab] = useStoredState<DataTab>(
    STORAGE_KEYS.tab,
    'positions',
  );
  const [storedLayout, setStoredLayout] = useStoredState<LayoutState>(
    STORAGE_KEYS.layout,
    DEFAULT_LAYOUT,
  );
  const [focusedSymbol, setFocusedSymbol] = useStoredState<string | null>(
    STORAGE_KEYS.symbol,
    null,
  );
  const [overlay, setOverlay] = useState<OverlayMode>(null);
  const [accountOverlayTab, setAccountOverlayTab] =
    useState<AccountOverlayTab>('live');
  const [captureOverlayTab, setCaptureOverlayTab] =
    useState<CaptureOverlayTab>('position');
  const [dragging, setDragging] = useState<DragTarget | null>(null);
  const [scopeQuery, setScopeQuery] = useState('');

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
  const [csvSourceExchange, setCsvSourceExchange] =
    useState<ExchangeKind>('import');

  const layout = { ...DEFAULT_LAYOUT, ...storedLayout };
  const deferredScopeQuery = useDeferredValue(scopeQuery.trim().toLowerCase());

  const bootstrapQuery = useQuery({
    queryKey: ['bootstrap'],
    queryFn: getBootstrapState,
    refetchInterval: 10_000,
  });

  const bootstrap = bootstrapQuery.data;
  const accounts = bootstrap?.accounts ?? EMPTY_ACCOUNTS;
  const positions = bootstrap?.positions ?? EMPTY_POSITIONS;
  const lanStatus = bootstrap?.lanStatus;
  const portfolioHistory = bootstrap?.portfolioHistory ?? EMPTY_HISTORY;
  const accountHistory = bootstrap?.accountHistory ?? EMPTY_ACCOUNT_HISTORY;
  const recentFundingEntries = bootstrap?.recentFundingEntries ?? EMPTY_FUNDING;
  const recentSyncJobs = bootstrap?.recentSyncJobs ?? EMPTY_SYNC_JOBS;

  const liveAccounts = useMemo(
    () => accounts.filter((account) => account.accountMode === 'live'),
    [accounts],
  );
  const manualAccounts = useMemo(
    () => accounts.filter((account) => account.accountMode !== 'live'),
    [accounts],
  );

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

  useEffect(() => {
    if (!dragging) {
      document.body.style.cursor = '';
      return undefined;
    }

    const onPointerMove = (event: PointerEvent) => {
      const workspace = workspaceRef.current;
      if (!workspace) {
        return;
      }

      const bounds = workspace.getBoundingClientRect();
      if (dragging === 'left') {
        const next = clamp(event.clientX - bounds.left, 260, 420);
        setStoredLayout((current) => ({ ...current, left: next }));
      }
      if (dragging === 'right') {
        const next = clamp(bounds.right - event.clientX, 300, 460);
        setStoredLayout((current) => ({ ...current, right: next }));
      }
      if (dragging === 'bottom') {
        const next = clamp(bounds.bottom - event.clientY, 236, bounds.height - 220);
        setStoredLayout((current) => ({ ...current, bottom: next }));
      }
    };

    const onPointerUp = () => {
      setDragging(null);
    };

    document.body.style.cursor = dragging === 'bottom' ? 'row-resize' : 'col-resize';
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);

    return () => {
      document.body.style.cursor = '';
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
    };
  }, [dragging, setStoredLayout]);

  const scopeContext = useMemo(() => deriveScopeContext(focusScope, accounts), [
    focusScope,
    accounts,
  ]);
  const selectedAccount = scopeContext.account;
  const scopedAccounts = scopeContext.accounts;
  const scopedAccountIds = useMemo(
    () => new Set(scopedAccounts.map((account) => account.id)),
    [scopedAccounts],
  );

  const selectedPositions = useMemo(
    () =>
      positions.filter((position) => scopedAccountIds.has(position.accountId)),
    [positions, scopedAccountIds],
  );
  const selectedFundingEntries = useMemo(
    () =>
      recentFundingEntries.filter((entry) => scopedAccountIds.has(entry.accountId)),
    [recentFundingEntries, scopedAccountIds],
  );
  const selectedSyncJobs = useMemo(
    () => recentSyncJobs.filter((job) => scopedAccountIds.has(job.accountId)),
    [recentSyncJobs, scopedAccountIds],
  );
  const selectedHistory = useMemo(() => {
    if (scopeContext.kind === 'portfolio') {
      return portfolioHistory;
    }

    const matchingSeries = accountHistory.filter((series) =>
      scopedAccountIds.has(series.accountId),
    );
    return aggregateHistory(matchingSeries);
  }, [accountHistory, portfolioHistory, scopeContext.kind, scopedAccountIds]);

  const selectedExposure = useMemo(
    () => buildExposure(selectedPositions),
    [selectedPositions],
  );
  const selectedPerformance = useMemo(
    () => buildPerformance(selectedPositions),
    [selectedPositions],
  );
  const focusClusters = useMemo(
    () => buildFocusClusters(selectedPositions),
    [selectedPositions],
  );

  useEffect(() => {
    if (focusClusters.length === 0) {
      if (focusedSymbol != null) {
        setFocusedSymbol(null);
      }
      return;
    }

    if (!focusedSymbol || !focusClusters.some((row) => row.symbol === focusedSymbol)) {
      setFocusedSymbol(focusClusters[0].symbol);
    }
  }, [focusClusters, focusedSymbol, setFocusedSymbol]);

  const selectedCluster =
    focusClusters.find((row) => row.symbol === focusedSymbol) ?? null;
  const latestHistoryPoint = selectedHistory[selectedHistory.length - 1] ?? null;
  const accountGroups = useMemo(
    () => filterAccountGroups(groupAccounts(accounts), deferredScopeQuery),
    [accounts, deferredScopeQuery],
  );
  const scopedLiveAccounts = scopedAccounts.filter(
    (account) => account.accountMode === 'live',
  );
  const staleLiveCount = scopedLiveAccounts.filter((account) =>
    isStaleSync(account.lastSyncedAt),
  ).length;
  const scopedSummary = {
    equity: scopedAccounts.reduce(
      (total, account) => total + account.snapshotEquity,
      0,
    ),
    available: scopedAccounts.reduce(
      (total, account) => total + account.availableBalance,
      0,
    ),
    wallet: scopedAccounts.reduce(
      (total, account) => total + account.walletBalance,
      0,
    ),
  };
  const grossNotional = selectedPositions.reduce(
    (sum, position) =>
      sum + (position.markPrice ?? position.entryPrice) * Math.abs(position.quantity),
    0,
  );
  const accountModeBreakdown = {
    live: scopedAccounts.filter((account) => account.accountMode === 'live').length,
    manual: scopedAccounts.filter((account) => account.accountMode === 'manual').length,
    import: scopedAccounts.filter((account) => account.accountMode === 'import').length,
  };
  const activeAccountOptions = manualAccounts.map((account) => ({
    value: account.id,
    label: `${account.name} · ${account.exchange.toUpperCase()}`,
  }));
  const selectedCaptureAccountId = positionForm.accountId || manualAccounts[0]?.id || '';
  const selectedCaptureAccount =
    manualAccounts.find((account) => account.id === selectedCaptureAccountId) ?? null;
  const captureExchange = selectedCaptureAccount?.exchange ?? positionForm.exchange;
  const marketBackedExchange =
    captureExchange === 'blofin' || captureExchange === 'hyperliquid'
      ? captureExchange
      : null;
  const exchangeBackedMarketsQuery = useQuery({
    queryKey: ['exchange-markets', marketBackedExchange],
    enabled:
      overlay === 'capture' &&
      captureOverlayTab === 'position' &&
      marketBackedExchange != null,
    queryFn: () => getExchangeMarkets(marketBackedExchange as SupportedLiveExchange),
    staleTime: 5 * 60_000,
  });
  const marketCatalog = exchangeBackedMarketsQuery.data ?? EMPTY_MARKETS;
  const filteredMarketCatalog = useMemo(() => {
    const query = positionForm.symbol.trim().toLowerCase();
    if (!query) {
      return marketCatalog.slice(0, 10);
    }

    return marketCatalog
      .filter((market) => {
        const haystack = [
          market.symbol,
          market.exchangeSymbol,
          market.baseAsset,
          market.quoteAsset,
          market.settleAsset,
        ]
          .filter(Boolean)
          .join(' ')
          .toLowerCase();
        return haystack.includes(query);
      })
      .slice(0, 10);
  }, [marketCatalog, positionForm.symbol]);
  const selectedExchangeMarket = useMemo(
    () =>
      marketCatalog.find((market) => {
        if (positionForm.exchangeSymbol) {
          return market.exchangeSymbol === positionForm.exchangeSymbol;
        }
        return market.symbol === positionForm.symbol;
      }) ?? null,
    [marketCatalog, positionForm.exchangeSymbol, positionForm.symbol],
  );
  const marketQuoteQuery = useQuery({
    queryKey: [
      'exchange-market-quote',
      marketBackedExchange,
      selectedExchangeMarket?.exchangeSymbol ?? positionForm.exchangeSymbol ?? null,
    ],
    enabled:
      overlay === 'capture' &&
      captureOverlayTab === 'position' &&
      marketBackedExchange != null &&
      Boolean(selectedExchangeMarket?.exchangeSymbol ?? positionForm.exchangeSymbol),
    queryFn: () =>
      getExchangeMarketQuote(
        marketBackedExchange as SupportedLiveExchange,
        (selectedExchangeMarket?.exchangeSymbol ?? positionForm.exchangeSymbol)!,
      ),
    refetchInterval: 15_000,
  });
  const liveQuotedMarkPrice =
    marketQuoteQuery.data?.markPrice ?? selectedExchangeMarket?.markPrice ?? null;
  const previewNotional = positionForm.quantity * positionForm.entryPrice;
  const previewMark =
    positionForm.markPrice ?? liveQuotedMarkPrice ?? positionForm.entryPrice;
  const previewPnl = computePnl(
    positionForm.side,
    positionForm.entryPrice,
    previewMark,
    positionForm.quantity,
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

  const workspaceStyle = {
    '--left-width': `${layout.left}px`,
    '--right-width': `${layout.right}px`,
    '--bottom-height': `${layout.bottom}px`,
  } as CSSProperties;

  const scopeSyncPending =
    selectedAccount?.accountMode === 'live'
      ? syncLiveMutation.isPending && syncLiveMutation.variables === selectedAccount.id
      : syncAllMutation.isPending;

  return (
    <div className={clsx('desk-shell', layout.denseRows && 'desk-shell-dense')}>
      <header className="desk-header">
        <div className="desk-brand">
          <span className="app-kicker">Cassini / Desk</span>
          <div className="desk-heading">
            <h1>Multi-exchange futures portfolio</h1>
            <span className="desk-badge">Portfolio workstation</span>
          </div>
          <p>Account-isolated futures monitoring with live and local books in one desk.</p>
        </div>

        <div className="desk-scope">
          <span className="toolbar-label">Scope</span>
          <strong>{scopeContext.label}</strong>
          <span>{scopeContext.detail}</span>
        </div>

        <div className="toolbar-actions">
          {liveAccounts.length > 0 ? (
            <button
              className="toolbar-button"
              disabled={syncAllMutation.isPending}
              onClick={() => syncAllMutation.mutate()}
            >
              {syncAllMutation.isPending ? (
                <LoaderCircle className="spin" size={16} />
              ) : (
                <RefreshCw size={16} />
              )}
              Sync live
            </button>
          ) : null}

          <button
            className="toolbar-button toolbar-button-strong"
            onClick={() => {
              setCaptureOverlayTab('position');
              setOverlay('capture');
            }}
          >
            <Plus size={16} />
            Add position
          </button>

          <button
            className="toolbar-button"
            onClick={() => {
              setAccountOverlayTab('live');
              setOverlay('account');
            }}
          >
            <WalletCards size={16} />
            Add account
          </button>

          <button className="toolbar-button" onClick={() => setOverlay('settings')}>
            <Settings2 size={16} />
            Settings
          </button>
        </div>
      </header>

      <section className="summary-ribbon">
        <TapeMetric
          icon={WalletCards}
          label="Equity"
          value={formatCurrency(scopedSummary.equity)}
          detail={`${scopedAccounts.length} scoped accounts`}
        />
        <TapeMetric
          icon={Activity}
          label="Open PnL"
          value={formatSignedCurrency(selectedPerformance.unrealizedPnl)}
          detail={`${selectedPositions.length} open legs`}
          tone={selectedPerformance.unrealizedPnl >= 0 ? 'positive' : 'negative'}
        />
        <TapeMetric
          icon={Radar}
          label="Gross notional"
          value={formatCurrency(grossNotional)}
          detail={`Heat ${formatPercent(estimateHeat(scopedSummary.equity, selectedPositions))}`}
        />
        <TapeMetric
          icon={ShieldCheck}
          label="Margin free"
          value={formatCurrency(scopedSummary.available)}
          detail={`Wallet ${formatCurrency(scopedSummary.wallet)}`}
        />
        <TapeMetric
          icon={Globe}
          label="LAN"
          value={lanStatus?.enabled ? 'On' : 'Off'}
          detail={lanStatus?.enabled ? 'Read-only projection' : 'Projection disabled'}
          tone={lanStatus?.enabled ? 'positive' : 'neutral'}
        />
        <TapeMetric
          icon={Link2}
          label="Sync health"
          value={`${staleLiveCount}`}
          detail={staleLiveCount > 0 ? 'stale live links' : 'no stale live links'}
          tone={staleLiveCount > 0 ? 'negative' : 'positive'}
        />
      </section>

      <div
        ref={workspaceRef}
        className={clsx(
          'workspace-grid',
          !layout.showInspector && 'workspace-grid-no-inspector',
        )}
        style={workspaceStyle}
      >
        <aside className="workspace-panel workspace-left">
          <PanelSection
            title="Scope matrix"
            meta={`${accounts.length} accounts loaded`}
            action={
              <button
                className={clsx('scope-chip', focusScope === 'portfolio' && 'scope-chip-active')}
                onClick={() => setFocusScope('portfolio')}
              >
                All portfolio
              </button>
            }
          >
            <label className="scope-search">
              <Search size={15} />
              <input
                value={scopeQuery}
                onChange={(event) => setScopeQuery(event.target.value)}
                placeholder="Filter accounts or exchanges"
              />
            </label>

            <div className="scope-list">
              {accountGroups.map((group) => {
                const exchangeScope = `exchange:${group.exchange}`;
                const liveCount = group.accounts.filter(
                  (account) => account.accountMode === 'live',
                ).length;
                return (
                  <div key={group.exchange} className="exchange-group">
                    <button
                      className={clsx(
                        'exchange-header',
                        focusScope === exchangeScope && 'exchange-header-active',
                      )}
                      onClick={() => setFocusScope(exchangeScope)}
                    >
                      <div>
                        <strong>{group.exchange.toUpperCase()}</strong>
                        <span>
                          {group.accounts.length} accounts · {liveCount} live
                        </span>
                      </div>
                      <span>{formatCurrency(group.totalEquity)}</span>
                    </button>

                    <div className="exchange-accounts">
                      {group.accounts.map((account) => (
                        <button
                          key={account.id}
                          className={clsx(
                            'account-node',
                            focusScope === account.id && 'account-node-active',
                          )}
                          onClick={() => setFocusScope(account.id)}
                        >
                          <div className="account-node-copy">
                            <strong>{account.name}</strong>
                            <span>
                              {account.accountMode.toUpperCase()} ·{' '}
                              {account.syncStatus.toUpperCase()}
                            </span>
                          </div>
                          <div className="account-node-metrics">
                            <strong>{formatCurrency(account.snapshotEquity)}</strong>
                            <span>{formatCurrency(account.availableBalance)} free</span>
                          </div>
                        </button>
                      ))}
                    </div>
                  </div>
                );
              })}

              {accountGroups.length === 0 ? (
                <CompactEmpty copy="No scoped accounts match the current filter." />
              ) : null}

              {accounts.length === 0 ? (
                <CompactEmpty copy="No accounts yet. Connect live or add a local book to activate the desk." />
              ) : null}
            </div>
          </PanelSection>

          {layout.showPulse ? (
            <PanelSection title="Desk pulse" meta="Operational single glance">
              <div className="mini-stat-grid">
                <MiniStat label="Live" value={`${accountModeBreakdown.live}`} />
                <MiniStat label="Manual" value={`${accountModeBreakdown.manual}`} />
                <MiniStat label="Imported" value={`${accountModeBreakdown.import}`} />
                <MiniStat label="History" value={`${selectedHistory.length} pts`} />
                <MiniStat label="Funding" value={`${selectedFundingEntries.length}`} />
                <MiniStat label="Sync jobs" value={`${selectedSyncJobs.length}`} />
              </div>
            </PanelSection>
          ) : null}

          <PanelSection title="Launch flows" meta="Layered actions">
            <div className="action-stack">
              <button
                className="action-button"
                onClick={() => {
                  setAccountOverlayTab('live');
                  setOverlay('account');
                }}
              >
                <Link2 size={16} />
                Connect live account
              </button>
              <button
                className="action-button"
                onClick={() => {
                  setAccountOverlayTab('local');
                  setOverlay('account');
                }}
              >
                <WalletCards size={16} />
                Add local account
              </button>
              <button
                className="action-button"
                onClick={() => {
                  setCaptureOverlayTab('position');
                  setOverlay('capture');
                }}
              >
                <Layers3 size={16} />
                Manual position
              </button>
              <button
                className="action-button"
                onClick={() => {
                  setCaptureOverlayTab('csv');
                  setOverlay('capture');
                }}
              >
                <FileSpreadsheet size={16} />
                Import CSV
              </button>
            </div>
          </PanelSection>
        </aside>

        <div
          className="resize-handle resize-handle-vertical"
          onPointerDown={() => setDragging('left')}
        />

        <section className="workspace-center">
          <section className="center-surface center-top-surface">
            <div className="surface-header">
              <div>
                <h2>{scopeContext.label}</h2>
                <p>{scopeContext.detail}</p>
              </div>
              <div className="surface-meta">
                <span className="surface-tag">
                  {selectedCluster ? `Focus ${selectedCluster.symbol}` : 'No symbol focus'}
                </span>
                <span className="surface-tag">
                  {latestHistoryPoint
                    ? `History ${formatRelativeAge(latestHistoryPoint.recordedAt)}`
                    : 'No persisted history'}
                </span>
              </div>
            </div>

            <div className="monitor-grid">
              <section className="monitor-board">
                <div className="board-toolbar">
                  <div className="board-toolbar-copy">
                    <strong>Position board</strong>
                    <span>Grouped by contract with account-isolated exposure kept intact.</span>
                  </div>
                  <div className="board-toolbar-tags">
                    <span className="surface-tag">{selectedPositions.length} legs</span>
                    <span className="surface-tag">
                      {selectedExposure.length} symbols
                    </span>
                  </div>
                </div>

                {focusClusters.length > 0 ? (
                  <div className="cluster-list">
                    {focusClusters.map((cluster) => {
                      const longShare = cluster.grossNotional
                        ? (cluster.longNotional / cluster.grossNotional) * 100
                        : 0;
                      const shortShare = cluster.grossNotional
                        ? (cluster.shortNotional / cluster.grossNotional) * 100
                        : 0;
                      return (
                        <button
                          key={cluster.symbol}
                          className={clsx(
                            'cluster-row',
                            focusedSymbol === cluster.symbol && 'cluster-row-active',
                          )}
                          onClick={() => setFocusedSymbol(cluster.symbol)}
                        >
                          <div className="cluster-copy">
                            <div>
                              <strong>{cluster.symbol}</strong>
                              <span>
                                {cluster.positionCount} legs · {cluster.accountIds.length}{' '}
                                accounts · {cluster.exchanges.length} venues
                              </span>
                            </div>
                            <div className="cluster-values">
                              <span>Gross {formatCurrency(cluster.grossNotional)}</span>
                              <span>
                                Avg lev {cluster.avgLeverage.toFixed(1)}x
                              </span>
                              <span
                                className={clsx(
                                  cluster.unrealizedPnl >= 0
                                    ? 'tone-positive'
                                    : 'tone-negative',
                                )}
                              >
                                {formatSignedCurrency(cluster.unrealizedPnl)}
                              </span>
                            </div>
                          </div>
                          <div className="cluster-bias">
                            <span className="tone-positive">
                              Long {formatCurrency(cluster.longNotional)}
                            </span>
                            <div className="cluster-bar">
                              <div
                                className="cluster-bar-long"
                                style={{ width: `${longShare}%` }}
                              />
                              <div
                                className="cluster-bar-short"
                                style={{ width: `${shortShare}%` }}
                              />
                            </div>
                            <span className="tone-negative">
                              Short {formatCurrency(cluster.shortNotional)}
                            </span>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                ) : (
                  <LaunchPad
                    onAddAccount={() => {
                      setAccountOverlayTab('live');
                      setOverlay('account');
                    }}
                    onImportCsv={() => {
                      setCaptureOverlayTab('csv');
                      setOverlay('capture');
                    }}
                    onAddPosition={() => {
                      setCaptureOverlayTab('position');
                      setOverlay('capture');
                    }}
                  />
                )}
              </section>

              <aside className="monitor-side">
                <SignalPanel
                  title="Equity trace"
                  meta={
                    latestHistoryPoint
                      ? describeHistoryWindow(selectedHistory)
                      : 'Awaiting persisted history'
                  }
                >
                  {selectedHistory.length > 0 ? (
                    <>
                      <div className="history-headline">
                        <strong>{formatCurrency(latestHistoryPoint?.equity ?? 0)}</strong>
                        <span
                          className={clsx(
                            historyDelta(selectedHistory) >= 0
                              ? 'tone-positive'
                              : 'tone-negative',
                          )}
                        >
                          {formatSignedCurrency(historyDelta(selectedHistory))}
                        </span>
                      </div>
                      <Sparkline
                        points={selectedHistory.map((point) => point.equity)}
                        tone={historyTone(selectedHistory)}
                        label="Equity history"
                        dense={false}
                      />
                      <div className="signal-stat-grid">
                        <MetricTile
                          label="Range"
                          value={formatCurrency(historyRange(selectedHistory))}
                        />
                        <MetricTile
                          label="Points"
                          value={`${selectedHistory.length}`}
                        />
                      </div>
                    </>
                  ) : (
                    <CompactEmpty copy="History appears after sync or local balance events persist." />
                  )}
                </SignalPanel>

                <SignalPanel
                  title="Exposure ladder"
                  meta="Top contracts by net portfolio pressure"
                >
                  <div className="ladder-list">
                    {selectedExposure.slice(0, 5).map((row) => {
                      const absoluteMax =
                        Math.max(...selectedExposure.map((item) => Math.abs(item.netNotional))) ||
                        1;
                      return (
                        <button
                          key={row.symbol}
                          className={clsx(
                            'ladder-row',
                            focusedSymbol === row.symbol && 'ladder-row-active',
                          )}
                          onClick={() => setFocusedSymbol(row.symbol)}
                        >
                          <div>
                            <strong>{row.symbol}</strong>
                            <span>{row.accountIds.length} accounts linked</span>
                          </div>
                          <div className="ladder-visual">
                            <span
                              className={clsx(
                                row.netNotional >= 0 ? 'tone-positive' : 'tone-negative',
                              )}
                            >
                              {formatSignedCurrency(row.netNotional)}
                            </span>
                            <div className="ladder-bar">
                              <div
                                className={clsx(
                                  'ladder-bar-fill',
                                  row.netNotional >= 0
                                    ? 'ladder-bar-fill-positive'
                                    : 'ladder-bar-fill-negative',
                                )}
                                style={{
                                  width: `${(Math.abs(row.netNotional) / absoluteMax) * 100}%`,
                                }}
                              />
                            </div>
                          </div>
                        </button>
                      );
                    })}
                    {selectedExposure.length === 0 ? (
                      <CompactEmpty copy="Exposure appears once positions exist." />
                    ) : null}
                  </div>
                </SignalPanel>

                <SignalPanel title="Activity lane" meta="Funding and sync snapshots">
                  <div className="activity-stack">
                    {selectedSyncJobs.slice(0, 3).map((job) => (
                      <div key={job.id} className="activity-row">
                        <div>
                          <strong>{job.accountName}</strong>
                          <span>{formatRelativeAge(job.startedAt)}</span>
                        </div>
                        <span className={clsx('status-pill', `status-${job.state}`)}>
                          {job.state}
                        </span>
                      </div>
                    ))}
                    {selectedFundingEntries.slice(0, 3).map((entry) => (
                      <div key={entry.id} className="activity-row">
                        <div>
                          <strong>{entry.symbol}</strong>
                          <span>{entry.accountName}</span>
                        </div>
                        <span
                          className={clsx(
                            entry.rate >= 0 ? 'tone-positive' : 'tone-negative',
                          )}
                        >
                          {(entry.rate * 100).toFixed(4)}%
                        </span>
                      </div>
                    ))}
                    {selectedSyncJobs.length === 0 && selectedFundingEntries.length === 0 ? (
                      <CompactEmpty copy="No recent sync or funding events for the current scope." />
                    ) : null}
                  </div>
                </SignalPanel>
              </aside>
            </div>
          </section>

          <div
            className="resize-handle resize-handle-horizontal"
            onPointerDown={() => setDragging('bottom')}
          />

          <section className="center-surface center-bottom-surface">
            <div className="surface-header surface-header-tabs">
              <div className="tab-strip" role="tablist" aria-label="Workspace data">
                {(['positions', 'exposure', 'funding', 'sync', 'history'] as const).map(
                  (tab) => (
                    <button
                      key={tab}
                      className={clsx('tab-button', activeTab === tab && 'tab-button-active')}
                      onClick={() => setActiveTab(tab)}
                    >
                      {tab}
                    </button>
                  ),
                )}
              </div>

              <div className="surface-meta">
                <button
                  className="toolbar-icon"
                  onClick={() =>
                    setStoredLayout((current) => ({
                      ...current,
                      showInspector: !layout.showInspector,
                    }))
                  }
                  title={layout.showInspector ? 'Hide inspector' : 'Show inspector'}
                >
                  {layout.showInspector ? (
                    <PanelLeftClose size={16} />
                  ) : (
                    <PanelLeftOpen size={16} />
                  )}
                </button>
              </div>
            </div>

            {activeTab === 'positions' ? (
              <PositionsPane
                positions={selectedPositions}
                focusedSymbol={focusedSymbol}
                onSelectSymbol={setFocusedSymbol}
                emptyCopy="Create an account, enter a position, or import a CSV to establish live portfolio state."
              />
            ) : null}

            {activeTab === 'exposure' ? (
              <ExposurePane
                rows={selectedExposure}
                focusedSymbol={focusedSymbol}
                onSelectSymbol={setFocusedSymbol}
                emptyCopy="Exposure appears once positions exist."
              />
            ) : null}

            {activeTab === 'funding' ? (
              <FundingPane
                entries={selectedFundingEntries}
                emptyCopy="Funding snapshots appear after live exchange sync completes."
              />
            ) : null}

            {activeTab === 'sync' ? (
              <SyncPane
                jobs={selectedSyncJobs}
                emptyCopy="Live sync history will appear here once connected accounts refresh."
              />
            ) : null}

            {activeTab === 'history' ? (
              <HistoryPane
                points={selectedHistory}
                emptyCopy="No persisted balance history exists for the current scope yet."
              />
            ) : null}
          </section>
        </section>

        {layout.showInspector ? (
          <>
            <div
              className="resize-handle resize-handle-vertical"
              onPointerDown={() => setDragging('right')}
            />

            <aside className="workspace-panel workspace-right">
              <InspectorPanel
                scope={scopeContext}
                selectedCluster={selectedCluster}
                summary={scopedSummary}
                performance={selectedPerformance}
                history={selectedHistory}
                fundingEntries={selectedFundingEntries}
                jobs={selectedSyncJobs}
                staleLiveCount={staleLiveCount}
                lanEnabled={Boolean(lanStatus?.enabled)}
                onSync={
                  selectedAccount?.accountMode === 'live'
                    ? () => syncLiveMutation.mutate(selectedAccount.id)
                    : liveAccounts.length > 0
                      ? () => syncAllMutation.mutate()
                      : undefined
                }
                syncPending={scopeSyncPending}
                onOpenSettings={() => setOverlay('settings')}
                onToggleLan={() => lanMutation.mutate(!lanStatus?.enabled)}
                lanPending={lanMutation.isPending}
              />
            </aside>
          </>
        ) : null}
      </div>

      {overlay === 'account' ? (
        <OverlayShell
          title="Account overlay"
          subtitle="Read-only live links and local books stay layered, not pinned into the desk."
          onClose={() => setOverlay(null)}
        >
          <div className="overlay-tab-row">
            <button
              className={clsx(
                'overlay-tab',
                accountOverlayTab === 'live' && 'overlay-tab-active',
              )}
              onClick={() => setAccountOverlayTab('live')}
            >
              Live read-only
            </button>
            <button
              className={clsx(
                'overlay-tab',
                accountOverlayTab === 'local' && 'overlay-tab-active',
              )}
              onClick={() => setAccountOverlayTab('local')}
            >
              Local / import
            </button>
          </div>

          {accountOverlayTab === 'live' ? (
            <LiveAccountForm
              form={liveAccountForm}
              liveAccountsCount={liveAccounts.length}
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
          title="Capture overlay"
          subtitle="Manual positions and imported rows now enter through layered capture flows."
          onClose={() => setOverlay(null)}
        >
          <div className="overlay-tab-row">
            <button
              className={clsx(
                'overlay-tab',
                captureOverlayTab === 'position' && 'overlay-tab-active',
              )}
              onClick={() => setCaptureOverlayTab('position')}
            >
              Manual position
            </button>
            <button
              className={clsx(
                'overlay-tab',
                captureOverlayTab === 'csv' && 'overlay-tab-active',
              )}
              onClick={() => setCaptureOverlayTab('csv')}
            >
              CSV import
            </button>
          </div>

          {captureOverlayTab === 'position' ? (
            <ManualPositionForm
              activeAccountOptions={activeAccountOptions}
              selectedAccount={selectedCaptureAccount}
              selectedAccountId={selectedCaptureAccountId}
              marketBackedExchange={marketBackedExchange}
              availableMarkets={filteredMarketCatalog}
              selectedMarket={selectedExchangeMarket}
              marketQuote={marketQuoteQuery.data ?? null}
              marketCatalogPending={exchangeBackedMarketsQuery.isPending}
              marketQuotePending={marketQuoteQuery.isPending}
              previewNotional={previewNotional}
              previewPnl={previewPnl}
              previewMark={previewMark}
              form={positionForm}
              pending={addPositionMutation.isPending}
              onChange={setPositionForm}
              onSelectMarket={(market) =>
                setPositionForm((current) => ({
                  ...current,
                  exchange: market.exchange,
                  exchangeSymbol: market.exchangeSymbol,
                  symbol: market.symbol,
                  leverage: market.maxLeverage
                    ? Math.min(Math.max(current.leverage, 1), market.maxLeverage)
                    : current.leverage,
                  markPrice: undefined,
                }))
              }
              onSave={() =>
                addPositionMutation.mutate({
                  ...positionForm,
                  accountId: selectedCaptureAccountId,
                  exchange:
                    selectedCaptureAccount?.exchange ?? positionForm.exchange,
                  markPrice: positionForm.markPrice ?? liveQuotedMarkPrice ?? undefined,
                })
              }
            />
          ) : (
            <CsvImportForm
              activeAccountOptions={activeAccountOptions}
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

      {overlay === 'settings' ? (
        <SettingsDrawer
          layout={layout}
          onClose={() => setOverlay(null)}
          onChange={setStoredLayout}
          onReset={() => setStoredLayout(DEFAULT_LAYOUT)}
        />
      ) : null}
    </div>
  );
}

function TapeMetric({
  icon: Icon,
  label,
  value,
  detail,
  tone = 'neutral',
}: {
  icon: typeof ShieldCheck;
  label: string;
  value: string;
  detail: string;
  tone?: 'neutral' | 'positive' | 'negative';
}) {
  return (
    <article className={clsx('tape-card', `tape-${tone}`)}>
      <div className="tape-topline">
        <Icon size={13} />
        <span>{label}</span>
      </div>
      <strong>{value}</strong>
      <p>{detail}</p>
    </article>
  );
}

function PanelSection({
  title,
  meta,
  action,
  children,
}: {
  title: string;
  meta?: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="panel-section">
      <div className="panel-section-header">
        <div>
          <h2>{title}</h2>
          {meta ? <p>{meta}</p> : null}
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

function SignalPanel({
  title,
  meta,
  children,
}: {
  title: string;
  meta: string;
  children: ReactNode;
}) {
  return (
    <section className="signal-panel">
      <div className="signal-panel-header">
        <strong>{title}</strong>
        <span>{meta}</span>
      </div>
      {children}
    </section>
  );
}

function LaunchPad({
  onAddAccount,
  onImportCsv,
  onAddPosition,
}: {
  onAddAccount: () => void;
  onImportCsv: () => void;
  onAddPosition: () => void;
}) {
  return (
    <div className="launch-pad">
      <div className="launch-pad-copy">
        <strong>Board idle</strong>
        <p>Populate the desk with live links, imported snapshots, or manual futures legs.</p>
      </div>
      <div className="launch-pad-actions">
        <button className="action-button" onClick={onAddAccount}>
          <Link2 size={16} />
          Connect live account
        </button>
        <button className="action-button" onClick={onImportCsv}>
          <FileSpreadsheet size={16} />
          Import CSV
        </button>
        <button className="action-button" onClick={onAddPosition}>
          <Layers3 size={16} />
          Manual position
        </button>
      </div>
    </div>
  );
}

function CompactEmpty({ copy }: { copy: string }) {
  return (
    <div className="compact-empty">
      <p>{copy}</p>
    </div>
  );
}

function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="mini-stat">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function MetricTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="metric-tile">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function PositionsPane({
  positions,
  focusedSymbol,
  onSelectSymbol,
  emptyCopy,
}: {
  positions: PortfolioPosition[];
  focusedSymbol: string | null;
  onSelectSymbol: (symbol: string) => void;
  emptyCopy: string;
}) {
  return (
    <div className="table-shell">
      <table className="data-table">
        <thead>
          <tr>
            <th>Exchange</th>
            <th>Account</th>
            <th>Symbol</th>
            <th>Side</th>
            <th>Qty</th>
            <th>Lev</th>
            <th>Entry</th>
            <th>Mark</th>
            <th>Notional</th>
            <th>PnL</th>
          </tr>
        </thead>
        <tbody>
          {positions.map((position) => {
            const notional =
              (position.markPrice ?? position.entryPrice) * Math.abs(position.quantity);
            return (
              <tr
                key={position.id}
                className={clsx(
                  focusedSymbol === position.symbol && 'data-row-active',
                )}
                onClick={() => onSelectSymbol(position.symbol)}
              >
                <td>{position.exchange.toUpperCase()}</td>
                <td>{position.accountName}</td>
                <td>{position.symbol}</td>
                <td
                  className={clsx(
                    position.side === 'long' ? 'tone-positive' : 'tone-negative',
                  )}
                >
                  {position.side.toUpperCase()}
                </td>
                <td>{position.quantity.toFixed(4)}</td>
                <td>{position.leverage.toFixed(1)}x</td>
                <td>{formatCurrency(position.entryPrice)}</td>
                <td>{formatCurrency(position.markPrice ?? position.entryPrice)}</td>
                <td>{formatCurrency(notional)}</td>
                <td
                  className={clsx(
                    position.unrealizedPnl >= 0 ? 'tone-positive' : 'tone-negative',
                  )}
                >
                  {formatSignedCurrency(position.unrealizedPnl)}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      {positions.length === 0 ? (
        <div className="empty-state">
          <ArrowUpRight size={18} />
          <p>{emptyCopy}</p>
        </div>
      ) : null}
    </div>
  );
}

function ExposurePane({
  rows,
  focusedSymbol,
  onSelectSymbol,
  emptyCopy,
}: {
  rows: ExposureRow[];
  focusedSymbol: string | null;
  onSelectSymbol: (symbol: string) => void;
  emptyCopy: string;
}) {
  const absoluteMax = Math.max(...rows.map((row) => Math.abs(row.netNotional)), 1);

  return (
    <div className="list-shell">
      {rows.map((row) => (
        <button
          key={row.symbol}
          className={clsx('list-row', focusedSymbol === row.symbol && 'list-row-active')}
          onClick={() => onSelectSymbol(row.symbol)}
        >
          <div>
            <strong>{row.symbol}</strong>
            <span>{row.accountIds.length} linked accounts</span>
          </div>
          <div className="list-row-body">
            <div className="list-row-metrics">
              <span>Long {formatCurrency(row.longNotional)}</span>
              <span>Short {formatCurrency(row.shortNotional)}</span>
              <span
                className={clsx(
                  row.netNotional >= 0 ? 'tone-positive' : 'tone-negative',
                )}
              >
                Net {formatSignedCurrency(row.netNotional)}
              </span>
            </div>
            <div className="row-bar">
              <div
                className={clsx(
                  'row-bar-fill',
                  row.netNotional >= 0
                    ? 'row-bar-fill-positive'
                    : 'row-bar-fill-negative',
                )}
                style={{ width: `${(Math.abs(row.netNotional) / absoluteMax) * 100}%` }}
              />
            </div>
          </div>
        </button>
      ))}
      {rows.length === 0 ? <CompactEmpty copy={emptyCopy} /> : null}
    </div>
  );
}

function FundingPane({
  entries,
  emptyCopy,
}: {
  entries: FundingHistoryEntry[];
  emptyCopy: string;
}) {
  return (
    <div className="list-shell">
      {entries.map((entry) => (
        <div key={entry.id} className="list-row">
          <div>
            <strong>{entry.symbol}</strong>
            <span>
              {entry.accountName} · due {formatDateTime(entry.fundingTime)}
            </span>
          </div>
          <div className="list-row-metrics">
            <span className={clsx(entry.rate >= 0 ? 'tone-positive' : 'tone-negative')}>
              {entry.rate >= 0 ? '+' : ''}
              {(entry.rate * 100).toFixed(4)}%
            </span>
            <span>captured {formatRelativeAge(entry.recordedAt)}</span>
          </div>
        </div>
      ))}
      {entries.length === 0 ? <CompactEmpty copy={emptyCopy} /> : null}
    </div>
  );
}

function SyncPane({
  jobs,
  emptyCopy,
}: {
  jobs: SyncJobRecord[];
  emptyCopy: string;
}) {
  return (
    <div className="list-shell">
      {jobs.map((job) => (
        <div key={job.id} className="list-row">
          <div>
            <strong>{job.accountName}</strong>
            <span>
              {job.exchange.toUpperCase()} · {formatRelativeAge(job.startedAt)}
            </span>
          </div>
          <div className="list-row-metrics sync-job-metrics">
            <span className={clsx('status-pill', `status-${job.state}`)}>
              {job.state}
            </span>
            <span>{job.syncedPositions} positions</span>
            <span>{job.fundingEntries} funding rows</span>
            <span>{job.attemptCount} attempts</span>
          </div>
          {job.errorMessage ? <p className="account-error">{job.errorMessage}</p> : null}
        </div>
      ))}
      {jobs.length === 0 ? <CompactEmpty copy={emptyCopy} /> : null}
    </div>
  );
}

function HistoryPane({
  points,
  emptyCopy,
}: {
  points: BalanceHistoryPoint[];
  emptyCopy: string;
}) {
  const rows = points
    .slice()
    .sort(
      (left, right) =>
        new Date(right.recordedAt).getTime() - new Date(left.recordedAt).getTime(),
    );

  return (
    <div className="table-shell">
      <table className="data-table">
        <thead>
          <tr>
            <th>Recorded</th>
            <th>Balance</th>
            <th>Equity</th>
            <th>Delta</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((point, index) => {
            const previous = rows[index + 1];
            const delta = previous ? point.equity - previous.equity : 0;
            return (
              <tr key={`${point.recordedAt}-${index}`}>
                <td>{formatDateTime(point.recordedAt)}</td>
                <td>{formatCurrency(point.balance)}</td>
                <td>{formatCurrency(point.equity)}</td>
                <td className={clsx(delta >= 0 ? 'tone-positive' : 'tone-negative')}>
                  {index === rows.length - 1 ? 'baseline' : formatSignedCurrency(delta)}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      {points.length === 0 ? (
        <div className="empty-state">
          <ArrowUpRight size={18} />
          <p>{emptyCopy}</p>
        </div>
      ) : null}
    </div>
  );
}

function InspectorPanel({
  scope,
  selectedCluster,
  summary,
  performance,
  history,
  fundingEntries,
  jobs,
  staleLiveCount,
  lanEnabled,
  onSync,
  syncPending,
  onOpenSettings,
  onToggleLan,
  lanPending,
}: {
  scope: ScopeContext;
  selectedCluster: FocusCluster | null;
  summary: {
    equity: number;
    available: number;
    wallet: number;
  };
  performance: PerformanceMetrics;
  history: BalanceHistoryPoint[];
  fundingEntries: FundingHistoryEntry[];
  jobs: SyncJobRecord[];
  staleLiveCount: number;
  lanEnabled: boolean;
  onSync?: () => void;
  syncPending: boolean;
  onOpenSettings: () => void;
  onToggleLan: () => void;
  lanPending: boolean;
}) {
  const latestPoint = history[history.length - 1] ?? null;

  return (
    <div className="inspector-stack">
      <PanelSection
        title="Scope detail"
        meta={scope.kind.toUpperCase()}
        action={
          onSync ? (
            <button className="scope-chip" disabled={syncPending} onClick={onSync}>
              {syncPending ? <LoaderCircle className="spin" size={14} /> : <RefreshCw size={14} />}
              Sync
            </button>
          ) : null
        }
      >
        <div className="inspector-card">
          <div className="inspector-row">
            <span>Name</span>
            <strong>{scope.label}</strong>
          </div>
          <div className="inspector-row">
            <span>Equity</span>
            <strong>{formatCurrency(summary.equity)}</strong>
          </div>
          <div className="inspector-row">
            <span>Available</span>
            <strong>{formatCurrency(summary.available)}</strong>
          </div>
          <div className="inspector-row">
            <span>Wallet</span>
            <strong>{formatCurrency(summary.wallet)}</strong>
          </div>
          <div className="inspector-row">
            <span>History</span>
            <strong>{latestPoint ? formatRelativeAge(latestPoint.recordedAt) : 'No history'}</strong>
          </div>
        </div>
      </PanelSection>

      <PanelSection title="Focused market" meta={selectedCluster?.symbol ?? 'No symbol selected'}>
        {selectedCluster ? (
          <div className="inspector-card">
            <div className="inspector-row">
              <span>Gross</span>
              <strong>{formatCurrency(selectedCluster.grossNotional)}</strong>
            </div>
            <div className="inspector-row">
              <span>Net</span>
              <strong
                className={clsx(
                  selectedCluster.netNotional >= 0 ? 'tone-positive' : 'tone-negative',
                )}
              >
                {formatSignedCurrency(selectedCluster.netNotional)}
              </strong>
            </div>
            <div className="inspector-row">
              <span>Avg leverage</span>
              <strong>{selectedCluster.avgLeverage.toFixed(1)}x</strong>
            </div>
            <div className="inspector-row">
              <span>Open PnL</span>
              <strong
                className={clsx(
                  selectedCluster.unrealizedPnl >= 0 ? 'tone-positive' : 'tone-negative',
                )}
              >
                {formatSignedCurrency(selectedCluster.unrealizedPnl)}
              </strong>
            </div>
            <div className="inspector-row">
              <span>Accounts</span>
              <strong>{selectedCluster.accountIds.length}</strong>
            </div>
          </div>
        ) : (
          <CompactEmpty copy="Pick a contract from the board or ledger to keep symbol detail in view." />
        )}
      </PanelSection>

      <PanelSection title="Performance" meta="Derived from stored positions">
        <div className="mini-stat-grid">
          <MiniStat label="Realized" value={formatSignedCurrency(performance.realizedPnl)} />
          <MiniStat
            label="Unrealized"
            value={formatSignedCurrency(performance.unrealizedPnl)}
          />
          <MiniStat label="Win rate" value={formatPercent(performance.winRate)} />
          <MiniStat label="Fee drag" value={formatCurrency(performance.feeDrag)} />
        </div>
      </PanelSection>

      <PanelSection title="Ops" meta="Health, LAN, and workspace controls">
        <div className="inspector-card">
          <div className="inspector-row">
            <span>Recent sync jobs</span>
            <strong>{jobs.length}</strong>
          </div>
          <div className="inspector-row">
            <span>Funding rows</span>
            <strong>{fundingEntries.length}</strong>
          </div>
          <div className="inspector-row">
            <span>Stale live links</span>
            <strong>{staleLiveCount}</strong>
          </div>
          <div className="inspector-row">
            <span>LAN mode</span>
            <strong>{lanEnabled ? 'Enabled' : 'Disabled'}</strong>
          </div>
        </div>
        <div className="action-stack">
          <button className="action-button" onClick={onOpenSettings}>
            <Settings2 size={16} />
            Open workspace settings
          </button>
          <button className="action-button" disabled={lanPending} onClick={onToggleLan}>
            {lanPending ? <LoaderCircle className="spin" size={16} /> : <Globe size={16} />}
            {lanEnabled ? 'Disable LAN mode' : 'Enable LAN mode'}
          </button>
        </div>
      </PanelSection>
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
    <div className="overlay-backdrop" onClick={onClose}>
      <div className="overlay-shell" onClick={(event) => event.stopPropagation()}>
        <div className="overlay-header">
          <div>
            <h2>{title}</h2>
            <p>{subtitle}</p>
          </div>
          <button className="toolbar-icon" onClick={onClose}>
            <span aria-hidden="true">×</span>
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

function SettingsDrawer({
  layout,
  onClose,
  onChange,
  onReset,
}: {
  layout: LayoutState;
  onClose: () => void;
  onChange: Dispatch<SetStateAction<LayoutState>>;
  onReset: () => void;
}) {
  return (
    <div className="overlay-backdrop overlay-backdrop-drawer" onClick={onClose}>
      <aside className="settings-drawer" onClick={(event) => event.stopPropagation()}>
        <div className="overlay-header">
          <div>
            <h2>Workspace settings</h2>
            <p>Layout memory, panel density, and desk chrome stay local to this machine.</p>
          </div>
          <button className="toolbar-icon" onClick={onClose}>
            <span aria-hidden="true">×</span>
          </button>
        </div>

        <div className="settings-stack">
          <label className="settings-field">
            <span>Left rail width</span>
            <input
              type="range"
              min={260}
              max={420}
              value={layout.left}
              onChange={(event) =>
                onChange((current) => ({
                  ...current,
                  left: Number(event.target.value),
                }))
              }
            />
            <strong>{layout.left}px</strong>
          </label>

          <label className="settings-field">
            <span>Ops rail width</span>
            <input
              type="range"
              min={300}
              max={460}
              value={layout.right}
              onChange={(event) =>
                onChange((current) => ({
                  ...current,
                  right: Number(event.target.value),
                }))
              }
            />
            <strong>{layout.right}px</strong>
          </label>

          <label className="settings-field">
            <span>Ledger height</span>
            <input
              type="range"
              min={236}
              max={420}
              value={layout.bottom}
              onChange={(event) =>
                onChange((current) => ({
                  ...current,
                  bottom: Number(event.target.value),
                }))
              }
            />
            <strong>{layout.bottom}px</strong>
          </label>

          <label className="settings-toggle">
            <input
              type="checkbox"
              checked={layout.showInspector}
              onChange={(event) =>
                onChange((current) => ({
                  ...current,
                  showInspector: event.target.checked,
                }))
              }
            />
            <span>Show right ops rail</span>
          </label>

          <label className="settings-toggle">
            <input
              type="checkbox"
              checked={layout.showPulse}
              onChange={(event) =>
                onChange((current) => ({
                  ...current,
                  showPulse: event.target.checked,
                }))
              }
            />
            <span>Show pulse stats in left rail</span>
          </label>

          <label className="settings-toggle">
            <input
              type="checkbox"
              checked={layout.denseRows}
              onChange={(event) =>
                onChange((current) => ({
                  ...current,
                  denseRows: event.target.checked,
                }))
              }
            />
            <span>Use compact terminal density</span>
          </label>

          <button className="toolbar-button toolbar-button-wide" onClick={onReset}>
            Reset layout
          </button>
        </div>
      </aside>
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
    <div className="overlay-body">
      <div className="field-grid">
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

      <div className="field-grid">
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
        <div className="field-grid">
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

      <div className="button-row">
        <button
          className="toolbar-button"
          disabled={validatePending || form.name.trim().length === 0}
          onClick={onValidate}
        >
          {validatePending ? (
            <LoaderCircle className="spin" size={16} />
          ) : (
            <Link2 size={16} />
          )}
          Validate
        </button>

        <button
          className="toolbar-button toolbar-button-strong"
          disabled={createPending || form.name.trim().length === 0}
          onClick={onCreate}
        >
          {createPending ? (
            <LoaderCircle className="spin" size={16} />
          ) : (
            <Radar size={16} />
          )}
          Connect and sync
        </button>

        {liveAccountsCount > 0 ? (
          <button
            className="toolbar-button"
            disabled={syncAllPending}
            onClick={onSyncAll}
          >
            {syncAllPending ? (
              <LoaderCircle className="spin" size={16} />
            ) : (
              <RefreshCw size={16} />
            )}
            Sync all live
          </button>
        ) : null}
      </div>

      {validation ? (
        <div className="inline-banner">
          {validation.exchange.toUpperCase()} validated for{' '}
          <strong>{validation.externalReference}</strong>. Equity{' '}
          <strong>{formatCurrency(validation.snapshotEquity)}</strong>, available{' '}
          <strong>{formatCurrency(validation.availableBalance)}</strong>, open positions{' '}
          <strong>{validation.openPositions}</strong>.
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
    <div className="overlay-body">
      <div className="field-grid">
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

      <div className="field-grid">
        <Field label="Wallet balance (USDT)">
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
            placeholder="Risk bucket, desk purpose, funding notes"
          />
        </Field>
      </div>

      <button
        className="toolbar-button toolbar-button-strong toolbar-button-wide"
        disabled={pending || form.name.trim().length === 0}
        onClick={onCreate}
      >
        <Plus size={16} />
        Add account
      </button>
    </div>
  );
}

function ManualPositionForm({
  activeAccountOptions,
  selectedAccount,
  selectedAccountId,
  marketBackedExchange,
  availableMarkets,
  selectedMarket,
  marketQuote,
  marketCatalogPending,
  marketQuotePending,
  previewNotional,
  previewPnl,
  previewMark,
  form,
  pending,
  onChange,
  onSelectMarket,
  onSave,
}: {
  activeAccountOptions: Array<{ value: string; label: string }>;
  selectedAccount: ExchangeAccount | null;
  selectedAccountId: string;
  marketBackedExchange: SupportedLiveExchange | null;
  availableMarkets: ExchangeMarket[];
  selectedMarket: ExchangeMarket | null;
  marketQuote: MarketQuote | null;
  marketCatalogPending: boolean;
  marketQuotePending: boolean;
  previewNotional: number;
  previewPnl: number;
  previewMark: number;
  form: ManualPositionInput;
  pending: boolean;
  onChange: Dispatch<SetStateAction<ManualPositionInput>>;
  onSelectMarket: (market: ExchangeMarket) => void;
  onSave: () => void;
}) {
  const [step, setStep] = useState<CaptureStep>('contract');

  return (
    <div className="overlay-body capture-layout">
      <aside className="capture-sidebar">
        <div className="capture-sidebar-copy">
          <strong>Manual futures capture</strong>
          <p>Layered entry flow until exchange-backed symbol and mark bridges land.</p>
        </div>

        <div className="capture-step-list">
          {(['contract', 'economics', 'review'] as const).map((item) => (
            <button
              key={item}
              className={clsx('capture-step', step === item && 'capture-step-active')}
              onClick={() => setStep(item)}
            >
              <span>{item}</span>
            </button>
          ))}
        </div>

        <div className="capture-note">
          <span>Account base</span>
          <strong>{selectedAccount?.exchange.toUpperCase() ?? 'MANUAL'}</strong>
          <p>
            {marketBackedExchange
              ? 'This account can now pull real exchange markets and live mark snapshots.'
              : 'This account is still pure local/manual, so market lookup and liq math remain explicit.'}
          </p>
        </div>
      </aside>

      <div className="capture-main">
        {step === 'contract' ? (
          <>
            <div className="field-grid field-grid-3">
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

              <Field label="Symbol">
                <input
                  value={form.symbol}
                  onChange={(event) =>
                    onChange((current) => ({
                      ...current,
                      exchangeSymbol: undefined,
                      symbol: event.target.value.toUpperCase(),
                      exchange: selectedAccount?.exchange ?? current.exchange,
                    }))
                  }
                  placeholder="BTCUSDT"
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
            </div>

            {marketBackedExchange ? (
              <div className="market-browser">
                <div className="market-browser-header">
                  <strong>
                    {marketCatalogPending ? 'Loading market catalog' : 'Exchange market catalog'}
                  </strong>
                  <span>{availableMarkets.length} matches</span>
                </div>

                <div className="market-results">
                  {availableMarkets.map((market) => (
                    <button
                      key={market.exchangeSymbol}
                      className={clsx(
                        'market-result',
                        selectedMarket?.exchangeSymbol === market.exchangeSymbol &&
                          'market-result-active',
                      )}
                      onClick={() => onSelectMarket(market)}
                    >
                      <div>
                        <strong>{market.exchangeSymbol}</strong>
                        <span>
                          {market.contractType} · max{' '}
                          {market.maxLeverage ? `${market.maxLeverage}x` : 'n/a'}
                        </span>
                      </div>
                      <div className="market-result-meta">
                        <span>{market.symbol}</span>
                        <span>
                          step {market.quantityStep ?? 'n/a'} / tick{' '}
                          {market.priceTickSize ?? 'n/a'}
                        </span>
                      </div>
                    </button>
                  ))}

                  {!marketCatalogPending && availableMarkets.length === 0 ? (
                    <CompactEmpty copy="No exchange markets match the current symbol search." />
                  ) : null}
                </div>
              </div>
            ) : null}

            <div className="field-grid field-grid-3">
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
                  placeholder="Desk thesis, hedge note, import tag"
                />
              </Field>
            </div>
          </>
        ) : null}

        {step === 'economics' ? (
          <>
            <div className="field-grid field-grid-3">
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
                  value={form.markPrice ?? marketQuote?.markPrice ?? ''}
                  onChange={(event) =>
                    onChange((current) => ({
                      ...current,
                      markPrice: event.target.value
                        ? Number(event.target.value)
                        : undefined,
                    }))
                  }
                  placeholder={
                    marketBackedExchange
                      ? 'Auto-filled from live quote, editable locally'
                      : 'Manual local snapshot'
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

            <div className="field-grid field-grid-2">
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

              {marketBackedExchange ? (
                <div className="quote-card">
                  <div className="quote-card-header">
                    <strong>
                      {selectedMarket?.exchangeSymbol ??
                        form.exchangeSymbol ??
                        'Select exchange market'}
                    </strong>
                    <span>{marketQuotePending ? 'Refreshing quote' : 'Live market snapshot'}</span>
                  </div>
                  <div className="quote-card-grid">
                    <MetricTile
                      label="Mark"
                      value={
                        marketQuote?.markPrice != null
                          ? formatCurrency(marketQuote.markPrice)
                          : 'n/a'
                      }
                    />
                    <MetricTile
                      label="Oracle"
                      value={
                        marketQuote?.oraclePrice != null
                          ? formatCurrency(marketQuote.oraclePrice)
                          : 'n/a'
                      }
                    />
                    <MetricTile
                      label="Funding"
                      value={
                        marketQuote?.fundingRate != null
                          ? `${(marketQuote.fundingRate * 100).toFixed(4)}%`
                          : 'n/a'
                      }
                    />
                  </div>
                </div>
              ) : (
                <div className="inline-banner">
                  This account base is not connected to a live exchange catalog, so mark and
                  funding remain local/manual in this flow.
                </div>
              )}
            </div>
          </>
        ) : null}

        {step === 'review' ? (
          <>
            <div className="review-card">
              <div className="review-card-header">
                <strong>
                  {form.symbol} · {form.side.toUpperCase()}
                </strong>
                <span>
                  {selectedAccount?.name ?? 'Select account'} · {form.leverage.toFixed(1)}x
                </span>
              </div>

              {form.exchangeSymbol ? (
                <div className="inline-banner">
                  Market base <strong>{form.exchangeSymbol}</strong> mapped into portfolio
                  symbol <strong>{form.symbol}</strong>.
                </div>
              ) : null}

              <div className="preview-grid">
                <MetricTile label="Notional" value={formatCurrency(previewNotional)} />
                <MetricTile label="Preview PnL" value={formatSignedCurrency(previewPnl)} />
                <MetricTile label="Mark" value={formatCurrency(previewMark)} />
              </div>
            </div>

            <button
              className="toolbar-button toolbar-button-strong toolbar-button-wide"
              disabled={pending || !selectedAccountId || form.entryPrice <= 0}
              onClick={onSave}
            >
              <Layers3 size={16} />
              Save position
            </button>
          </>
        ) : null}

        <div className="capture-footer">
          <button
            className="toolbar-button"
            disabled={step === 'contract'}
            onClick={() =>
              setStep((current) =>
                current === 'review' ? 'economics' : 'contract',
              )
            }
          >
            Back
          </button>
          <button
            className="toolbar-button"
            disabled={step === 'review'}
            onClick={() =>
              setStep((current) =>
                current === 'contract' ? 'economics' : 'review',
              )
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
  onPayloadChange: (payload: string) => void;
  onSourceExchangeChange: (exchange: ExchangeKind) => void;
  onTargetAccountChange: (accountId: string) => void;
  onImport: () => void;
}) {
  return (
    <div className="overlay-body">
      <div className="field-grid">
        <Field label="Target account">
          <select
            value={csvTargetAccount}
            onChange={(event) => onTargetAccountChange(event.target.value)}
          >
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
            onChange={(event) =>
              onSourceExchangeChange(event.target.value as ExchangeKind)
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

      <Field label="CSV payload">
        <textarea
          rows={10}
          value={csvPayload}
          onChange={(event) => onPayloadChange(event.target.value)}
        />
      </Field>

      <button
        className="toolbar-button toolbar-button-strong toolbar-button-wide"
        disabled={pending || csvPayload.trim().length === 0}
        onClick={onImport}
      >
        <FileSpreadsheet size={16} />
        Import CSV snapshot
      </button>

      {importResult ? (
        <div className="inline-banner">
          Imported {importResult.importedCount} rows into snapshot{' '}
          <strong>{importResult.snapshotId}</strong>.
          {importResult.rejectedRows.length > 0
            ? ` ${importResult.rejectedRows.length} rows were rejected.`
            : ''}
        </div>
      ) : null}
    </div>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
    </label>
  );
}

function Sparkline({
  points,
  tone,
  label,
  dense,
}: {
  points: number[];
  tone: 'accent' | 'positive' | 'negative';
  label: string;
  dense: boolean;
}) {
  if (points.length === 0) {
    return null;
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
    <div className={clsx('sparkline-shell', dense && 'sparkline-shell-dense', `sparkline-${tone}`)}>
      <svg
        className="sparkline-svg"
        viewBox="0 0 100 100"
        preserveAspectRatio="none"
        role="img"
        aria-label={label}
      >
        <polygon className="sparkline-area" points={`0,100 ${coordinates} 100,100`} />
        <polyline className="sparkline-line" points={coordinates} />
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
      detail: 'Cross-exchange portfolio scope',
      account: null,
      accounts,
    };
  }

  const exchange = getExchangeScope(scope);
  if (exchange) {
    const exchangeAccounts = accounts.filter((account) => account.exchange === exchange);
    return {
      kind: 'exchange',
      label: exchange.toUpperCase(),
      detail: `${exchangeAccounts.length} accounts in exchange aggregate`,
      account: null,
      accounts: exchangeAccounts,
    };
  }

  const account = accounts.find((item) => item.id === scope) ?? null;
  if (!account) {
    return {
      kind: 'portfolio',
      label: 'All accounts',
      detail: 'Cross-exchange portfolio scope',
      account: null,
      accounts,
    };
  }

  return {
    kind: 'account',
    label: account.name,
    detail: `${account.exchange.toUpperCase()} · ${account.accountMode.toUpperCase()}`,
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

function groupAccounts(accounts: ExchangeAccount[]): AccountGroup[] {
  const grouped = new Map<ExchangeKind, ExchangeAccount[]>();

  for (const account of accounts) {
    const current = grouped.get(account.exchange) ?? [];
    current.push(account);
    grouped.set(account.exchange, current);
  }

  return Array.from(grouped.entries())
    .map(([exchange, groupedAccounts]) => ({
      exchange,
      accounts: groupedAccounts.sort(
        (left, right) => right.snapshotEquity - left.snapshotEquity,
      ),
      totalEquity: groupedAccounts.reduce(
        (total, account) => total + account.snapshotEquity,
        0,
      ),
    }))
    .sort((left, right) => right.totalEquity - left.totalEquity);
}

function filterAccountGroups(groups: AccountGroup[], query: string) {
  if (!query) {
    return groups;
  }

  return groups
    .map((group) => {
      const matchesExchange = group.exchange.includes(query);
      const filteredAccounts = matchesExchange
        ? group.accounts
        : group.accounts.filter((account) => {
            const haystack = [
              account.name,
              account.exchange,
              account.accountMode,
              account.externalReference,
              account.notes,
            ]
              .filter(Boolean)
              .join(' ')
              .toLowerCase();
            return haystack.includes(query);
          });

      return {
        ...group,
        accounts: filteredAccounts,
        totalEquity: filteredAccounts.reduce(
          (total, account) => total + account.snapshotEquity,
          0,
        ),
      };
    })
    .filter((group) => group.accounts.length > 0);
}

function buildExposure(positions: PortfolioPosition[]): ExposureRow[] {
  const grouped = new Map<string, ExposureRow>();

  for (const position of positions) {
    const current = grouped.get(position.symbol) ?? {
      symbol: position.symbol,
      longNotional: 0,
      shortNotional: 0,
      netNotional: 0,
      accountIds: [],
    };

    const notional =
      (position.markPrice ?? position.entryPrice) * Math.abs(position.quantity);

    if (!current.accountIds.includes(position.accountId)) {
      current.accountIds.push(position.accountId);
    }

    if (position.side === 'long') {
      current.longNotional += notional;
      current.netNotional += notional;
    } else {
      current.shortNotional += notional;
      current.netNotional -= notional;
    }

    grouped.set(position.symbol, current);
  }

  return Array.from(grouped.values()).sort(
    (left, right) => Math.abs(right.netNotional) - Math.abs(left.netNotional),
  );
}

function buildFocusClusters(positions: PortfolioPosition[]): FocusCluster[] {
  const grouped = new Map<string, FocusCluster & { leverageTotal: number }>();

  for (const position of positions) {
    const current = grouped.get(position.symbol) ?? {
      symbol: position.symbol,
      longNotional: 0,
      shortNotional: 0,
      netNotional: 0,
      grossNotional: 0,
      unrealizedPnl: 0,
      avgLeverage: 0,
      leverageTotal: 0,
      positionCount: 0,
      accountIds: [],
      exchanges: [],
    };

    const notional =
      (position.markPrice ?? position.entryPrice) * Math.abs(position.quantity);

    if (!current.accountIds.includes(position.accountId)) {
      current.accountIds.push(position.accountId);
    }
    if (!current.exchanges.includes(position.exchange)) {
      current.exchanges.push(position.exchange);
    }

    if (position.side === 'long') {
      current.longNotional += notional;
      current.netNotional += notional;
    } else {
      current.shortNotional += notional;
      current.netNotional -= notional;
    }

    current.grossNotional += notional;
    current.unrealizedPnl += position.unrealizedPnl;
    current.leverageTotal += position.leverage;
    current.positionCount += 1;

    grouped.set(position.symbol, current);
  }

  return Array.from(grouped.values())
    .map((cluster) => ({
      ...cluster,
      avgLeverage:
        cluster.positionCount > 0 ? cluster.leverageTotal / cluster.positionCount : 0,
    }))
    .sort((left, right) => right.grossNotional - left.grossNotional);
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
      if (position.realizedPnl > 0) {
        wins += 1;
      }
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

function estimateHeat(equity: number, positions: PortfolioPosition[]) {
  if (equity <= 0) {
    return 0;
  }

  const marginUsed = positions.reduce(
    (sum, position) =>
      sum +
      (position.entryPrice * Math.abs(position.quantity)) /
        Math.max(position.leverage, 1),
    0,
  );

  return (marginUsed / equity) * 100;
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

function historyRange(points: BalanceHistoryPoint[]) {
  if (points.length === 0) return 0;
  const values = points.map((point) => point.equity);
  return Math.max(...values) - Math.min(...values);
}

function historyTone(points: BalanceHistoryPoint[]) {
  const delta = historyDelta(points);
  if (delta > 0) return 'positive';
  if (delta < 0) return 'negative';
  return 'accent';
}

function describeHistoryWindow(points: BalanceHistoryPoint[]) {
  if (points.length === 0) {
    return 'No history window';
  }

  if (points.length === 1) {
    return `Single point · ${formatDateTime(points[0].recordedAt)}`;
  }

  return `${formatDateTime(points[0].recordedAt)} to ${formatDateTime(
    points[points.length - 1].recordedAt,
  )}`;
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
  return `${value.toFixed(2)}%`;
}

function formatDateTime(value: string) {
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: '2-digit',
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

function isStaleSync(value?: string | null) {
  if (!value) return false;
  return Date.now() - new Date(value).getTime() > 15 * 60_000;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

export default App;
