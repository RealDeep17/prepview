#![allow(dependency_on_unit_never_type_fallback)]

mod commands;
mod connectors;
mod credentials;
mod csv_import;
mod domain;
mod error;
mod lan;
mod metrics;
mod risk_engine;
mod secret_store;
mod store;

use std::{
    fs,
    path::PathBuf,
    sync::{Arc, Mutex},
};

use chrono::{Duration as ChronoDuration, Utc};
use commands::{
    add_manual_position, close_manual_position, create_account, create_live_account,
    delete_account, delete_manual_position, get_bootstrap_state, get_closed_trades,
    get_exchange_market_quote, get_exchange_markets, get_position_events, import_csv_positions,
    refresh_portfolio_quotes, reset_database, set_lan_projection, sync_all_live_accounts, sync_live_account,
    update_account, update_manual_position, validate_live_account,
};
use domain::{AutoSyncStatus, BootstrapState};
use error::{AppError, AppResult};
use lan::LanProjectionManager;
use secret_store::database_key;
use store::PortfolioRepository;
use tauri::Manager;
use tokio::{
    sync::{broadcast, Mutex as AsyncMutex},
    time::{sleep, Duration},
};

const AUTO_SYNC_INTERVAL_SECONDS: u64 = 90;

pub(crate) struct AppServices {
    repository: Mutex<PortfolioRepository>,
    broadcaster: broadcast::Sender<String>,
    lan_manager: Mutex<LanProjectionManager>,
    auto_sync_status: Mutex<AutoSyncStatus>,
    http_client: reqwest::Client,
    secrets_dir: PathBuf,
    sync_gate: AsyncMutex<()>,
}

impl AppServices {
    fn snapshot(&self) -> AppResult<BootstrapState> {
        let lan_status = self
            .lan_manager
            .lock()
            .map_err(|_| AppError::StatePoisoned("lan manager"))?
            .status();
        let auto_sync_status = self
            .auto_sync_status
            .lock()
            .map_err(|_| AppError::StatePoisoned("auto sync status"))?
            .clone();
        let repository = self
            .repository
            .lock()
            .map_err(|_| AppError::StatePoisoned("repository"))?;

        repository.bootstrap_state_with_runtime(lan_status, auto_sync_status)
    }

    fn emit_snapshot(&self) -> AppResult<()> {
        let payload = serde_json::to_string(&self.snapshot()?)?;
        let _ = self.broadcaster.send(payload);
        Ok(())
    }

    fn update_auto_sync_status(
        &self,
        mutate: impl FnOnce(&mut AutoSyncStatus),
    ) -> AppResult<AutoSyncStatus> {
        let mut status = self
            .auto_sync_status
            .lock()
            .map_err(|_| AppError::StatePoisoned("auto sync status"))?;
        mutate(&mut status);
        Ok(status.clone())
    }

    fn auto_sync_status(&self) -> AppResult<AutoSyncStatus> {
        self.auto_sync_status
            .lock()
            .map_err(|_| AppError::StatePoisoned("auto sync status"))
            .map(|status| status.clone())
    }
}

fn build_services(app: &tauri::AppHandle) -> AppResult<Arc<AppServices>> {
    let app_data_dir = app.path().app_data_dir()?;
    fs::create_dir_all(&app_data_dir)?;

    let database_path = app_data_dir.join("prepview.db");
    let secrets_dir = app_data_dir.join("secrets");
    let repository = PortfolioRepository::open(
        database_path.clone(),
        database_key(&secrets_dir, &database_path)?,
    )?;
    let (broadcaster, _) = broadcast::channel(64);

    Ok(Arc::new(AppServices {
        repository: Mutex::new(repository),
        broadcaster,
        lan_manager: Mutex::new(LanProjectionManager::default()),
        auto_sync_status: Mutex::new(AutoSyncStatus::default()),
        http_client: reqwest::Client::builder()
            .user_agent("prepview/0.1.0")
            .build()?,
        secrets_dir,
        sync_gate: AsyncMutex::new(()),
    }))
}

