use std::{collections::BTreeSet, sync::Arc};

use chrono::Utc;
use tauri::State;
use tokio::time::{sleep, Duration};

use crate::{
    connectors::{
        build_external_reference, connector_for, estimate_public_position_funding,
        fetch_exchange_risk_tiers, ExchangeConnector,
    },
    credentials::build_credentials,
    csv_import::parse_csv,
    domain::{
        BootstrapState, CloseManualPositionInput, CloseManualPositionResult, ClosedTradeQueryInput,
        ClosedTradeRecord, CreateAccountInput, CreateLiveAccountInput, CsvImportInput,
        CsvImportResult, ExchangeAccount, ExchangeKind, ExchangeMarket, FundingMode, LanStatus,
        LiveAccountValidation, ManualPositionInput, MarginMode, MarketQuote, PortfolioPosition,
        PositionEventQueryInput, PositionEventRecord, PositionFundingEstimate,
        PositionFundingEstimateInput, QuoteRefreshResult, SyncAccountResult, SyncAllAccountsResult,
        SyncFailure, UpdateAccountInput, UpdateManualPositionInput,
    },
    error::{command_result, invalid_input, AppError},
    secret_store::{
        clear_runtime_secrets, delete_live_credentials, load_lan_passphrase, load_live_credentials,
        store_lan_passphrase, store_live_credentials,
    },
    store::MarketQuoteRefreshTarget,
    AppServices,
};

const MAX_SYNC_ATTEMPTS: u32 = 3;
const INITIAL_BACKOFF_MS: u64 = 350;

#[tauri::command]
pub fn get_bootstrap_state(state: State<'_, Arc<AppServices>>) -> Result<BootstrapState, String> {
    command_result(state.snapshot())
}

#[tauri::command]
pub fn create_account(
    state: State<'_, Arc<AppServices>>,
    input: CreateAccountInput,
) -> Result<ExchangeAccount, String> {
    let created = {
        let repository = state
            .repository
            .lock()
            .map_err(|_| AppError::StatePoisoned("repository").to_string())?;
        repository.create_account(input)
    };
    let created = command_result(created)?;
    let _ = state.emit_snapshot();
    Ok(created)
}

#[tauri::command]
pub fn update_account(
    state: State<'_, Arc<AppServices>>,
    input: UpdateAccountInput,
) -> Result<ExchangeAccount, String> {
    let updated = {
        let repository = state
            .repository
            .lock()
            .map_err(|_| AppError::StatePoisoned("repository").to_string())?;
        repository.update_account(input)
    };
    let updated = command_result(updated)?;
    let _ = state.emit_snapshot();
    Ok(updated)
}

#[tauri::command]
pub fn delete_account(
    state: State<'_, Arc<AppServices>>,
    account_id: String,
) -> Result<(), String> {
    let account = {
        let repository = state
            .repository
            .lock()
            .map_err(|_| AppError::StatePoisoned("repository").to_string())?;
        let account = command_result(repository.get_account(&account_id))?;
        command_result(repository.delete_account_with_snapshot(&account_id))?;
        account
    };

    if account.account_mode == crate::domain::AccountMode::Live {
        command_result(delete_live_credentials(&state.secrets_dir, &account_id))?;
    }

    let _ = state.emit_snapshot();
    Ok(())
}

#[tauri::command]
pub async fn validate_live_account(
    state: State<'_, Arc<AppServices>>,
    input: CreateLiveAccountInput,
) -> Result<LiveAccountValidation, String> {
    let credentials = command_result(build_credentials(&input))?;
    let external_reference = command_result(build_external_reference(&input, &credentials))?;
    let connector = command_result(connector_for(input.exchange, state.http_client.clone()))?;
    let mut validation = command_result(connector.validate_credentials(&credentials).await)?;
    validation.external_reference = external_reference;
    Ok(validation)
}

#[tauri::command]
pub async fn create_live_account(
    state: State<'_, Arc<AppServices>>,
    input: CreateLiveAccountInput,
) -> Result<SyncAccountResult, String> {
    let credentials = command_result(build_credentials(&input))?;
    let connector = command_result(connector_for(input.exchange, state.http_client.clone()))?;
    let external_reference = command_result(build_external_reference(&input, &credentials))?;
    let account_name = input.name.trim().to_string();
    if account_name.is_empty() {
        return Err("account name cannot be empty".into());
    }
    let _ = command_result(connector.validate_credentials(&credentials).await)?;

    let account_id = {
        let repository = state
            .repository
            .lock()
            .map_err(|_| AppError::StatePoisoned("repository").to_string())?;
        let account = command_result(repository.create_live_account_record(
            account_name,
            input.exchange,
            external_reference,
        ))?;
        account.id
    };

    let store_result = store_live_credentials(&state.secrets_dir, &account_id, &credentials);
    if let Err(error) = store_result {
        let repository = state
            .repository
            .lock()
            .map_err(|_| AppError::StatePoisoned("repository").to_string())?;
        let _ = repository.delete_account(&account_id);
        return Err(error.to_string());
    }

    let _sync_guard = state.sync_gate.lock().await;
    match sync_account_inner(state.inner(), &account_id).await {
        Ok(result) => {
            let _ = state.emit_snapshot();
            Ok(result)
        }
        Err(error) => {
            let repository = state
                .repository
                .lock()
                .map_err(|_| AppError::StatePoisoned("repository").to_string())?;
            let _ = repository.delete_account(&account_id);
            let _ = delete_live_credentials(&state.secrets_dir, &account_id);
            Err(error.to_string())
        }
    }
}

#[tauri::command]
pub async fn sync_live_account(
    state: State<'_, Arc<AppServices>>,
    account_id: String,
) -> Result<SyncAccountResult, String> {
    let _sync_guard = state.sync_gate.lock().await;
    let result = sync_account_inner(state.inner(), &account_id).await;
    match result {
        Ok(result) => {
            let _ = state.emit_snapshot();
            Ok(result)
        }
        Err(error) => {
            let _ = state.emit_snapshot();
            Err(error.to_string())
        }
    }
}

#[tauri::command]
pub async fn sync_all_live_accounts(
    state: State<'_, Arc<AppServices>>,
) -> Result<SyncAllAccountsResult, String> {
    let _sync_guard = state.sync_gate.lock().await;
    let result = command_result(sync_all_live_accounts_inner(state.inner()).await)?;
    let _ = state.emit_snapshot();
    Ok(result)
}

