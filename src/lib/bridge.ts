import { invoke } from '@tauri-apps/api/core';
import type {
    BootstrapState,
    ClosedTradeQueryInput,
    ClosedTradeRecord,
    CloseManualPositionInput,
    CloseManualPositionResult,
    CreateAccountInput,
    CreateLiveAccountInput,
    CsvImportInput,
    CsvImportResult,
    ExchangeAccount,
    ExchangeKind,
    ExchangeMarket,
    LanStatus,
    LiveAccountValidation,
    ManualPositionInput,
    MarketQuote,
    PortfolioPosition,
    PositionFundingEstimate,
    PositionFundingEstimateInput,
    PositionEventQueryInput,
    PositionEventRecord,
    QuoteRefreshResult,
    SyncAllAccountsResult,
    SyncAccountResult,
    UpdateAccountInput,
    UpdateManualPositionInput,
} from './types';

function assertTauri() {
  if (!(window as Window & { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__) {
    throw new Error('PrepView must be run through Tauri. Use `npm run tauri:dev` for local development.');
  }
}

export async function getBootstrapState() {
  assertTauri();
  return invoke<BootstrapState>('get_bootstrap_state');
}

export async function createAccount(input: CreateAccountInput) {
  assertTauri();
  return invoke<ExchangeAccount>('create_account', { input });
}

export async function updateAccount(input: UpdateAccountInput) {
  assertTauri();
  return invoke<ExchangeAccount>('update_account', { input });
}

export async function deleteAccount(accountId: string) {
  assertTauri();
  return invoke<void>('delete_account', { accountId });
}

export async function validateLiveAccount(input: CreateLiveAccountInput) {
  assertTauri();
  return invoke<LiveAccountValidation>('validate_live_account', { input });
}

export async function createLiveAccount(input: CreateLiveAccountInput) {
  assertTauri();
  return invoke<SyncAccountResult>('create_live_account', { input });
}

export async function syncLiveAccount(accountId: string) {
  assertTauri();
  return invoke<SyncAccountResult>('sync_live_account', { accountId });
}

export async function syncAllLiveAccounts() {
  assertTauri();
  return invoke<SyncAllAccountsResult>('sync_all_live_accounts');
}

export async function addManualPosition(input: ManualPositionInput) {
  assertTauri();
  return invoke<PortfolioPosition>('add_manual_position', { input });
}

export async function updateManualPosition(input: UpdateManualPositionInput) {
  assertTauri();
  return invoke<PortfolioPosition>('update_manual_position', { input });
}

export async function deleteManualPosition(positionId: string) {
  assertTauri();
  return invoke<void>('delete_manual_position', { positionId });
}

export async function closeManualPosition(input: CloseManualPositionInput) {
  assertTauri();
  return invoke<CloseManualPositionResult>('close_manual_position', { input });
}

export async function importCsvPositions(input: CsvImportInput) {
  assertTauri();
  return invoke<CsvImportResult>('import_csv_positions', { input });
}

export async function getExchangeMarkets(exchange: Extract<ExchangeKind, 'blofin' | 'hyperliquid'>) {
  assertTauri();
  return invoke<ExchangeMarket[]>('get_exchange_markets', { exchange });
}

export async function getExchangeMarketQuote(
  exchange: Extract<ExchangeKind, 'blofin' | 'hyperliquid'>,
  exchangeSymbol: string,
) {
  assertTauri();
  return invoke<MarketQuote>('get_exchange_market_quote', {
    exchange,
    exchangeSymbol,
  });
}

export async function previewPositionFunding(input: PositionFundingEstimateInput) {
  assertTauri();
  return invoke<PositionFundingEstimate>('preview_position_funding', { input });
}

export async function getPositionEvents(input?: PositionEventQueryInput) {
  assertTauri();
  return invoke<PositionEventRecord[]>('get_position_events', {
    input,
  });
}

export async function getClosedTrades(input?: ClosedTradeQueryInput) {
  assertTauri();
  return invoke<ClosedTradeRecord[]>('get_closed_trades', {
    input,
  });
}

export async function refreshPortfolioQuotes() {
  assertTauri();
  return invoke<QuoteRefreshResult>('refresh_portfolio_quotes');
}

export async function setLanProjection(
  enabled: boolean,
  exposeToLan?: boolean,
  viewerPassphrase?: string,
): Promise<LanStatus> {
  assertTauri();
  return invoke('set_lan_projection', { enabled, exposeToLan, viewerPassphrase });
}

export async function resetDatabase(): Promise<void> {
  assertTauri();
  return invoke('reset_database');
}
