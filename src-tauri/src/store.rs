use std::{collections::BTreeMap, path::PathBuf};

use chrono::{DateTime, Utc};
use rusqlite::{params, params_from_iter, types::Value, Connection, OptionalExtension, Row};
use uuid::Uuid;

use crate::{
    csv_import::parse_csv,
    domain::{
        AccountHistorySeries, AccountMode, AccountSnapshot, AutoSyncStatus, BalanceHistoryPoint,
        BootstrapState, CloseManualPositionInput, CloseManualPositionResult, ClosedTradeQueryInput,
        ClosedTradeRecord, CreateAccountInput, CsvImportInput, CsvImportResult,
        ExchangeAccount, ExchangeKind, ExchangeMarket, ExchangeRiskTier, FundingEntry,
        FundingHistoryEntry, LanStatus, ManualPositionInput, MarginMode, MarketQuote,
        PortfolioPosition, PositionEventKind, PositionEventQueryInput, PositionEventRecord,
        PositionRiskSource, PositionSide, SyncJobRecord, SyncJobState, SyncStatus,
        SyncedPosition, UpdateAccountInput, UpdateManualPositionInput,
    },
    error::{invalid_input, AppResult},
    metrics,
    risk_engine::{
        blofin_required_amount, current_tier_selection, derive_margin_used,
        estimate_blofin_liquidation_price, estimate_hyperliquid_liquidation_price,
        hyperliquid_required_amount, maintenance_margin_amount, notional_usd, pnl_amount,
    },
};

pub struct PortfolioRepository {
    connection: Connection,
}

const ACCOUNT_HISTORY_LIMIT: usize = 16;
const PORTFOLIO_HISTORY_LIMIT: usize = 48;
const POSITION_EVENT_LIMIT: usize = 64;
const CLOSED_TRADE_LIMIT: usize = 64;

#[derive(Debug, Clone)]
pub(crate) struct MarketQuoteRefreshTarget {
    pub exchange: ExchangeKind,
    pub exchange_symbol: Option<String>,
    pub symbol: String,
}

#[derive(Debug)]
struct SnapshotMeta {
    source: String,
}

#[derive(Debug)]
struct BalanceHistoryRow {
    account_id: String,
    account_name: String,
    exchange: ExchangeKind,
    balance: f64,
    equity: f64,
    recorded_at: DateTime<Utc>,
}

#[derive(Debug)]
struct QuoteRepriceRow {
    id: String,
    account_id: String,
    exchange_symbol: Option<String>,
    symbol: String,
    side: PositionSide,
    entry_price: f64,
    quantity: f64,
    fee_paid: f64,
    funding_paid: f64,
    mark_price: Option<f64>,
    unrealized_pnl: f64,
}

#[derive(Debug)]
struct ResolvedPositionDraft {
    exchange: ExchangeKind,
    exchange_symbol: Option<String>,
    symbol: String,
    mark_price: f64,
    market: Option<ExchangeMarket>,
}

#[derive(Debug)]
struct PositionEventInsert {
    account_id: String,
    account_name: String,
    position_id: Option<String>,
    exchange: ExchangeKind,
    event_kind: PositionEventKind,
    exchange_symbol: Option<String>,
    margin_mode: Option<MarginMode>,
    symbol: String,
    side: PositionSide,
    quantity: f64,
    entry_price: f64,
    mark_price: Option<f64>,
    margin_used: Option<f64>,
    liquidation_price: Option<f64>,
    maintenance_margin: Option<f64>,
    leverage: f64,
    unrealized_pnl: f64,
    realized_pnl: f64,
    fee_paid: f64,
    funding_paid: f64,
    event_time: DateTime<Utc>,
    source_job_id: Option<String>,
    note: Option<String>,
}

#[derive(Debug)]
struct ClosedTradeInsert {
    account_id: String,
    account_name: String,
    position_id: Option<String>,
    exchange: ExchangeKind,
    exchange_symbol: Option<String>,
    margin_mode: Option<MarginMode>,
    symbol: String,
    side: PositionSide,
    quantity: f64,
    entry_price: f64,
    exit_price: f64,
    leverage: f64,
    realized_pnl: f64,
    fee_paid: f64,
    funding_paid: f64,
    opened_at: DateTime<Utc>,
    closed_at: DateTime<Utc>,
    note: Option<String>,
}

impl PortfolioRepository {
    pub fn open(path: PathBuf, database_key: String) -> AppResult<Self> {
        let connection = Connection::open(path)?;
        connection.execute_batch(&format!(
            "PRAGMA key = '{}'; PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;",
            database_key.replace('\'', "''")
        ))?;
        let repository = Self { connection };
        repository.migrate()?;
        Ok(repository)
    }

    fn migrate(&self) -> AppResult<()> {
        self.connection.execute_batch(
            "
            CREATE TABLE IF NOT EXISTS accounts (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                exchange TEXT NOT NULL,
                account_mode TEXT NOT NULL DEFAULT 'manual',
                wallet_balance REAL NOT NULL DEFAULT 0,
                available_balance REAL NOT NULL DEFAULT 0,
                snapshot_equity REAL NOT NULL DEFAULT 0,
                currency TEXT NOT NULL DEFAULT 'USDT',
                external_reference TEXT,
                notes TEXT,
                sync_status TEXT NOT NULL DEFAULT 'manual',
                sync_error TEXT,
                created_at TEXT NOT NULL,
                last_synced_at TEXT
            );

            CREATE TABLE IF NOT EXISTS positions (
                id TEXT PRIMARY KEY,
                account_id TEXT NOT NULL,
                exchange TEXT NOT NULL,
                exchange_symbol TEXT,
                margin_mode TEXT,
                symbol TEXT NOT NULL,
                side TEXT NOT NULL,
                quantity REAL NOT NULL,
                entry_price REAL NOT NULL,
                mark_price REAL,
                margin_used REAL,
                liquidation_price REAL,
                maintenance_margin REAL,
                maintenance_margin_rate REAL,
                risk_source TEXT,
                leverage REAL NOT NULL DEFAULT 1,
                unrealized_pnl REAL NOT NULL DEFAULT 0,
                realized_pnl REAL NOT NULL DEFAULT 0,
                fee_paid REAL NOT NULL DEFAULT 0,
                funding_paid REAL NOT NULL DEFAULT 0,
                opened_at TEXT NOT NULL,
                notes TEXT,
                FOREIGN KEY(account_id) REFERENCES accounts(id) ON DELETE CASCADE
            );

            CREATE TABLE IF NOT EXISTS snapshots (
                id TEXT PRIMARY KEY,
                source TEXT NOT NULL,
                summary_json TEXT NOT NULL,
                created_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS balance_events (
                id TEXT PRIMARY KEY,
                account_id TEXT NOT NULL,
                balance REAL NOT NULL,
                equity REAL NOT NULL,
                recorded_at TEXT NOT NULL,
                source_job_id TEXT,
                FOREIGN KEY(account_id) REFERENCES accounts(id) ON DELETE CASCADE
            );

            CREATE TABLE IF NOT EXISTS funding_entries (
                id TEXT PRIMARY KEY,
                account_id TEXT NOT NULL,
                symbol TEXT NOT NULL,
                rate REAL NOT NULL,
                funding_time TEXT NOT NULL,
                recorded_at TEXT NOT NULL,
                source_job_id TEXT,
                FOREIGN KEY(account_id) REFERENCES accounts(id) ON DELETE CASCADE
            );

            CREATE TABLE IF NOT EXISTS market_quotes (
                exchange TEXT NOT NULL,
                exchange_symbol TEXT NOT NULL,
                symbol TEXT NOT NULL,
                mark_price REAL,
                oracle_price REAL,
                funding_rate REAL,
                next_funding_time TEXT,
                as_of TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                PRIMARY KEY(exchange, exchange_symbol)
            );

            CREATE TABLE IF NOT EXISTS exchange_markets (
                exchange TEXT NOT NULL,
                exchange_symbol TEXT NOT NULL,
                symbol TEXT NOT NULL,
                base_asset TEXT NOT NULL,
                quote_asset TEXT NOT NULL,
                settle_asset TEXT,
                contract_type TEXT NOT NULL,
                contract_value REAL,
                price_tick_size REAL,
                quantity_step REAL,
                min_quantity REAL,
                max_leverage REAL,
                mark_price REAL,
                oracle_price REAL,
                funding_rate REAL,
                next_funding_time TEXT,
                is_active INTEGER NOT NULL DEFAULT 1,
                updated_at TEXT NOT NULL,
                PRIMARY KEY(exchange, exchange_symbol)
            );

            CREATE TABLE IF NOT EXISTS exchange_risk_tiers (
                exchange TEXT NOT NULL,
                exchange_symbol TEXT NOT NULL,
                margin_mode TEXT NOT NULL DEFAULT '',
                tier_basis TEXT NOT NULL,
                lower_bound REAL NOT NULL,
                upper_bound REAL,
                maintenance_margin_rate REAL NOT NULL,
                maintenance_amount_deduction REAL NOT NULL DEFAULT 0,
                max_leverage REAL NOT NULL,
                updated_at TEXT NOT NULL,
                PRIMARY KEY(exchange, exchange_symbol, margin_mode, tier_basis, lower_bound)
            );

            CREATE TABLE IF NOT EXISTS position_events (
                id TEXT PRIMARY KEY,
                account_id TEXT NOT NULL,
                account_name TEXT NOT NULL,
                position_id TEXT,
                exchange TEXT NOT NULL,
                event_kind TEXT NOT NULL,
                exchange_symbol TEXT,
                margin_mode TEXT,
                symbol TEXT NOT NULL,
                side TEXT NOT NULL,
                quantity REAL NOT NULL,
                entry_price REAL NOT NULL,
                mark_price REAL,
                margin_used REAL,
                liquidation_price REAL,
                maintenance_margin REAL,
                leverage REAL NOT NULL DEFAULT 1,
                unrealized_pnl REAL NOT NULL DEFAULT 0,
                realized_pnl REAL NOT NULL DEFAULT 0,
                fee_paid REAL NOT NULL DEFAULT 0,
                funding_paid REAL NOT NULL DEFAULT 0,
                event_time TEXT NOT NULL,
                source_job_id TEXT,
                note TEXT,
                FOREIGN KEY(account_id) REFERENCES accounts(id) ON DELETE CASCADE
            );

            CREATE TABLE IF NOT EXISTS closed_trades (
                id TEXT PRIMARY KEY,
                account_id TEXT NOT NULL,
                account_name TEXT NOT NULL,
                position_id TEXT,
                exchange TEXT NOT NULL,
                exchange_symbol TEXT,
                margin_mode TEXT,
                symbol TEXT NOT NULL,
                side TEXT NOT NULL,
                quantity REAL NOT NULL,
                entry_price REAL NOT NULL,
                exit_price REAL NOT NULL,
                leverage REAL NOT NULL DEFAULT 1,
                realized_pnl REAL NOT NULL DEFAULT 0,
                fee_paid REAL NOT NULL DEFAULT 0,
                funding_paid REAL NOT NULL DEFAULT 0,
                opened_at TEXT NOT NULL,
                closed_at TEXT NOT NULL,
                note TEXT,
                FOREIGN KEY(account_id) REFERENCES accounts(id) ON DELETE CASCADE
            );

            CREATE TABLE IF NOT EXISTS sync_jobs (
                id TEXT PRIMARY KEY,
                account_id TEXT NOT NULL,
                exchange TEXT NOT NULL,
                state TEXT NOT NULL,
                started_at TEXT NOT NULL,
                finished_at TEXT,
                attempt_count INTEGER NOT NULL DEFAULT 0,
                synced_positions INTEGER NOT NULL DEFAULT 0,
                funding_entries INTEGER NOT NULL DEFAULT 0,
                error_message TEXT,
                FOREIGN KEY(account_id) REFERENCES accounts(id) ON DELETE CASCADE
            );

            CREATE UNIQUE INDEX IF NOT EXISTS idx_funding_entries_unique
            ON funding_entries (account_id, symbol, funding_time);

            CREATE INDEX IF NOT EXISTS idx_market_quotes_symbol
            ON market_quotes (symbol, updated_at DESC);

            CREATE INDEX IF NOT EXISTS idx_exchange_markets_exchange_symbol
            ON exchange_markets (exchange, symbol, updated_at DESC);

            CREATE INDEX IF NOT EXISTS idx_exchange_risk_tiers_lookup
            ON exchange_risk_tiers (exchange, exchange_symbol, margin_mode, updated_at DESC);

            CREATE INDEX IF NOT EXISTS idx_position_events_account_time
            ON position_events (account_id, event_time DESC);

            CREATE INDEX IF NOT EXISTS idx_position_events_exchange_time
            ON position_events (exchange, event_time DESC);

            CREATE INDEX IF NOT EXISTS idx_position_events_symbol_time
            ON position_events (symbol, event_time DESC);

            CREATE INDEX IF NOT EXISTS idx_closed_trades_account_time
            ON closed_trades (account_id, closed_at DESC);

            CREATE INDEX IF NOT EXISTS idx_closed_trades_exchange_time
            ON closed_trades (exchange, closed_at DESC);

            CREATE INDEX IF NOT EXISTS idx_closed_trades_symbol_time
            ON closed_trades (symbol, closed_at DESC);
            ",
        )?;

        self.ensure_account_column("account_mode", "TEXT NOT NULL DEFAULT 'manual'")?;
        self.ensure_account_column("external_reference", "TEXT")?;
        self.ensure_account_column("sync_error", "TEXT")?;
        self.ensure_account_column("bonus_balance", "REAL NOT NULL DEFAULT 0")?;
        self.ensure_account_column("bonus_fee_deduction_rate", "REAL NOT NULL DEFAULT 0")?;
        self.ensure_account_column("bonus_loss_deduction_rate", "REAL NOT NULL DEFAULT 0")?;
        self.ensure_account_column("bonus_funding_deduction_rate", "REAL NOT NULL DEFAULT 0")?;
        self.ensure_position_column("exchange_symbol", "TEXT")?;
        self.ensure_position_column("margin_mode", "TEXT")?;
        self.ensure_position_column("margin_used", "REAL")?;
        self.ensure_position_column("liquidation_price", "REAL")?;
        self.ensure_position_column("maintenance_margin", "REAL")?;
        self.ensure_position_column("maintenance_margin_rate", "REAL")?;
        self.ensure_position_column("risk_source", "TEXT")?;
        self.ensure_exchange_market_column("contract_value", "REAL")?;
        self.ensure_account_column("bonus_balance", "REAL NOT NULL DEFAULT 0")?;
        self.ensure_account_column("bonus_fee_deduction_rate", "REAL NOT NULL DEFAULT 0")?;
        self.ensure_account_column("bonus_loss_deduction_rate", "REAL NOT NULL DEFAULT 0")?;
        self.ensure_account_column("bonus_funding_deduction_rate", "REAL NOT NULL DEFAULT 0")?;
        Ok(())
    }

    pub fn create_account(&self, input: CreateAccountInput) -> AppResult<ExchangeAccount> {
        self.create_account_with_mode(input, AccountMode::Manual, None)
    }

    pub fn create_live_account_record(
        &self,
        name: String,
        exchange: ExchangeKind,
        external_reference: String,
    ) -> AppResult<ExchangeAccount> {
        self.create_account_with_mode(
            CreateAccountInput {
                name,
                exchange,
                wallet_balance: 0.0,
                notes: Some("Live read-only account".into()),
                bonus_balance: None,
                bonus_fee_deduction_rate: None,
                bonus_loss_deduction_rate: None,
                bonus_funding_deduction_rate: None,
            },
            AccountMode::Live,
            Some(external_reference),
        )
    }

    pub fn delete_account(&self, account_id: &str) -> AppResult<()> {
        self.connection
            .execute("DELETE FROM accounts WHERE id = ?1", params![account_id])?;
        Ok(())
    }

    pub fn delete_account_with_snapshot(&self, account_id: &str) -> AppResult<()> {
        self.delete_account(account_id)?;
        self.record_snapshot("account_delete".into())?;
        Ok(())
    }

    pub fn update_account(&self, input: UpdateAccountInput) -> AppResult<ExchangeAccount> {
        let account = self.get_account(&input.id)?;
        let name = input.name.trim();
        if name.is_empty() {
            return Err(invalid_input("account name cannot be empty"));
        }

        let notes = normalize_optional_text(input.notes);
        let wallet_balance = match account.account_mode {
            AccountMode::Live => account.wallet_balance,
            _ => input
                .wallet_balance
                .unwrap_or(account.wallet_balance)
                .max(0.0),
        };
        let bonus_balance = input
            .bonus_balance
            .unwrap_or(account.bonus_balance)
            .max(0.0);
        let bonus_fee_deduction_rate = validate_bonus_rate(
            input
                .bonus_fee_deduction_rate
                .unwrap_or(account.bonus_fee_deduction_rate),
            "bonus fee deduction rate",
        )?;
        let bonus_loss_deduction_rate = validate_bonus_rate(
            input
                .bonus_loss_deduction_rate
                .unwrap_or(account.bonus_loss_deduction_rate),
            "bonus loss deduction rate",
        )?;
        let bonus_funding_deduction_rate = validate_bonus_rate(
            input
                .bonus_funding_deduction_rate
                .unwrap_or(account.bonus_funding_deduction_rate),
            "bonus funding deduction rate",
        )?;
        let available_balance = match account.account_mode {
            AccountMode::Live => account.available_balance,
            _ => wallet_balance,
        };
        let snapshot_equity = match account.account_mode {
            AccountMode::Live => account.snapshot_equity,
            _ => wallet_balance,
        };

        self.connection.execute(
            "UPDATE accounts
             SET name = ?2,
                 wallet_balance = ?3,
                 available_balance = ?4,
                 snapshot_equity = ?5,
                 notes = ?6,
                 bonus_balance = ?7,
                 bonus_fee_deduction_rate = ?8,
                 bonus_loss_deduction_rate = ?9,
                 bonus_funding_deduction_rate = ?10
             WHERE id = ?1",
            params![
                input.id,
                name,
                wallet_balance,
                available_balance,
                snapshot_equity,
                notes,
                bonus_balance,
                bonus_fee_deduction_rate,
                bonus_loss_deduction_rate,
                bonus_funding_deduction_rate,
            ],
        )?;

        if account.account_mode != AccountMode::Live {
            self.recalculate_non_live_account_risk(&input.id)?;
        }
        self.record_snapshot("account_update".into())?;
        self.get_account(&input.id)
    }

    pub fn get_account(&self, account_id: &str) -> AppResult<ExchangeAccount> {
        self.connection
            .query_row(
                "SELECT id, name, exchange, account_mode, wallet_balance, available_balance, snapshot_equity, currency,
                        external_reference, notes, sync_status, sync_error, created_at, last_synced_at,
                        bonus_balance, bonus_fee_deduction_rate, bonus_loss_deduction_rate, bonus_funding_deduction_rate
                 FROM accounts WHERE id = ?1 LIMIT 1",
                params![account_id],
                read_account_row,
            )
            .map_err(Into::into)
    }

    pub fn list_live_accounts(&self) -> AppResult<Vec<ExchangeAccount>> {
        Ok(self
            .fetch_accounts()?
            .into_iter()
            .filter(|account| account.account_mode == AccountMode::Live)
            .collect())
    }

    pub fn begin_sync_job(&self, account_id: &str, exchange: ExchangeKind) -> AppResult<String> {
        let job_id = Uuid::new_v4().to_string();
        self.connection.execute(
            "INSERT INTO sync_jobs (
                id, account_id, exchange, state, started_at, attempt_count, synced_positions, funding_entries
            ) VALUES (?1, ?2, ?3, 'running', ?4, 0, 0, 0)",
            params![job_id, account_id, encode_exchange(exchange), Utc::now().to_rfc3339()],
        )?;
        Ok(job_id)
    }

    pub fn update_sync_job_attempts(&self, job_id: &str, attempts: u32) -> AppResult<()> {
        self.connection.execute(
            "UPDATE sync_jobs SET attempt_count = ?2 WHERE id = ?1",
            params![job_id, attempts],
        )?;
        Ok(())
    }

    pub fn complete_sync_job_success(
        &self,
        job_id: &str,
        attempts: u32,
        synced_positions: usize,
        funding_entries: usize,
    ) -> AppResult<()> {
        self.connection.execute(
            "UPDATE sync_jobs
             SET state = 'success',
                 finished_at = ?2,
                 attempt_count = ?3,
                 synced_positions = ?4,
                 funding_entries = ?5,
                 error_message = NULL
             WHERE id = ?1",
            params![
                job_id,
                Utc::now().to_rfc3339(),
                attempts,
                synced_positions as i64,
                funding_entries as i64,
            ],
        )?;
        Ok(())
    }

    pub fn complete_sync_job_failure(
        &self,
        job_id: &str,
        attempts: u32,
        message: &str,
    ) -> AppResult<()> {
        self.connection.execute(
            "UPDATE sync_jobs
             SET state = 'failed',
                 finished_at = ?2,
                 attempt_count = ?3,
                 error_message = ?4
             WHERE id = ?1",
            params![job_id, Utc::now().to_rfc3339(), attempts, message],
        )?;
        Ok(())
    }

    pub fn sync_live_account(
        &self,
        account_id: &str,
        snapshot: &AccountSnapshot,
        positions: &[SyncedPosition],
        funding_entries: &[FundingEntry],
        job_id: Option<&str>,
    ) -> AppResult<ExchangeAccount> {
        let account = self.get_account(account_id)?;
        if account.account_mode != AccountMode::Live {
            return Err(invalid_input("sync is only available for live accounts"));
        }

        let now = Utc::now();
        self.connection.execute(
            "UPDATE accounts
             SET wallet_balance = ?2,
                 available_balance = ?3,
                 snapshot_equity = ?4,
                 currency = ?5,
                 sync_status = 'active',
                 sync_error = NULL,
                 last_synced_at = ?6
             WHERE id = ?1",
            params![
                account_id,
                snapshot.wallet_balance,
                snapshot.available_balance,
                snapshot.snapshot_equity,
                snapshot.currency,
                now.to_rfc3339(),
            ],
        )?;

        let existing_positions = self.fetch_positions_for_account(account_id)?;
        let mut existing_by_key = existing_positions
            .into_iter()
            .map(|position| (stored_position_key(&position), position))
            .collect::<BTreeMap<_, _>>();

        for position in positions {
            let key = synced_position_key(position);
            if let Some(existing) = existing_by_key.remove(&key) {
                self.update_live_position(&account, &existing.id, position)?;
                if has_material_position_change(&existing, position) {
                    self.record_position_event(build_position_event_from_synced(
                        &account,
                        Some(existing.id),
                        position,
                        PositionEventKind::Adjusted,
                        now,
                        job_id,
                        Some("Live sync adjustment".into()),
                    ))?;
                }
            } else {
                let position_id = self.insert_live_position(&account, position)?;
                self.record_position_event(build_position_event_from_synced(
                    &account,
                    Some(position_id),
                    position,
                    PositionEventKind::Opened,
                    position.opened_at,
                    job_id,
                    Some("Live sync opened".into()),
                ))?;
            }
        }

        for stale_position in existing_by_key.into_values() {
            self.record_position_event(build_position_event_from_position(
                &account,
                &stale_position,
                PositionEventKind::Closed,
                now,
                job_id,
                Some("No longer returned by live sync".into()),
            ))?;
            self.connection.execute(
                "DELETE FROM positions WHERE id = ?1",
                params![stale_position.id],
            )?;
        }

        self.record_balance_event(
            account_id,
            snapshot.wallet_balance,
            snapshot.snapshot_equity,
            now,
            job_id,
        )?;
        self.record_funding_entries(account_id, funding_entries, now, job_id)?;

        self.record_snapshot(format!("live_sync_{}", encode_exchange(account.exchange)))?;
        self.get_account(account_id)
    }