#[tauri::command]
pub async fn add_manual_position(
    state: State<'_, Arc<AppServices>>,
    input: ManualPositionInput,
) -> Result<PortfolioPosition, String> {
    let mut input = input;
    let funding_mode = resolve_manual_funding_mode(
        input.exchange,
        input.funding_mode,
        None,
        input.opened_at.is_some(),
        input.funding_paid.is_some(),
    );
    input.funding_mode = Some(funding_mode);
    command_result(
        prime_manual_risk_model(
            state.inner(),
            input.exchange,
            input.exchange_symbol.as_deref(),
            Some(input.symbol.as_str()),
            input.margin_mode,
        )
        .await,
    )?;
    input.funding_paid = command_result(
        maybe_fill_manual_position_funding(
            state.inner(),
            input.exchange,
            input.exchange_symbol.as_deref(),
            input.symbol.as_str(),
            input.side,
            input.quantity,
            input.opened_at,
            funding_mode,
            input.funding_paid,
        )
        .await,
    )?;
    let created = {
        let repository = state
            .repository
            .lock()
            .map_err(|_| AppError::StatePoisoned("repository").to_string())?;
        repository.add_manual_position(input)
    };
    let created = command_result(created)?;
    let _ = state.emit_snapshot();
    Ok(created)
}

#[tauri::command]
pub async fn update_manual_position(
    state: State<'_, Arc<AppServices>>,
    input: UpdateManualPositionInput,
) -> Result<PortfolioPosition, String> {
    let mut input = input;
    let existing_position = {
        let repository = state
            .repository
            .lock()
            .map_err(|_| AppError::StatePoisoned("repository").to_string())?;
        command_result(repository.get_position(&input.id))?
    };
    let existing_exchange = existing_position.exchange;
    let funding_mode = resolve_manual_funding_mode(
        existing_exchange,
        input.funding_mode,
        Some(existing_position.funding_mode),
        input.opened_at.is_some(),
        input.funding_paid.is_some(),
    );
    if input.opened_at.is_none() {
        input.opened_at = Some(existing_position.opened_at);
    }
    input.funding_mode = Some(funding_mode);
    command_result(
        prime_manual_risk_model(
            state.inner(),
            existing_exchange,
            input.exchange_symbol.as_deref(),
            Some(input.symbol.as_str()),
            input.margin_mode,
        )
        .await,
    )?;
    input.funding_paid = command_result(
        maybe_fill_manual_position_funding(
            state.inner(),
            existing_exchange,
            input.exchange_symbol.as_deref(),
            input.symbol.as_str(),
            input.side,
            input.quantity,
            input.opened_at,
            funding_mode,
            input.funding_paid,
        )
        .await,
    )?;
    let updated = {
        let repository = state
            .repository
            .lock()
            .map_err(|_| AppError::StatePoisoned("repository").to_string())?;
        repository.update_manual_position(input)
    };
    let updated = command_result(updated)?;
    let _ = state.emit_snapshot();
    Ok(updated)
}

#[tauri::command]
pub fn delete_manual_position(
    state: State<'_, Arc<AppServices>>,
    position_id: String,
) -> Result<(), String> {
    {
        let repository = state
            .repository
            .lock()
            .map_err(|_| AppError::StatePoisoned("repository").to_string())?;
        command_result(repository.delete_manual_position(&position_id))?;
    }
    let _ = state.emit_snapshot();
    Ok(())
}

#[tauri::command]
pub fn close_manual_position(
    state: State<'_, Arc<AppServices>>,
    input: CloseManualPositionInput,
) -> Result<CloseManualPositionResult, String> {
    let result = {
        let repository = state
            .repository
            .lock()
            .map_err(|_| AppError::StatePoisoned("repository").to_string())?;
        repository.close_manual_position(input)
    };
    let result = command_result(result)?;
    let _ = state.emit_snapshot();
    Ok(result)
}

#[tauri::command]
pub async fn import_csv_positions(
    state: State<'_, Arc<AppServices>>,
    input: CsvImportInput,
) -> Result<CsvImportResult, String> {
    let (rows, _) = command_result(parse_csv(&input.csv))?;
    let should_refresh_auto_funding = matches!(
        input.exchange,
        ExchangeKind::Blofin | ExchangeKind::Hyperliquid
    ) && rows
        .iter()
        .any(|row| row.data.opened_at.is_some() && row.data.funding_paid.is_none());
    for row in &rows {
        command_result(
            prime_manual_risk_model(
                state.inner(),
                input.exchange,
                row.data.exchange_symbol.as_deref(),
                Some(row.data.symbol.as_str()),
                row.data.margin_mode,
            )
            .await,
        )?;
    }
    let result = {
        let repository = state
            .repository
            .lock()
            .map_err(|_| AppError::StatePoisoned("repository").to_string())?;
        repository.import_csv(input)
    };
    let result = command_result(result)?;
    if should_refresh_auto_funding {
        match refresh_local_auto_funding_inner(state.inner()).await {
            Ok((_, warnings)) => {
                for warning in warnings {
                    log::warn!("prepview auto funding refresh warning: {warning}");
                }
            }
            Err(error) => {
                log::warn!("prepview auto funding refresh failed after csv import: {error}");
            }
        }
    }
    let _ = state.emit_snapshot();
    Ok(result)
}

#[tauri::command]
pub async fn get_exchange_markets(
    state: State<'_, Arc<AppServices>>,
    exchange: ExchangeKind,
) -> Result<Vec<ExchangeMarket>, String> {
    command_result(load_exchange_markets_with_cache(state.inner(), exchange).await)
}

#[tauri::command]
pub async fn get_exchange_market_quote(
    state: State<'_, Arc<AppServices>>,
    exchange: ExchangeKind,
    exchange_symbol: String,
) -> Result<MarketQuote, String> {
    let connector = command_result(connector_for(exchange, state.http_client.clone()))?;
    let quote = command_result(connector.fetch_market_quote(&exchange_symbol).await)?;
    {
        let repository = state
            .repository
            .lock()
            .map_err(|_| AppError::StatePoisoned("repository").to_string())?;
        command_result(repository.cache_market_quotes(std::slice::from_ref(&quote)))?;
    }
    Ok(quote)
}

#[tauri::command]
pub async fn preview_position_funding(
    state: State<'_, Arc<AppServices>>,
    input: PositionFundingEstimateInput,
) -> Result<PositionFundingEstimate, String> {
    command_result(estimate_position_funding_inner(state.inner(), &input).await)
}

#[tauri::command]
pub async fn refresh_portfolio_quotes(
    state: State<'_, Arc<AppServices>>,
) -> Result<QuoteRefreshResult, String> {
    let _sync_guard = state.sync_gate.lock().await;
    let result = command_result(refresh_portfolio_quotes_inner(state.inner()).await)?;
    let _ = state.emit_snapshot();
    Ok(result)
}

