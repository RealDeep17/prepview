export type ExchangeKind = 'manual' | 'blofin' | 'hyperliquid' | 'import';
export type PositionSide = 'long' | 'short';
export type SyncStatus = 'manual' | 'active' | 'error';
export type AccountMode = 'manual' | 'import' | 'live';
export type SyncJobState = 'running' | 'success' | 'failed';
export type SyncHealthTone = 'positive' | 'negative' | 'neutral';
export type SyncHealthState = 'local' | 'awaiting' | 'syncing' | 'stale' | 'degraded' | 'synced';
export type MarginMode = 'cross' | 'isolated';
export type PositionEventKind = 'opened' | 'adjusted' | 'closed' | 'imported';
export type PositionRiskSource = 'live_exchange' | 'user_input' | 'local_engine';

export interface ClosedTradeRecord {
  id: string;
  accountId: string;
  accountName: string;
  positionId?: string | null;
  exchange: ExchangeKind;
  exchangeSymbol?: string | null;
  marginMode?: MarginMode | null;
  symbol: string;
  side: PositionSide;
  quantity: number;
  entryPrice: number;
  exitPrice: number;
  leverage: number;
  realizedPnl: number;
  feePaid: number;
  fundingPaid: number;
  openedAt: string;
  closedAt: string;
  note?: string | null;
}

export interface ClosedTradeQueryInput {
  accountId?: string;
  exchange?: ExchangeKind;
  symbol?: string;
  startedAt?: string;
  endedAt?: string;
  limit?: number;
}

export interface CloseManualPositionInput {
  positionId: string;
  quantity?: number;
  exitPrice: number;
  feePaid?: number;
  fundingPaid?: number;
  closedAt?: string;
  note?: string;
}

export interface CloseManualPositionResult {
  closedTrade: ClosedTradeRecord;
  remainingPosition?: PortfolioPosition | null;
}

export interface ExchangeAccount {
  id: string;
  name: string;
  exchange: ExchangeKind;
  accountMode: AccountMode;
  walletBalance: number;
  availableBalance: number;
  snapshotEquity: number;
  currency: string;
  externalReference?: string | null;
  notes?: string;
  syncStatus: SyncStatus;
  syncError?: string | null;
  createdAt: string;
  lastSyncedAt?: string | null;
  bonusBalance: number;
  bonusFeeDeductionRate: number;
  bonusLossDeductionRate: number;
  bonusFundingDeductionRate: number;
}

export interface PortfolioPosition {
  id: string;
  accountId: string;
  accountName: string;
  exchange: ExchangeKind;
  exchangeSymbol?: string | null;
  marginMode?: MarginMode | null;
  symbol: string;
  side: PositionSide;
  quantity: number;
  entryPrice: number;
  markPrice?: number | null;
  marginUsed?: number | null;
  liquidationPrice?: number | null;
  maintenanceMargin?: number | null;
  maintenanceMarginRate?: number | null;
  riskSource?: PositionRiskSource | null;
  leverage: number;
  unrealizedPnl: number;
  realizedPnl: number;
  feePaid: number;
  fundingPaid: number;
  openedAt: string;
  notes?: string;
}

export interface PortfolioSummary {
  totalEquity: number;
  totalUnrealizedPnl: number;
  totalBonusOffset: number;
  grossNotional: number;
  portfolioHeatPercent: number;
  openPositions: number;
  accountCount: number;
  updatedAt: string;
  sourceLabel: string;
}

export interface ExposureItem {
  symbol: string;
  longNotional: number;
  shortNotional: number;
  netNotional: number;
  accountIds: string[];
}

export interface PerformanceMetrics {
  realizedPnl: number;
  unrealizedPnl: number;
  totalBonusOffset: number;
  closedPositions: number;
  winRate: number;
  averageHoldHours: number;
  feeDrag: number;
}

export interface BalanceHistoryPoint {
  recordedAt: string;
  balance: number;
  equity: number;
}

export interface AccountHistorySeries {
  accountId: string;
  accountName: string;
  exchange: ExchangeKind;
  points: BalanceHistoryPoint[];
}

export interface LanStatus {
  enabled: boolean;
  exposeToLan: boolean;
  bindAddress?: string | null;
  publicUrl?: string | null;
  token?: string | null;
}

export interface AutoSyncStatus {
  enabled: boolean;
  running: boolean;
  intervalSeconds: number;
  nextScheduledAt?: string | null;
  lastStartedAt?: string | null;
  lastFinishedAt?: string | null;
  lastCycleAccounts: number;
  lastCycleSucceeded: number;
  lastCycleFailed: number;
  lastError?: string | null;
}

export interface AccountSyncHealth {
  accountId: string;
  state: SyncHealthState;
  label: string;
  tone: SyncHealthTone;
  detail: string;
  errorMessage?: string | null;
  lastSyncedAt?: string | null;
}

export interface SyncHealthSummary {
  state: SyncHealthState;
  label: string;
  tone: SyncHealthTone;
  detail: string;
  errorMessage?: string | null;
  lastSyncedAt?: string | null;
  liveAccounts: number;
  staleCount: number;
  degradedCount: number;
  awaitingCount: number;
  syncingCount: number;
}

export interface BootstrapState {
  accounts: ExchangeAccount[];
  accountSyncHealth: AccountSyncHealth[];
  syncHealthSummary: SyncHealthSummary;
  positions: PortfolioPosition[];
  exposure: ExposureItem[];
  summary: PortfolioSummary;
  performance: PerformanceMetrics;
  portfolioHistory: BalanceHistoryPoint[];
  accountHistory: AccountHistorySeries[];
  recentFundingEntries: FundingHistoryEntry[];
  recentPositionEvents?: PositionEventRecord[];
  recentClosedTrades?: ClosedTradeRecord[];
  recentSyncJobs: SyncJobRecord[];
  lanStatus: LanStatus;
  autoSyncStatus: AutoSyncStatus;
}