    pub fn mark_sync_error(&self, account_id: &str, message: &str) -> AppResult<()> {
        self.connection.execute(
            "UPDATE accounts
             SET sync_status = 'error',
                 sync_error = ?2
             WHERE id = ?1",
            params![account_id, message],
        )?;
        Ok(())
    }

    pub fn add_manual_position(&self, input: ManualPositionInput) -> AppResult<PortfolioPosition> {
        let position = self.insert_manual_position(input, PositionEventKind::Opened)?;
        self.record_snapshot("manual_position".into())?;
        Ok(position)
    }

    pub fn update_manual_position(
        &self,
        input: UpdateManualPositionInput,
    ) -> AppResult<PortfolioPosition> {
        let existing = self.get_position(&input.id)?;
        let existing_account = self.get_account(&existing.account_id)?;
        if existing_account.account_mode == AccountMode::Live {
            return Err(invalid_input(
                "live-synced positions cannot be edited locally",
            ));
        }

        let target_account = self.get_account(&input.account_id)?;
        if target_account.account_mode == AccountMode::Live {
            return Err(invalid_input(
                "manual positions cannot be moved into live-synced accounts",
            ));
        }
        validate_manual_account_exchange(&target_account, existing.exchange)?;

        if input.entry_price <= 0.0 || input.quantity <= 0.0 {
            return Err(invalid_input("entry price and quantity must be positive"));
        }
        validate_manual_position_numbers(
            input.mark_price,
            input.margin_used,
            input.liquidation_price,
            input.maintenance_margin,
        )?;

        let resolved = self.resolve_position_draft(
            existing.exchange,
            input.exchange_symbol,
            Some(input.symbol),
            input.mark_price,
            input.entry_price,
            input.quantity,
            input.leverage.max(1.0),
        )?;
        let leverage = input.leverage.max(1.0);
        let unrealized_pnl = pnl_amount(
            input.side,
            input.entry_price,
            resolved.mark_price,
            input.quantity,
            resolved.market.as_ref(),
        ) - input.fee_paid.unwrap_or(0.0)
            - input.funding_paid.unwrap_or(0.0);
        let margin_used = input.margin_used.or_else(|| {
            Some(derive_margin_used(
                input.entry_price,
                input.quantity,
                leverage,
                resolved.market.as_ref(),
            ))
        });
        let risk_source =
            manual_position_risk_source(input.liquidation_price, input.maintenance_margin);

        self.connection.execute(
            "UPDATE positions
             SET account_id = ?2,
                 exchange = ?3,
                 exchange_symbol = ?4,
                 margin_mode = ?5,
                 symbol = ?6,
                 side = ?7,
                 quantity = ?8,
                 entry_price = ?9,
                 mark_price = ?10,
                 margin_used = ?11,
                 liquidation_price = ?12,
                 maintenance_margin = ?13,
                 maintenance_margin_rate = ?14,
                 risk_source = ?15,
                 leverage = ?16,
                 unrealized_pnl = ?17,
                 realized_pnl = ?18,
                 fee_paid = ?19,
                 funding_paid = ?20,
                 notes = ?21
             WHERE id = ?1",
            params![
                input.id,
                input.account_id,
                encode_exchange(resolved.exchange),
                resolved.exchange_symbol,
                encode_optional_margin_mode(input.margin_mode),
                resolved.symbol,
                encode_side(input.side),
                input.quantity,
                input.entry_price,
                resolved.mark_price,
                margin_used,
                input.liquidation_price,
                input.maintenance_margin,
                None::<f64>,
                encode_position_risk_source(risk_source),
                leverage,
                unrealized_pnl,
                input.realized_pnl.unwrap_or(existing.realized_pnl),
                input.fee_paid.unwrap_or(0.0),
                input.funding_paid.unwrap_or(0.0),
                normalize_optional_text(input.notes),
            ],
        )?;

        self.recalculate_non_live_account_risk(&existing.account_id)?;
        if existing.account_id != target_account.id {
            self.recalculate_non_live_account_risk(&target_account.id)?;
        }

        let updated = self.get_position(&input.id)?;
        self.record_position_event(build_position_event_from_position(
            &target_account,
            &updated,
            PositionEventKind::Adjusted,
            Utc::now(),
            None,
            Some("Manual position adjusted".into()),
        ))?;
        self.record_snapshot("manual_position_update".into())?;
        Ok(updated)
    }

    pub fn delete_manual_position(&self, position_id: &str) -> AppResult<()> {
        let position = self.get_position(position_id)?;
        let account = self.get_account(&position.account_id)?;
        if account.account_mode == AccountMode::Live {
            return Err(invalid_input(
                "live-synced positions cannot be deleted locally",
            ));
        }

        self.record_position_event(build_position_event_from_position(
            &account,
            &position,
            PositionEventKind::Closed,
            Utc::now(),
            None,
            Some("Manual position removed".into()),
        ))?;
        self.connection
            .execute("DELETE FROM positions WHERE id = ?1", params![position_id])?;
        self.recalculate_non_live_account_risk(&account.id)?;
        self.record_snapshot("manual_position_delete".into())?;
        Ok(())
    }

    pub fn close_manual_position(
        &self,
        input: CloseManualPositionInput,
    ) -> AppResult<CloseManualPositionResult> {
        let position = self.get_position(&input.position_id)?;
        let account = self.get_account(&position.account_id)?;
        if account.account_mode == AccountMode::Live {
            return Err(invalid_input(
                "live-synced positions cannot be closed locally",
            ));
        }
        if input.exit_price <= 0.0 {
            return Err(invalid_input("exit price must be positive"));
        }

        let quantity_to_close = input.quantity.unwrap_or(position.quantity);
        if quantity_to_close <= 0.0 || quantity_to_close - position.quantity > 1e-9 {
            return Err(invalid_input(
                "close quantity must be positive and less than or equal to the open quantity",
            ));
        }

        let market = self.resolve_exchange_market(
            position.exchange,
            position.exchange_symbol.as_deref(),
            Some(&position.symbol),
        )?;
        let close_fee = input.fee_paid.unwrap_or(0.0).max(0.0);
        let close_funding = input.funding_paid.unwrap_or(0.0);
        let closed_at = input.closed_at.unwrap_or_else(Utc::now);
        let realized_pnl =
            pnl_amount(
                position.side,
                position.entry_price,
                input.exit_price,
                quantity_to_close,
                market.as_ref(),
            ) - close_fee
                - close_funding;

        let closed_trade = ClosedTradeInsert {
            account_id: account.id.clone(),
            account_name: account.name.clone(),
            position_id: Some(position.id.clone()),
            exchange: position.exchange,
            exchange_symbol: position.exchange_symbol.clone(),
            margin_mode: position.margin_mode,
            symbol: position.symbol.clone(),
            side: position.side,
            quantity: quantity_to_close,
            entry_price: position.entry_price,
            exit_price: input.exit_price,
            leverage: position.leverage,
            realized_pnl,
            fee_paid: close_fee,
            funding_paid: close_funding,
            opened_at: position.opened_at,
            closed_at,
            note: normalize_optional_text(input.note),
        };
        let closed_trade_record = self.record_closed_trade(closed_trade)?;

        let fully_closed = (position.quantity - quantity_to_close).abs() <= 1e-9;
        if fully_closed {
            let closed_position = PortfolioPosition {
                quantity: quantity_to_close,
                mark_price: Some(input.exit_price),
                realized_pnl: position.realized_pnl + realized_pnl,
                fee_paid: position.fee_paid + close_fee,
                funding_paid: position.funding_paid + close_funding,
                ..position.clone()
            };
            self.record_position_event(build_position_event_from_position(
                &account,
                &closed_position,
                PositionEventKind::Closed,
                closed_at,
                None,
                Some("Manual position closed".into()),
            ))?;
            self.connection
                .execute("DELETE FROM positions WHERE id = ?1", params![position.id])?;
            self.recalculate_non_live_account_risk(&account.id)?;
            self.record_snapshot("manual_position_close".into())?;
            return Ok(CloseManualPositionResult {
                closed_trade: closed_trade_record,
                remaining_position: None,
            });
        }

        let remaining_quantity = position.quantity - quantity_to_close;
        let next_mark_price = Some(input.exit_price);
        let next_realized_pnl = position.realized_pnl + realized_pnl;
        let next_fee_paid = position.fee_paid + close_fee;
        let next_funding_paid = position.funding_paid + close_funding;
        let next_unrealized_pnl =
            pnl_amount(
                position.side,
                position.entry_price,
                input.exit_price,
                remaining_quantity,
                market.as_ref(),
            ) - next_fee_paid
                - next_funding_paid;

        self.connection.execute(
            "UPDATE positions
             SET quantity = ?2,
                 mark_price = ?3,
                 unrealized_pnl = ?4,
                 realized_pnl = ?5,
                 fee_paid = ?6,
                 funding_paid = ?7
             WHERE id = ?1",
            params![
                position.id,
                remaining_quantity,
                next_mark_price,
                next_unrealized_pnl,
                next_realized_pnl,
                next_fee_paid,
                next_funding_paid,
            ],
        )?;
        self.recalculate_non_live_account_risk(&account.id)?;
        let remaining = self.get_position(&position.id)?;
        let closed_slice = PortfolioPosition {
            quantity: quantity_to_close,
            mark_price: Some(input.exit_price),
            realized_pnl: realized_pnl,
            fee_paid: close_fee,
            funding_paid: close_funding,
            ..position.clone()
        };
        self.record_position_event(build_position_event_from_position(
            &account,
            &closed_slice,
            PositionEventKind::Closed,
            closed_at,
            None,
            Some("Manual position partially closed".into()),
        ))?;
        self.record_position_event(build_position_event_from_position(
            &account,
            &remaining,
            PositionEventKind::Adjusted,
            closed_at,
            None,
            Some("Manual position resized after partial close".into()),
        ))?;
        self.record_snapshot("manual_position_partial_close".into())?;

        Ok(CloseManualPositionResult {
            closed_trade: closed_trade_record,
            remaining_position: Some(remaining),
        })
    }

    pub fn import_csv(&self, input: CsvImportInput) -> AppResult<CsvImportResult> {
        let (rows, mut rejected_rows) = parse_csv(&input.csv)?;
        if rows.is_empty() {
            return Err(invalid_input(
                "csv payload did not contain any valid positions",
            ));
        }

        let target_account_id = if let Some(target_account_id) = input.target_account_id.clone() {
            let account = self.get_account(&target_account_id)?;
            if account.account_mode == AccountMode::Live {
                return Err(invalid_input(
                    "CSV imports cannot be written into a live-synced account",
                ));
            }
            Some(target_account_id)
        } else {
            None
        };
        let mut created_import_account_id = None::<String>;
        let mut imported_count = 0usize;

        for row in rows {
            let account_id = if let Some(account_id) = target_account_id.as_ref() {
                account_id.clone()
            } else if let Some(account_id) = created_import_account_id.as_ref() {
                account_id.clone()
            } else {
                let account_id = self
                    .create_account_with_mode(
                        CreateAccountInput {
                            name: format!(
                                "{} import {}",
                                capitalize_exchange(input.exchange),
                                Utc::now().format("%b %d")
                            ),
                            exchange: input.exchange,
                            wallet_balance: 0.0,
                            notes: Some("Auto-created from CSV import".into()),
                            bonus_balance: None,
                            bonus_fee_deduction_rate: None,
                            bonus_loss_deduction_rate: None,
                            bonus_funding_deduction_rate: None,
                        },
                        AccountMode::Import,
                        None,
                    )?
                    .id;
                created_import_account_id = Some(account_id.clone());
                account_id
            };

            match self.insert_manual_position(
                ManualPositionInput {
                    account_id: account_id.clone(),
                    exchange: input.exchange,
                    exchange_symbol: row.data.exchange_symbol.clone(),
                    symbol: row.data.symbol.clone(),
                    margin_mode: row.data.margin_mode,
                    side: row.data.side,
                    quantity: row.data.quantity,
                    entry_price: row.data.entry_price,
                    mark_price: row.data.mark_price,
                    margin_used: row.data.margin_used,
                    liquidation_price: row.data.liquidation_price,
                    maintenance_margin: row.data.maintenance_margin,
                    leverage: row.data.leverage,
                    realized_pnl: Some(row.data.realized_pnl),
                    fee_paid: Some(row.data.fee_paid),
                    funding_paid: Some(row.data.funding_paid),
                    notes: Some("Imported from CSV".into()),
                },
                PositionEventKind::Imported,
            ) {
                Ok(_) => imported_count += 1,
                Err(error) => rejected_rows.push(format!("row {}: {}", row.row_number, error)),
            }
        }

        if imported_count == 0 {
            if target_account_id.is_none() {
                if let Some(account_id) = created_import_account_id.take() {
                    let _ = self.delete_account(&account_id);
                }
            }
            return Err(invalid_input(if rejected_rows.is_empty() {
                "csv payload did not contain any importable positions".to_string()
            } else {
                format!(
                    "csv payload did not contain any importable positions; first rejection: {}",
                    rejected_rows[0]
                )
            }));
        }

        let snapshot_id = self.record_snapshot("csv_import".into())?;
        Ok(CsvImportResult {
            imported_count,
            rejected_rows,
            snapshot_id,
        })
    }

    pub fn bootstrap_state(&self) -> AppResult<BootstrapState> {
        self.bootstrap_state_with_runtime(LanStatus::default(), AutoSyncStatus::default())
    }

    pub fn bootstrap_state_with_runtime(
        &self,
        lan_status: LanStatus,
        auto_sync_status: AutoSyncStatus,
    ) -> AppResult<BootstrapState> {
        let raw_accounts = self.fetch_accounts()?;
        let positions = self.fetch_positions()?;
        let accounts = metrics::enrich_accounts(&raw_accounts, &positions);
        let latest_sync_jobs = self.fetch_latest_sync_jobs()?;
        let account_sync_health = metrics::account_sync_health(&accounts, &latest_sync_jobs);
        let sync_health_summary = metrics::summarize_sync_health(&accounts, &latest_sync_jobs);
        let latest_snapshot = self.latest_snapshot_meta()?;
        let notionals = self.position_notionals(&positions)?;
        let summary = metrics::summarize_with_notionals(
            &accounts,
            &positions,
            &notionals,
            latest_snapshot
                .map(|snapshot| format!("Snapshot · {}", snapshot.source))
                .unwrap_or_else(|| "Local state only".into()),
        );
        let exposure = metrics::exposure_with_notionals(&positions, &notionals);
        let performance = metrics::performance(&accounts, &positions);

        Ok(BootstrapState {
            accounts,
            account_sync_health,
            sync_health_summary,
            positions,
            exposure,
            summary,
            performance,
            portfolio_history: self.fetch_portfolio_history(PORTFOLIO_HISTORY_LIMIT)?,
            account_history: self.fetch_account_history_series(ACCOUNT_HISTORY_LIMIT)?,
            recent_funding_entries: self.fetch_recent_funding_entries(12)?,
            recent_position_events: self.fetch_recent_position_events(POSITION_EVENT_LIMIT)?,
            recent_closed_trades: self.fetch_recent_closed_trades(CLOSED_TRADE_LIMIT)?,
            recent_sync_jobs: self.fetch_recent_sync_jobs(12)?,
            lan_status,
            auto_sync_status,
        })
    }

    pub fn query_position_events(
        &self,
        query: PositionEventQueryInput,
    ) -> AppResult<Vec<PositionEventRecord>> {
        if let (Some(started_at), Some(ended_at)) =
            (query.started_at.as_ref(), query.ended_at.as_ref())
        {
            if ended_at < started_at {
                return Err(invalid_input(
                    "position event query endedAt must be greater than or equal to startedAt",
                ));
            }
        }

        let mut sql = String::from(
            "SELECT id, account_id, account_name, position_id, exchange, event_kind, exchange_symbol, margin_mode,
                    symbol, side, quantity, entry_price, mark_price, margin_used, liquidation_price, maintenance_margin,
                    leverage, unrealized_pnl, realized_pnl, fee_paid, funding_paid, event_time, source_job_id, note
             FROM position_events",
        );
        let mut clauses = Vec::new();
        let mut params = Vec::<Value>::new();

        if let Some(account_id) = query
            .account_id
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty())
        {
            clauses.push("account_id = ?");
            params.push(Value::Text(account_id.to_string()));
        }

        if let Some(exchange) = query.exchange {
            clauses.push("exchange = ?");
            params.push(Value::Text(encode_exchange(exchange).to_string()));
        }

        if let Some(event_kind) = query.event_kind {
            clauses.push("event_kind = ?");
            params.push(Value::Text(
                encode_position_event_kind(event_kind).to_string(),
            ));
        }

