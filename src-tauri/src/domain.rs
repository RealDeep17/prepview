use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum ExchangeKind {
    Manual,
    Blofin,
    Hyperliquid,
    Import,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum PositionSide {
    Long,
    Short,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum SyncStatus {
    Manual,
    Active,
    Error,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum SyncJobState {
    Running,
    Success,
    Failed,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum SyncHealthTone {
    Positive,
    Negative,
    Neutral,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum SyncHealthState {
    Local,
    Awaiting,
    Syncing,
    Stale,
    Degraded,
    Synced,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum AccountMode {
    Manual,
    Import,
    Live,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum MarginMode {
    Cross,
    Isolated,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum PositionEventKind {
    Opened,
    Adjusted,
    Closed,
    Imported,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum PositionRiskSource {
    LiveExchange,
    UserInput,
    LocalEngine,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum RiskTierBasis {
    ExchangeQuantity,
    NotionalUsd,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExchangeAccount {
    pub id: String,
    pub name: String,
    pub exchange: ExchangeKind,
    pub account_mode: AccountMode,
    pub wallet_balance: f64,
    pub available_balance: f64,
    pub snapshot_equity: f64,
    pub currency: String,
    pub external_reference: Option<String>,
    pub notes: Option<String>,
    pub sync_status: SyncStatus,
    pub sync_error: Option<String>,
    pub created_at: DateTime<Utc>,
    pub last_synced_at: Option<DateTime<Utc>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PortfolioPosition {
    pub id: String,
    pub account_id: String,
    pub account_name: String,
    pub exchange: ExchangeKind,
    pub exchange_symbol: Option<String>,
    pub margin_mode: Option<MarginMode>,
    pub symbol: String,
    pub side: PositionSide,
    pub quantity: f64,
    pub entry_price: f64,
    pub mark_price: Option<f64>,
    pub margin_used: Option<f64>,
    pub liquidation_price: Option<f64>,
    pub maintenance_margin: Option<f64>,
    pub maintenance_margin_rate: Option<f64>,
    pub risk_source: Option<PositionRiskSource>,
    pub leverage: f64,
    pub unrealized_pnl: f64,
    pub realized_pnl: f64,
    pub fee_paid: f64,
    pub funding_paid: f64,
    pub opened_at: DateTime<Utc>,
    pub notes: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PortfolioSummary {
    pub total_equity: f64,
    pub total_unrealized_pnl: f64,
    pub gross_notional: f64,
    pub portfolio_heat_percent: f64,
    pub open_positions: usize,
    pub account_count: usize,
    pub updated_at: DateTime<Utc>,
    pub source_label: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExposureItem {
    pub symbol: String,
    pub long_notional: f64,
    pub short_notional: f64,
    pub net_notional: f64,
    pub account_ids: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PerformanceMetrics {
    pub realized_pnl: f64,
    pub unrealized_pnl: f64,
    pub closed_positions: usize,
    pub win_rate: f64,
    pub average_hold_hours: f64,
    pub fee_drag: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct LanStatus {
    pub enabled: bool,
    pub expose_to_lan: bool,
    pub bind_address: Option<String>,
    pub public_url: Option<String>,
    pub token: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AutoSyncStatus {
    pub enabled: bool,
    pub running: bool,
    pub interval_seconds: u64,
    pub next_scheduled_at: Option<DateTime<Utc>>,
    pub last_started_at: Option<DateTime<Utc>>,
    pub last_finished_at: Option<DateTime<Utc>>,
    pub last_cycle_accounts: usize,
    pub last_cycle_succeeded: usize,
    pub last_cycle_failed: usize,
    pub last_error: Option<String>,
}

impl Default for AutoSyncStatus {
    fn default() -> Self {
        Self {
            enabled: false,
            running: false,
            interval_seconds: 0,
            next_scheduled_at: None,
            last_started_at: None,
            last_finished_at: None,
            last_cycle_accounts: 0,
            last_cycle_succeeded: 0,
            last_cycle_failed: 0,
            last_error: None,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AccountSyncHealth {
    pub account_id: String,
    pub state: SyncHealthState,
    pub label: String,
    pub tone: SyncHealthTone,
    pub detail: String,
    pub error_message: Option<String>,
    pub last_synced_at: Option<DateTime<Utc>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncHealthSummary {
    pub state: SyncHealthState,
    pub label: String,
    pub tone: SyncHealthTone,
    pub detail: String,
    pub error_message: Option<String>,
    pub last_synced_at: Option<DateTime<Utc>>,
    pub live_accounts: usize,
    pub stale_count: usize,
    pub degraded_count: usize,
    pub awaiting_count: usize,
    pub syncing_count: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ClosedTradeRecord {
    pub id: String,
    pub account_id: String,
    pub account_name: String,
    pub position_id: Option<String>,
    pub exchange: ExchangeKind,
    pub exchange_symbol: Option<String>,
    pub margin_mode: Option<MarginMode>,
    pub symbol: String,
    pub side: PositionSide,
    pub quantity: f64,
    pub entry_price: f64,
    pub exit_price: f64,
    pub leverage: f64,
    pub realized_pnl: f64,
    pub fee_paid: f64,
    pub funding_paid: f64,
    pub opened_at: DateTime<Utc>,
    pub closed_at: DateTime<Utc>,
    pub note: Option<String>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ClosedTradeQueryInput {
    pub account_id: Option<String>,
    pub exchange: Option<ExchangeKind>,
    pub symbol: Option<String>,
    pub started_at: Option<DateTime<Utc>>,
    pub ended_at: Option<DateTime<Utc>>,
    pub limit: Option<usize>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CloseManualPositionInput {
    pub position_id: String,
    pub quantity: Option<f64>,
    pub exit_price: f64,
    pub fee_paid: Option<f64>,
    pub funding_paid: Option<f64>,
    pub closed_at: Option<DateTime<Utc>>,
    pub note: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CloseManualPositionResult {
    pub closed_trade: ClosedTradeRecord,
    pub remaining_position: Option<PortfolioPosition>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BalanceHistoryPoint {
    pub recorded_at: DateTime<Utc>,
    pub balance: f64,
    pub equity: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AccountHistorySeries {
    pub account_id: String,
    pub account_name: String,
    pub exchange: ExchangeKind,
    pub points: Vec<BalanceHistoryPoint>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BootstrapState {
    pub accounts: Vec<ExchangeAccount>,
    pub account_sync_health: Vec<AccountSyncHealth>,
    pub sync_health_summary: SyncHealthSummary,
    pub positions: Vec<PortfolioPosition>,
    pub exposure: Vec<ExposureItem>,
    pub summary: PortfolioSummary,
    pub performance: PerformanceMetrics,
    pub portfolio_history: Vec<BalanceHistoryPoint>,
    pub account_history: Vec<AccountHistorySeries>,
    pub recent_funding_entries: Vec<FundingHistoryEntry>,
    pub recent_position_events: Vec<PositionEventRecord>,
    pub recent_closed_trades: Vec<ClosedTradeRecord>,
    pub recent_sync_jobs: Vec<SyncJobRecord>,
    pub lan_status: LanStatus,
    pub auto_sync_status: AutoSyncStatus,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateAccountInput {
    pub name: String,
    pub exchange: ExchangeKind,
    pub wallet_balance: f64,
    pub notes: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateAccountInput {
    pub id: String,
    pub name: String,
    pub wallet_balance: Option<f64>,
    pub notes: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ManualPositionInput {
    pub account_id: String,
    pub exchange: ExchangeKind,
    pub exchange_symbol: Option<String>,
    pub symbol: String,
    pub margin_mode: Option<MarginMode>,
    pub side: PositionSide,
    pub quantity: f64,
    pub entry_price: f64,
    pub mark_price: Option<f64>,
    pub margin_used: Option<f64>,
    pub liquidation_price: Option<f64>,
    pub maintenance_margin: Option<f64>,
    pub leverage: f64,
    pub realized_pnl: Option<f64>,
    pub fee_paid: Option<f64>,
    pub funding_paid: Option<f64>,
    pub notes: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateManualPositionInput {
    pub id: String,
    pub account_id: String,
    pub exchange_symbol: Option<String>,
    pub symbol: String,
    pub margin_mode: Option<MarginMode>,
    pub side: PositionSide,
    pub quantity: f64,
    pub entry_price: f64,
    pub mark_price: Option<f64>,
    pub margin_used: Option<f64>,
    pub liquidation_price: Option<f64>,
    pub maintenance_margin: Option<f64>,
    pub leverage: f64,
    pub realized_pnl: Option<f64>,
    pub fee_paid: Option<f64>,
    pub funding_paid: Option<f64>,
    pub notes: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CsvImportInput {
    pub csv: String,
    pub exchange: ExchangeKind,
    pub target_account_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CsvImportRow {
    pub exchange_symbol: Option<String>,
    pub symbol: String,
    pub margin_mode: Option<MarginMode>,
    pub side: PositionSide,
    pub entry_price: f64,
    pub quantity: f64,
    pub leverage: f64,
    pub mark_price: Option<f64>,
    pub margin_used: Option<f64>,
    pub liquidation_price: Option<f64>,
    pub maintenance_margin: Option<f64>,
    pub realized_pnl: f64,
    pub fee_paid: f64,
    pub funding_paid: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CsvImportResult {
    pub imported_count: usize,
    pub rejected_rows: Vec<String>,
    pub snapshot_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateLiveAccountInput {
    pub name: String,
    pub exchange: ExchangeKind,
    pub connection_label: Option<String>,
    pub wallet_address: Option<String>,
    pub api_key: Option<String>,
    pub api_secret: Option<String>,
    pub api_passphrase: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LiveAccountValidation {
    pub exchange: ExchangeKind,
    pub external_reference: String,
    pub wallet_balance: f64,
    pub available_balance: f64,
    pub snapshot_equity: f64,
    pub currency: String,
    pub open_positions: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncAccountResult {
    pub account: ExchangeAccount,
    pub synced_positions: usize,
    pub funding_entries: usize,
    pub attempts: u32,
    pub synced_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AccountSnapshot {
    pub wallet_balance: f64,
    pub available_balance: f64,
    pub snapshot_equity: f64,
    pub currency: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncedPosition {
    pub exchange_symbol: String,
    pub symbol: String,
    pub margin_mode: Option<MarginMode>,
    pub side: PositionSide,
    pub quantity: f64,
    pub entry_price: f64,
    pub mark_price: Option<f64>,
    pub margin_used: Option<f64>,
    pub liquidation_price: Option<f64>,
    pub maintenance_margin: Option<f64>,
    pub maintenance_margin_rate: Option<f64>,
    pub risk_source: Option<PositionRiskSource>,
    pub leverage: f64,
    pub unrealized_pnl: f64,
    pub realized_pnl: f64,
    pub fee_paid: f64,
    pub funding_paid: f64,
    pub opened_at: DateTime<Utc>,
}

#[allow(dead_code)]
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BalanceEvent {
    pub timestamp: DateTime<Utc>,
    pub balance: f64,
    pub equity: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FundingEntry {
    pub symbol: String,
    pub rate: f64,
    pub funding_time: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExchangeMarket {
    pub exchange: ExchangeKind,
    pub exchange_symbol: String,
    pub symbol: String,
    pub base_asset: String,
    pub quote_asset: String,
    pub settle_asset: Option<String>,
    pub contract_type: String,
    pub contract_value: Option<f64>,
    pub price_tick_size: Option<f64>,
    pub quantity_step: Option<f64>,
    pub min_quantity: Option<f64>,
    pub max_leverage: Option<f64>,
    pub mark_price: Option<f64>,
    pub oracle_price: Option<f64>,
    pub funding_rate: Option<f64>,
    pub next_funding_time: Option<DateTime<Utc>>,
    pub is_active: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExchangeRiskTier {
    pub exchange: ExchangeKind,
    pub exchange_symbol: String,
    pub margin_mode: Option<MarginMode>,
    pub tier_basis: RiskTierBasis,
    pub lower_bound: f64,
    pub upper_bound: Option<f64>,
    pub maintenance_margin_rate: f64,
    pub maintenance_amount_deduction: f64,
    pub max_leverage: f64,
}

#[allow(dead_code)]
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MarkPriceUpdate {
    pub symbol: String,
    pub mark_price: f64,
    pub as_of: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MarketQuote {
    pub exchange: ExchangeKind,
    pub exchange_symbol: String,
    pub symbol: String,
    pub mark_price: Option<f64>,
    pub oracle_price: Option<f64>,
    pub funding_rate: Option<f64>,
    pub next_funding_time: Option<DateTime<Utc>>,
    pub as_of: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct QuoteRefreshResult {
    pub targets_discovered: usize,
    pub quote_requests_attempted: usize,
    pub quotes_refreshed: usize,
    pub positions_updated: usize,
    pub exchanges_touched: Vec<ExchangeKind>,
    pub warnings: Vec<String>,
    pub refreshed_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PositionEventQueryInput {
    pub account_id: Option<String>,
    pub exchange: Option<ExchangeKind>,
    pub event_kind: Option<PositionEventKind>,
    pub symbol: Option<String>,
    pub started_at: Option<DateTime<Utc>>,
    pub ended_at: Option<DateTime<Utc>>,
    pub limit: Option<usize>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FundingHistoryEntry {
    pub id: String,
    pub account_id: String,
    pub account_name: String,
    pub symbol: String,
    pub rate: f64,
    pub funding_time: DateTime<Utc>,
    pub recorded_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PositionEventRecord {
    pub id: String,
    pub account_id: String,
    pub account_name: String,
    pub position_id: Option<String>,
    pub exchange: ExchangeKind,
    pub event_kind: PositionEventKind,
    pub exchange_symbol: Option<String>,
    pub margin_mode: Option<MarginMode>,
    pub symbol: String,
    pub side: PositionSide,
    pub quantity: f64,
    pub entry_price: f64,
    pub mark_price: Option<f64>,
    pub margin_used: Option<f64>,
    pub liquidation_price: Option<f64>,
    pub maintenance_margin: Option<f64>,
    pub leverage: f64,
    pub unrealized_pnl: f64,
    pub realized_pnl: f64,
    pub fee_paid: f64,
    pub funding_paid: f64,
    pub event_time: DateTime<Utc>,
    pub source_job_id: Option<String>,
    pub note: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncJobRecord {
    pub id: String,
    pub account_id: String,
    pub account_name: String,
    pub exchange: ExchangeKind,
    pub state: SyncJobState,
    pub started_at: DateTime<Utc>,
    pub finished_at: Option<DateTime<Utc>>,
    pub attempt_count: u32,
    pub synced_positions: usize,
    pub funding_entries: usize,
    pub error_message: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncFailure {
    pub account_id: String,
    pub account_name: String,
    pub error: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncAllAccountsResult {
    pub succeeded: Vec<SyncAccountResult>,
    pub failed: Vec<SyncFailure>,
}