#[tauri::command]
pub async fn set_lan_projection(
    state: State<'_, Arc<AppServices>>,
    enabled: bool,
    expose_to_lan: Option<bool>,
    viewer_passphrase: Option<String>,
) -> Result<LanStatus, String> {
    let expose_to_lan = expose_to_lan.unwrap_or(false);
    let passphrase_updated = if let Some(passphrase) = viewer_passphrase {
        let trimmed = passphrase.trim().to_string();
        if trimmed.len() < 12 {
            return Err("LAN passphrase must be at least 12 characters".into());
        }
        command_result(store_lan_passphrase(&state.secrets_dir, &trimmed))?;
        true
    } else {
        false
    };
    let current_status = {
        let manager = state
            .lan_manager
            .lock()
            .map_err(|_| AppError::StatePoisoned("lan manager").to_string())?;
        manager.status()
    };
    let saved_passphrase = if enabled || passphrase_updated {
        Some(command_result(load_lan_passphrase(&state.secrets_dir))?)
    } else {
        None
    };

    let status = if enabled {
        if current_status.enabled
            && current_status.expose_to_lan == expose_to_lan
            && !passphrase_updated
        {
            current_status
        } else {
            if current_status.enabled {
                let mut manager = state
                    .lan_manager
                    .lock()
                    .map_err(|_| AppError::StatePoisoned("lan manager").to_string())?;
                let _ = manager.disable();
            }
            let (started_status, shutdown) = command_result(
                crate::lan::LanProjectionManager::start_server(
                    state.inner().clone(),
                    expose_to_lan,
                    saved_passphrase.unwrap_or_default(),
                )
                .await,
            )?;
            let mut manager = state
                .lan_manager
                .lock()
                .map_err(|_| AppError::StatePoisoned("lan manager").to_string())?;
            manager.enable_with(started_status, shutdown)
        }
    } else if current_status.enabled {
        let mut manager = state
            .lan_manager
            .lock()
            .map_err(|_| AppError::StatePoisoned("lan manager").to_string())?;
        manager.disable()
    } else {
        current_status
    };

    let _ = state.emit_snapshot();
    Ok(status)
}

#[tauri::command]
pub fn get_position_events(
    state: State<'_, Arc<AppServices>>,
    input: Option<PositionEventQueryInput>,
) -> Result<Vec<PositionEventRecord>, String> {
    let repository = state
        .repository
        .lock()
        .map_err(|_| AppError::StatePoisoned("repository").to_string())?;
    let mut input = input.unwrap_or_default();
    input.limit = Some(input.limit.unwrap_or(128).min(512));
    command_result(repository.query_position_events(input))
}

#[tauri::command]
pub fn get_closed_trades(
    state: State<'_, Arc<AppServices>>,
    input: Option<ClosedTradeQueryInput>,
) -> Result<Vec<ClosedTradeRecord>, String> {
    let repository = state
        .repository
        .lock()
        .map_err(|_| AppError::StatePoisoned("repository").to_string())?;
    let mut input = input.unwrap_or_default();
    input.limit = Some(input.limit.unwrap_or(128).min(512));
    command_result(repository.query_closed_trades(input))
}

#[tauri::command]
pub fn reset_database(state: State<'_, Arc<AppServices>>) -> Result<(), String> {
    let result = {
        let repository = state
            .repository
            .lock()
            .map_err(|_| AppError::StatePoisoned("repository").to_string())?;
        repository.reset_database()
    };
    let _ = command_result(result)?;
    {
        let mut manager = state
            .lan_manager
            .lock()
            .map_err(|_| AppError::StatePoisoned("lan manager").to_string())?;
        let _ = manager.disable();
    }
    command_result(clear_runtime_secrets(&state.secrets_dir))?;
    let _ = state.emit_snapshot();
    Ok(())
}

struct SyncPayload {
    snapshot: crate::domain::AccountSnapshot,
    positions: Vec<crate::domain::SyncedPosition>,
    funding_entries: Vec<crate::domain::FundingEntry>,
    attempts: u32,
}

struct QuoteFetchBatchResult {
    quotes: Vec<MarketQuote>,
    quote_requests_attempted: usize,
    warnings: Vec<String>,
}

async fn prime_manual_risk_model(
    services: &Arc<AppServices>,
    exchange: ExchangeKind,
    exchange_symbol: Option<&str>,
    symbol: Option<&str>,
    margin_mode: Option<MarginMode>,
) -> Result<(), AppError> {
    if !matches!(exchange, ExchangeKind::Blofin | ExchangeKind::Hyperliquid) {
        return Ok(());
    }
    if margin_mode.is_none() {
        return Ok(());
    }

    load_exchange_markets_with_cache(services, exchange).await?;

    let resolved_exchange_symbol = {
        let repository = services
            .repository
            .lock()
            .map_err(|_| AppError::StatePoisoned("repository"))?;
        repository
            .resolve_cached_exchange_market(exchange, exchange_symbol, symbol)?
            .map(|market| market.exchange_symbol)
            .or_else(|| exchange_symbol.map(|value| value.trim().to_uppercase()))
    };

    let Some(exchange_symbol) = resolved_exchange_symbol else {
        return Ok(());
    };

    let cached = {
        let repository = services
            .repository
            .lock()
            .map_err(|_| AppError::StatePoisoned("repository"))?;
        repository.list_exchange_risk_tiers(exchange, &exchange_symbol, margin_mode)?
    };
    if !cached.is_empty() {
        return Ok(());
    }

    let tiers = fetch_exchange_risk_tiers(
        services.http_client.clone(),
        exchange,
        &exchange_symbol,
        margin_mode,
    )
    .await?;

    let repository = services
        .repository
        .lock()
        .map_err(|_| AppError::StatePoisoned("repository"))?;
    repository.upsert_exchange_risk_tiers(&tiers)?;
    Ok(())
}