        if let Some(symbol) = query
            .symbol
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty())
        {
            clauses.push(
                "(UPPER(symbol) = UPPER(?) OR UPPER(COALESCE(exchange_symbol, '')) = UPPER(?))",
            );
            params.push(Value::Text(symbol.to_string()));
            params.push(Value::Text(symbol.to_string()));
        }

        if let Some(started_at) = query.started_at {
            clauses.push("event_time >= ?");
            params.push(Value::Text(started_at.to_rfc3339()));
        }

        if let Some(ended_at) = query.ended_at {
            clauses.push("event_time <= ?");
            params.push(Value::Text(ended_at.to_rfc3339()));
        }

        if !clauses.is_empty() {
            sql.push_str(" WHERE ");
            sql.push_str(&clauses.join(" AND "));
        }

        sql.push_str(" ORDER BY event_time DESC, id DESC LIMIT ?");
        params.push(Value::Integer(
            query.limit.unwrap_or(128).clamp(1, 1024) as i64
        ));

        let mut statement = self.connection.prepare(&sql)?;
        let rows = statement.query_map(params_from_iter(params.iter()), read_position_event_row)?;

        rows.collect::<Result<Vec<_>, _>>().map_err(Into::into)
    }

    pub fn query_closed_trades(
        &self,
        query: ClosedTradeQueryInput,
    ) -> AppResult<Vec<ClosedTradeRecord>> {
        if let (Some(started_at), Some(ended_at)) =
            (query.started_at.as_ref(), query.ended_at.as_ref())
        {
            if ended_at < started_at {
                return Err(invalid_input(
                    "closed trade query endedAt must be greater than or equal to startedAt",
                ));
            }
        }

        let mut sql = String::from(
            "SELECT id, account_id, account_name, position_id, exchange, exchange_symbol, margin_mode,
                    symbol, side, quantity, entry_price, exit_price, leverage, realized_pnl,
                    fee_paid, funding_paid, opened_at, closed_at, note
             FROM closed_trades",
        );
        let mut clauses = Vec::new();
        let mut params = Vec::<Value>::new();

        if let Some(account_id) = query
            .account_id
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty())
        {
            clauses.push("account_id = ?");
            params.push(Value::Text(account_id.to_string()));
        }

        if let Some(exchange) = query.exchange {
            clauses.push("exchange = ?");
            params.push(Value::Text(encode_exchange(exchange).to_string()));
        }

        if let Some(symbol) = query
            .symbol
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty())
        {
            clauses.push(
                "(UPPER(symbol) = UPPER(?) OR UPPER(COALESCE(exchange_symbol, '')) = UPPER(?))",
            );
            params.push(Value::Text(symbol.to_string()));
            params.push(Value::Text(symbol.to_string()));
        }

        if let Some(started_at) = query.started_at {
            clauses.push("closed_at >= ?");
            params.push(Value::Text(started_at.to_rfc3339()));
        }

        if let Some(ended_at) = query.ended_at {
            clauses.push("closed_at <= ?");
            params.push(Value::Text(ended_at.to_rfc3339()));
        }

        if !clauses.is_empty() {
            sql.push_str(" WHERE ");
            sql.push_str(&clauses.join(" AND "));
        }

        sql.push_str(" ORDER BY closed_at DESC, id DESC LIMIT ?");
        params.push(Value::Integer(
            query.limit.unwrap_or(128).clamp(1, 1024) as i64
        ));

        let mut statement = self.connection.prepare(&sql)?;
        let rows = statement.query_map(params_from_iter(params.iter()), read_closed_trade_row)?;

        rows.collect::<Result<Vec<_>, _>>().map_err(Into::into)
    }

    pub fn list_quote_refresh_targets(&self) -> AppResult<Vec<MarketQuoteRefreshTarget>> {
        let mut statement = self.connection.prepare(
            "SELECT DISTINCT positions.exchange, positions.exchange_symbol, positions.symbol
             FROM positions
             JOIN accounts ON accounts.id = positions.account_id
             WHERE accounts.account_mode != 'live'
               AND positions.exchange IN ('blofin', 'hyperliquid')
               AND (
                    TRIM(COALESCE(positions.exchange_symbol, '')) != ''
                    OR TRIM(positions.symbol) != ''
               )
             ORDER BY positions.exchange, COALESCE(positions.exchange_symbol, positions.symbol)",
        )?;

        let rows = statement.query_map([], |row| {
            Ok(MarketQuoteRefreshTarget {
                exchange: decode_exchange(row.get::<_, String>(0)?.as_str()),
                exchange_symbol: normalize_symbol_like(row.get::<_, Option<String>>(1)?),
                symbol: row.get::<_, String>(2)?.trim().to_uppercase(),
            })
        })?;

        rows.collect::<Result<Vec<_>, _>>().map_err(Into::into)
    }

    pub fn apply_market_quotes(&self, quotes: &[MarketQuote]) -> AppResult<usize> {
        if quotes.is_empty() {
            return Ok(0);
        }

        self.cache_market_quotes(quotes)?;

        let mut updated = 0usize;
        for quote in quotes {
            updated += self.apply_market_quote_to_positions(quote)?;
        }

        if updated > 0 {
            self.record_snapshot("market_quote_refresh".into())?;
        }

        Ok(updated)
    }

    pub fn cache_market_quotes(&self, quotes: &[MarketQuote]) -> AppResult<usize> {
        if quotes.is_empty() {
            return Ok(0);
        }

        let cached_at = Utc::now();
        for quote in quotes {
            self.upsert_market_quote(quote, cached_at)?;
        }

        Ok(quotes.len())
    }

    pub fn upsert_exchange_markets(&self, markets: &[ExchangeMarket]) -> AppResult<usize> {
        if markets.is_empty() {
            return Ok(0);
        }

        let updated_at = Utc::now().to_rfc3339();
        let mut written = 0usize;
        for market in markets {
            written += self.connection.execute(
                "INSERT INTO exchange_markets (
                    exchange, exchange_symbol, symbol, base_asset, quote_asset, settle_asset,
                    contract_type, contract_value, price_tick_size, quantity_step, min_quantity,
                    max_leverage, mark_price, oracle_price, funding_rate, next_funding_time,
                    is_active, updated_at
                ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18)
                ON CONFLICT(exchange, exchange_symbol) DO UPDATE SET
                    symbol = excluded.symbol,
                    base_asset = excluded.base_asset,
                    quote_asset = excluded.quote_asset,
                    settle_asset = excluded.settle_asset,
                    contract_type = excluded.contract_type,
                    contract_value = excluded.contract_value,
                    price_tick_size = excluded.price_tick_size,
                    quantity_step = excluded.quantity_step,
                    min_quantity = excluded.min_quantity,
                    max_leverage = excluded.max_leverage,
                    mark_price = excluded.mark_price,
                    oracle_price = excluded.oracle_price,
                    funding_rate = excluded.funding_rate,
                    next_funding_time = excluded.next_funding_time,
                    is_active = excluded.is_active,
                    updated_at = excluded.updated_at",
                params![
                    encode_exchange(market.exchange),
                    market.exchange_symbol.trim().to_uppercase(),
                    market.symbol.trim().to_uppercase(),
                    market.base_asset.trim().to_uppercase(),
                    market.quote_asset.trim().to_uppercase(),
                    market
                        .settle_asset
                        .as_ref()
                        .map(|value| value.trim().to_uppercase())
                        .filter(|value| !value.is_empty()),
                    market.contract_type.trim(),
                    market.contract_value,
                    market.price_tick_size,
                    market.quantity_step,
                    market.min_quantity,
                    market.max_leverage,
                    market.mark_price,
                    market.oracle_price,
                    market.funding_rate,
                    market.next_funding_time.as_ref().map(DateTime::to_rfc3339),
                    market.is_active as i64,
                    updated_at,
                ],
            )?;
        }

        Ok(written)
    }

    pub fn upsert_exchange_risk_tiers(&self, tiers: &[ExchangeRiskTier]) -> AppResult<usize> {
        if tiers.is_empty() {
            return Ok(0);
        }

        let updated_at = Utc::now().to_rfc3339();
        let mut written = 0usize;
        for tier in tiers {
            written += self.connection.execute(
                "INSERT INTO exchange_risk_tiers (
                    exchange, exchange_symbol, margin_mode, tier_basis, lower_bound, upper_bound,
                    maintenance_margin_rate, maintenance_amount_deduction, max_leverage, updated_at
                ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)
                ON CONFLICT(exchange, exchange_symbol, margin_mode, tier_basis, lower_bound) DO UPDATE SET
                    upper_bound = excluded.upper_bound,
                    maintenance_margin_rate = excluded.maintenance_margin_rate,
                    maintenance_amount_deduction = excluded.maintenance_amount_deduction,
                    max_leverage = excluded.max_leverage,
                    updated_at = excluded.updated_at",
                params![
                    encode_exchange(tier.exchange),
                    tier.exchange_symbol.trim().to_uppercase(),
                    encode_risk_margin_mode(tier.margin_mode),
                    encode_risk_tier_basis(tier.tier_basis),
                    tier.lower_bound,
                    tier.upper_bound,
                    tier.maintenance_margin_rate,
                    tier.maintenance_amount_deduction,
                    tier.max_leverage,
                    updated_at,
                ],
            )?;
        }

        Ok(written)
    }

    pub fn list_exchange_risk_tiers(
        &self,
        exchange: ExchangeKind,
        exchange_symbol: &str,
        margin_mode: Option<MarginMode>,
    ) -> AppResult<Vec<ExchangeRiskTier>> {
        let normalized_symbol = exchange_symbol.trim().to_uppercase();
        let requested_margin_mode = encode_risk_margin_mode(margin_mode);
        let mut statement = self.connection.prepare(
            "SELECT exchange, exchange_symbol, margin_mode, tier_basis, lower_bound, upper_bound,
                    maintenance_margin_rate, maintenance_amount_deduction, max_leverage
             FROM exchange_risk_tiers
             WHERE exchange = ?1
               AND UPPER(exchange_symbol) = UPPER(?2)
               AND (?3 = '' OR margin_mode = ?3 OR margin_mode = '')
             ORDER BY lower_bound ASC",
        )?;
        let rows = statement.query_map(
            params![encode_exchange(exchange), normalized_symbol, requested_margin_mode],
            read_exchange_risk_tier_row,
        )?;
        rows.collect::<Result<Vec<_>, _>>().map_err(Into::into)
    }

    pub fn list_exchange_markets(&self, exchange: ExchangeKind) -> AppResult<Vec<ExchangeMarket>> {
        let mut statement = self.connection.prepare(
            "SELECT exchange, exchange_symbol, symbol, base_asset, quote_asset, settle_asset,
                    contract_type, contract_value, price_tick_size, quantity_step, min_quantity,
                    max_leverage, mark_price, oracle_price, funding_rate, next_funding_time,
                    is_active
             FROM exchange_markets
             WHERE exchange = ?1
             ORDER BY is_active DESC, symbol ASC, exchange_symbol ASC",
        )?;
        let rows =
            statement.query_map(params![encode_exchange(exchange)], read_exchange_market_row)?;
        rows.collect::<Result<Vec<_>, _>>().map_err(Into::into)
    }

    fn create_account_with_mode(
        &self,
        input: CreateAccountInput,
        account_mode: AccountMode,
        external_reference: Option<String>,
    ) -> AppResult<ExchangeAccount> {
        if input.name.trim().is_empty() {
            return Err(invalid_input("account name cannot be empty"));
        }

        let now = Utc::now();
        let bonus_balance = input.bonus_balance.unwrap_or(0.0).max(0.0);
        let bonus_fee_deduction_rate = validate_bonus_rate(
            input.bonus_fee_deduction_rate.unwrap_or(0.0),
            "bonus fee deduction rate",
        )?;
        let bonus_loss_deduction_rate = validate_bonus_rate(
            input.bonus_loss_deduction_rate.unwrap_or(0.0),
            "bonus loss deduction rate",
        )?;
        let bonus_funding_deduction_rate = validate_bonus_rate(
            input.bonus_funding_deduction_rate.unwrap_or(0.0),
            "bonus funding deduction rate",
        )?;
        let identifier = Uuid::new_v4().to_string();
        self.connection.execute(
            "INSERT INTO accounts (
                id, name, exchange, account_mode, wallet_balance, available_balance, snapshot_equity,
                currency, external_reference, notes, sync_status, sync_error, created_at,
                bonus_balance, bonus_fee_deduction_rate, bonus_loss_deduction_rate,
                bonus_funding_deduction_rate
            ) VALUES (?1, ?2, ?3, ?4, ?5, ?5, ?5, ?6, ?7, ?8, ?9, NULL, ?10, ?11, ?12, ?13, ?14)",
            params![
                identifier,
                input.name.trim(),
                encode_exchange(input.exchange),
                encode_account_mode(account_mode),
                input.wallet_balance.max(0.0),
                default_currency_for_exchange(input.exchange),
                external_reference,
                input.notes,
                encode_sync_status(match account_mode {
                    AccountMode::Live => SyncStatus::Active,
                    _ => SyncStatus::Manual,
                }),
                now.to_rfc3339(),
                bonus_balance,
                bonus_fee_deduction_rate,
                bonus_loss_deduction_rate,
                bonus_funding_deduction_rate,
            ],
        )?;

        let account = self.get_account(&identifier)?;
        self.record_snapshot(format!("{}_account", encode_account_mode(account_mode)))?;
        Ok(account)
    }

    fn upsert_market_quote(&self, quote: &MarketQuote, updated_at: DateTime<Utc>) -> AppResult<()> {
        self.connection.execute(
            "INSERT INTO market_quotes (
                exchange, exchange_symbol, symbol, mark_price, oracle_price, funding_rate,
                next_funding_time, as_of, updated_at
            ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)
            ON CONFLICT(exchange, exchange_symbol) DO UPDATE SET
                symbol = excluded.symbol,
                mark_price = excluded.mark_price,
                oracle_price = excluded.oracle_price,
                funding_rate = excluded.funding_rate,
                next_funding_time = excluded.next_funding_time,
                as_of = excluded.as_of,
                updated_at = excluded.updated_at",
            params![
                encode_exchange(quote.exchange),
                quote.exchange_symbol.trim().to_uppercase(),
                quote.symbol.trim().to_uppercase(),
                quote.mark_price,
                quote.oracle_price,
                quote.funding_rate,
                quote.next_funding_time.as_ref().map(DateTime::to_rfc3339),
                quote.as_of.to_rfc3339(),
                updated_at.to_rfc3339(),
            ],
        )?;

        Ok(())
    }

    fn apply_market_quote_to_positions(&self, quote: &MarketQuote) -> AppResult<usize> {
        let next_mark_price = quote.mark_price.or(quote.oracle_price);
        let Some(next_mark_price) = next_mark_price else {
            return Ok(0);
        };

        let canonical_exchange_symbol = quote.exchange_symbol.trim().to_uppercase();
        let canonical_symbol = quote.symbol.trim().to_uppercase();
        let mut statement = self.connection.prepare(
            "SELECT positions.id, positions.account_id, positions.exchange_symbol, positions.symbol,
                    positions.side, positions.entry_price, positions.quantity, positions.fee_paid,
                    positions.funding_paid, positions.mark_price, positions.unrealized_pnl
             FROM positions
             JOIN accounts ON accounts.id = positions.account_id
             WHERE accounts.account_mode != 'live'
               AND positions.exchange = ?1
               AND (
                    UPPER(COALESCE(positions.exchange_symbol, '')) = UPPER(?2)
                    OR UPPER(positions.symbol) = UPPER(?3)
               )",
        )?;
        let rows = statement.query_map(
            params![
                encode_exchange(quote.exchange),
                canonical_exchange_symbol.as_str(),
                canonical_symbol.as_str(),
            ],
            |row| {
                Ok(QuoteRepriceRow {
                    id: row.get(0)?,
                    account_id: row.get(1)?,
                    exchange_symbol: row.get(2)?,
                    symbol: row.get(3)?,
                    side: decode_side(row.get::<_, String>(4)?.as_str()),
                    entry_price: row.get(5)?,
                    quantity: row.get(6)?,
                    fee_paid: row.get(7)?,
                    funding_paid: row.get(8)?,
                    mark_price: row.get(9)?,
                    unrealized_pnl: row.get(10)?,
                })
            },
        )?;
        let rows = rows.collect::<Result<Vec<_>, _>>()?;

        let market = self.resolve_exchange_market(
            quote.exchange,
            Some(&canonical_exchange_symbol),
            Some(&canonical_symbol),
        )?;

        let mut updated = 0usize;
        let mut affected_accounts = Vec::<String>::new();
        for row in rows {
            let next_unrealized = pnl_amount(
                row.side,
                row.entry_price,
                next_mark_price,
                row.quantity,
                market.as_ref(),
            ) - row.fee_paid
                - row.funding_paid;
            let exchange_symbol_changed = row
                .exchange_symbol
                .as_deref()
                .map(str::trim)
                .map(|value| !value.eq_ignore_ascii_case(&canonical_exchange_symbol))
                .unwrap_or(true);
            let symbol_changed = !row.symbol.eq_ignore_ascii_case(&canonical_symbol);
            if !approx_equal_optional(row.mark_price, Some(next_mark_price))
                || !approx_equal(row.unrealized_pnl, next_unrealized)
                || exchange_symbol_changed
                || symbol_changed
            {
                updated += self.connection.execute(
                    "UPDATE positions
                     SET exchange_symbol = ?2,
                         symbol = ?3,
                         mark_price = ?4,
                         unrealized_pnl = ?5
                     WHERE id = ?1",
                    params![
                        row.id,
                        canonical_exchange_symbol.as_str(),
                        canonical_symbol.as_str(),
                        next_mark_price,
                        next_unrealized,
                    ],
                )?;
                if !affected_accounts.iter().any(|account_id| account_id == &row.account_id) {
                    affected_accounts.push(row.account_id.clone());
                }
            }
        }

        for account_id in affected_accounts {
            self.recalculate_non_live_account_risk(&account_id)?;
        }

        Ok(updated)
    }

    fn recalculate_non_live_account_risk(&self, account_id: &str) -> AppResult<()> {
        let account = self.get_account(account_id)?;
        if account.account_mode == AccountMode::Live {
            return Ok(());
        }

        let positions = self.fetch_positions_for_account(account_id)?;
        if positions.is_empty() {
            return Ok(());
        }

        #[derive(Clone)]
        struct PreparedPosition {
            position: PortfolioPosition,
            market: Option<ExchangeMarket>,
            tiers: Vec<ExchangeRiskTier>,
            risk_source: PositionRiskSource,
            margin_used: f64,
            current_required: f64,
        }

        let mut prepared = Vec::<PreparedPosition>::new();
        for position in &positions {
            let market = self.resolve_exchange_market(
                position.exchange,
                position.exchange_symbol.as_deref(),
                Some(&position.symbol),
            )?;
            let mark_price = position.mark_price.unwrap_or(position.entry_price);
            let risk_source = effective_position_risk_source(position);
            let margin_used = position.margin_used.unwrap_or_else(|| {
                derive_margin_used(
                    position.entry_price,
                    position.quantity,
                    position.leverage,
                    market.as_ref(),
                )
            });
            let tiers = if risk_source == PositionRiskSource::LocalEngine {
                match position
                    .exchange_symbol
                    .as_deref()
                    .or_else(|| market.as_ref().map(|item| item.exchange_symbol.as_str()))
                {
                    Some(exchange_symbol) => self.list_exchange_risk_tiers(
                        position.exchange,
                        exchange_symbol,
                        position.margin_mode,
                    )?,
                    None => Vec::new(),
                }
            } else {
                Vec::new()
            };
            let current_selection = if risk_source == PositionRiskSource::LocalEngine {
                current_tier_selection(
                    position.exchange,
                    position.quantity,
                    market.as_ref(),
                    mark_price,
                    &tiers,
                )
            } else {
                None
            };
            let current_required = match (position.exchange, current_selection) {
                (ExchangeKind::Blofin, Some(selection)) => {
                    blofin_required_amount(
                        position.quantity,
                        market.as_ref(),
                        mark_price,
                        selection.maintenance_margin_rate,
                    )
                }
                (ExchangeKind::Hyperliquid, Some(selection)) => {
                    hyperliquid_required_amount(
                        position.quantity,
                        market.as_ref(),
                        mark_price,
                        selection,
                    )
                }
                _ => 0.0,
            };
            prepared.push(PreparedPosition {
                position: position.clone(),
                market,
                tiers,
                risk_source,
                margin_used,
                current_required,
            });
        }

        for item in &prepared {
            let position = &item.position;
            if item.risk_source != PositionRiskSource::LocalEngine {
                continue;
            }

            let mut next_margin_used = item.margin_used;
            let mut next_liquidation_price = None::<f64>;
            let mut next_maintenance_margin = None::<f64>;
            let mut next_maintenance_margin_rate = None::<f64>;

            if let Some(margin_mode) = position.margin_mode {
                if let Some(selection) = current_tier_selection(
                    position.exchange,
                    position.quantity,
                    item.market.as_ref(),
                    position.mark_price.unwrap_or(position.entry_price),
                    &item.tiers,
                ) {
                    next_maintenance_margin =
                        Some(maintenance_margin_amount(
                            position.quantity,
                            item.market.as_ref(),
                            position.mark_price.unwrap_or(position.entry_price),
                            selection,
                        ));
                    next_maintenance_margin_rate = Some(selection.maintenance_margin_rate);

                    match (position.exchange, margin_mode) {
                        (ExchangeKind::Blofin, MarginMode::Isolated) => {
                            next_liquidation_price = estimate_blofin_liquidation_price(
                                position.side,
                                next_margin_used,
                                0.0,
                                position.entry_price,
                                position.quantity,
                                item.market.as_ref(),
                                selection.maintenance_margin_rate,
                            );
                        }
                        (ExchangeKind::Blofin, MarginMode::Cross) => {
                            let collateral_pool = account.wallet_balance
                                + account.bonus_balance
                                - prepared
                                    .iter()
                                    .filter(|other| {
                                        other.position.id != position.id
                                            && other.position.exchange == position.exchange
                                            && other.position.margin_mode == Some(MarginMode::Isolated)
                                    })
                                    .map(|other| other.margin_used)
                                    .sum::<f64>()
                                + prepared
                                    .iter()
                                    .filter(|other| {
                                        other.position.id != position.id
                                            && other.position.exchange == position.exchange
                                            && other.position.margin_mode == Some(MarginMode::Cross)
                                    })
                                    .map(|other| other.position.unrealized_pnl)
                                    .sum::<f64>();
                            let other_required = prepared
                                .iter()
                                .filter(|other| {
                                    other.position.id != position.id
                                        && other.position.exchange == position.exchange
                                        && other.position.margin_mode == Some(MarginMode::Cross)
                                })
                                .map(|other| other.current_required)
                                .sum::<f64>();
                            next_liquidation_price = estimate_blofin_liquidation_price(
                                position.side,
                                collateral_pool,
                                other_required,
                                position.entry_price,
                                position.quantity,
                                item.market.as_ref(),
                                selection.maintenance_margin_rate,
                            );
                        }
                        (ExchangeKind::Hyperliquid, MarginMode::Isolated) => {
                            next_liquidation_price = estimate_hyperliquid_liquidation_price(
                                position.side,
                                next_margin_used,
                                0.0,
                                position.entry_price,
                                position.quantity,
                                item.market.as_ref(),
                                &item.tiers,
                            );
                        }
                        (ExchangeKind::Hyperliquid, MarginMode::Cross) => {
                            let collateral_pool = account.wallet_balance
                                + account.bonus_balance
                                - prepared
                                    .iter()
                                    .filter(|other| {
                                        other.position.id != position.id
                                            && other.position.exchange == position.exchange
                                            && other.position.margin_mode == Some(MarginMode::Isolated)
                                    })
                                    .map(|other| other.margin_used)
                                    .sum::<f64>()
                                + prepared
                                    .iter()
                                    .filter(|other| {
                                        other.position.id != position.id
                                            && other.position.exchange == position.exchange
                                            && other.position.margin_mode == Some(MarginMode::Cross)
                                    })
                                    .map(|other| other.position.unrealized_pnl)
                                    .sum::<f64>();
                            let other_required = prepared
                                .iter()
                                .filter(|other| {
                                    other.position.id != position.id
                                        && other.position.exchange == position.exchange
                                        && other.position.margin_mode == Some(MarginMode::Cross)
                                })
                                .map(|other| other.current_required)
                                .sum::<f64>();
                            next_liquidation_price = estimate_hyperliquid_liquidation_price(
                                position.side,
                                collateral_pool,
                                other_required,
                                position.entry_price,
                                position.quantity,
                                item.market.as_ref(),
                                &item.tiers,
                            );
                        }
                        _ => {
                            next_maintenance_margin = None;
                            next_maintenance_margin_rate = None;
                        }
                    }
                }
            }

            if position.exchange == ExchangeKind::Blofin || position.exchange == ExchangeKind::Hyperliquid {
                next_margin_used = derive_margin_used(
                    position.entry_price,
                    position.quantity,
                    position.leverage,
                    item.market.as_ref(),
                );
            }

            self.connection.execute(
                "UPDATE positions
                 SET margin_used = ?2,
                     liquidation_price = ?3,
                     maintenance_margin = ?4,
                     maintenance_margin_rate = ?5,
                     risk_source = ?6
                 WHERE id = ?1",
                params![
                    position.id,
                    Some(next_margin_used),
                    next_liquidation_price,
                    next_maintenance_margin,
                    next_maintenance_margin_rate,
                    encode_position_risk_source(PositionRiskSource::LocalEngine),
                ],
            )?;
        }

        Ok(())
    }

    fn insert_manual_position(
        &self,
        input: ManualPositionInput,
        event_kind: PositionEventKind,
    ) -> AppResult<PortfolioPosition> {
        let account = self.get_account(&input.account_id)?;
        if account.account_mode == AccountMode::Live {
            return Err(invalid_input(
                "manual positions cannot be added to live-synced accounts",
            ));
        }
        validate_manual_account_exchange(&account, input.exchange)?;
        if input.entry_price <= 0.0 || input.quantity <= 0.0 {
            return Err(invalid_input("entry price and quantity must be positive"));
        }
        validate_manual_position_numbers(
            input.mark_price,
            input.margin_used,
            input.liquidation_price,
            input.maintenance_margin,
        )?;

        let resolved = self.resolve_position_draft(
            input.exchange,
            input.exchange_symbol,
            Some(input.symbol),
            input.mark_price,
            input.entry_price,
            input.quantity,
            input.leverage.max(1.0),
        )?;
        let leverage = input.leverage.max(1.0);
        let opened_at = Utc::now();
        let unrealized_pnl = pnl_amount(
            input.side,
            input.entry_price,
            resolved.mark_price,
            input.quantity,
            resolved.market.as_ref(),
        ) - input.fee_paid.unwrap_or(0.0)
            - input.funding_paid.unwrap_or(0.0);
        let margin_used = input.margin_used.or_else(|| {
            Some(derive_margin_used(
                input.entry_price,
                input.quantity,
                leverage,
                resolved.market.as_ref(),
            ))
        });
        let risk_source =
            manual_position_risk_source(input.liquidation_price, input.maintenance_margin);

        let identifier = Uuid::new_v4().to_string();
        self.connection.execute(
            "INSERT INTO positions (
                id, account_id, exchange, exchange_symbol, margin_mode, symbol, side, quantity, entry_price, mark_price,
                margin_used, liquidation_price, maintenance_margin, maintenance_margin_rate,
                risk_source, leverage, unrealized_pnl, realized_pnl, fee_paid, funding_paid,
                opened_at, notes
            ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18, ?19, ?20, ?21, ?22)",
            params![
                identifier,
                input.account_id,
                encode_exchange(resolved.exchange),
                resolved.exchange_symbol,
                encode_optional_margin_mode(input.margin_mode),
                resolved.symbol,
                encode_side(input.side),
                input.quantity,
                input.entry_price,
                resolved.mark_price,
                margin_used,
                input.liquidation_price,
                input.maintenance_margin,
                None::<f64>,
                encode_position_risk_source(risk_source),
                leverage,
                unrealized_pnl,
                input.realized_pnl.unwrap_or(0.0),
                input.fee_paid.unwrap_or(0.0),
                input.funding_paid.unwrap_or(0.0),
                opened_at.to_rfc3339(),
                normalize_optional_text(input.notes),
            ],
        )?;

        self.recalculate_non_live_account_risk(&account.id)?;
        let position = self.get_position(&identifier)?;
        self.record_position_event(build_position_event_from_position(
            &account,
            &position,
            event_kind,
            opened_at,
            None,
            Some(match event_kind {
                PositionEventKind::Imported => "CSV import position".into(),
                _ => "Manual position opened".into(),
            }),
        ))?;
        Ok(position)
    }

    fn insert_live_position(
        &self,
        account: &ExchangeAccount,
        position: &SyncedPosition,
    ) -> AppResult<String> {
        let identifier = Uuid::new_v4().to_string();
        self.connection.execute(
            "INSERT INTO positions (
                id, account_id, exchange, exchange_symbol, margin_mode, symbol, side, quantity, entry_price, mark_price,
                margin_used, liquidation_price, maintenance_margin, maintenance_margin_rate,
                risk_source, leverage, unrealized_pnl, realized_pnl, fee_paid, funding_paid,
                opened_at, notes
            ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18, ?19, ?20, ?21, ?22)",
            params![
                identifier,
                account.id,
                encode_exchange(account.exchange),
                Some(position.exchange_symbol.trim().to_uppercase()),
                encode_optional_margin_mode(position.margin_mode),
                position.symbol.trim().to_uppercase(),
                encode_side(position.side),
                position.quantity,
                position.entry_price,
                position.mark_price,
                position.margin_used,
                position.liquidation_price,
                position.maintenance_margin,
                position.maintenance_margin_rate,
                position
                    .risk_source
                    .map(encode_position_risk_source)
                    .unwrap_or("live_exchange"),
                position.leverage,
                position.unrealized_pnl,
                position.realized_pnl,
                position.fee_paid,
                position.funding_paid,
                position.opened_at.to_rfc3339(),
                Some(format!("Live sync · {}", position.exchange_symbol)),
            ],
        )?;
        Ok(identifier)
    }

    fn update_live_position(
        &self,
        account: &ExchangeAccount,
        position_id: &str,
        position: &SyncedPosition,
    ) -> AppResult<()> {
        self.connection.execute(
            "UPDATE positions
             SET account_id = ?2,
                 exchange = ?3,
                 exchange_symbol = ?4,
                 margin_mode = ?5,
                 symbol = ?6,
                 side = ?7,
                 quantity = ?8,
                 entry_price = ?9,
                 mark_price = ?10,
                 margin_used = ?11,
                 liquidation_price = ?12,
                 maintenance_margin = ?13,
                 maintenance_margin_rate = ?14,
                 risk_source = ?15,
                 leverage = ?16,
                 unrealized_pnl = ?17,
                 realized_pnl = ?18,
                 fee_paid = ?19,
                 funding_paid = ?20,
                 opened_at = ?21,
                 notes = ?22
             WHERE id = ?1",
            params![
                position_id,
                account.id,
                encode_exchange(account.exchange),
                Some(position.exchange_symbol.trim().to_uppercase()),
                encode_optional_margin_mode(position.margin_mode),
                position.symbol.trim().to_uppercase(),
                encode_side(position.side),
                position.quantity,
                position.entry_price,
                position.mark_price,
                position.margin_used,
                position.liquidation_price,
                position.maintenance_margin,
                position.maintenance_margin_rate,
                position
                    .risk_source
                    .map(encode_position_risk_source)
                    .unwrap_or("live_exchange"),
                position.leverage,
                position.unrealized_pnl,
                position.realized_pnl,
                position.fee_paid,
                position.funding_paid,
                position.opened_at.to_rfc3339(),
                Some(format!("Live sync · {}", position.exchange_symbol)),
            ],
        )?;
        Ok(())
    }

    fn latest_snapshot_meta(&self) -> AppResult<Option<SnapshotMeta>> {
        self.connection
            .query_row(
                "SELECT source FROM snapshots ORDER BY created_at DESC LIMIT 1",
                [],
                |row| {
                    Ok(SnapshotMeta {
                        source: row.get(0)?,
                    })
                },
            )
            .optional()
            .map_err(Into::into)
    }

    fn record_snapshot(&self, source: String) -> AppResult<String> {
        let snapshot_id = Uuid::new_v4().to_string();
        let state = self.bootstrap_state()?;
        self.connection.execute(
            "INSERT INTO snapshots (id, source, summary_json, created_at) VALUES (?1, ?2, ?3, ?4)",
            params![
                snapshot_id,
                source,
                serde_json::to_string(&state.summary)?,
                Utc::now().to_rfc3339()
            ],
        )?;

        Ok(snapshot_id)
    }

    fn record_balance_event(
        &self,
        account_id: &str,
        balance: f64,
        equity: f64,
        recorded_at: DateTime<Utc>,
        source_job_id: Option<&str>,
    ) -> AppResult<()> {
        self.connection.execute(
            "INSERT INTO balance_events (id, account_id, balance, equity, recorded_at, source_job_id)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            params![
                Uuid::new_v4().to_string(),
                account_id,
                balance,
                equity,
                recorded_at.to_rfc3339(),
                source_job_id,
            ],
        )?;
        Ok(())
    }

    fn record_funding_entries(
        &self,
        account_id: &str,
        entries: &[FundingEntry],
        recorded_at: DateTime<Utc>,
        source_job_id: Option<&str>,
    ) -> AppResult<()> {
        for entry in entries {
            self.connection.execute(
                "INSERT OR IGNORE INTO funding_entries (
                    id, account_id, symbol, rate, funding_time, recorded_at, source_job_id
                ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
                params![
                    Uuid::new_v4().to_string(),
                    account_id,
                    entry.symbol,
                    entry.rate,
                    entry.funding_time.to_rfc3339(),
                    recorded_at.to_rfc3339(),
                    source_job_id,
                ],
            )?;
        }
        Ok(())
    }

    fn record_position_event(&self, event: PositionEventInsert) -> AppResult<()> {
        self.connection.execute(
            "INSERT INTO position_events (
                id, account_id, account_name, position_id, exchange, event_kind, exchange_symbol, margin_mode,
                symbol, side, quantity, entry_price, mark_price, margin_used, liquidation_price, maintenance_margin,
                leverage, unrealized_pnl, realized_pnl, fee_paid, funding_paid, event_time, source_job_id, note
            ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18, ?19, ?20, ?21, ?22, ?23, ?24)",
            params![
                Uuid::new_v4().to_string(),
                event.account_id,
                event.account_name,
                event.position_id,
                encode_exchange(event.exchange),
                encode_position_event_kind(event.event_kind),
                event.exchange_symbol,
                encode_optional_margin_mode(event.margin_mode),
                event.symbol,
                encode_side(event.side),
                event.quantity,
                event.entry_price,
                event.mark_price,
                event.margin_used,
                event.liquidation_price,
                event.maintenance_margin,
                event.leverage,
                event.unrealized_pnl,
                event.realized_pnl,
                event.fee_paid,
                event.funding_paid,
                event.event_time.to_rfc3339(),
                event.source_job_id,
                event.note,
            ],
        )?;
        Ok(())
    }

    fn record_closed_trade(&self, trade: ClosedTradeInsert) -> AppResult<ClosedTradeRecord> {
        let identifier = Uuid::new_v4().to_string();
        self.connection.execute(
            "INSERT INTO closed_trades (
                id, account_id, account_name, position_id, exchange, exchange_symbol, margin_mode,
                symbol, side, quantity, entry_price, exit_price, leverage, realized_pnl,
                fee_paid, funding_paid, opened_at, closed_at, note
            ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18, ?19)",
            params![
                identifier,
                trade.account_id,
                trade.account_name,
                trade.position_id,
                encode_exchange(trade.exchange),
                trade.exchange_symbol,
                encode_optional_margin_mode(trade.margin_mode),
                trade.symbol,
                encode_side(trade.side),
                trade.quantity,
                trade.entry_price,
                trade.exit_price,
                trade.leverage,
                trade.realized_pnl,
                trade.fee_paid,
                trade.funding_paid,
                trade.opened_at.to_rfc3339(),
                trade.closed_at.to_rfc3339(),
                trade.note,
            ],
        )?;
        self.connection.query_row(
            "SELECT id, account_id, account_name, position_id, exchange, exchange_symbol, margin_mode,
                    symbol, side, quantity, entry_price, exit_price, leverage, realized_pnl,
                    fee_paid, funding_paid, opened_at, closed_at, note
             FROM closed_trades
             WHERE id = ?1",
            params![identifier],
            read_closed_trade_row,
        ).map_err(Into::into)
    }

    fn fetch_accounts(&self) -> AppResult<Vec<ExchangeAccount>> {
        let mut statement = self.connection.prepare(
            "SELECT id, name, exchange, account_mode, wallet_balance, available_balance, snapshot_equity, currency,
                    external_reference, notes, sync_status, sync_error, created_at, last_synced_at,
                    bonus_balance, bonus_fee_deduction_rate, bonus_loss_deduction_rate, bonus_funding_deduction_rate
             FROM accounts ORDER BY created_at DESC",
        )?;

        let rows = statement.query_map([], read_account_row)?;
        rows.collect::<Result<Vec<_>, _>>().map_err(Into::into)
    }

    fn fetch_positions_for_account(&self, account_id: &str) -> AppResult<Vec<PortfolioPosition>> {
        let mut statement = self.connection.prepare(
            "SELECT positions.id, positions.account_id, accounts.name, positions.exchange, positions.exchange_symbol,
                    positions.margin_mode, positions.symbol, positions.side,
                    positions.quantity, positions.entry_price, positions.mark_price, positions.margin_used,
                    positions.liquidation_price, positions.maintenance_margin,
                    positions.maintenance_margin_rate, positions.risk_source, positions.leverage,
                    positions.unrealized_pnl, positions.realized_pnl, positions.fee_paid,
                    positions.funding_paid, positions.opened_at, positions.notes
             FROM positions
             JOIN accounts ON accounts.id = positions.account_id
             WHERE positions.account_id = ?1
             ORDER BY positions.opened_at DESC",
        )?;
        let rows = statement.query_map(params![account_id], read_position_row)?;
        rows.collect::<Result<Vec<_>, _>>().map_err(Into::into)
    }

    fn fetch_positions(&self) -> AppResult<Vec<PortfolioPosition>> {
        let mut statement = self.connection.prepare(
            "SELECT positions.id, positions.account_id, accounts.name, positions.exchange, positions.exchange_symbol,
                    positions.margin_mode, positions.symbol, positions.side,
                    positions.quantity, positions.entry_price, positions.mark_price, positions.margin_used,
                    positions.liquidation_price, positions.maintenance_margin,
                    positions.maintenance_margin_rate, positions.risk_source, positions.leverage,
                    positions.unrealized_pnl, positions.realized_pnl, positions.fee_paid,
                    positions.funding_paid, positions.opened_at, positions.notes
             FROM positions
             JOIN accounts ON accounts.id = positions.account_id
             ORDER BY positions.opened_at DESC",
        )?;

        let rows = statement.query_map([], read_position_row)?;
        rows.collect::<Result<Vec<_>, _>>().map_err(Into::into)
    }

    pub fn get_position(&self, position_id: &str) -> AppResult<PortfolioPosition> {
        self.connection
            .query_row(
                "SELECT positions.id, positions.account_id, accounts.name, positions.exchange, positions.exchange_symbol,
                        positions.margin_mode, positions.symbol, positions.side,
                        positions.quantity, positions.entry_price, positions.mark_price, positions.margin_used,
                        positions.liquidation_price, positions.maintenance_margin,
                        positions.maintenance_margin_rate, positions.risk_source, positions.leverage,
                        positions.unrealized_pnl, positions.realized_pnl, positions.fee_paid,
                        positions.funding_paid, positions.opened_at, positions.notes
                 FROM positions
                 JOIN accounts ON accounts.id = positions.account_id
                 WHERE positions.id = ?1
                 LIMIT 1",
                params![position_id],
                read_position_row,
            )
            .map_err(Into::into)
    }

    fn position_notionals(&self, positions: &[PortfolioPosition]) -> AppResult<Vec<f64>> {
        positions
            .iter()
            .map(|position| {
                let market = self.resolve_exchange_market(
                    position.exchange,
                    position.exchange_symbol.as_deref(),
                    Some(&position.symbol),
                )?;
                Ok(notional_usd(
                    position.quantity,
                    market.as_ref(),
                    position.mark_price.unwrap_or(position.entry_price),
                ))
            })
            .collect()
    }

    fn fetch_account_history_series(&self, limit: usize) -> AppResult<Vec<AccountHistorySeries>> {
        if limit == 0 {
            return Ok(Vec::new());
        }

        let rows = self.fetch_balance_history_rows()?;
        let mut grouped = BTreeMap::<String, AccountHistorySeries>::new();

        for row in rows {
            let series =
                grouped
                    .entry(row.account_id.clone())
                    .or_insert_with(|| AccountHistorySeries {
                        account_id: row.account_id.clone(),
                        account_name: row.account_name.clone(),
                        exchange: row.exchange,
                        points: Vec::new(),
                    });

            series.points.push(BalanceHistoryPoint {
                recorded_at: row.recorded_at,
                balance: row.balance,
                equity: row.equity,
            });
        }

        let mut series = grouped
            .into_values()
            .filter_map(|mut series| {
                trim_history_points(&mut series.points, limit);
                (!series.points.is_empty()).then_some(series)
            })
            .collect::<Vec<_>>();

        series.sort_by(|left, right| {
            right
                .points
                .last()
                .map(|point| point.recorded_at)
                .cmp(&left.points.last().map(|point| point.recorded_at))
                .then_with(|| left.account_name.cmp(&right.account_name))
        });

        Ok(series)
    }

    fn fetch_portfolio_history(&self, limit: usize) -> AppResult<Vec<BalanceHistoryPoint>> {
        if limit == 0 {
            return Ok(Vec::new());
        }

        let rows = self.fetch_balance_history_rows()?;
        let mut latest_by_account = BTreeMap::<String, BalanceHistoryPoint>::new();
        let mut history = Vec::new();

        for row in rows {
            let point = BalanceHistoryPoint {
                recorded_at: row.recorded_at,
                balance: row.balance,
                equity: row.equity,
            };
            latest_by_account.insert(row.account_id, point.clone());

            history.push(BalanceHistoryPoint {
                recorded_at: point.recorded_at,
                balance: latest_by_account.values().map(|item| item.balance).sum(),
                equity: latest_by_account.values().map(|item| item.equity).sum(),
            });
        }

        trim_history_points(&mut history, limit);
        Ok(history)
    }

    fn fetch_balance_history_rows(&self) -> AppResult<Vec<BalanceHistoryRow>> {
        let mut statement = self.connection.prepare(
            "SELECT balance_events.account_id, accounts.name, accounts.exchange,
                    balance_events.balance, balance_events.equity, balance_events.recorded_at
             FROM balance_events
             JOIN accounts ON accounts.id = balance_events.account_id
             ORDER BY balance_events.recorded_at ASC, balance_events.account_id ASC",
        )?;

        let rows = statement.query_map([], read_balance_history_row)?;
        rows.collect::<Result<Vec<_>, _>>().map_err(Into::into)
    }

    fn fetch_recent_funding_entries(&self, limit: usize) -> AppResult<Vec<FundingHistoryEntry>> {
        let mut statement = self.connection.prepare(
            "SELECT funding_entries.id, funding_entries.account_id, accounts.name, funding_entries.symbol,
                    funding_entries.rate, funding_entries.funding_time, funding_entries.recorded_at
             FROM funding_entries
             JOIN accounts ON accounts.id = funding_entries.account_id
             ORDER BY funding_entries.recorded_at DESC
             LIMIT ?1",
        )?;
        let rows = statement.query_map(params![limit as i64], read_funding_row)?;
        rows.collect::<Result<Vec<_>, _>>().map_err(Into::into)
    }

    fn fetch_recent_position_events(&self, limit: usize) -> AppResult<Vec<PositionEventRecord>> {
        let mut statement = self.connection.prepare(
            "SELECT id, account_id, account_name, position_id, exchange, event_kind, exchange_symbol, margin_mode,
                    symbol, side, quantity, entry_price, mark_price, margin_used, liquidation_price, maintenance_margin,
                    leverage, unrealized_pnl, realized_pnl, fee_paid, funding_paid, event_time, source_job_id, note
             FROM position_events
             ORDER BY event_time DESC
             LIMIT ?1",
        )?;
        let rows = statement.query_map(params![limit as i64], read_position_event_row)?;
        rows.collect::<Result<Vec<_>, _>>().map_err(Into::into)
    }

    fn fetch_recent_closed_trades(&self, limit: usize) -> AppResult<Vec<ClosedTradeRecord>> {
        let mut statement = self.connection.prepare(
            "SELECT id, account_id, account_name, position_id, exchange, exchange_symbol, margin_mode,
                    symbol, side, quantity, entry_price, exit_price, leverage, realized_pnl,
                    fee_paid, funding_paid, opened_at, closed_at, note
             FROM closed_trades
             ORDER BY closed_at DESC, id DESC
             LIMIT ?1",
        )?;
        let rows = statement.query_map(params![limit as i64], read_closed_trade_row)?;
        rows.collect::<Result<Vec<_>, _>>().map_err(Into::into)
    }

    fn fetch_recent_sync_jobs(&self, limit: usize) -> AppResult<Vec<SyncJobRecord>> {
        let mut statement = self.connection.prepare(
            "SELECT sync_jobs.id, sync_jobs.account_id, accounts.name, sync_jobs.exchange, sync_jobs.state,
                    sync_jobs.started_at, sync_jobs.finished_at, sync_jobs.attempt_count,
                    sync_jobs.synced_positions, sync_jobs.funding_entries, sync_jobs.error_message
             FROM sync_jobs
             JOIN accounts ON accounts.id = sync_jobs.account_id
             ORDER BY sync_jobs.started_at DESC
             LIMIT ?1",
        )?;
        let rows = statement.query_map(params![limit as i64], read_sync_job_row)?;
        rows.collect::<Result<Vec<_>, _>>().map_err(Into::into)
    }

    fn fetch_latest_sync_jobs(&self) -> AppResult<Vec<SyncJobRecord>> {
        let mut statement = self.connection.prepare(
            "SELECT sync_jobs.id, sync_jobs.account_id, accounts.name, sync_jobs.exchange, sync_jobs.state,
                    sync_jobs.started_at, sync_jobs.finished_at, sync_jobs.attempt_count,
                    sync_jobs.synced_positions, sync_jobs.funding_entries, sync_jobs.error_message
             FROM sync_jobs
             JOIN accounts ON accounts.id = sync_jobs.account_id
             WHERE sync_jobs.id = (
                SELECT candidate.id
                FROM sync_jobs AS candidate
                WHERE candidate.account_id = sync_jobs.account_id
                ORDER BY candidate.started_at DESC, candidate.id DESC
                LIMIT 1
             )
             ORDER BY sync_jobs.started_at DESC, sync_jobs.id DESC",
        )?;
        let rows = statement.query_map([], read_sync_job_row)?;
        rows.collect::<Result<Vec<_>, _>>().map_err(Into::into)
    }

    fn resolve_position_draft(
        &self,
        exchange: ExchangeKind,
        exchange_symbol: Option<String>,
        symbol: Option<String>,
        mark_price: Option<f64>,
        entry_price: f64,
        quantity: f64,
        leverage: f64,
    ) -> AppResult<ResolvedPositionDraft> {
        let normalized_exchange_symbol = normalize_symbol_like(exchange_symbol);
        let normalized_symbol = normalize_symbol_like(symbol);
        if normalized_exchange_symbol.is_none() && normalized_symbol.is_none() {
            return Err(invalid_input(
                "either symbol or exchange symbol must be provided",
            ));
        }

        let market = self.resolve_exchange_market(
            exchange,
            normalized_exchange_symbol.as_deref(),
            normalized_symbol.as_deref(),
        )?;
        if let Some(market) = market.as_ref() {
            validate_position_against_market(market, quantity, leverage)?;
        }
        let exchange_symbol = market
            .as_ref()
            .map(|item| item.exchange_symbol.clone())
            .or(normalized_exchange_symbol.clone());
        let symbol = market
            .as_ref()
            .map(|item| item.symbol.clone())
            .or(normalized_symbol)
            .or(normalized_exchange_symbol.clone())
            .ok_or_else(|| invalid_input("symbol could not be resolved"))?;

        let cached_mark_price = self.find_cached_market_mark_price(
            exchange,
            exchange_symbol.as_deref(),
            Some(&symbol),
        )?;
        let mark_price = mark_price
            .or(cached_mark_price)
            .or_else(|| market.as_ref().and_then(market_implied_mark_price))
            .unwrap_or(entry_price);

        Ok(ResolvedPositionDraft {
            exchange,
            exchange_symbol,
            symbol,
            mark_price,
            market,
        })
    }

    pub fn resolve_cached_exchange_market(
        &self,
        exchange: ExchangeKind,
        exchange_symbol: Option<&str>,
        symbol: Option<&str>,
    ) -> AppResult<Option<ExchangeMarket>> {
        self.resolve_exchange_market(exchange, exchange_symbol, symbol)
    }

    fn resolve_exchange_market(
        &self,
        exchange: ExchangeKind,
        exchange_symbol: Option<&str>,
        symbol: Option<&str>,
    ) -> AppResult<Option<ExchangeMarket>> {
        if !supports_market_catalog(exchange) {
            return Ok(None);
        }

        let markets = self.list_exchange_markets(exchange)?;
        if markets.is_empty() {
            return Ok(None);
        }

        let normalized_exchange_symbol = exchange_symbol.and_then(normalize_symbol_ref);
        if let Some(candidate) = normalized_exchange_symbol.as_deref() {
            if let Some(market) = markets
                .iter()
                .find(|item| item.exchange_symbol.eq_ignore_ascii_case(candidate))
            {
                return Ok(Some(market.clone()));
            }
        }

        let normalized_symbol = symbol.and_then(normalize_symbol_ref);
        if let Some(candidate) = normalized_symbol.as_deref() {
            if let Some(market) = markets
                .iter()
                .find(|item| item.symbol.eq_ignore_ascii_case(candidate))
            {
                return Ok(Some(market.clone()));
            }
        }

        let mut candidates = Vec::new();
        if let Some(candidate) = normalized_exchange_symbol {
            candidates.push(candidate);
        }
        if let Some(candidate) = normalized_symbol {
            if !candidates.iter().any(|item| item == &candidate) {
                candidates.push(candidate);
            }
        }

        Ok(markets.into_iter().find(|market| {
            let aliases = build_market_aliases(market);
            candidates
                .iter()
                .any(|candidate| aliases.iter().any(|alias| alias == candidate))
        }))
    }

    fn find_cached_market_mark_price(
        &self,
        exchange: ExchangeKind,
        exchange_symbol: Option<&str>,
        symbol: Option<&str>,
    ) -> AppResult<Option<f64>> {
        if let Some(exchange_symbol) = exchange_symbol.and_then(normalize_symbol_ref) {
            let quote = self
                .connection
                .query_row(
                    "SELECT mark_price, oracle_price
                     FROM market_quotes
                     WHERE exchange = ?1 AND UPPER(exchange_symbol) = UPPER(?2)
                     ORDER BY updated_at DESC
                     LIMIT 1",
                    params![encode_exchange(exchange), exchange_symbol],
                    |row| Ok((row.get::<_, Option<f64>>(0)?, row.get::<_, Option<f64>>(1)?)),
                )
                .optional()?;
            if let Some((mark_price, oracle_price)) = quote {
                if let Some(price) = mark_price.or(oracle_price) {
                    return Ok(Some(price));
                }
            }
        }

        if let Some(symbol) = symbol.and_then(normalize_symbol_ref) {
            let quote = self
                .connection
                .query_row(
                    "SELECT mark_price, oracle_price
                     FROM market_quotes
                     WHERE exchange = ?1 AND UPPER(symbol) = UPPER(?2)
                     ORDER BY updated_at DESC
                     LIMIT 1",
                    params![encode_exchange(exchange), symbol],
                    |row| Ok((row.get::<_, Option<f64>>(0)?, row.get::<_, Option<f64>>(1)?)),
                )
                .optional()?;
            if let Some((mark_price, oracle_price)) = quote {
                return Ok(mark_price.or(oracle_price));
            }
        }

        Ok(None)
    }

    fn ensure_account_column(&self, column_name: &str, definition: &str) -> AppResult<()> {
        if self.has_account_column(column_name)? {
            return Ok(());
        }

        self.connection.execute(
            &format!("ALTER TABLE accounts ADD COLUMN {column_name} {definition}"),
            [],
        )?;
        Ok(())
    }

    fn ensure_position_column(&self, column_name: &str, definition: &str) -> AppResult<()> {
        if self.has_position_column(column_name)? {
            return Ok(());
        }

        self.connection.execute(
            &format!("ALTER TABLE positions ADD COLUMN {column_name} {definition}"),
            [],
        )?;
        Ok(())
    }

    fn ensure_exchange_market_column(&self, column_name: &str, definition: &str) -> AppResult<()> {
        if self.has_exchange_market_column(column_name)? {
            return Ok(());
        }

        self.connection.execute(
            &format!("ALTER TABLE exchange_markets ADD COLUMN {column_name} {definition}"),
            [],
        )?;
        Ok(())
    }

    fn has_account_column(&self, column_name: &str) -> AppResult<bool> {
        let mut statement = self.connection.prepare("PRAGMA table_info(accounts)")?;
        let mut rows = statement.query([])?;
        while let Some(row) = rows.next()? {
            let name: String = row.get(1)?;
            if name == column_name {
                return Ok(true);
            }
        }
        Ok(false)
    }

    fn has_position_column(&self, column_name: &str) -> AppResult<bool> {
        let mut statement = self.connection.prepare("PRAGMA table_info(positions)")?;
        let mut rows = statement.query([])?;
        while let Some(row) = rows.next()? {
            let name: String = row.get(1)?;
            if name == column_name {
                return Ok(true);
            }
        }
        Ok(false)
    }

    fn has_exchange_market_column(&self, column_name: &str) -> AppResult<bool> {
        let mut statement = self.connection.prepare("PRAGMA table_info(exchange_markets)")?;
        let mut rows = statement.query([])?;
        while let Some(row) = rows.next()? {
            let name: String = row.get(1)?;
            if name == column_name {
                return Ok(true);
            }
        }
        Ok(false)
    }
}