fn start_background_sync_scheduler(services: Arc<AppServices>) {
    let next_run = Utc::now() + ChronoDuration::seconds(AUTO_SYNC_INTERVAL_SECONDS as i64);
    if let Ok(status) = services.update_auto_sync_status(|state| {
        state.enabled = true;
        state.interval_seconds = AUTO_SYNC_INTERVAL_SECONDS;
        state.next_scheduled_at = Some(next_run);
        state.last_error = None;
    }) {
        log::info!(
            "prepview auto-sync scheduler armed: every {}s, next at {:?}",
            status.interval_seconds,
            status.next_scheduled_at
        );
    }
    let _ = services.emit_snapshot();

    tauri::async_runtime::spawn(async move {
        let interval = Duration::from_secs(AUTO_SYNC_INTERVAL_SECONDS);

        loop {
            let scheduled_for = match services.auto_sync_status() {
                Ok(status) => status.next_scheduled_at.unwrap_or_else(|| {
                    Utc::now() + ChronoDuration::seconds(AUTO_SYNC_INTERVAL_SECONDS as i64)
                }),
                Err(_) => Utc::now() + ChronoDuration::seconds(AUTO_SYNC_INTERVAL_SECONDS as i64),
            };

            let sleep_for = scheduled_for
                .signed_duration_since(Utc::now())
                .to_std()
                .unwrap_or(Duration::ZERO);
            sleep(sleep_for).await;

            let guard = match services.sync_gate.try_lock() {
                Ok(guard) => guard,
                Err(_) => {
                    let next_cycle =
                        Utc::now() + ChronoDuration::seconds(AUTO_SYNC_INTERVAL_SECONDS as i64);
                    let _ = services.update_auto_sync_status(|state| {
                        state.enabled = true;
                        state.interval_seconds = AUTO_SYNC_INTERVAL_SECONDS;
                        state.running = false;
                        state.next_scheduled_at = Some(next_cycle);
                    });
                    let _ = services.emit_snapshot();
                    continue;
                }
            };

            let started_at = Utc::now();
            let _ = services.update_auto_sync_status(|state| {
                state.enabled = true;
                state.interval_seconds = AUTO_SYNC_INTERVAL_SECONDS;
                state.running = true;
                state.last_started_at = Some(started_at);
                state.last_error = None;
            });
            let _ = services.emit_snapshot();

            let result = commands::sync_all_live_accounts_inner(&services).await;
            let market_refresh_warnings =
                commands::refresh_supported_exchange_markets_inner(&services).await;
            let quote_refresh = commands::refresh_portfolio_quotes_inner(&services).await;
            let finished_at = Utc::now();
            let next_cycle = finished_at + ChronoDuration::seconds(interval.as_secs() as i64);

            let _ = services.update_auto_sync_status(|state| {
                state.enabled = true;
                state.interval_seconds = AUTO_SYNC_INTERVAL_SECONDS;
                state.running = false;
                state.last_finished_at = Some(finished_at);
                state.next_scheduled_at = Some(next_cycle);
                match &result {
                    Ok(summary) => {
                        state.last_cycle_accounts = summary.succeeded.len() + summary.failed.len();
                        state.last_cycle_succeeded = summary.succeeded.len();
                        state.last_cycle_failed = summary.failed.len();
                        state.last_error = summary
                            .failed
                            .first()
                            .map(|failure| failure.error.clone())
                            .or_else(|| {
                                quote_refresh.as_ref().err().map(|error| error.to_string())
                            });
                    }
                    Err(error) => {
                        state.last_cycle_accounts = 0;
                        state.last_cycle_succeeded = 0;
                        state.last_cycle_failed = 0;
                        state.last_error = Some(error.to_string());
                    }
                }
            });
            let _ = services.emit_snapshot();

            if let Err(error) = result {
                log::error!("prepview auto-sync cycle failed: {error}");
            }
            for warning in &market_refresh_warnings {
                log::warn!("prepview market catalog refresh warning: {warning}");
            }
            if let Ok(summary) = &quote_refresh {
                for warning in &summary.warnings {
                    log::warn!("prepview quote refresh warning: {warning}");
                }
            }
            if let Err(error) = quote_refresh {
                log::error!("prepview quote refresh failed: {error}");
            }

            drop(guard);
        }
    });
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(
            tauri_plugin_log::Builder::default()
                .level(log::LevelFilter::Info)
                .build(),
        )
        .setup(|app| {
            let services = build_services(&app.handle())?;
            start_background_sync_scheduler(services.clone());
            let startup_services = services.clone();
            tauri::async_runtime::spawn(async move {
                let _guard = startup_services.sync_gate.lock().await;
                for warning in
                    commands::refresh_supported_exchange_markets_inner(&startup_services).await
                {
                    log::warn!("prepview startup market catalog warning: {warning}");
                }
                match commands::refresh_portfolio_quotes_inner(&startup_services).await {
                    Ok(summary) => {
                        for warning in &summary.warnings {
                            log::warn!("prepview startup quote refresh warning: {warning}");
                        }
                    }
                    Err(error) => log::error!("prepview startup quote refresh failed: {error}"),
                }
                let _ = startup_services.emit_snapshot();
            });
            services.emit_snapshot()?;
            app.manage(services);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_bootstrap_state,
            create_account,
            update_account,
            delete_account,
            validate_live_account,
            create_live_account,
            sync_live_account,
            sync_all_live_accounts,
            add_manual_position,
            update_manual_position,
            delete_manual_position,
            close_manual_position,
            import_csv_positions,
            get_exchange_markets,
            get_exchange_market_quote,
            refresh_portfolio_quotes,
            get_position_events,
            get_closed_trades,
            set_lan_projection,
            reset_database
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