pub(crate) async fn refresh_portfolio_quotes_inner(
    services: &Arc<AppServices>,
) -> Result<QuoteRefreshResult, AppError> {
    let targets = {
        let repository = services
            .repository
            .lock()
            .map_err(|_| AppError::StatePoisoned("repository"))?;
        repository.list_quote_refresh_targets()?
    };

    let refreshed_at = Utc::now();
    if targets.is_empty() {
        return Ok(QuoteRefreshResult {
            targets_discovered: 0,
            quote_requests_attempted: 0,
            quotes_refreshed: 0,
            positions_updated: 0,
            exchanges_touched: Vec::new(),
            warnings: Vec::new(),
            refreshed_at,
        });
    }

    let mut quotes = Vec::new();
    let mut warnings = Vec::new();
    let mut exchanges_touched = Vec::new();
    let mut quote_requests_attempted = 0usize;

    for (exchange, group) in [
        (
            ExchangeKind::Blofin,
            targets
                .iter()
                .filter(|target| target.exchange == ExchangeKind::Blofin)
                .cloned()
                .collect::<Vec<_>>(),
        ),
        (
            ExchangeKind::Hyperliquid,
            targets
                .iter()
                .filter(|target| target.exchange == ExchangeKind::Hyperliquid)
                .cloned()
                .collect::<Vec<_>>(),
        ),
    ] {
        if group.is_empty() {
            continue;
        }

        let markets = match load_exchange_markets_with_cache(services, exchange).await {
            Ok(markets) => markets,
            Err(error) => {
                warnings.push(format!(
                    "{} market catalog refresh failed: {}",
                    exchange_label(exchange),
                    error
                ));
                continue;
            }
        };
        let connector = connector_for(exchange, services.http_client.clone())?;
        match fetch_quotes_for_targets(connector.as_ref(), exchange, &markets, &group).await {
            Ok(batch) => {
                quote_requests_attempted += batch.quote_requests_attempted;
                warnings.extend(batch.warnings);
                if !batch.quotes.is_empty() {
                    exchanges_touched.push(exchange);
                    quotes.extend(batch.quotes);
                }
            }
            Err(error) => warnings.push(format!(
                "{} quote refresh failed: {}",
                exchange_label(exchange),
                error
            )),
        }
    }

    let mut positions_updated = {
        let repository = services
            .repository
            .lock()
            .map_err(|_| AppError::StatePoisoned("repository"))?;
        repository.apply_market_quotes(&quotes)?
    };
    match refresh_local_auto_funding_inner(services).await {
        Ok((funding_updates, auto_warnings)) => {
            positions_updated += funding_updates;
            warnings.extend(auto_warnings);
        }
        Err(error) => warnings.push(format!("Local auto funding refresh failed: {error}")),
    }

    Ok(QuoteRefreshResult {
        targets_discovered: targets.len(),
        quote_requests_attempted,
        quotes_refreshed: quotes.len(),
        positions_updated,
        exchanges_touched,
        warnings,
        refreshed_at,
    })
}

async fn fetch_quotes_for_targets(
    connector: &dyn ExchangeConnector,
    exchange: ExchangeKind,
    markets: &[ExchangeMarket],
    targets: &[MarketQuoteRefreshTarget],
) -> Result<QuoteFetchBatchResult, AppError> {
    let requests = resolve_quote_requests(targets, markets);
    let mut quotes = Vec::new();
    let mut warnings = Vec::new();

    for request in &requests {
        match connector.fetch_market_quote(request).await {
            Ok(quote) => quotes.push(quote),
            Err(error) => warnings.push(format!(
                "{} quote refresh skipped {}: {}",
                exchange_label(exchange),
                request,
                error
            )),
        }
    }

    Ok(QuoteFetchBatchResult {
        quotes,
        quote_requests_attempted: requests.len(),
        warnings,
    })
}

pub(crate) async fn refresh_supported_exchange_markets_inner(
    services: &Arc<AppServices>,
) -> Vec<String> {
    let mut warnings = Vec::new();
    for exchange in [ExchangeKind::Blofin, ExchangeKind::Hyperliquid] {
        if let Err(error) = load_exchange_markets_with_cache(services, exchange).await {
            warnings.push(format!(
                "{} market catalog refresh failed: {}",
                exchange_label(exchange),
                error
            ));
        }
    }
    warnings
}

async fn load_exchange_markets_with_cache(
    services: &Arc<AppServices>,
    exchange: ExchangeKind,
) -> Result<Vec<ExchangeMarket>, AppError> {
    let connector = connector_for(exchange, services.http_client.clone())?;
    match connector.fetch_markets().await {
        Ok(markets) => {
            let repository = services
                .repository
                .lock()
                .map_err(|_| AppError::StatePoisoned("repository"))?;
            repository.upsert_exchange_markets(&markets)?;
            repository.cache_market_quotes(&quotes_from_markets(&markets))?;
            repository.list_exchange_markets(exchange)
        }
        Err(error) => {
            let repository = services
                .repository
                .lock()
                .map_err(|_| AppError::StatePoisoned("repository"))?;
            let cached = repository.list_exchange_markets(exchange)?;
            if cached.is_empty() {
                Err(error)
            } else {
                Ok(cached)
            }
        }
    }
}

async fn estimate_position_funding_inner(
    services: &Arc<AppServices>,
    input: &PositionFundingEstimateInput,
) -> Result<PositionFundingEstimate, AppError> {
    if !matches!(
        input.exchange,
        ExchangeKind::Blofin | ExchangeKind::Hyperliquid
    ) {
        return Err(invalid_input(
            "automatic funding is only available for BloFin and Hyperliquid positions",
        ));
    }
    if input.quantity <= 0.0 {
        return Err(invalid_input("quantity must be positive"));
    }

    let as_of = Utc::now();
    if input.opened_at > as_of {
        return Err(invalid_input("trade placed at cannot be in the future"));
    }

    load_exchange_markets_with_cache(services, input.exchange).await?;
    let market = {
        let repository = services
            .repository
            .lock()
            .map_err(|_| AppError::StatePoisoned("repository"))?;
        repository.resolve_cached_exchange_market(
            input.exchange,
            input.exchange_symbol.as_deref(),
            Some(input.symbol.as_str()),
        )?
    }
    .ok_or_else(|| AppError::message("exchange-backed market metadata was not found"))?;

    estimate_public_position_funding(
        services.http_client.clone(),
        input.exchange,
        &market.exchange_symbol,
        input.side,
        input.quantity,
        market.contract_value,
        input.opened_at,
        as_of,
    )
    .await
}

fn resolve_manual_funding_mode(
    exchange: ExchangeKind,
    requested_mode: Option<FundingMode>,
    existing_mode: Option<FundingMode>,
    has_opened_at: bool,
    has_funding_paid: bool,
) -> FundingMode {
    match requested_mode {
        Some(FundingMode::Auto) => FundingMode::Auto,
        Some(FundingMode::Manual) => FundingMode::Manual,
        Some(FundingMode::ExchangeSync) => FundingMode::Manual,
        None => match existing_mode {
            Some(FundingMode::Auto) => FundingMode::Auto,
            Some(FundingMode::Manual) | Some(FundingMode::ExchangeSync) => FundingMode::Manual,
            None if matches!(exchange, ExchangeKind::Blofin | ExchangeKind::Hyperliquid)
                && has_opened_at
                && !has_funding_paid =>
            {
                FundingMode::Auto
            }
            None => FundingMode::Manual,
        },
    }
}