fn read_account_row(row: &Row<'_>) -> Result<ExchangeAccount, rusqlite::Error> {
    Ok(ExchangeAccount {
        id: row.get(0)?,
        name: row.get(1)?,
        exchange: decode_exchange(row.get::<_, String>(2)?.as_str()),
        account_mode: decode_account_mode(row.get::<_, String>(3)?.as_str()),
        wallet_balance: row.get(4)?,
        available_balance: row.get(5)?,
        snapshot_equity: row.get(6)?,
        currency: row.get(7)?,
        external_reference: row.get(8)?,
        notes: row.get(9)?,
        sync_status: decode_sync_status(row.get::<_, String>(10)?.as_str()),
        sync_error: row.get(11)?,
        created_at: parse_datetime(row.get::<_, String>(12)?),
        last_synced_at: row.get::<_, Option<String>>(13)?.map(parse_datetime),
        bonus_balance: row.get(14)?,
        bonus_fee_deduction_rate: row.get(15)?,
        bonus_loss_deduction_rate: row.get(16)?,
        bonus_funding_deduction_rate: row.get(17)?,
    })
}

fn read_position_row(row: &Row<'_>) -> Result<PortfolioPosition, rusqlite::Error> {
    Ok(PortfolioPosition {
        id: row.get(0)?,
        account_id: row.get(1)?,
        account_name: row.get(2)?,
        exchange: decode_exchange(row.get::<_, String>(3)?.as_str()),
        exchange_symbol: row.get(4)?,
        margin_mode: row
            .get::<_, Option<String>>(5)?
            .as_deref()
            .and_then(decode_margin_mode),
        symbol: row.get(6)?,
        side: decode_side(row.get::<_, String>(7)?.as_str()),
        quantity: row.get(8)?,
        entry_price: row.get(9)?,
        mark_price: row.get(10)?,
        margin_used: row.get(11)?,
        liquidation_price: row.get(12)?,
        maintenance_margin: row.get(13)?,
        maintenance_margin_rate: row.get(14)?,
        risk_source: row
            .get::<_, Option<String>>(15)?
            .as_deref()
            .and_then(decode_position_risk_source),
        leverage: row.get(16)?,
        unrealized_pnl: row.get(17)?,
        realized_pnl: row.get(18)?,
        fee_paid: row.get(19)?,
        funding_paid: row.get(20)?,
        opened_at: parse_datetime(row.get::<_, String>(21)?),
        notes: row.get(22)?,
    })
}