export interface CreateAccountInput {
  name: string;
  exchange: ExchangeKind;
  walletBalance: number;
  notes?: string;
  bonusBalance?: number;
  bonusFeeDeductionRate?: number;
  bonusLossDeductionRate?: number;
  bonusFundingDeductionRate?: number;
}

export interface UpdateAccountInput {
  id: string;
  name: string;
  walletBalance?: number;
  notes?: string;
  bonusBalance?: number;
  bonusFeeDeductionRate?: number;
  bonusLossDeductionRate?: number;
  bonusFundingDeductionRate?: number;
}

export interface ManualPositionInput {
  accountId: string;
  exchange: ExchangeKind;
  exchangeSymbol?: string;
  symbol: string;
  marginMode?: MarginMode | null;
  side: PositionSide;
  quantity: number;
  entryPrice: number;
  markPrice?: number;
  marginUsed?: number;
  liquidationPrice?: number;
  maintenanceMargin?: number;
  leverage: number;
  realizedPnl?: number;
  feePaid?: number;
  fundingPaid?: number;
  notes?: string;
}

export interface UpdateManualPositionInput {
  id: string;
  accountId: string;
  exchangeSymbol?: string;
  symbol: string;
  marginMode?: MarginMode | null;
  side: PositionSide;
  quantity: number;
  entryPrice: number;
  markPrice?: number;
  marginUsed?: number;
  liquidationPrice?: number;
  maintenanceMargin?: number;
  leverage: number;
  realizedPnl?: number;
  feePaid?: number;
  fundingPaid?: number;
  notes?: string;
}

export interface CsvImportInput {
  csv: string;
  exchange: ExchangeKind;
  targetAccountId?: string;
}

export interface CsvImportResult {
  importedCount: number;
  rejectedRows: string[];
  snapshotId: string;
}

export interface CreateLiveAccountInput {
  name: string;
  exchange: Extract<ExchangeKind, 'blofin' | 'hyperliquid'>;
  connectionLabel?: string;
  walletAddress?: string;
  apiKey?: string;
  apiSecret?: string;
  apiPassphrase?: string;
}

export interface LiveAccountValidation {
  exchange: ExchangeKind;
  externalReference: string;
  walletBalance: number;
  availableBalance: number;
  snapshotEquity: number;
  currency: string;
  openPositions: number;
}

export interface SyncAccountResult {
  account: ExchangeAccount;
  syncedPositions: number;
  fundingEntries: number;
  attempts: number;
  syncedAt: string;
}

export interface FundingHistoryEntry {
  id: string;
  accountId: string;
  accountName: string;
  symbol: string;
  rate: number;
  fundingTime: string;
  recordedAt: string;
}

export interface PositionEventRecord {
  id: string;
  accountId: string;
  accountName: string;
  positionId?: string | null;
  exchange: ExchangeKind;
  eventKind: PositionEventKind;
  exchangeSymbol?: string | null;
  marginMode?: MarginMode | null;
  symbol: string;
  side: PositionSide;
  quantity: number;
  entryPrice: number;
  markPrice?: number | null;
  marginUsed?: number | null;
  liquidationPrice?: number | null;
  maintenanceMargin?: number | null;
  leverage: number;
  unrealizedPnl: number;
  realizedPnl: number;
  feePaid: number;
  fundingPaid: number;
  eventTime: string;
  sourceJobId?: string | null;
  note?: string | null;
}

export interface SyncJobRecord {
  id: string;
  accountId: string;
  accountName: string;
  exchange: ExchangeKind;
  state: SyncJobState;
  startedAt: string;
  finishedAt?: string | null;
  attemptCount: number;
  syncedPositions: number;
  fundingEntries: number;
  errorMessage?: string | null;
}

export interface SyncFailure {
  accountId: string;
  accountName: string;
  error: string;
}

export interface SyncAllAccountsResult {
  succeeded: SyncAccountResult[];
  failed: SyncFailure[];
}

export interface ExchangeMarket {
  exchange: ExchangeKind;
  exchangeSymbol: string;
  symbol: string;
  baseAsset: string;
  quoteAsset: string;
  settleAsset?: string | null;
  contractType: string;
  contractValue?: number | null;
  priceTickSize?: number | null;
  quantityStep?: number | null;
  minQuantity?: number | null;
  maxLeverage?: number | null;
  markPrice?: number | null;
  oraclePrice?: number | null;
  fundingRate?: number | null;
  nextFundingTime?: string | null;
  isActive: boolean;
}

export interface MarketQuote {
  exchange: ExchangeKind;
  exchangeSymbol: string;
  symbol: string;
  markPrice?: number | null;
  oraclePrice?: number | null;
  fundingRate?: number | null;
  nextFundingTime?: string | null;
  asOf: string;
}

export interface QuoteRefreshResult {
  targetsDiscovered: number;
  quoteRequestsAttempted: number;
  quotesRefreshed: number;
  positionsUpdated: number;
  exchangesTouched: ExchangeKind[];
  warnings: string[];
  refreshedAt: string;
}

export interface PositionEventQueryInput {
  accountId?: string;
  exchange?: ExchangeKind;
  eventKind?: PositionEventKind;
  symbol?: string;
  startedAt?: string;
  endedAt?: string;
  limit?: number;
}