async fn maybe_fill_manual_position_funding(
    services: &Arc<AppServices>,
    exchange: ExchangeKind,
    exchange_symbol: Option<&str>,
    symbol: &str,
    side: crate::domain::PositionSide,
    quantity: f64,
    opened_at: Option<chrono::DateTime<Utc>>,
    funding_mode: FundingMode,
    funding_paid: Option<f64>,
) -> Result<Option<f64>, AppError> {
    if funding_mode != FundingMode::Auto || funding_paid.is_some() {
        return Ok(funding_paid);
    }

    let opened_at = opened_at.ok_or_else(|| {
        invalid_input("trade placed at is required when automatic funding is enabled")
    })?;
    let estimate = estimate_position_funding_inner(
        services,
        &PositionFundingEstimateInput {
            exchange,
            exchange_symbol: exchange_symbol.map(|value| value.to_string()),
            symbol: symbol.to_string(),
            side,
            quantity,
            opened_at,
        },
    )
    .await?;
    Ok(Some(estimate.funding_paid))
}

async fn refresh_local_auto_funding_inner(
    services: &Arc<AppServices>,
) -> Result<(usize, Vec<String>), AppError> {
    let targets = {
        let repository = services
            .repository
            .lock()
            .map_err(|_| AppError::StatePoisoned("repository"))?;
        repository.list_auto_funding_refresh_targets()?
    };
    if targets.is_empty() {
        return Ok((0, Vec::new()));
    }

    let as_of = Utc::now();
    let mut warnings = Vec::new();
    let mut updates = Vec::new();
    let mut blofin_markets = None::<Vec<ExchangeMarket>>;
    let mut hyperliquid_markets = None::<Vec<ExchangeMarket>>;

    for target in targets {
        let markets = match target.exchange {
            ExchangeKind::Blofin => {
                if blofin_markets.is_none() {
                    match load_exchange_markets_with_cache(services, ExchangeKind::Blofin).await {
                        Ok(markets) => blofin_markets = Some(markets),
                        Err(error) => {
                            warnings.push(format!(
                                "BloFin auto funding refresh skipped {}: {}",
                                target.exchange_symbol, error
                            ));
                            continue;
                        }
                    }
                }
                blofin_markets.as_ref().expect("blofin markets should load")
            }
            ExchangeKind::Hyperliquid => {
                if hyperliquid_markets.is_none() {
                    match load_exchange_markets_with_cache(services, ExchangeKind::Hyperliquid)
                        .await
                    {
                        Ok(markets) => hyperliquid_markets = Some(markets),
                        Err(error) => {
                            warnings.push(format!(
                                "Hyperliquid auto funding refresh skipped {}: {}",
                                target.exchange_symbol, error
                            ));
                            continue;
                        }
                    }
                }
                hyperliquid_markets
                    .as_ref()
                    .expect("hyperliquid markets should load")
            }
            _ => continue,
        };

        let market = markets
            .iter()
            .find(|market| {
                market
                    .exchange_symbol
                    .eq_ignore_ascii_case(&target.exchange_symbol)
                    || market.symbol.eq_ignore_ascii_case(&target.symbol)
            })
            .cloned();
        let Some(market) = market else {
            warnings.push(format!(
                "{} auto funding refresh skipped {}: market metadata was not found",
                exchange_label(target.exchange),
                target.exchange_symbol,
            ));
            continue;
        };

        match estimate_public_position_funding(
            services.http_client.clone(),
            target.exchange,
            &market.exchange_symbol,
            target.side,
            target.quantity,
            market.contract_value,
            target.opened_at,
            as_of,
        )
        .await
        {
            Ok(estimate) => updates.push(crate::store::AutoFundingUpdate {
                position_id: target.position_id,
                funding_paid: estimate.funding_paid,
            }),
            Err(error) => warnings.push(format!(
                "{} auto funding refresh skipped {}: {}",
                exchange_label(target.exchange),
                target.exchange_symbol,
                error
            )),
        }
    }

    let updated = {
        let repository = services
            .repository
            .lock()
            .map_err(|_| AppError::StatePoisoned("repository"))?;
        repository.apply_auto_funding_updates(&updates)?
    };

    Ok((updated, warnings))
}

fn quotes_from_markets(markets: &[ExchangeMarket]) -> Vec<MarketQuote> {
    let as_of = Utc::now();
    markets
        .iter()
        .filter_map(|market| {
            let has_quote_context = market.mark_price.is_some()
                || market.oracle_price.is_some()
                || market.funding_rate.is_some()
                || market.next_funding_time.is_some();
            has_quote_context.then(|| MarketQuote {
                exchange: market.exchange,
                exchange_symbol: market.exchange_symbol.clone(),
                symbol: market.symbol.clone(),
                mark_price: market.mark_price,
                oracle_price: market.oracle_price,
                funding_rate: market.funding_rate,
                next_funding_time: market.next_funding_time,
                as_of,
            })
        })
        .collect()
}

fn resolve_quote_requests(
    targets: &[MarketQuoteRefreshTarget],
    markets: &[ExchangeMarket],
) -> Vec<String> {
    let mut catalog = std::collections::BTreeMap::<String, String>::new();
    for market in markets {
        let canonical = market.exchange_symbol.trim().to_uppercase();
        catalog.insert(canonical.clone(), canonical.clone());
        catalog.insert(market.symbol.trim().to_uppercase(), canonical);
    }

    let mut requests = BTreeSet::<String>::new();
    for target in targets {
        if let Some(exchange_symbol) = target
            .exchange_symbol
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty())
        {
            if let Some(canonical) = catalog.get(&exchange_symbol.to_uppercase()) {
                requests.insert(canonical.clone());
                continue;
            }
            requests.insert(exchange_symbol.to_uppercase());
            continue;
        }

        let symbol = target.symbol.trim().to_uppercase();
        if let Some(canonical) = catalog.get(&symbol) {
            requests.insert(canonical.clone());
        } else if !symbol.is_empty() {
            requests.insert(symbol);
        }
    }

    requests.into_iter().collect()
}

fn exchange_label(exchange: ExchangeKind) -> &'static str {
    match exchange {
        ExchangeKind::Blofin => "BloFin",
        ExchangeKind::Hyperliquid => "Hyperliquid",
        ExchangeKind::Import => "Import",
        ExchangeKind::Manual => "Manual",
    }
}

pub(crate) async fn sync_all_live_accounts_inner(
    services: &Arc<AppServices>,
) -> Result<SyncAllAccountsResult, AppError> {
    let accounts = {
        let repository = services
            .repository
            .lock()
            .map_err(|_| AppError::StatePoisoned("repository"))?;
        repository.list_live_accounts()?
    };

    let mut succeeded = Vec::new();
    let mut failed = Vec::new();

    for account in accounts {
        match sync_account_inner(services, &account.id).await {
            Ok(result) => succeeded.push(result),
            Err(error) => failed.push(SyncFailure {
                account_id: account.id,
                account_name: account.name,
                error: error.to_string(),
            }),
        }
    }

    Ok(SyncAllAccountsResult { succeeded, failed })
}