fn read_balance_history_row(row: &Row<'_>) -> Result<BalanceHistoryRow, rusqlite::Error> {
    Ok(BalanceHistoryRow {
        account_id: row.get(0)?,
        account_name: row.get(1)?,
        exchange: decode_exchange(row.get::<_, String>(2)?.as_str()),
        balance: row.get(3)?,
        equity: row.get(4)?,
        recorded_at: parse_datetime(row.get::<_, String>(5)?),
    })
}

fn read_funding_row(row: &Row<'_>) -> Result<FundingHistoryEntry, rusqlite::Error> {
    Ok(FundingHistoryEntry {
        id: row.get(0)?,
        account_id: row.get(1)?,
        account_name: row.get(2)?,
        symbol: row.get(3)?,
        rate: row.get(4)?,
        funding_time: parse_datetime(row.get::<_, String>(5)?),
        recorded_at: parse_datetime(row.get::<_, String>(6)?),
    })
}

fn read_position_event_row(row: &Row<'_>) -> Result<PositionEventRecord, rusqlite::Error> {
    Ok(PositionEventRecord {
        id: row.get(0)?,
        account_id: row.get(1)?,
        account_name: row.get(2)?,
        position_id: row.get(3)?,
        exchange: decode_exchange(row.get::<_, String>(4)?.as_str()),
        event_kind: decode_position_event_kind(row.get::<_, String>(5)?.as_str()),
        exchange_symbol: row.get(6)?,
        margin_mode: row
            .get::<_, Option<String>>(7)?
            .as_deref()
            .and_then(decode_margin_mode),
        symbol: row.get(8)?,
        side: decode_side(row.get::<_, String>(9)?.as_str()),
        quantity: row.get(10)?,
        entry_price: row.get(11)?,
        mark_price: row.get(12)?,
        margin_used: row.get(13)?,
        liquidation_price: row.get(14)?,
        maintenance_margin: row.get(15)?,
        leverage: row.get(16)?,
        unrealized_pnl: row.get(17)?,
        realized_pnl: row.get(18)?,
        fee_paid: row.get(19)?,
        funding_paid: row.get(20)?,
        event_time: parse_datetime(row.get::<_, String>(21)?),
        source_job_id: row.get(22)?,
        note: row.get(23)?,
    })
}

fn read_closed_trade_row(row: &Row<'_>) -> Result<ClosedTradeRecord, rusqlite::Error> {
    Ok(ClosedTradeRecord {
        id: row.get(0)?,
        account_id: row.get(1)?,
        account_name: row.get(2)?,
        position_id: row.get(3)?,
        exchange: decode_exchange(row.get::<_, String>(4)?.as_str()),
        exchange_symbol: row.get(5)?,
        margin_mode: row
            .get::<_, Option<String>>(6)?
            .as_deref()
            .and_then(decode_margin_mode),
        symbol: row.get(7)?,
        side: decode_side(row.get::<_, String>(8)?.as_str()),
        quantity: row.get(9)?,
        entry_price: row.get(10)?,
        exit_price: row.get(11)?,
        leverage: row.get(12)?,
        realized_pnl: row.get(13)?,
        fee_paid: row.get(14)?,
        funding_paid: row.get(15)?,
        opened_at: parse_datetime(row.get::<_, String>(16)?),
        closed_at: parse_datetime(row.get::<_, String>(17)?),
        note: row.get(18)?,
    })
}

fn read_sync_job_row(row: &Row<'_>) -> Result<SyncJobRecord, rusqlite::Error> {
    Ok(SyncJobRecord {
        id: row.get(0)?,
        account_id: row.get(1)?,
        account_name: row.get(2)?,
        exchange: decode_exchange(row.get::<_, String>(3)?.as_str()),
        state: decode_sync_job_state(row.get::<_, String>(4)?.as_str()),
        started_at: parse_datetime(row.get::<_, String>(5)?),
        finished_at: row.get::<_, Option<String>>(6)?.map(parse_datetime),
        attempt_count: row.get::<_, i64>(7)? as u32,
        synced_positions: row.get::<_, i64>(8)? as usize,
        funding_entries: row.get::<_, i64>(9)? as usize,
        error_message: row.get(10)?,
    })
}

fn read_exchange_market_row(row: &Row<'_>) -> Result<ExchangeMarket, rusqlite::Error> {
    Ok(ExchangeMarket {
        exchange: decode_exchange(row.get::<_, String>(0)?.as_str()),
        exchange_symbol: row.get(1)?,
        symbol: row.get(2)?,
        base_asset: row.get(3)?,
        quote_asset: row.get(4)?,
        settle_asset: row.get(5)?,
        contract_type: row.get(6)?,
        contract_value: row.get(7)?,
        price_tick_size: row.get(8)?,
        quantity_step: row.get(9)?,
        min_quantity: row.get(10)?,
        max_leverage: row.get(11)?,
        mark_price: row.get(12)?,
        oracle_price: row.get(13)?,
        funding_rate: row.get(14)?,
        next_funding_time: row.get::<_, Option<String>>(15)?.map(parse_datetime),
        is_active: row.get::<_, i64>(16)? != 0,
    })
}

fn read_exchange_risk_tier_row(row: &Row<'_>) -> Result<ExchangeRiskTier, rusqlite::Error> {
    Ok(ExchangeRiskTier {
        exchange: decode_exchange(row.get::<_, String>(0)?.as_str()),
        exchange_symbol: row.get(1)?,
        margin_mode: decode_margin_mode(row.get::<_, String>(2)?.as_str()),
        tier_basis: decode_risk_tier_basis(row.get::<_, String>(3)?.as_str()),
        lower_bound: row.get(4)?,
        upper_bound: row.get(5)?,
        maintenance_margin_rate: row.get(6)?,
        maintenance_amount_deduction: row.get(7)?,
        max_leverage: row.get(8)?,
    })
}

fn parse_datetime(value: String) -> DateTime<Utc> {
    DateTime::parse_from_rfc3339(&value)
        .map(|datetime| datetime.with_timezone(&Utc))
        .unwrap_or_else(|_| Utc::now())
}

fn trim_history_points(points: &mut Vec<BalanceHistoryPoint>, limit: usize) {
    if points.len() > limit {
        let trim_count = points.len() - limit;
        points.drain(0..trim_count);
    }
}

fn encode_exchange(exchange: ExchangeKind) -> &'static str {
    match exchange {
        ExchangeKind::Manual => "manual",
        ExchangeKind::Blofin => "blofin",
        ExchangeKind::Hyperliquid => "hyperliquid",
        ExchangeKind::Import => "import",
    }
}

fn capitalize_exchange(exchange: ExchangeKind) -> &'static str {
    match exchange {
        ExchangeKind::Manual => "Manual",
        ExchangeKind::Blofin => "BloFin",
        ExchangeKind::Hyperliquid => "Hyperliquid",
        ExchangeKind::Import => "Imported",
    }
}

fn default_currency_for_exchange(exchange: ExchangeKind) -> &'static str {
    match exchange {
        ExchangeKind::Hyperliquid => "USDC",
        _ => "USDT",
    }
}

fn encode_optional_margin_mode(margin_mode: Option<MarginMode>) -> Option<&'static str> {
    margin_mode.map(encode_margin_mode)
}

fn encode_risk_margin_mode(margin_mode: Option<MarginMode>) -> &'static str {
    margin_mode.map(encode_margin_mode).unwrap_or("")
}

fn encode_margin_mode(margin_mode: MarginMode) -> &'static str {
    match margin_mode {
        MarginMode::Cross => "cross",
        MarginMode::Isolated => "isolated",
    }
}

fn encode_position_event_kind(event_kind: PositionEventKind) -> &'static str {
    match event_kind {
        PositionEventKind::Opened => "opened",
        PositionEventKind::Adjusted => "adjusted",
        PositionEventKind::Closed => "closed",
        PositionEventKind::Imported => "imported",
    }
}

fn decode_margin_mode(raw: &str) -> Option<MarginMode> {
    match raw {
        "cross" => Some(MarginMode::Cross),
        "isolated" => Some(MarginMode::Isolated),
        _ => None,
    }
}

fn encode_position_risk_source(source: PositionRiskSource) -> &'static str {
    match source {
        PositionRiskSource::LiveExchange => "live_exchange",
        PositionRiskSource::UserInput => "user_input",
        PositionRiskSource::LocalEngine => "local_engine",
    }
}

fn decode_position_risk_source(raw: &str) -> Option<PositionRiskSource> {
    match raw {
        "live_exchange" => Some(PositionRiskSource::LiveExchange),
        "user_input" => Some(PositionRiskSource::UserInput),
        "local_engine" => Some(PositionRiskSource::LocalEngine),
        _ => None,
    }
}

fn encode_risk_tier_basis(basis: crate::domain::RiskTierBasis) -> &'static str {
    match basis {
        crate::domain::RiskTierBasis::ExchangeQuantity => "exchange_quantity",
        crate::domain::RiskTierBasis::NotionalUsd => "notional_usd",
    }
}

fn decode_risk_tier_basis(raw: &str) -> crate::domain::RiskTierBasis {
    match raw {
        "exchange_quantity" => crate::domain::RiskTierBasis::ExchangeQuantity,
        _ => crate::domain::RiskTierBasis::NotionalUsd,
    }
}

fn decode_position_event_kind(raw: &str) -> PositionEventKind {
    match raw {
        "adjusted" => PositionEventKind::Adjusted,
        "closed" => PositionEventKind::Closed,
        "imported" => PositionEventKind::Imported,
        _ => PositionEventKind::Opened,
    }
}

fn decode_exchange(value: &str) -> ExchangeKind {
    match value {
        "blofin" => ExchangeKind::Blofin,
        "hyperliquid" => ExchangeKind::Hyperliquid,
        "import" => ExchangeKind::Import,
        _ => ExchangeKind::Manual,
    }
}

fn encode_account_mode(mode: AccountMode) -> &'static str {
    match mode {
        AccountMode::Manual => "manual",
        AccountMode::Import => "import",
        AccountMode::Live => "live",
    }
}

fn decode_account_mode(value: &str) -> AccountMode {
    match value {
        "import" => AccountMode::Import,
        "live" => AccountMode::Live,
        _ => AccountMode::Manual,
    }
}

fn encode_side(side: PositionSide) -> &'static str {
    match side {
        PositionSide::Long => "long",
        PositionSide::Short => "short",
    }
}

fn decode_side(value: &str) -> PositionSide {
    match value {
        "short" => PositionSide::Short,
        _ => PositionSide::Long,
    }
}

fn encode_sync_status(value: SyncStatus) -> &'static str {
    match value {
        SyncStatus::Manual => "manual",
        SyncStatus::Active => "active",
        SyncStatus::Error => "error",
    }
}

fn decode_sync_status(value: &str) -> SyncStatus {
    match value {
        "active" => SyncStatus::Active,
        "error" => SyncStatus::Error,
        _ => SyncStatus::Manual,
    }
}

fn decode_sync_job_state(value: &str) -> SyncJobState {
    match value {
        "success" => SyncJobState::Success,
        "failed" => SyncJobState::Failed,
        _ => SyncJobState::Running,
    }
}

fn normalize_optional_text(value: Option<String>) -> Option<String> {
    value
        .map(|item| item.trim().to_string())
        .filter(|item| !item.is_empty())
}

fn validate_bonus_rate(value: f64, field_name: &str) -> AppResult<f64> {
    if (0.0..=1.0).contains(&value) {
        Ok(value)
    } else {
        Err(invalid_input(format!(
            "{field_name} must be between 0.0 and 1.0"
        )))
    }
}

fn normalize_symbol_like(value: Option<String>) -> Option<String> {
    value
        .map(|item| item.trim().to_uppercase())
        .filter(|item| !item.is_empty())
}

fn validate_manual_position_numbers(
    mark_price: Option<f64>,
    margin_used: Option<f64>,
    liquidation_price: Option<f64>,
    maintenance_margin: Option<f64>,
) -> AppResult<()> {
    if let Some(value) = mark_price {
        if value <= 0.0 {
            return Err(invalid_input("mark price must be positive when provided"));
        }
    }
    if let Some(value) = margin_used {
        if value < 0.0 {
            return Err(invalid_input(
                "margin used must be greater than or equal to zero when provided",
            ));
        }
    }
    if let Some(value) = liquidation_price {
        if value <= 0.0 {
            return Err(invalid_input(
                "liquidation price must be positive when provided",
            ));
        }
    }
    if let Some(value) = maintenance_margin {
        if value < 0.0 {
            return Err(invalid_input(
                "maintenance margin must be greater than or equal to zero when provided",
            ));
        }
    }
    Ok(())
}

fn manual_position_risk_source(
    liquidation_price: Option<f64>,
    maintenance_margin: Option<f64>,
) -> PositionRiskSource {
    if liquidation_price.is_some() || maintenance_margin.is_some() {
        PositionRiskSource::UserInput
    } else {
        PositionRiskSource::LocalEngine
    }
}

fn effective_position_risk_source(position: &PortfolioPosition) -> PositionRiskSource {
    position.risk_source.unwrap_or_else(|| {
        manual_position_risk_source(position.liquidation_price, position.maintenance_margin)
    })
}

fn validate_manual_account_exchange(
    account: &ExchangeAccount,
    position_exchange: ExchangeKind,
) -> AppResult<()> {
    match account.exchange {
        ExchangeKind::Manual | ExchangeKind::Import => Ok(()),
        exchange if exchange == position_exchange => Ok(()),
        exchange => Err(invalid_input(format!(
            "account {} is scoped to {} positions",
            account.name,
            capitalize_exchange(exchange)
        ))),
    }
}

fn normalize_symbol_ref(value: &str) -> Option<String> {
    let normalized = value.trim().to_uppercase();
    (!normalized.is_empty()).then_some(normalized)
}

fn synced_position_key(position: &SyncedPosition) -> String {
    format!(
        "{}::{}",
        position.exchange_symbol.trim().to_uppercase(),
        encode_side(position.side)
    )
}

fn stored_position_key(position: &PortfolioPosition) -> String {
    let basis = position
        .exchange_symbol
        .clone()
        .unwrap_or_else(|| position.symbol.clone());
    format!(
        "{}::{}",
        basis.trim().to_uppercase(),
        encode_side(position.side)
    )
}

fn approx_equal(left: f64, right: f64) -> bool {
    (left - right).abs() < 1e-9
}

fn approx_equal_optional(left: Option<f64>, right: Option<f64>) -> bool {
    match (left, right) {
        (Some(left), Some(right)) => approx_equal(left, right),
        (None, None) => true,
        _ => false,
    }
}

fn supports_market_catalog(exchange: ExchangeKind) -> bool {
    matches!(exchange, ExchangeKind::Blofin | ExchangeKind::Hyperliquid)
}

fn build_market_aliases(market: &ExchangeMarket) -> Vec<String> {
    let mut aliases = vec![
        market.exchange_symbol.trim().to_uppercase(),
        market.symbol.trim().to_uppercase(),
        market.base_asset.trim().to_uppercase(),
    ];
    let pair_joined = format!(
        "{}{}",
        market.base_asset.trim().to_uppercase(),
        market.quote_asset.trim().to_uppercase()
    );
    let pair_dashed = format!(
        "{}-{}",
        market.base_asset.trim().to_uppercase(),
        market.quote_asset.trim().to_uppercase()
    );
    let pair_slashed = format!(
        "{}/{}",
        market.base_asset.trim().to_uppercase(),
        market.quote_asset.trim().to_uppercase()
    );
    for alias in [pair_joined, pair_dashed, pair_slashed] {
        if !aliases.iter().any(|existing| existing == &alias) {
            aliases.push(alias);
        }
    }
    aliases
}

fn market_implied_mark_price(market: &ExchangeMarket) -> Option<f64> {
    market.mark_price.or(market.oracle_price)
}

fn validate_position_against_market(
    market: &ExchangeMarket,
    quantity: f64,
    leverage: f64,
) -> AppResult<()> {
    if let Some(min_quantity) = market.min_quantity {
        if quantity + 1e-9 < min_quantity {
            return Err(invalid_input(format!(
                "quantity {quantity} is below minimum {min_quantity} for {}",
                market.exchange_symbol
            )));
        }
    }

    if let Some(quantity_step) = market.quantity_step {
        if quantity_step > 0.0 && !is_step_aligned(quantity, quantity_step) {
            return Err(invalid_input(format!(
                "quantity {quantity} does not align to step {quantity_step} for {}",
                market.exchange_symbol
            )));
        }
    }

    if let Some(max_leverage) = market.max_leverage {
        if leverage - max_leverage > 1e-9 {
            return Err(invalid_input(format!(
                "leverage {leverage} exceeds max leverage {max_leverage} for {}",
                market.exchange_symbol
            )));
        }
    }

    Ok(())
}

fn is_step_aligned(quantity: f64, step: f64) -> bool {
    if step <= 0.0 {
        return true;
    }
    let quotient = quantity / step;
    (quotient - quotient.round()).abs() <= 1e-6
}

fn has_material_position_change(existing: &PortfolioPosition, incoming: &SyncedPosition) -> bool {
    !approx_equal(existing.quantity, incoming.quantity)
        || !approx_equal(existing.entry_price, incoming.entry_price)
        || !approx_equal(existing.leverage, incoming.leverage)
        || !approx_equal(existing.fee_paid, incoming.fee_paid)
        || !approx_equal(existing.funding_paid, incoming.funding_paid)
        || !approx_equal(existing.realized_pnl, incoming.realized_pnl)
        || existing.margin_mode != incoming.margin_mode
        || !approx_equal_optional(existing.margin_used, incoming.margin_used)
}

fn build_position_event_from_position(
    account: &ExchangeAccount,
    position: &PortfolioPosition,
    event_kind: PositionEventKind,
    event_time: DateTime<Utc>,
    source_job_id: Option<&str>,
    note: Option<String>,
) -> PositionEventInsert {
    PositionEventInsert {
        account_id: account.id.clone(),
        account_name: account.name.clone(),
        position_id: Some(position.id.clone()),
        exchange: position.exchange,
        event_kind,
        exchange_symbol: position.exchange_symbol.clone(),
        margin_mode: position.margin_mode,
        symbol: position.symbol.clone(),
        side: position.side,
        quantity: position.quantity,
        entry_price: position.entry_price,
        mark_price: position.mark_price,
        margin_used: position.margin_used,
        liquidation_price: position.liquidation_price,
        maintenance_margin: position.maintenance_margin,
        leverage: position.leverage,
        unrealized_pnl: position.unrealized_pnl,
        realized_pnl: position.realized_pnl,
        fee_paid: position.fee_paid,
        funding_paid: position.funding_paid,
        event_time,
        source_job_id: source_job_id.map(|value| value.to_string()),
        note,
    }
}

fn build_position_event_from_synced(
    account: &ExchangeAccount,
    position_id: Option<String>,
    position: &SyncedPosition,
    event_kind: PositionEventKind,
    event_time: DateTime<Utc>,
    source_job_id: Option<&str>,
    note: Option<String>,
) -> PositionEventInsert {
    PositionEventInsert {
        account_id: account.id.clone(),
        account_name: account.name.clone(),
        position_id,
        exchange: account.exchange,
        event_kind,
        exchange_symbol: Some(position.exchange_symbol.trim().to_uppercase()),
        margin_mode: position.margin_mode,
        symbol: position.symbol.trim().to_uppercase(),
        side: position.side,
        quantity: position.quantity,
        entry_price: position.entry_price,
        mark_price: position.mark_price,
        margin_used: position.margin_used,
        liquidation_price: position.liquidation_price,
        maintenance_margin: position.maintenance_margin,
        leverage: position.leverage,
        unrealized_pnl: position.unrealized_pnl,
        realized_pnl: position.realized_pnl,
        fee_paid: position.fee_paid,
        funding_paid: position.funding_paid,
        event_time,
        source_job_id: source_job_id.map(|value| value.to_string()),
        note,
    }
}

#[cfg(test)]
mod tests {
    use chrono::TimeZone;

    use super::*;
    use crate::domain::{
        ExchangeRiskTier, FundingEntry, MarginMode, PositionEventKind, PositionRiskSource,
        PositionSide, RiskTierBasis,
    };

    fn open_test_repo() -> (PortfolioRepository, PathBuf) {
        let root = std::env::temp_dir().join(format!("cassini-store-test-{}", Uuid::new_v4()));
        std::fs::create_dir_all(&root).expect("test directory should exist");
        let repository = PortfolioRepository::open(root.join("portfolio.db"), "test-key".into())
            .expect("repository should open");
        (repository, root)
    }

    fn sample_blofin_market(mark_price: Option<f64>) -> ExchangeMarket {
        ExchangeMarket {
            exchange: ExchangeKind::Blofin,
            exchange_symbol: "BTC-USDT".into(),
            symbol: "BTC-PERP".into(),
            base_asset: "BTC".into(),
            quote_asset: "USDT".into(),
            settle_asset: Some("USDT".into()),
            contract_type: "perpetual".into(),
            contract_value: Some(1.0),
            price_tick_size: Some(0.1),
            quantity_step: Some(0.001),
            min_quantity: Some(0.001),
            max_leverage: Some(50.0),
            mark_price,
            oracle_price: mark_price.map(|price| price - 25.0),
            funding_rate: Some(0.0002),
            next_funding_time: None,
            is_active: true,
        }
    }

    fn sample_blofin_eth_market(mark_price: f64) -> ExchangeMarket {
        ExchangeMarket {
            exchange: ExchangeKind::Blofin,
            exchange_symbol: "ETH-USDT".into(),
            symbol: "ETH-PERP".into(),
            base_asset: "ETH".into(),
            quote_asset: "USDT".into(),
            settle_asset: Some("USDT".into()),
            contract_type: "perpetual".into(),
            contract_value: Some(0.1),
            price_tick_size: Some(0.01),
            quantity_step: Some(0.1),
            min_quantity: Some(0.1),
            max_leverage: Some(150.0),
            mark_price: Some(mark_price),
            oracle_price: Some(mark_price - 0.1),
            funding_rate: Some(0.0002),
            next_funding_time: None,
            is_active: true,
        }
    }

    fn sample_blofin_tier(
        exchange_symbol: &str,
        margin_mode: MarginMode,
        maintenance_margin_rate: f64,
    ) -> ExchangeRiskTier {
        ExchangeRiskTier {
            exchange: ExchangeKind::Blofin,
            exchange_symbol: exchange_symbol.into(),
            margin_mode: Some(margin_mode),
            tier_basis: RiskTierBasis::ExchangeQuantity,
            lower_bound: 0.0,
            upper_bound: Some(2500.0),
            maintenance_margin_rate,
            maintenance_amount_deduction: 0.0,
            max_leverage: 150.0,
        }
    }