async fn sync_account_inner(
    services: &Arc<AppServices>,
    account_id: &str,
) -> Result<SyncAccountResult, AppError> {
    let (account, credentials) = {
        let repository = services
            .repository
            .lock()
            .map_err(|_| AppError::StatePoisoned("repository"))?;
        let account = repository.get_account(account_id)?;
        let credentials = load_live_credentials(&services.secrets_dir, account_id)?;
        (account, credentials)
    };

    if account.exchange != credentials.exchange() {
        return Err(AppError::message(
            "stored credentials do not match the account exchange",
        ));
    }

    let job_id = {
        let repository = services
            .repository
            .lock()
            .map_err(|_| AppError::StatePoisoned("repository"))?;
        repository.begin_sync_job(account_id, account.exchange)?
    };
    let _ = services.emit_snapshot();

    let connector = connector_for(account.exchange, services.http_client.clone())?;
    let sync_result =
        fetch_sync_payload_with_retry(services, &job_id, connector.as_ref(), &credentials).await;

    let result = match sync_result {
        Ok(payload) => {
            let synced_account = {
                let repository = services
                    .repository
                    .lock()
                    .map_err(|_| AppError::StatePoisoned("repository"))?;
                let account = repository.sync_live_account(
                    account_id,
                    &payload.snapshot,
                    &payload.positions,
                    &payload.funding_entries,
                    Some(&job_id),
                )?;
                repository.complete_sync_job_success(
                    &job_id,
                    payload.attempts,
                    payload.positions.len(),
                    payload.funding_entries.len(),
                )?;
                account
            };

            Ok(SyncAccountResult {
                synced_at: synced_account
                    .last_synced_at
                    .unwrap_or_else(chrono::Utc::now),
                account: synced_account,
                synced_positions: payload.positions.len(),
                funding_entries: payload.funding_entries.len(),
                attempts: payload.attempts,
            })
        }
        Err((error, attempts)) => {
            let repository = services
                .repository
                .lock()
                .map_err(|_| AppError::StatePoisoned("repository"))?;
            repository.mark_sync_error(account_id, &error.to_string())?;
            repository.complete_sync_job_failure(&job_id, attempts, &error.to_string())?;
            Err(error)
        }
    };

    let _ = services.emit_snapshot();
    result
}

async fn fetch_sync_payload_with_retry(
    services: &Arc<AppServices>,
    job_id: &str,
    connector: &dyn ExchangeConnector,
    credentials: &crate::credentials::StoredCredentials,
) -> Result<SyncPayload, (AppError, u32)> {
    let mut last_error: Option<AppError> = None;

    for attempt in 1..=MAX_SYNC_ATTEMPTS {
        if let Ok(repository) = services.repository.lock() {
            let _ = repository.update_sync_job_attempts(job_id, attempt);
        }

        match fetch_sync_payload(connector, credentials).await {
            Ok(payload) => {
                return Ok(SyncPayload {
                    attempts: attempt,
                    ..payload
                });
            }
            Err(error) => {
                last_error = Some(error);
                if attempt < MAX_SYNC_ATTEMPTS {
                    let delay = INITIAL_BACKOFF_MS * 2_u64.pow(attempt - 1);
                    sleep(Duration::from_millis(delay)).await;
                }
            }
        }
    }

    Err((
        last_error.unwrap_or_else(|| AppError::message("sync failed without an error")),
        MAX_SYNC_ATTEMPTS,
    ))
}

async fn fetch_sync_payload(
    connector: &dyn ExchangeConnector,
    credentials: &crate::credentials::StoredCredentials,
) -> Result<SyncPayload, AppError> {
    let snapshot = connector.fetch_account_snapshot(credentials).await?;
    let positions = connector.fetch_open_positions(credentials).await?;
    let exchange_symbols = positions
        .iter()
        .map(|position| position.exchange_symbol.clone())
        .collect::<Vec<_>>();
    let funding_entries = connector.fetch_funding_rates(&exchange_symbols).await?;

    Ok(SyncPayload {
        snapshot,
        positions,
        funding_entries,
        attempts: 0,
    })
}

#[cfg(test)]
mod tests {
    use std::{
        path::PathBuf,
        sync::{
            atomic::{AtomicUsize, Ordering},
            Arc, Mutex,
        },
    };

    use async_trait::async_trait;
    use chrono::Utc;
    use tokio::sync::broadcast;
    use uuid::Uuid;

    use super::*;
    use crate::{
        credentials::StoredCredentials,
        domain::{
            AccountSnapshot, AutoSyncStatus, BalanceEvent, ExchangeKind, ExchangeMarket,
            FundingEntry, LiveAccountValidation, MarkPriceUpdate, MarketQuote, PositionSide,
            SyncedPosition,
        },
        error::AppResult,
        lan::LanProjectionManager,
        store::PortfolioRepository,
    };

    struct RetryConnector {
        remaining_failures: AtomicUsize,
        total_snapshot_calls: AtomicUsize,
    }

    impl RetryConnector {
        fn new(failures_before_success: usize) -> Self {
            Self {
                remaining_failures: AtomicUsize::new(failures_before_success),
                total_snapshot_calls: AtomicUsize::new(0),
            }
        }

        fn snapshot_calls(&self) -> usize {
            self.total_snapshot_calls.load(Ordering::SeqCst)
        }
    }

    #[async_trait]
    impl ExchangeConnector for RetryConnector {
        async fn validate_credentials(
            &self,
            _credentials: &StoredCredentials,
        ) -> AppResult<LiveAccountValidation> {
            Ok(LiveAccountValidation {
                exchange: ExchangeKind::Hyperliquid,
                external_reference: "0xabc".into(),
                wallet_balance: 1000.0,
                available_balance: 800.0,
                snapshot_equity: 1010.0,
                currency: "USDC".into(),
                open_positions: 1,
            })
        }

        async fn fetch_account_snapshot(
            &self,
            _credentials: &StoredCredentials,
        ) -> AppResult<AccountSnapshot> {
            self.total_snapshot_calls.fetch_add(1, Ordering::SeqCst);
            let remaining = self.remaining_failures.load(Ordering::SeqCst);
            if remaining > 0 {
                self.remaining_failures.fetch_sub(1, Ordering::SeqCst);
                return Err(AppError::message("transient upstream failure"));
            }

            Ok(AccountSnapshot {
                wallet_balance: 1000.0,
                available_balance: 800.0,
                snapshot_equity: 1015.0,
                currency: "USDC".into(),
            })
        }

        async fn fetch_open_positions(
            &self,
            _credentials: &StoredCredentials,
        ) -> AppResult<Vec<SyncedPosition>> {
            Ok(vec![SyncedPosition {
                exchange_symbol: "BTC".into(),
                symbol: "BTC-PERP".into(),
                margin_mode: None,
                side: PositionSide::Long,
                quantity: 0.1,
                entry_price: 70000.0,
                mark_price: Some(70200.0),
                margin_used: Some(700.0),
                liquidation_price: Some(65000.0),
                maintenance_margin: Some(55.0),
                maintenance_margin_rate: None,
                risk_source: None,
                leverage: 10.0,
                unrealized_pnl: 20.0,
                realized_pnl: 0.0,
                fee_paid: 0.0,
                funding_paid: 0.0,
                opened_at: Utc::now(),
            }])
        }

        async fn fetch_balance_history(
            &self,
            _credentials: &StoredCredentials,
        ) -> AppResult<Vec<BalanceEvent>> {
            Ok(Vec::new())
        }

        async fn fetch_funding_rates(&self, _symbols: &[String]) -> AppResult<Vec<FundingEntry>> {
            Ok(vec![FundingEntry {
                symbol: "BTC-PERP".into(),
                rate: 0.0001,
                funding_time: Utc::now(),
            }])
        }

        async fn fetch_markets(&self) -> AppResult<Vec<ExchangeMarket>> {
            Ok(Vec::new())
        }

        async fn fetch_market_quote(&self, _exchange_symbol: &str) -> AppResult<MarketQuote> {
            Ok(MarketQuote {
                exchange: ExchangeKind::Hyperliquid,
                exchange_symbol: "BTC".into(),
                symbol: "BTC-PERP".into(),
                mark_price: Some(70200.0),
                oracle_price: None,
                funding_rate: Some(0.0001),
                next_funding_time: None,
                as_of: Utc::now(),
            })
        }

        async fn subscribe_mark_prices(
            &self,
            _credentials: &StoredCredentials,
            _symbols: &[String],
        ) -> AppResult<broadcast::Receiver<Vec<MarkPriceUpdate>>> {
            let (_, receiver) = broadcast::channel(4);
            Ok(receiver)
        }

        fn normalize_symbol(&self, symbol: &str) -> String {
            symbol.to_string()
        }
    }

    struct CatalogConnector;

    #[async_trait]
    impl ExchangeConnector for CatalogConnector {
        async fn validate_credentials(
            &self,
            _credentials: &StoredCredentials,
        ) -> AppResult<LiveAccountValidation> {
            Err(AppError::message("not used in quote catalog tests"))
        }

        async fn fetch_account_snapshot(
            &self,
            _credentials: &StoredCredentials,
        ) -> AppResult<AccountSnapshot> {
            Err(AppError::message("not used in quote catalog tests"))
        }

        async fn fetch_open_positions(
            &self,
            _credentials: &StoredCredentials,
        ) -> AppResult<Vec<SyncedPosition>> {
            Err(AppError::message("not used in quote catalog tests"))
        }

        async fn fetch_balance_history(
            &self,
            _credentials: &StoredCredentials,
        ) -> AppResult<Vec<BalanceEvent>> {
            Ok(Vec::new())
        }

        async fn fetch_funding_rates(&self, _symbols: &[String]) -> AppResult<Vec<FundingEntry>> {
            Ok(Vec::new())
        }

        async fn fetch_markets(&self) -> AppResult<Vec<ExchangeMarket>> {
            Ok(vec![
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
                    mark_price: Some(62150.0),
                    oracle_price: Some(62100.0),
                    funding_rate: Some(0.0002),
                    next_funding_time: None,
                    is_active: true,
                },
                ExchangeMarket {
                    exchange: ExchangeKind::Blofin,
                    exchange_symbol: "ETH-USDT".into(),
                    symbol: "ETH-PERP".into(),
                    base_asset: "ETH".into(),
                    quote_asset: "USDT".into(),
                    settle_asset: Some("USDT".into()),
                    contract_type: "perpetual".into(),
                    contract_value: Some(1.0),
                    price_tick_size: Some(0.01),
                    quantity_step: Some(0.01),
                    min_quantity: Some(0.01),
                    max_leverage: Some(50.0),
                    mark_price: Some(3150.0),
                    oracle_price: Some(3148.0),
                    funding_rate: Some(0.0001),
                    next_funding_time: None,
                    is_active: true,
                },
            ])
        }

        async fn fetch_market_quote(&self, exchange_symbol: &str) -> AppResult<MarketQuote> {
            Ok(MarketQuote {
                exchange: ExchangeKind::Blofin,
                exchange_symbol: exchange_symbol.to_string(),
                symbol: if exchange_symbol.eq_ignore_ascii_case("BTC-USDT") {
                    "BTC-PERP".into()
                } else {
                    "ETH-PERP".into()
                },
                mark_price: Some(if exchange_symbol.eq_ignore_ascii_case("BTC-USDT") {
                    62150.0
                } else {
                    3150.0
                }),
                oracle_price: None,
                funding_rate: Some(0.0001),
                next_funding_time: None,
                as_of: Utc::now(),
            })
        }

        async fn subscribe_mark_prices(
            &self,
            _credentials: &StoredCredentials,
            _symbols: &[String],
        ) -> AppResult<broadcast::Receiver<Vec<MarkPriceUpdate>>> {
            let (_, receiver) = broadcast::channel(4);
            Ok(receiver)
        }