    #[test]
    fn manual_accounts_and_positions_can_match_live_position_shape() {
        let (repo, root) = open_test_repo();
        let account = repo
            .create_account(CreateAccountInput {
                name: "HL Manual".into(),
                exchange: ExchangeKind::Hyperliquid,
                wallet_balance: 1500.0,
                notes: None,
                bonus_balance: None,
                bonus_fee_deduction_rate: None,
                bonus_loss_deduction_rate: None,
                bonus_funding_deduction_rate: None,
            })
            .expect("manual account should be created");

        assert_eq!(account.currency, "USDC");

        let position = repo
            .add_manual_position(ManualPositionInput {
                account_id: account.id.clone(),
                exchange: ExchangeKind::Hyperliquid,
                exchange_symbol: Some("BTC".into()),
                symbol: "BTC-PERP".into(),
                margin_mode: Some(MarginMode::Cross),
                side: PositionSide::Long,
                quantity: 0.15,
                entry_price: 70000.0,
                mark_price: Some(70400.0),
                margin_used: Some(1050.0),
                liquidation_price: Some(64000.0),
                maintenance_margin: Some(42.0),
                leverage: 10.0,
                realized_pnl: Some(35.0),
                fee_paid: Some(4.0),
                funding_paid: Some(1.2),
                notes: Some("manual live-parity".into()),
            })
            .expect("manual position should be created");

        assert_eq!(position.exchange, ExchangeKind::Hyperliquid);
        assert_eq!(position.margin_mode, Some(MarginMode::Cross));
        assert_eq!(position.margin_used, Some(1050.0));
        assert_eq!(position.liquidation_price, Some(64000.0));
        assert_eq!(position.maintenance_margin, Some(42.0));
        assert_eq!(position.realized_pnl, 35.0);

        drop(repo);
        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn manual_blofin_positions_derive_margin_and_liquidation_from_cached_risk_tiers() {
        let (repo, root) = open_test_repo();
        let account = repo
            .create_account(CreateAccountInput {
                name: "BloFin Manual".into(),
                exchange: ExchangeKind::Blofin,
                wallet_balance: 200.0,
                notes: None,
                bonus_balance: None,
                bonus_fee_deduction_rate: None,
                bonus_loss_deduction_rate: None,
                bonus_funding_deduction_rate: None,
            })
            .expect("manual account should be created");
        repo.upsert_exchange_markets(&[sample_blofin_eth_market(1591.69)])
            .expect("market cache should load");
        repo.upsert_exchange_risk_tiers(&[sample_blofin_tier(
            "ETH-USDT",
            MarginMode::Isolated,
            0.004,
        )])
        .expect("risk tier cache should load");

        let position = repo
            .add_manual_position(ManualPositionInput {
                account_id: account.id.clone(),
                exchange: ExchangeKind::Blofin,
                exchange_symbol: Some("ETH-USDT".into()),
                symbol: "ETH-PERP".into(),
                margin_mode: Some(MarginMode::Isolated),
                side: PositionSide::Long,
                quantity: 1.0,
                entry_price: 1591.8,
                mark_price: None,
                margin_used: None,
                liquidation_price: None,
                maintenance_margin: None,
                leverage: 3.0,
                realized_pnl: None,
                fee_paid: None,
                funding_paid: None,
                notes: None,
            })
            .expect("manual position should derive risk");

        assert_eq!(position.risk_source, Some(PositionRiskSource::LocalEngine));
        assert_eq!(position.maintenance_margin_rate, Some(0.004));
        assert!((position.margin_used.unwrap_or_default() - 53.06).abs() < 1e-6);
        assert!((position.maintenance_margin.unwrap_or_default() - 0.636676).abs() < 1e-6);
        assert!((position.liquidation_price.unwrap_or_default() - 1066.1040787623).abs() < 1e-6);

        drop(repo);
        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn cross_account_risk_recalculates_existing_positions_when_new_position_is_added() {
        let (repo, root) = open_test_repo();
        let account = repo
            .create_account(CreateAccountInput {
                name: "BloFin Cross".into(),
                exchange: ExchangeKind::Blofin,
                wallet_balance: 100.0,
                notes: None,
                bonus_balance: None,
                bonus_fee_deduction_rate: None,
                bonus_loss_deduction_rate: None,
                bonus_funding_deduction_rate: None,
            })
            .expect("manual account should be created");
        repo.upsert_exchange_markets(&[sample_blofin_eth_market(1500.0)])
            .expect("market cache should load");
        repo.upsert_exchange_risk_tiers(&[sample_blofin_tier(
            "ETH-USDT",
            MarginMode::Cross,
            0.004,
        )])
        .expect("risk tier cache should load");

        let first = repo
            .add_manual_position(ManualPositionInput {
                account_id: account.id.clone(),
                exchange: ExchangeKind::Blofin,
                exchange_symbol: Some("ETH-USDT".into()),
                symbol: "ETH-PERP".into(),
                margin_mode: Some(MarginMode::Cross),
                side: PositionSide::Long,
                quantity: 1.0,
                entry_price: 1500.0,
                mark_price: Some(1500.0),
                margin_used: None,
                liquidation_price: None,
                maintenance_margin: None,
                leverage: 10.0,
                realized_pnl: None,
                fee_paid: None,
                funding_paid: None,
                notes: None,
            })
            .expect("first manual position should be created");
        let first_liquidation_before = first.liquidation_price.unwrap_or_default();

        repo.add_manual_position(ManualPositionInput {
            account_id: account.id.clone(),
            exchange: ExchangeKind::Blofin,
            exchange_symbol: Some("ETH-USDT".into()),
            symbol: "ETH-PERP".into(),
            margin_mode: Some(MarginMode::Cross),
            side: PositionSide::Long,
            quantity: 2.0,
            entry_price: 1600.0,
            mark_price: Some(1600.0),
            margin_used: None,
            liquidation_price: None,
            maintenance_margin: None,
            leverage: 10.0,
            realized_pnl: None,
            fee_paid: None,
            funding_paid: None,
            notes: None,
        })
        .expect("second manual position should be created");

        let first_reloaded = repo
            .get_position(&first.id)
            .expect("first position should reload");
        assert!(
            first_reloaded.liquidation_price.unwrap_or_default() > first_liquidation_before,
            "expected shared cross collateral to move liquidation closer"
        );

        drop(repo);
        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn records_sync_artifacts_for_live_accounts() {
        let (repo, root) = open_test_repo();
        let account = repo
            .create_live_account_record("HL Test".into(), ExchangeKind::Hyperliquid, "0xabc".into())
            .expect("live account should be created");
        let job_id = repo
            .begin_sync_job(&account.id, ExchangeKind::Hyperliquid)
            .expect("sync job should start");

        let synced_account = repo
            .sync_live_account(
                &account.id,
                &AccountSnapshot {
                    wallet_balance: 1000.0,
                    available_balance: 850.0,
                    snapshot_equity: 1100.0,
                    currency: "USDC".into(),
                },
                &[SyncedPosition {
                    exchange_symbol: "BTC".into(),
                    symbol: "BTC-PERP".into(),
                    margin_mode: Some(MarginMode::Cross),
                    side: PositionSide::Long,
                    quantity: 0.2,
                    entry_price: 60000.0,
                    mark_price: Some(61000.0),
                    margin_used: Some(2400.0),
                    liquidation_price: Some(53400.0),
                    maintenance_margin: Some(180.0),
                    maintenance_margin_rate: None,
                    risk_source: None,
                    leverage: 5.0,
                    unrealized_pnl: 200.0,
                    realized_pnl: 0.0,
                    fee_paid: 0.0,
                    funding_paid: 0.0,
                    opened_at: Utc::now(),
                }],
                &[FundingEntry {
                    symbol: "BTC-PERP".into(),
                    rate: 0.0001,
                    funding_time: Utc::now(),
                }],
                Some(&job_id),
            )
            .expect("sync should succeed");
        repo.complete_sync_job_success(&job_id, 2, 1, 1)
            .expect("sync job should complete");

        let bootstrap = repo.bootstrap_state().expect("bootstrap state should load");

        assert_eq!(synced_account.snapshot_equity, 1100.0);
        assert_eq!(bootstrap.recent_sync_jobs.len(), 1);
        assert_eq!(bootstrap.recent_sync_jobs[0].attempt_count, 2);
        assert_eq!(bootstrap.recent_funding_entries.len(), 1);
        assert_eq!(bootstrap.portfolio_history.len(), 1);
        assert_eq!(bootstrap.account_history.len(), 1);
        assert_eq!(bootstrap.positions.len(), 1);
        assert_eq!(bootstrap.positions[0].margin_mode, Some(MarginMode::Cross));
        assert_eq!(bootstrap.positions[0].margin_used, Some(2400.0));
        assert_eq!(bootstrap.positions[0].liquidation_price, Some(53400.0));
        assert_eq!(bootstrap.positions[0].maintenance_margin, Some(180.0));

        drop(repo);
        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn records_manual_position_lifecycle_in_position_events() {
        let (repo, root) = open_test_repo();
        let account = repo
            .create_account(CreateAccountInput {
                name: "Manual Core".into(),
                exchange: ExchangeKind::Manual,
                wallet_balance: 5000.0,
                notes: None,
                bonus_balance: None,
                bonus_fee_deduction_rate: None,
                bonus_loss_deduction_rate: None,
                bonus_funding_deduction_rate: None,
            })
            .expect("manual account should be created");

        let created = repo
            .add_manual_position(ManualPositionInput {
                account_id: account.id.clone(),
                exchange: ExchangeKind::Manual,
                exchange_symbol: None,
                symbol: "BTCUSDT".into(),
                margin_mode: None,
                side: PositionSide::Long,
                quantity: 0.25,
                entry_price: 60000.0,
                mark_price: Some(60500.0),
                margin_used: None,
                liquidation_price: None,
                maintenance_margin: None,
                leverage: 5.0,
                realized_pnl: None,
                fee_paid: Some(4.0),
                funding_paid: Some(1.0),
                notes: Some("manual open".into()),
            })
            .expect("manual position should be added");

        let updated = repo
            .update_manual_position(UpdateManualPositionInput {
                id: created.id.clone(),
                account_id: account.id.clone(),
                exchange_symbol: None,
                symbol: "BTCUSDT".into(),
                margin_mode: None,
                side: PositionSide::Long,
                quantity: 0.4,
                entry_price: 60100.0,
                mark_price: Some(60850.0),
                margin_used: None,
                liquidation_price: None,
                maintenance_margin: None,
                leverage: 6.0,
                realized_pnl: None,
                fee_paid: Some(5.0),
                funding_paid: Some(1.5),
                notes: Some("manual adjust".into()),
            })
            .expect("manual position should update");

        repo.delete_manual_position(&updated.id)
            .expect("manual position should delete");

        let events = repo
            .fetch_recent_position_events(10)
            .expect("position events should load");

        assert_eq!(events.len(), 3);
        assert_eq!(events[0].event_kind, PositionEventKind::Closed);
        assert_eq!(events[1].event_kind, PositionEventKind::Adjusted);
        assert_eq!(events[2].event_kind, PositionEventKind::Opened);
        assert!(events.iter().all(|event| event.symbol == "BTCUSDT"));
        assert!(events
            .iter()
            .all(|event| event.position_id.as_deref() == Some(created.id.as_str())));

        drop(repo);
        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn derives_recent_history_from_persisted_balance_events() {
        let (repo, root) = open_test_repo();
        let alpha = repo
            .create_live_account_record("BloFin Alpha".into(), ExchangeKind::Blofin, "alpha".into())
            .expect("alpha should be created");
        let beta = repo
            .create_live_account_record(
                "HL Vault".into(),
                ExchangeKind::Hyperliquid,
                "0xbeta".into(),
            )
            .expect("beta should be created");

        let t0 = Utc
            .with_ymd_and_hms(2026, 1, 2, 10, 0, 0)
            .single()
            .expect("valid timestamp");
        let t1 = Utc
            .with_ymd_and_hms(2026, 1, 2, 10, 5, 0)
            .single()
            .expect("valid timestamp");
        let t2 = Utc
            .with_ymd_and_hms(2026, 1, 2, 10, 10, 0)
            .single()
            .expect("valid timestamp");
        let t3 = Utc
            .with_ymd_and_hms(2026, 1, 2, 10, 15, 0)
            .single()
            .expect("valid timestamp");

        repo.record_balance_event(&alpha.id, 100.0, 110.0, t0, None)
            .expect("alpha t0 should record");
        repo.record_balance_event(&beta.id, 200.0, 190.0, t1, None)
            .expect("beta t1 should record");
        repo.record_balance_event(&alpha.id, 120.0, 130.0, t2, None)
            .expect("alpha t2 should record");
        repo.record_balance_event(&beta.id, 210.0, 205.0, t3, None)
            .expect("beta t3 should record");

        let account_history = repo
            .fetch_account_history_series(2)
            .expect("account history should load");
        let portfolio_history = repo
            .fetch_portfolio_history(8)
            .expect("portfolio history should load");

        assert_eq!(account_history.len(), 2);
        let alpha_series = account_history
            .iter()
            .find(|series| series.account_id == alpha.id)
            .expect("alpha series should exist");
        assert_eq!(alpha_series.points.len(), 2);
        assert_eq!(alpha_series.points[0].balance, 100.0);
        assert_eq!(alpha_series.points[1].equity, 130.0);

        let beta_series = account_history
            .iter()
            .find(|series| series.account_id == beta.id)
            .expect("beta series should exist");
        assert_eq!(beta_series.points.len(), 2);
        assert_eq!(beta_series.points[0].equity, 190.0);
        assert_eq!(beta_series.points[1].balance, 210.0);

        assert_eq!(portfolio_history.len(), 4);
        assert_eq!(portfolio_history[0].equity, 110.0);
        assert_eq!(portfolio_history[1].equity, 300.0);
        assert_eq!(portfolio_history[2].balance, 320.0);
        assert_eq!(portfolio_history[3].equity, 335.0);

        let bootstrap = repo.bootstrap_state().expect("bootstrap should load");
        assert_eq!(bootstrap.account_history.len(), 2);
        assert_eq!(bootstrap.portfolio_history.len(), 4);
        assert_eq!(
            bootstrap
                .portfolio_history
                .last()
                .expect("latest portfolio point should exist")
                .equity,
            335.0
        );

        drop(repo);
        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn sync_keeps_multiple_live_accounts_isolated_on_same_exchange() {
        let (repo, root) = open_test_repo();
        let alpha = repo
            .create_live_account_record("BloFin Alpha".into(), ExchangeKind::Blofin, "alpha".into())
            .expect("alpha should be created");
        let beta = repo
            .create_live_account_record("BloFin Beta".into(), ExchangeKind::Blofin, "beta".into())
            .expect("beta should be created");

        repo.sync_live_account(
            &alpha.id,
            &AccountSnapshot {
                wallet_balance: 1200.0,
                available_balance: 900.0,
                snapshot_equity: 1280.0,
                currency: "USDT".into(),
            },
            &[SyncedPosition {
                exchange_symbol: "BTC-USDT".into(),
                symbol: "BTC-PERP".into(),
                margin_mode: Some(MarginMode::Cross),
                side: PositionSide::Long,
                quantity: 0.15,
                entry_price: 65000.0,
                mark_price: Some(65250.0),
                margin_used: Some(975.0),
                liquidation_price: Some(59800.0),
                maintenance_margin: Some(120.0),
                maintenance_margin_rate: None,
                risk_source: None,
                leverage: 10.0,
                unrealized_pnl: 37.5,
                realized_pnl: 0.0,
                fee_paid: 0.0,
                funding_paid: 0.0,
                opened_at: Utc::now(),
            }],
            &[],
            None,
        )
        .expect("alpha sync should succeed");

        repo.sync_live_account(
            &beta.id,
            &AccountSnapshot {
                wallet_balance: 800.0,
                available_balance: 620.0,
                snapshot_equity: 845.0,
                currency: "USDT".into(),
            },
            &[SyncedPosition {
                exchange_symbol: "ETH-USDT".into(),
                symbol: "ETH-PERP".into(),
                margin_mode: Some(MarginMode::Isolated),
                side: PositionSide::Short,
                quantity: 3.0,
                entry_price: 3200.0,
                mark_price: Some(3150.0),
                margin_used: Some(640.0),
                liquidation_price: Some(3475.0),
                maintenance_margin: Some(54.0),
                maintenance_margin_rate: None,
                risk_source: None,
                leverage: 15.0,
                unrealized_pnl: 150.0,
                realized_pnl: 0.0,
                fee_paid: 0.0,
                funding_paid: 0.0,
                opened_at: Utc::now(),
            }],
            &[],
            None,
        )
        .expect("beta sync should succeed");

        let bootstrap = repo.bootstrap_state().expect("bootstrap should load");
        assert_eq!(bootstrap.positions.len(), 2);
        assert_eq!(
            bootstrap
                .positions
                .iter()
                .filter(|position| position.account_id == alpha.id)
                .count(),
            1
        );
        assert_eq!(
            bootstrap
                .positions
                .iter()
                .filter(|position| position.account_id == beta.id)
                .count(),
            1
        );

        repo.sync_live_account(
            &alpha.id,
            &AccountSnapshot {
                wallet_balance: 1300.0,
                available_balance: 1010.0,
                snapshot_equity: 1365.0,
                currency: "USDT".into(),
            },
            &[SyncedPosition {
                exchange_symbol: "SOL-USDT".into(),
                symbol: "SOL-PERP".into(),
                margin_mode: Some(MarginMode::Cross),
                side: PositionSide::Long,
                quantity: 120.0,
                entry_price: 180.0,
                mark_price: Some(184.0),
                margin_used: Some(2160.0),
                liquidation_price: Some(150.0),
                maintenance_margin: Some(180.0),
                maintenance_margin_rate: None,
                risk_source: None,
                leverage: 10.0,
                unrealized_pnl: 480.0,
                realized_pnl: 0.0,
                fee_paid: 0.0,
                funding_paid: 0.0,
                opened_at: Utc::now(),
            }],
            &[],
            None,
        )
        .expect("alpha resync should succeed");

        let refreshed = repo.bootstrap_state().expect("bootstrap should reload");
        assert_eq!(refreshed.positions.len(), 2);
        assert!(refreshed
            .positions
            .iter()
            .any(|position| { position.account_id == alpha.id && position.symbol == "SOL-PERP" }));
        assert!(!refreshed
            .positions
            .iter()
            .any(|position| { position.account_id == alpha.id && position.symbol == "BTC-PERP" }));
        assert!(refreshed
            .positions
            .iter()
            .any(|position| { position.account_id == beta.id && position.symbol == "ETH-PERP" }));

        drop(repo);
        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn live_sync_records_open_adjust_and_close_position_events() {
        let (repo, root) = open_test_repo();
        let account = repo
            .create_live_account_record(
                "HL Lifecycle".into(),
                ExchangeKind::Hyperliquid,
                "0xlife".into(),
            )
            .expect("live account should be created");
        let opened_at = Utc
            .with_ymd_and_hms(2026, 1, 5, 12, 0, 0)
            .single()
            .expect("valid timestamp");

        repo.sync_live_account(
            &account.id,
            &AccountSnapshot {
                wallet_balance: 1000.0,
                available_balance: 850.0,
                snapshot_equity: 1010.0,
                currency: "USDC".into(),
            },
            &[SyncedPosition {
                exchange_symbol: "BTC".into(),
                symbol: "BTC-PERP".into(),
                margin_mode: Some(MarginMode::Cross),
                side: PositionSide::Long,
                quantity: 0.1,
                entry_price: 70000.0,
                mark_price: Some(70200.0),
                margin_used: Some(700.0),
                liquidation_price: Some(64000.0),
                maintenance_margin: Some(50.0),
                maintenance_margin_rate: None,
                risk_source: None,
                leverage: 10.0,
                unrealized_pnl: 20.0,
                realized_pnl: 0.0,
                fee_paid: 0.0,
                funding_paid: 0.0,
                opened_at,
            }],
            &[],
            None,
        )
        .expect("first sync should succeed");

        repo.sync_live_account(
            &account.id,
            &AccountSnapshot {
                wallet_balance: 1015.0,
                available_balance: 840.0,
                snapshot_equity: 1035.0,
                currency: "USDC".into(),
            },
            &[SyncedPosition {
                exchange_symbol: "BTC".into(),
                symbol: "BTC-PERP".into(),
                margin_mode: Some(MarginMode::Cross),
                side: PositionSide::Long,
                quantity: 0.2,
                entry_price: 70000.0,
                mark_price: Some(70600.0),
                margin_used: Some(1400.0),
                liquidation_price: Some(64000.0),
                maintenance_margin: Some(50.0),
                maintenance_margin_rate: None,
                risk_source: None,
                leverage: 10.0,
                unrealized_pnl: 120.0,
                realized_pnl: 0.0,
                fee_paid: 3.0,
                funding_paid: 1.5,
                opened_at,
            }],
            &[],
            None,
        )
        .expect("second sync should succeed");

        repo.sync_live_account(
            &account.id,
            &AccountSnapshot {
                wallet_balance: 1020.0,
                available_balance: 1020.0,
                snapshot_equity: 1020.0,
                currency: "USDC".into(),
            },
            &[],
            &[],
            None,
        )
        .expect("third sync should succeed");

        let events = repo
            .fetch_recent_position_events(10)
            .expect("position events should load");

        assert_eq!(events.len(), 3);
        assert_eq!(events[0].event_kind, PositionEventKind::Closed);
        assert_eq!(events[1].event_kind, PositionEventKind::Adjusted);
        assert_eq!(events[2].event_kind, PositionEventKind::Opened);
        assert_eq!(events[0].symbol, "BTC-PERP");
        assert_eq!(events[0].position_id, events[1].position_id);
        assert_eq!(events[1].position_id, events[2].position_id);
        assert_eq!(
            repo.fetch_positions_for_account(&account.id)
                .expect("positions should load")
                .len(),
            0
        );

        drop(repo);
        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn list_position_events_filters_by_account_and_exchange() {
        let (repo, root) = open_test_repo();
        let manual = repo
            .create_account(CreateAccountInput {
                name: "Manual Ledger".into(),
                exchange: ExchangeKind::Manual,
                wallet_balance: 1000.0,
                notes: None,
                bonus_balance: None,
                bonus_fee_deduction_rate: None,
                bonus_loss_deduction_rate: None,
                bonus_funding_deduction_rate: None,
            })
            .expect("manual account should be created");
        let imported = repo
            .create_account_with_mode(
                CreateAccountInput {
                    name: "Import Ledger".into(),
                    exchange: ExchangeKind::Import,
                    wallet_balance: 0.0,
                    notes: None,
                    bonus_balance: None,
                    bonus_fee_deduction_rate: None,
                    bonus_loss_deduction_rate: None,
                    bonus_funding_deduction_rate: None,
                },
                AccountMode::Import,
                None,
            )
            .expect("import account should be created");

        repo.add_manual_position(ManualPositionInput {
            account_id: manual.id.clone(),
            exchange: ExchangeKind::Manual,
            exchange_symbol: None,
            symbol: "BTCUSDT".into(),
            margin_mode: None,
            side: PositionSide::Long,
            quantity: 0.2,
            entry_price: 50000.0,
            mark_price: Some(50100.0),
            margin_used: None,
            liquidation_price: None,
            maintenance_margin: None,
            leverage: 5.0,
            realized_pnl: None,
            fee_paid: Some(2.0),
            funding_paid: Some(0.0),
            notes: None,
        })
        .expect("manual position should be added");

        repo.insert_manual_position(
            ManualPositionInput {
                account_id: imported.id.clone(),
                exchange: ExchangeKind::Import,
                exchange_symbol: None,
                symbol: "ETHUSDT".into(),
                margin_mode: None,
                side: PositionSide::Short,
                quantity: 1.0,
                entry_price: 3000.0,
                mark_price: Some(2950.0),
                margin_used: None,
                liquidation_price: None,
                maintenance_margin: None,
                leverage: 3.0,
                realized_pnl: None,
                fee_paid: Some(1.0),
                funding_paid: Some(0.5),
                notes: Some("csv".into()),
            },
            PositionEventKind::Imported,
        )
        .expect("imported position should be added");

        let manual_events = repo
            .query_position_events(PositionEventQueryInput {
                account_id: Some(manual.id.clone()),
                limit: Some(10),
                ..PositionEventQueryInput::default()
            })
            .expect("manual events should load");
        let import_events = repo
            .query_position_events(PositionEventQueryInput {
                exchange: Some(ExchangeKind::Import),
                limit: Some(10),
                ..PositionEventQueryInput::default()
            })
            .expect("import events should load");

        assert_eq!(manual_events.len(), 1);
        assert_eq!(manual_events[0].account_id, manual.id);
        assert_eq!(manual_events[0].event_kind, PositionEventKind::Opened);
        assert_eq!(import_events.len(), 1);
        assert_eq!(import_events[0].account_id, imported.id);
        assert_eq!(import_events[0].event_kind, PositionEventKind::Imported);

        drop(repo);
        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn query_position_events_filters_by_time_symbol_and_kind() {
        let (repo, root) = open_test_repo();
        let account = repo
            .create_account(CreateAccountInput {
                name: "Manual Query".into(),
                exchange: ExchangeKind::Manual,
                wallet_balance: 2500.0,
                notes: None,
                bonus_balance: None,
                bonus_fee_deduction_rate: None,
                bonus_loss_deduction_rate: None,
                bonus_funding_deduction_rate: None,
            })
            .expect("manual account should be created");

        let opened_at = Utc
            .with_ymd_and_hms(2026, 1, 10, 12, 0, 0)
            .single()
            .expect("opened timestamp should be valid");
        let adjusted_at = Utc
            .with_ymd_and_hms(2026, 1, 10, 13, 0, 0)
            .single()
            .expect("adjusted timestamp should be valid");
        let closed_at = Utc
            .with_ymd_and_hms(2026, 1, 10, 14, 0, 0)
            .single()
            .expect("closed timestamp should be valid");

        let btc_position = SyncedPosition {
            exchange_symbol: "BTCUSDT".into(),
            symbol: "BTCUSDT".into(),
            margin_mode: Some(MarginMode::Cross),
            side: PositionSide::Long,
            quantity: 0.15,
            entry_price: 65000.0,
            mark_price: Some(65150.0),
            margin_used: Some(1950.0),
            liquidation_price: Some(58000.0),
            maintenance_margin: Some(140.0),
            maintenance_margin_rate: None,
            risk_source: None,
            leverage: 5.0,
            unrealized_pnl: 22.5,
            realized_pnl: 0.0,
            fee_paid: 1.2,
            funding_paid: 0.0,
            opened_at,
        };
        let eth_position = SyncedPosition {
            exchange_symbol: "ETHUSDT".into(),
            symbol: "ETHUSDT".into(),
            margin_mode: Some(MarginMode::Isolated),
            side: PositionSide::Short,
            quantity: 1.0,
            entry_price: 3200.0,
            mark_price: Some(3150.0),
            margin_used: Some(640.0),
            liquidation_price: Some(3525.0),
            maintenance_margin: Some(55.0),
            maintenance_margin_rate: None,
            risk_source: None,
            leverage: 5.0,
            unrealized_pnl: 50.0,
            realized_pnl: 0.0,
            fee_paid: 0.9,
            funding_paid: 0.2,
            opened_at: closed_at,
        };

        repo.record_position_event(build_position_event_from_synced(
            &account,
            Some("btc-1".into()),
            &btc_position,
            PositionEventKind::Opened,
            opened_at,
            None,
            None,
        ))
        .expect("opened event should record");
        repo.record_position_event(build_position_event_from_synced(
            &account,
            Some("btc-1".into()),
            &btc_position,
            PositionEventKind::Adjusted,
            adjusted_at,
            None,
            Some("scaled in".into()),
        ))
        .expect("adjusted event should record");
        repo.record_position_event(build_position_event_from_synced(
            &account,
            Some("eth-1".into()),
            &eth_position,
            PositionEventKind::Closed,
            closed_at,
            None,
            None,
        ))
        .expect("closed event should record");

        let adjusted_btc = repo
            .query_position_events(PositionEventQueryInput {
                account_id: Some(account.id.clone()),
                exchange: Some(ExchangeKind::Manual),
                event_kind: Some(PositionEventKind::Adjusted),
                symbol: Some("btcusdt".into()),
                started_at: Some(opened_at + chrono::Duration::minutes(30)),
                ended_at: Some(closed_at - chrono::Duration::minutes(30)),
                limit: Some(10),
            })
            .expect("filtered events should load");

        assert_eq!(adjusted_btc.len(), 1);
        assert_eq!(adjusted_btc[0].event_kind, PositionEventKind::Adjusted);
        assert_eq!(adjusted_btc[0].symbol, "BTCUSDT");
        assert_eq!(adjusted_btc[0].note.as_deref(), Some("scaled in"));

        let ordered = repo
            .query_position_events(PositionEventQueryInput {
                account_id: Some(account.id.clone()),
                exchange: Some(ExchangeKind::Manual),
                limit: Some(2),
                ..PositionEventQueryInput::default()
            })
            .expect("ordered events should load");

        assert_eq!(ordered.len(), 2);
        assert_eq!(ordered[0].event_kind, PositionEventKind::Closed);
        assert_eq!(ordered[0].event_time, closed_at);
        assert_eq!(ordered[1].event_kind, PositionEventKind::Adjusted);
        assert_eq!(ordered[1].event_time, adjusted_at);

        drop(repo);
        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn query_position_events_rejects_inverted_time_window() {
        let (repo, root) = open_test_repo();
        let started_at = Utc
            .with_ymd_and_hms(2026, 1, 10, 15, 0, 0)
            .single()
            .expect("timestamp should be valid");
        let ended_at = Utc
            .with_ymd_and_hms(2026, 1, 10, 14, 0, 0)
            .single()
            .expect("timestamp should be valid");

        let error = repo
            .query_position_events(PositionEventQueryInput {
                started_at: Some(started_at),
                ended_at: Some(ended_at),
                ..PositionEventQueryInput::default()
            })
            .expect_err("inverted window should fail");

        assert!(
            error
                .to_string()
                .contains("endedAt must be greater than or equal to startedAt"),
            "unexpected error: {error}"
        );

        drop(repo);
        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn applies_market_quotes_to_non_live_exchange_positions_and_caches_quotes() {
        let (repo, root) = open_test_repo();
        let manual = repo
            .create_account(CreateAccountInput {
                name: "Manual Desk".into(),
                exchange: ExchangeKind::Manual,
                wallet_balance: 5000.0,
                notes: None,
                bonus_balance: None,
                bonus_fee_deduction_rate: None,
                bonus_loss_deduction_rate: None,
                bonus_funding_deduction_rate: None,
            })
            .expect("manual account should be created");
        let live = repo
            .create_live_account_record(
                "BloFin Live".into(),
                ExchangeKind::Blofin,
                "BloFin key · 1234".into(),
            )
            .expect("live account should be created");

        let manual_position = repo
            .add_manual_position(ManualPositionInput {
                account_id: manual.id.clone(),
                exchange: ExchangeKind::Blofin,
                exchange_symbol: None,
                symbol: "BTC-PERP".into(),
                margin_mode: None,
                side: PositionSide::Long,
                quantity: 0.2,
                entry_price: 60000.0,
                mark_price: Some(60100.0),
                margin_used: None,
                liquidation_price: None,
                maintenance_margin: None,
                leverage: 5.0,
                realized_pnl: None,
                fee_paid: Some(2.0),
                funding_paid: Some(1.0),
                notes: None,
            })
            .expect("manual position should be created");
        repo.insert_live_position(
            &live,
            &SyncedPosition {
                exchange_symbol: "BTC-USDT".into(),
                symbol: "BTC-PERP".into(),
                margin_mode: Some(MarginMode::Cross),
                side: PositionSide::Long,
                quantity: 0.5,
                entry_price: 61000.0,
                mark_price: Some(61100.0),
                margin_used: Some(6100.0),
                liquidation_price: Some(56000.0),
                maintenance_margin: Some(420.0),
                maintenance_margin_rate: None,
                risk_source: None,
                leverage: 5.0,
                unrealized_pnl: 50.0,
                realized_pnl: 0.0,
                fee_paid: 0.0,
                funding_paid: 0.0,
                opened_at: Utc::now(),
            },
        )
        .expect("live position should be inserted");

        let updated = repo
            .apply_market_quotes(&[MarketQuote {
                exchange: ExchangeKind::Blofin,
                exchange_symbol: "BTC-USDT".into(),
                symbol: "BTC-PERP".into(),
                mark_price: Some(62000.0),
                oracle_price: Some(61950.0),
                funding_rate: Some(0.0003),
                next_funding_time: Some(Utc::now()),
                as_of: Utc::now(),
            }])
            .expect("market quote application should succeed");

        assert_eq!(updated, 1);

        let repriced = repo
            .get_position(&manual_position.id)
            .expect("manual position should reload");
        assert_eq!(repriced.exchange_symbol.as_deref(), Some("BTC-USDT"));
        assert_eq!(repriced.symbol, "BTC-PERP");
        assert_eq!(repriced.mark_price, Some(62000.0));
        assert!(approx_equal(repriced.unrealized_pnl, 397.0));

        let live_positions = repo
            .fetch_positions_for_account(&live.id)
            .expect("live positions should load");
        assert_eq!(live_positions.len(), 1);
        assert_eq!(live_positions[0].mark_price, Some(61100.0));

        let cached = repo
            .connection
            .query_row(
                "SELECT symbol, mark_price
                 FROM market_quotes
                 WHERE exchange = 'blofin' AND exchange_symbol = 'BTC-USDT'
                 LIMIT 1",
                [],
                |row| Ok((row.get::<_, String>(0)?, row.get::<_, Option<f64>>(1)?)),
            )
            .expect("cached quote should exist");
        assert_eq!(cached.0, "BTC-PERP");
        assert_eq!(cached.1, Some(62000.0));

        drop(repo);
        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn upserts_and_lists_cached_exchange_markets() {
        let (repo, root) = open_test_repo();

        repo.upsert_exchange_markets(&[sample_blofin_market(Some(62000.0))])
            .expect("market catalog should upsert");
        repo.upsert_exchange_markets(&[ExchangeMarket {
            mark_price: Some(62500.0),
            oracle_price: Some(62450.0),
            ..sample_blofin_market(Some(62500.0))
        }])
        .expect("market catalog should update");

        let markets = repo
            .list_exchange_markets(ExchangeKind::Blofin)
            .expect("cached markets should list");

        assert_eq!(markets.len(), 1);
        assert_eq!(markets[0].exchange_symbol, "BTC-USDT");
        assert_eq!(markets[0].symbol, "BTC-PERP");
        assert_eq!(markets[0].mark_price, Some(62500.0));
        assert_eq!(markets[0].oracle_price, Some(62450.0));

        drop(repo);
        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn manual_positions_resolve_cached_market_catalog_and_cached_quotes() {
        let (repo, root) = open_test_repo();
        let account = repo
            .create_account(CreateAccountInput {
                name: "Manual Base".into(),
                exchange: ExchangeKind::Manual,
                wallet_balance: 5000.0,
                notes: None,
                bonus_balance: None,
                bonus_fee_deduction_rate: None,
                bonus_loss_deduction_rate: None,
                bonus_funding_deduction_rate: None,
            })
            .expect("manual account should be created");

        repo.upsert_exchange_markets(&[sample_blofin_market(None)])
            .expect("market catalog should upsert");
        repo.apply_market_quotes(&[MarketQuote {
            exchange: ExchangeKind::Blofin,
            exchange_symbol: "BTC-USDT".into(),
            symbol: "BTC-PERP".into(),
            mark_price: Some(62125.0),
            oracle_price: Some(62100.0),
            funding_rate: Some(0.0002),
            next_funding_time: None,
            as_of: Utc::now(),
        }])
        .expect("quote cache should update");

        let position = repo
            .add_manual_position(ManualPositionInput {
                account_id: account.id,
                exchange: ExchangeKind::Blofin,
                exchange_symbol: None,
                symbol: "btcusdt".into(),
                margin_mode: None,
                side: PositionSide::Long,
                quantity: 0.2,
                entry_price: 60000.0,
                mark_price: None,
                margin_used: None,
                liquidation_price: None,
                maintenance_margin: None,
                leverage: 5.0,
                realized_pnl: None,
                fee_paid: Some(2.0),
                funding_paid: Some(1.0),
                notes: None,
            })
            .expect("manual position should resolve against cached market");

        assert_eq!(position.exchange, ExchangeKind::Blofin);
        assert_eq!(position.exchange_symbol.as_deref(), Some("BTC-USDT"));
        assert_eq!(position.symbol, "BTC-PERP");
        assert_eq!(position.mark_price, Some(62125.0));

        drop(repo);
        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn manual_positions_reject_market_rule_violations() {
        let (repo, root) = open_test_repo();
        let account = repo
            .create_account(CreateAccountInput {
                name: "Manual Rules".into(),
                exchange: ExchangeKind::Manual,
                wallet_balance: 5000.0,
                notes: None,
                bonus_balance: None,
                bonus_fee_deduction_rate: None,
                bonus_loss_deduction_rate: None,
                bonus_funding_deduction_rate: None,
            })
            .expect("manual account should be created");

        repo.upsert_exchange_markets(&[sample_blofin_market(Some(62000.0))])
            .expect("market catalog should upsert");

        let leverage_error = repo
            .add_manual_position(ManualPositionInput {
                account_id: account.id.clone(),
                exchange: ExchangeKind::Blofin,
                exchange_symbol: Some("BTC-USDT".into()),
                symbol: "BTC-PERP".into(),
                margin_mode: None,
                side: PositionSide::Long,
                quantity: 0.1,
                entry_price: 60000.0,
                mark_price: None,
                margin_used: None,
                liquidation_price: None,
                maintenance_margin: None,
                leverage: 55.0,
                realized_pnl: None,
                fee_paid: Some(0.0),
                funding_paid: Some(0.0),
                notes: None,
            })
            .expect_err("excess leverage should be rejected");
        assert!(leverage_error
            .to_string()
            .contains("exceeds max leverage 50"));

        let quantity_error = repo
            .add_manual_position(ManualPositionInput {
                account_id: account.id,
                exchange: ExchangeKind::Blofin,
                exchange_symbol: Some("BTC-USDT".into()),
                symbol: "BTC-PERP".into(),
                margin_mode: None,
                side: PositionSide::Long,
                quantity: 0.0015,
                entry_price: 60000.0,
                mark_price: None,
                margin_used: None,
                liquidation_price: None,
                maintenance_margin: None,
                leverage: 10.0,
                realized_pnl: None,
                fee_paid: Some(0.0),
                funding_paid: Some(0.0),
                notes: None,
            })
            .expect_err("off-step quantity should be rejected");
        assert!(quantity_error
            .to_string()
            .contains("does not align to step 0.001"));

        drop(repo);
        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn updating_manual_positions_preserves_exchange_and_recovers_canonical_market_identity() {
        let (repo, root) = open_test_repo();
        let account = repo
            .create_account(CreateAccountInput {
                name: "Manual Desk".into(),
                exchange: ExchangeKind::Manual,
                wallet_balance: 4000.0,
                notes: None,
                bonus_balance: None,
                bonus_fee_deduction_rate: None,
                bonus_loss_deduction_rate: None,
                bonus_funding_deduction_rate: None,
            })
            .expect("manual account should be created");

        repo.upsert_exchange_markets(&[sample_blofin_market(Some(62050.0))])
            .expect("market catalog should upsert");

        let created = repo
            .add_manual_position(ManualPositionInput {
                account_id: account.id.clone(),
                exchange: ExchangeKind::Blofin,
                exchange_symbol: Some("BTC-USDT".into()),
                symbol: "BTC-PERP".into(),
                margin_mode: None,
                side: PositionSide::Long,
                quantity: 0.1,
                entry_price: 60000.0,
                mark_price: Some(62050.0),
                margin_used: None,
                liquidation_price: None,
                maintenance_margin: None,
                leverage: 5.0,
                realized_pnl: None,
                fee_paid: Some(1.0),
                funding_paid: Some(0.5),
                notes: None,
            })
            .expect("manual position should be created");

        let updated = repo
            .update_manual_position(UpdateManualPositionInput {
                id: created.id,
                account_id: account.id,
                exchange_symbol: None,
                symbol: "btcusdt".into(),
                margin_mode: None,
                side: PositionSide::Long,
                quantity: 0.3,
                entry_price: 60100.0,
                mark_price: None,
                margin_used: None,
                liquidation_price: None,
                maintenance_margin: None,
                leverage: 6.0,
                realized_pnl: None,
                fee_paid: Some(1.2),
                funding_paid: Some(0.5),
                notes: Some("resized".into()),
            })
            .expect("manual position update should preserve exchange-backed identity");

        assert_eq!(updated.exchange, ExchangeKind::Blofin);
        assert_eq!(updated.exchange_symbol.as_deref(), Some("BTC-USDT"));
        assert_eq!(updated.symbol, "BTC-PERP");
        assert_eq!(updated.mark_price, Some(62050.0));

        drop(repo);
        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn csv_import_uses_cached_market_catalog_for_exchange_backed_rows() {
        let (repo, root) = open_test_repo();

        repo.upsert_exchange_markets(&[sample_blofin_market(None)])
            .expect("market catalog should upsert");
        repo.apply_market_quotes(&[MarketQuote {
            exchange: ExchangeKind::Blofin,
            exchange_symbol: "BTC-USDT".into(),
            symbol: "BTC-PERP".into(),
            mark_price: Some(61980.0),
            oracle_price: Some(61975.0),
            funding_rate: Some(0.0002),
            next_funding_time: None,
            as_of: Utc::now(),
        }])
        .expect("quote cache should update");

        repo.import_csv(CsvImportInput {
            exchange: ExchangeKind::Blofin,
            target_account_id: None,
            csv: "symbol,side,entry_price,quantity,leverage,mark_price,fee_paid,funding_paid\nBTCUSDT,long,60000,0.1,5,,1.5,0.4\n".into(),
        })
        .expect("csv import should succeed");

        let positions = repo.fetch_positions().expect("positions should load");
        assert_eq!(positions.len(), 1);
        assert_eq!(positions[0].exchange, ExchangeKind::Blofin);
        assert_eq!(positions[0].exchange_symbol.as_deref(), Some("BTC-USDT"));
        assert_eq!(positions[0].symbol, "BTC-PERP");
        assert_eq!(positions[0].mark_price, Some(61980.0));

        drop(repo);
        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn csv_import_rejects_invalid_market_rows_without_dropping_valid_rows() {
        let (repo, root) = open_test_repo();

        repo.upsert_exchange_markets(&[sample_blofin_market(Some(61980.0))])
            .expect("market catalog should upsert");

        let result = repo
            .import_csv(CsvImportInput {
                exchange: ExchangeKind::Blofin,
                target_account_id: None,
                csv: "symbol,side,entry_price,quantity,leverage,mark_price,fee_paid,funding_paid\nBTCUSDT,long,60000,0.1,10,,1.5,0.4\nBTCUSDT,long,60000,0.1,70,,1.5,0.4\n".into(),
            })
            .expect("csv import should partially succeed");

        assert_eq!(result.imported_count, 1);
        assert_eq!(result.rejected_rows.len(), 1);
        assert!(result.rejected_rows[0].contains("row 3"));
        assert!(result.rejected_rows[0].contains("exceeds max leverage 50"));

        let positions = repo.fetch_positions().expect("positions should load");
        assert_eq!(positions.len(), 1);
        assert_eq!(positions[0].exchange_symbol.as_deref(), Some("BTC-USDT"));
        assert_eq!(positions[0].symbol, "BTC-PERP");

        drop(repo);
        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn csv_import_persists_live_parity_fields_for_manual_books() {
        let (repo, root) = open_test_repo();

        let result = repo
            .import_csv(CsvImportInput {
                exchange: ExchangeKind::Hyperliquid,
                target_account_id: None,
                csv: "symbol,exchange_symbol,margin_mode,side,entry_price,quantity,leverage,mark_price,margin_used,liquidation_price,maintenance_margin,realized_pnl,fee_paid,funding_paid\nBTC-PERP,BTC,cross,long,70000,0.2,10,70400,1400,65000,55,18.5,3.2,1.1\n".into(),
            })
            .expect("csv import should succeed");

        assert_eq!(result.imported_count, 1);
        assert!(result.rejected_rows.is_empty());

        let bootstrap = repo.bootstrap_state().expect("bootstrap should load");
        assert_eq!(bootstrap.accounts.len(), 1);
        assert_eq!(bootstrap.accounts[0].currency, "USDC");
        assert_eq!(bootstrap.positions.len(), 1);
        assert_eq!(bootstrap.positions[0].margin_mode, Some(MarginMode::Cross));
        assert_eq!(bootstrap.positions[0].margin_used, Some(1400.0));
        assert_eq!(bootstrap.positions[0].liquidation_price, Some(65000.0));
        assert_eq!(bootstrap.positions[0].maintenance_margin, Some(55.0));
        assert_eq!(bootstrap.positions[0].realized_pnl, 18.5);

        drop(repo);
        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn exchange_backed_manual_positions_use_contract_value_for_pnl_and_summary() {
        let (repo, root) = open_test_repo();
        let account = repo
            .create_account(CreateAccountInput {
                name: "BloFin ETH".into(),
                exchange: ExchangeKind::Blofin,
                wallet_balance: 500.0,
                notes: None,
                bonus_balance: None,
                bonus_fee_deduction_rate: None,
                bonus_loss_deduction_rate: None,
                bonus_funding_deduction_rate: None,
            })
            .expect("manual account should be created");
        repo.upsert_exchange_markets(&[sample_blofin_eth_market(1600.0)])
            .expect("market cache should load");
        repo.upsert_exchange_risk_tiers(&[sample_blofin_tier(
            "ETH-USDT",
            MarginMode::Isolated,
            0.004,
        )])
        .expect("risk tier cache should load");

        let position = repo
            .add_manual_position(ManualPositionInput {
                account_id: account.id,
                exchange: ExchangeKind::Blofin,
                exchange_symbol: Some("ETH-USDT".into()),
                symbol: "ETH-PERP".into(),
                margin_mode: Some(MarginMode::Isolated),
                side: PositionSide::Long,
                quantity: 10.0,
                entry_price: 1500.0,
                mark_price: Some(1600.0),
                margin_used: None,
                liquidation_price: None,
                maintenance_margin: None,
                leverage: 5.0,
                realized_pnl: None,
                fee_paid: Some(2.0),
                funding_paid: Some(1.0),
                notes: None,
            })
            .expect("manual position should be created");

        assert!(approx_equal(position.unrealized_pnl, 97.0));

        let bootstrap = repo.bootstrap_state().expect("bootstrap should load");
        assert!(approx_equal(bootstrap.summary.gross_notional, 1600.0));
        assert!(approx_equal(bootstrap.summary.total_unrealized_pnl, 97.0));
        assert_eq!(bootstrap.exposure.len(), 1);
        assert!(approx_equal(bootstrap.exposure[0].long_notional, 1600.0));
        assert!(approx_equal(bootstrap.exposure[0].net_notional, 1600.0));

        drop(repo);
        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn updating_exchange_backed_manual_positions_recomputes_pnl_with_contract_value() {
        let (repo, root) = open_test_repo();
        let account = repo
            .create_account(CreateAccountInput {
                name: "BloFin Update".into(),
                exchange: ExchangeKind::Blofin,
                wallet_balance: 800.0,
                notes: None,
                bonus_balance: None,
                bonus_fee_deduction_rate: None,
                bonus_loss_deduction_rate: None,
                bonus_funding_deduction_rate: None,
            })
            .expect("manual account should be created");
        repo.upsert_exchange_markets(&[sample_blofin_eth_market(1700.0)])
            .expect("market cache should load");
        repo.upsert_exchange_risk_tiers(&[sample_blofin_tier(
            "ETH-USDT",
            MarginMode::Isolated,
            0.004,
        )])
        .expect("risk tier cache should load");

        let created = repo
            .add_manual_position(ManualPositionInput {
                account_id: account.id.clone(),
                exchange: ExchangeKind::Blofin,
                exchange_symbol: Some("ETH-USDT".into()),
                symbol: "ETH-PERP".into(),
                margin_mode: Some(MarginMode::Isolated),
                side: PositionSide::Long,
                quantity: 10.0,
                entry_price: 1500.0,
                mark_price: Some(1500.0),
                margin_used: None,
                liquidation_price: None,
                maintenance_margin: None,
                leverage: 5.0,
                realized_pnl: None,
                fee_paid: Some(0.0),
                funding_paid: Some(0.0),
                notes: None,
            })
            .expect("manual position should be created");

        let updated = repo
            .update_manual_position(UpdateManualPositionInput {
                id: created.id,
                account_id: account.id,
                exchange_symbol: None,
                symbol: "ethusdt".into(),
                margin_mode: Some(MarginMode::Isolated),
                side: PositionSide::Long,
                quantity: 20.0,
                entry_price: 1500.0,
                mark_price: Some(1700.0),
                margin_used: None,
                liquidation_price: None,
                maintenance_margin: None,
                leverage: 5.0,
                realized_pnl: None,
                fee_paid: Some(3.0),
                funding_paid: Some(2.0),
                notes: Some("scaled".into()),
            })
            .expect("manual position should update");

        assert_eq!(updated.exchange_symbol.as_deref(), Some("ETH-USDT"));
        assert_eq!(updated.symbol, "ETH-PERP");
        assert!(approx_equal(updated.unrealized_pnl, 395.0));

        drop(repo);
        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn quote_refresh_uses_contract_value_for_exchange_backed_manual_positions() {
        let (repo, root) = open_test_repo();
        let account = repo
            .create_account(CreateAccountInput {
                name: "BloFin Quotes".into(),
                exchange: ExchangeKind::Blofin,
                wallet_balance: 800.0,
                notes: None,
                bonus_balance: None,
                bonus_fee_deduction_rate: None,
                bonus_loss_deduction_rate: None,
                bonus_funding_deduction_rate: None,
            })
            .expect("manual account should be created");
        repo.upsert_exchange_markets(&[sample_blofin_eth_market(1500.0)])
            .expect("market cache should load");
        repo.upsert_exchange_risk_tiers(&[sample_blofin_tier(
            "ETH-USDT",
            MarginMode::Isolated,
            0.004,
        )])
        .expect("risk tier cache should load");

        let created = repo
            .add_manual_position(ManualPositionInput {
                account_id: account.id,
                exchange: ExchangeKind::Blofin,
                exchange_symbol: Some("ETH-USDT".into()),
                symbol: "ETH-PERP".into(),
                margin_mode: Some(MarginMode::Isolated),
                side: PositionSide::Long,
                quantity: 10.0,
                entry_price: 1500.0,
                mark_price: Some(1500.0),
                margin_used: None,
                liquidation_price: None,
                maintenance_margin: None,
                leverage: 5.0,
                realized_pnl: None,
                fee_paid: Some(2.0),
                funding_paid: Some(1.0),
                notes: None,
            })
            .expect("manual position should be created");

        let updated = repo
            .apply_market_quotes(&[MarketQuote {
                exchange: ExchangeKind::Blofin,
                exchange_symbol: "ETH-USDT".into(),
                symbol: "ETH-PERP".into(),
                mark_price: Some(1600.0),
                oracle_price: Some(1599.5),
                funding_rate: Some(0.0002),
                next_funding_time: Some(Utc::now()),
                as_of: Utc::now(),
            }])
            .expect("quote application should succeed");
        assert_eq!(updated, 1);

        let repriced = repo
            .get_position(&created.id)
            .expect("repriced position should load");
        assert_eq!(repriced.mark_price, Some(1600.0));
        assert!(approx_equal(repriced.unrealized_pnl, 97.0));

        drop(repo);
        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn closing_manual_positions_records_closed_trades_for_full_and_partial_reduces() {
        let (repo, root) = open_test_repo();
        let account = repo
            .create_account(CreateAccountInput {
                name: "Manual Close".into(),
                exchange: ExchangeKind::Manual,
                wallet_balance: 2000.0,
                notes: None,
                bonus_balance: None,
                bonus_fee_deduction_rate: None,
                bonus_loss_deduction_rate: None,
                bonus_funding_deduction_rate: None,
            })
            .expect("manual account should be created");

        let partial = repo
            .add_manual_position(ManualPositionInput {
                account_id: account.id.clone(),
                exchange: ExchangeKind::Manual,
                exchange_symbol: None,
                symbol: "BTCUSDT".into(),
                margin_mode: Some(MarginMode::Cross),
                side: PositionSide::Long,
                quantity: 2.0,
                entry_price: 100.0,
                mark_price: Some(100.0),
                margin_used: None,
                liquidation_price: None,
                maintenance_margin: None,
                leverage: 5.0,
                realized_pnl: None,
                fee_paid: Some(0.0),
                funding_paid: Some(0.0),
                notes: None,
            })
            .expect("partial position should be created");

        let partial_result = repo
            .close_manual_position(CloseManualPositionInput {
                position_id: partial.id.clone(),
                quantity: Some(0.5),
                exit_price: 120.0,
                fee_paid: Some(2.0),
                funding_paid: Some(1.0),
                closed_at: Some(
                    Utc.with_ymd_and_hms(2026, 1, 12, 10, 0, 0)
                        .single()
                        .expect("timestamp should be valid"),
                ),
                note: Some("trim".into()),
            })
            .expect("partial close should succeed");

        assert!(approx_equal(partial_result.closed_trade.realized_pnl, 7.0));
        let remaining = partial_result
            .remaining_position
            .expect("partial close should keep a remainder");
        assert!(approx_equal(remaining.quantity, 1.5));
        assert!(approx_equal(remaining.realized_pnl, 7.0));

        let full = repo
            .add_manual_position(ManualPositionInput {
                account_id: account.id.clone(),
                exchange: ExchangeKind::Manual,
                exchange_symbol: None,
                symbol: "ETHUSDT".into(),
                margin_mode: Some(MarginMode::Isolated),
                side: PositionSide::Short,
                quantity: 1.0,
                entry_price: 200.0,
                mark_price: Some(200.0),
                margin_used: None,
                liquidation_price: None,
                maintenance_margin: None,
                leverage: 4.0,
                realized_pnl: None,
                fee_paid: Some(0.0),
                funding_paid: Some(0.0),
                notes: None,
            })
            .expect("full position should be created");

        let full_result = repo
            .close_manual_position(CloseManualPositionInput {
                position_id: full.id.clone(),
                quantity: None,
                exit_price: 180.0,
                fee_paid: Some(1.0),
                funding_paid: Some(0.0),
                closed_at: Some(
                    Utc.with_ymd_and_hms(2026, 1, 12, 11, 0, 0)
                        .single()
                        .expect("timestamp should be valid"),
                ),
                note: Some("exit".into()),
            })
            .expect("full close should succeed");

        assert!(full_result.remaining_position.is_none());
        let remaining_positions = repo.fetch_positions().expect("positions should load");
        assert_eq!(remaining_positions.len(), 1);
        assert_eq!(remaining_positions[0].id, partial.id);

        let closed_trades = repo
            .query_closed_trades(ClosedTradeQueryInput {
                account_id: Some(account.id.clone()),
                exchange: Some(ExchangeKind::Manual),
                limit: Some(10),
                ..ClosedTradeQueryInput::default()
            })
            .expect("closed trades should load");
        assert_eq!(closed_trades.len(), 2);
        assert_eq!(closed_trades[0].symbol, "ETHUSDT");
        assert!(approx_equal(closed_trades[0].realized_pnl, 19.0));
        assert_eq!(closed_trades[1].symbol, "BTCUSDT");
        assert!(approx_equal(closed_trades[1].realized_pnl, 7.0));

        let bootstrap = repo.bootstrap_state().expect("bootstrap should load");
        assert_eq!(bootstrap.recent_closed_trades.len(), 2);

        drop(repo);
        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn query_closed_trades_filters_and_rejects_inverted_time_windows() {
        let (repo, root) = open_test_repo();
        let account = repo
            .create_account(CreateAccountInput {
                name: "Manual Query".into(),
                exchange: ExchangeKind::Manual,
                wallet_balance: 1500.0,
                notes: None,
                bonus_balance: None,
                bonus_fee_deduction_rate: None,
                bonus_loss_deduction_rate: None,
                bonus_funding_deduction_rate: None,
            })
            .expect("manual account should be created");

        let first = repo
            .add_manual_position(ManualPositionInput {
                account_id: account.id.clone(),
                exchange: ExchangeKind::Manual,
                exchange_symbol: None,
                symbol: "BTCUSDT".into(),
                margin_mode: None,
                side: PositionSide::Long,
                quantity: 1.0,
                entry_price: 100.0,
                mark_price: Some(100.0),
                margin_used: None,
                liquidation_price: None,
                maintenance_margin: None,
                leverage: 3.0,
                realized_pnl: None,
                fee_paid: Some(0.0),
                funding_paid: Some(0.0),
                notes: None,
            })
            .expect("first position should be created");
        let second = repo
            .add_manual_position(ManualPositionInput {
                account_id: account.id.clone(),
                exchange: ExchangeKind::Manual,
                exchange_symbol: None,
                symbol: "ETHUSDT".into(),
                margin_mode: None,
                side: PositionSide::Short,
                quantity: 1.0,
                entry_price: 200.0,
                mark_price: Some(200.0),
                margin_used: None,
                liquidation_price: None,
                maintenance_margin: None,
                leverage: 3.0,
                realized_pnl: None,
                fee_paid: Some(0.0),
                funding_paid: Some(0.0),
                notes: None,
            })
            .expect("second position should be created");

        let first_closed_at = Utc
            .with_ymd_and_hms(2026, 1, 13, 10, 0, 0)
            .single()
            .expect("timestamp should be valid");
        let second_closed_at = Utc
            .with_ymd_and_hms(2026, 1, 13, 11, 0, 0)
            .single()
            .expect("timestamp should be valid");

        repo.close_manual_position(CloseManualPositionInput {
            position_id: first.id,
            quantity: None,
            exit_price: 110.0,
            fee_paid: Some(0.0),
            funding_paid: Some(0.0),
            closed_at: Some(first_closed_at),
            note: None,
        })
        .expect("first close should succeed");
        repo.close_manual_position(CloseManualPositionInput {
            position_id: second.id,
            quantity: None,
            exit_price: 180.0,
            fee_paid: Some(0.0),
            funding_paid: Some(0.0),
            closed_at: Some(second_closed_at),
            note: None,
        })
        .expect("second close should succeed");

        let filtered = repo
            .query_closed_trades(ClosedTradeQueryInput {
                account_id: Some(account.id.clone()),
                exchange: Some(ExchangeKind::Manual),
                symbol: Some("btcusdt".into()),
                started_at: Some(first_closed_at - chrono::Duration::minutes(5)),
                ended_at: Some(first_closed_at + chrono::Duration::minutes(5)),
                limit: Some(10),
            })
            .expect("filtered closed trades should load");
        assert_eq!(filtered.len(), 1);
        assert_eq!(filtered[0].symbol, "BTCUSDT");

        let error = repo
            .query_closed_trades(ClosedTradeQueryInput {
                started_at: Some(second_closed_at),
                ended_at: Some(first_closed_at),
                limit: Some(10),
                ..ClosedTradeQueryInput::default()
            })
            .expect_err("inverted window should fail");
        assert!(
            error
                .to_string()
                .contains("endedAt must be greater than or equal to startedAt"),
            "unexpected error: {error}"
        );

        drop(repo);
        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn live_synced_positions_cannot_be_closed_locally() {
        let (repo, root) = open_test_repo();
        let account = repo
            .create_live_account_record(
                "HL Live".into(),
                ExchangeKind::Hyperliquid,
                "0xclose".into(),
            )
            .expect("live account should be created");
        repo.sync_live_account(
                &account.id,
                &AccountSnapshot {
                    wallet_balance: 1000.0,
                    available_balance: 900.0,
                    snapshot_equity: 1010.0,
                    currency: "USDC".into(),
                },
                &[SyncedPosition {
                    exchange_symbol: "BTC".into(),
                    symbol: "BTC-PERP".into(),
                    margin_mode: Some(MarginMode::Cross),
                    side: PositionSide::Long,
                    quantity: 0.1,
                    entry_price: 70000.0,
                    mark_price: Some(70100.0),
                    margin_used: Some(700.0),
                    liquidation_price: Some(64000.0),
                    maintenance_margin: Some(50.0),
                    maintenance_margin_rate: None,
                    risk_source: None,
                    leverage: 10.0,
                    unrealized_pnl: 10.0,
                    realized_pnl: 0.0,
                    fee_paid: 0.0,
                    funding_paid: 0.0,
                    opened_at: Utc::now(),
                }],
                &[],
                None,
            )
            .expect("live sync should succeed");
        let position = repo
            .fetch_positions_for_account(&account.id)
            .expect("live positions should load")
            .into_iter()
            .next()
            .expect("live position should exist");

        let error = repo
            .close_manual_position(CloseManualPositionInput {
                position_id: position.id.clone(),
                quantity: None,
                exit_price: 70500.0,
                fee_paid: Some(0.0),
                funding_paid: Some(0.0),
                closed_at: None,
                note: None,
            })
            .expect_err("live positions should reject local close");
        assert!(error
            .to_string()
            .contains("live-synced positions cannot be closed locally"));

        drop(repo);
        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn failed_sync_marks_account_error_without_erasing_last_good_state() {
        let (repo, root) = open_test_repo();
        let account = repo
            .create_live_account_record(
                "HL Core".into(),
                ExchangeKind::Hyperliquid,
                "0xcore".into(),
            )
            .expect("live account should be created");
        let first_job = repo
            .begin_sync_job(&account.id, ExchangeKind::Hyperliquid)
            .expect("first job should start");

        repo.sync_live_account(
            &account.id,
            &AccountSnapshot {
                wallet_balance: 900.0,
                available_balance: 700.0,
                snapshot_equity: 950.0,
                currency: "USDC".into(),
            },
            &[SyncedPosition {
                exchange_symbol: "ETH".into(),
                symbol: "ETH-PERP".into(),
                margin_mode: Some(MarginMode::Cross),
                side: PositionSide::Long,
                quantity: 1.5,
                entry_price: 3200.0,
                mark_price: Some(3250.0),
                margin_used: Some(480.0),
                liquidation_price: Some(2810.0),
                maintenance_margin: Some(42.0),
                maintenance_margin_rate: None,
                risk_source: None,
                leverage: 10.0,
                unrealized_pnl: 75.0,
                realized_pnl: 0.0,
                fee_paid: 0.0,
                funding_paid: 0.0,
                opened_at: Utc::now(),
            }],
            &[],
            Some(&first_job),
        )
        .expect("initial sync should succeed");
        repo.complete_sync_job_success(&first_job, 1, 1, 0)
            .expect("first job should complete");

        let last_good = repo
            .get_account(&account.id)
            .expect("account should load after success")
            .last_synced_at;

        let failed_job = repo
            .begin_sync_job(&account.id, ExchangeKind::Hyperliquid)
            .expect("failed job should start");
        repo.mark_sync_error(&account.id, "request error: timeout")
            .expect("account should record sync error");
        repo.complete_sync_job_failure(&failed_job, 3, "request error: timeout")
            .expect("failed job should complete");

        let bootstrap = repo.bootstrap_state().expect("bootstrap should load");
        let refreshed = bootstrap
            .accounts
            .iter()
            .find(|item| item.id == account.id)
            .expect("account should exist");

        assert_eq!(refreshed.sync_status, SyncStatus::Error);
        assert_eq!(
            refreshed.sync_error.as_deref(),
            Some("request error: timeout")
        );
        assert_eq!(refreshed.snapshot_equity, 950.0);
        assert_eq!(refreshed.last_synced_at, last_good);
        assert_eq!(
            bootstrap
                .positions
                .iter()
                .filter(|position| position.account_id == account.id)
                .count(),
            1
        );
        assert_eq!(bootstrap.recent_sync_jobs.len(), 2);
        assert_eq!(bootstrap.recent_sync_jobs[0].state, SyncJobState::Failed);
        assert_eq!(bootstrap.recent_sync_jobs[0].attempt_count, 3);

        drop(repo);
        let _ = std::fs::remove_dir_all(root);
    }
}