        fn normalize_symbol(&self, symbol: &str) -> String {
            symbol.to_string()
        }
    }

    fn open_test_services() -> (Arc<AppServices>, PathBuf) {
        let root = std::env::temp_dir().join(format!("prepview-commands-test-{}", Uuid::new_v4()));
        std::fs::create_dir_all(&root).expect("test directory should exist");
        let repository = PortfolioRepository::open(root.join("portfolio.db"), "test-key".into())
            .expect("repository should open");
        let (broadcaster, _) = broadcast::channel(8);
        let services = Arc::new(AppServices {
            repository: Mutex::new(repository),
            broadcaster,
            lan_manager: Mutex::new(LanProjectionManager::default()),
            auto_sync_status: Mutex::new(AutoSyncStatus::default()),
            http_client: reqwest::Client::builder()
                .build()
                .expect("client should build"),
            secrets_dir: root.join("secrets"),
            sync_gate: tokio::sync::Mutex::new(()),
            app_handle: None,
        });
        (services, root)
    }

    #[test]
    fn resolve_quote_requests_uses_market_catalog_aliases() {
        let markets = vec![
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
                mark_price: Some(62150.0),
                oracle_price: Some(62100.0),
                funding_rate: Some(0.0002),
                next_funding_time: None,
                is_active: true,
            },
            ExchangeMarket {
                exchange: ExchangeKind::Blofin,
                exchange_symbol: "ETH-USDT".into(),
                symbol: "ETH-PERP".into(),
                base_asset: "ETH".into(),
                quote_asset: "USDT".into(),
                settle_asset: Some("USDT".into()),
                contract_type: "perpetual".into(),
                contract_value: Some(1.0),
                price_tick_size: Some(0.01),
                quantity_step: Some(0.01),
                min_quantity: Some(0.01),
                max_leverage: Some(50.0),
                mark_price: Some(3150.0),
                oracle_price: Some(3148.0),
                funding_rate: Some(0.0001),
                next_funding_time: None,
                is_active: true,
            },
        ];
        let requests = resolve_quote_requests(
            &[
                crate::store::MarketQuoteRefreshTarget {
                    exchange: ExchangeKind::Blofin,
                    exchange_symbol: None,
                    symbol: "BTC-PERP".into(),
                },
                crate::store::MarketQuoteRefreshTarget {
                    exchange: ExchangeKind::Blofin,
                    exchange_symbol: Some("eth-usdt".into()),
                    symbol: "ETH-PERP".into(),
                },
                crate::store::MarketQuoteRefreshTarget {
                    exchange: ExchangeKind::Blofin,
                    exchange_symbol: Some("BTC-USDT".into()),
                    symbol: "BTC-PERP".into(),
                },
            ],
            &markets,
        );

        assert_eq!(
            requests,
            vec!["BTC-USDT".to_string(), "ETH-USDT".to_string()]
        );
    }

    #[test]
    fn derives_cacheable_quotes_from_market_catalog_rows() {
        let quotes = quotes_from_markets(&[
            ExchangeMarket {
                exchange: ExchangeKind::Hyperliquid,
                exchange_symbol: "BTC".into(),
                symbol: "BTC-PERP".into(),
                base_asset: "BTC".into(),
                quote_asset: "USDC".into(),
                settle_asset: Some("USDC".into()),
                contract_type: "perpetual".into(),
                contract_value: Some(1.0),
                price_tick_size: None,
                quantity_step: Some(0.001),
                min_quantity: Some(0.001),
                max_leverage: Some(40.0),
                mark_price: Some(70100.0),
                oracle_price: Some(70080.0),
                funding_rate: Some(0.0001),
                next_funding_time: None,
                is_active: true,
            },
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
                mark_price: None,
                oracle_price: None,
                funding_rate: None,
                next_funding_time: None,
                is_active: true,
            },
        ]);

        assert_eq!(quotes.len(), 1);
        assert_eq!(quotes[0].exchange, ExchangeKind::Hyperliquid);
        assert_eq!(quotes[0].exchange_symbol, "BTC");
        assert_eq!(quotes[0].symbol, "BTC-PERP");
        assert_eq!(quotes[0].mark_price, Some(70100.0));
    }

    #[tokio::test]
    async fn fetch_quotes_for_targets_resolves_symbol_only_targets() {
        let markets = CatalogConnector
            .fetch_markets()
            .await
            .expect("market catalog should load");
        let batch = fetch_quotes_for_targets(
            &CatalogConnector,
            ExchangeKind::Blofin,
            &markets,
            &[
                crate::store::MarketQuoteRefreshTarget {
                    exchange: ExchangeKind::Blofin,
                    exchange_symbol: None,
                    symbol: "BTC-PERP".into(),
                },
                crate::store::MarketQuoteRefreshTarget {
                    exchange: ExchangeKind::Blofin,
                    exchange_symbol: Some("eth-usdt".into()),
                    symbol: "ETH-PERP".into(),
                },
            ],
        )
        .await
        .expect("quote batch should load");

        assert_eq!(batch.quote_requests_attempted, 2);
        assert!(batch.warnings.is_empty());
        assert_eq!(batch.quotes.len(), 2);
        assert!(batch
            .quotes
            .iter()
            .any(|quote| quote.exchange_symbol == "BTC-USDT" && quote.symbol == "BTC-PERP"));
        assert!(batch
            .quotes
            .iter()
            .any(|quote| quote.exchange_symbol == "ETH-USDT" && quote.symbol == "ETH-PERP"));
    }

    #[tokio::test]
    async fn retries_transient_sync_failures_and_records_attempts() {
        let (services, root) = open_test_services();
        let job_id = {
            let repository = services
                .repository
                .lock()
                .expect("repository lock should succeed");
            let account = repository
                .create_live_account_record(
                    "Retry Test".into(),
                    ExchangeKind::Hyperliquid,
                    "0xabc".into(),
                )
                .expect("live account should be created");
            repository
                .begin_sync_job(&account.id, ExchangeKind::Hyperliquid)
                .expect("job should start")
        };

        let connector = RetryConnector::new(2);
        let payload = fetch_sync_payload_with_retry(
            &services,
            &job_id,
            &connector,
            &StoredCredentials::Hyperliquid {
                wallet_address: "0xabc".into(),
            },
        )
        .await
        .expect("retry helper should recover");

        assert_eq!(payload.attempts, 3);
        assert_eq!(payload.positions.len(), 1);
        assert_eq!(connector.snapshot_calls(), 3);

        let bootstrap = services.snapshot().expect("bootstrap should load");
        assert_eq!(bootstrap.recent_sync_jobs.len(), 1);
        assert_eq!(bootstrap.recent_sync_jobs[0].attempt_count, 3);
        assert_eq!(
            bootstrap.recent_sync_jobs[0].state,
            crate::domain::SyncJobState::Running
        );

        let _ = std::fs::remove_dir_all(root);
    }

    #[tokio::test]
    async fn exhausts_retry_budget_for_persistent_failures() {
        let (services, root) = open_test_services();
        let job_id = {
            let repository = services
                .repository
                .lock()
                .expect("repository lock should succeed");
            let account = repository
                .create_live_account_record(
                    "Retry Fail".into(),
                    ExchangeKind::Hyperliquid,
                    "0xdef".into(),
                )
                .expect("live account should be created");
            repository
                .begin_sync_job(&account.id, ExchangeKind::Hyperliquid)
                .expect("job should start")
        };

        let connector = RetryConnector::new(5);
        let error = match fetch_sync_payload_with_retry(
            &services,
            &job_id,
            &connector,
            &StoredCredentials::Hyperliquid {
                wallet_address: "0xdef".into(),
            },
        )
        .await
        {
            Ok(_) => panic!("retry helper should fail after budget is exhausted"),
            Err(error) => error,
        };

        assert_eq!(error.1, MAX_SYNC_ATTEMPTS);
        assert_eq!(connector.snapshot_calls(), MAX_SYNC_ATTEMPTS as usize);

        let bootstrap = services.snapshot().expect("bootstrap should load");
        assert_eq!(bootstrap.recent_sync_jobs.len(), 1);
        assert_eq!(
            bootstrap.recent_sync_jobs[0].attempt_count,
            MAX_SYNC_ATTEMPTS
        );

        let _ = std::fs::remove_dir_all(root);
    }
}
