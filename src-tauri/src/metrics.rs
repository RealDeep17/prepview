use std::collections::BTreeMap;

use chrono::{DateTime, Duration, Utc};

use crate::domain::{
    AccountMode, AccountSyncHealth, ClosedTradeRecord, ExchangeAccount, ExposureItem,
    PerformanceMetrics, PortfolioPosition, PortfolioSummary, PositionSide, SyncHealthState,
    SyncHealthSummary, SyncHealthTone, SyncJobRecord, SyncJobState,
};

const STALE_SYNC_WINDOW: Duration = Duration::minutes(15);

fn effective_margin_used(position: &PortfolioPosition) -> f64 {
    position
        .margin_used
        .unwrap_or_else(|| (position.entry_price * position.quantity) / position.leverage.max(1.0))
}

fn fallback_notional(position: &PortfolioPosition) -> f64 {
    (position.mark_price.unwrap_or(position.entry_price) * position.quantity).abs()
}

pub fn enrich_accounts(
    accounts: &[ExchangeAccount],
    positions: &[PortfolioPosition],
) -> Vec<ExchangeAccount> {
    accounts
        .iter()
        .map(|account| {
            let account_positions = positions
                .iter()
                .filter(|position| position.account_id == account.id);
            let unrealized = account_positions
                .clone()
                .map(|position| position.unrealized_pnl)
                .sum::<f64>();
            let margin_used = account_positions.map(effective_margin_used).sum::<f64>();

            let mut next = account.clone();
            if account.account_mode == AccountMode::Live {
                next.snapshot_equity = account.snapshot_equity + account.bonus_balance;
                next.available_balance = account.available_balance + account.bonus_balance;
            } else {
                next.snapshot_equity = account.wallet_balance + account.bonus_balance + unrealized;
                next.available_balance =
                    (account.wallet_balance + account.bonus_balance - margin_used).max(0.0);
            }
            next
        })
        .collect()
}

/// Computes how much of an account's costs are offset by its bonus balance.
/// Returns a positive number representing the dollar amount of offset.
pub fn compute_account_bonus_offset(
    account: &ExchangeAccount,
    account_positions: &[PortfolioPosition],
) -> f64 {
    if account.bonus_balance <= 0.0 {
        return 0.0;
    }

    let mut total_fee = 0.0;
    let mut total_loss = 0.0;
    let mut total_funding = 0.0;

    for position in account_positions {
        total_fee += position.fee_paid.abs();
        total_funding += position.funding_paid.abs();
        if position.unrealized_pnl < 0.0 {
            total_loss += position.unrealized_pnl.abs();
        }
    }

    let fee_offset = total_fee * account.bonus_fee_deduction_rate;
    let loss_offset = total_loss * account.bonus_loss_deduction_rate;
    let funding_offset = total_funding * account.bonus_funding_deduction_rate;

    (fee_offset + loss_offset + funding_offset).min(account.bonus_balance)
}

#[allow(dead_code)]
pub fn summarize(
    accounts: &[ExchangeAccount],
    positions: &[PortfolioPosition],
    source_label: String,
) -> PortfolioSummary {
    let notionals = positions.iter().map(fallback_notional).collect::<Vec<_>>();
    summarize_with_notionals(accounts, positions, &notionals, source_label)
}

pub fn summarize_with_notionals(
    accounts: &[ExchangeAccount],
    positions: &[PortfolioPosition],
    notionals: &[f64],
    source_label: String,
) -> PortfolioSummary {
    let total_equity = accounts
        .iter()
        .map(|account| account.snapshot_equity)
        .sum::<f64>();
    let total_unrealized_pnl = positions
        .iter()
        .map(|position| position.unrealized_pnl)
        .sum::<f64>();
    let gross_notional = positions
        .iter()
        .enumerate()
        .map(|(index, position)| {
            notionals
                .get(index)
                .copied()
                .unwrap_or_else(|| fallback_notional(position))
        })
        .sum::<f64>();
    let total_bonus_offset = accounts
        .iter()
        .map(|account| {
            let account_positions = positions
                .iter()
                .filter(|position| position.account_id == account.id)
                .cloned()
                .collect::<Vec<_>>();
            compute_account_bonus_offset(account, &account_positions)
        })
        .sum::<f64>();
    let margin_used = positions.iter().map(effective_margin_used).sum::<f64>();

    PortfolioSummary {
        total_equity,
        total_unrealized_pnl,
        total_bonus_offset,
        gross_notional,
        portfolio_heat_percent: if total_equity > 0.0 {
            (margin_used / total_equity) * 100.0
        } else {
            0.0
        },
        open_positions: positions.len(),
        account_count: accounts.len(),
        updated_at: Utc::now(),
        source_label,
    }
}

#[allow(dead_code)]
pub fn exposure(positions: &[PortfolioPosition]) -> Vec<ExposureItem> {
    let notionals = positions.iter().map(fallback_notional).collect::<Vec<_>>();
    exposure_with_notionals(positions, &notionals)
}

pub fn exposure_with_notionals(
    positions: &[PortfolioPosition],
    notionals: &[f64],
) -> Vec<ExposureItem> {
    let mut grouped = BTreeMap::<String, ExposureItem>::new();

    for (index, position) in positions.iter().enumerate() {
        let notional = notionals
            .get(index)
            .copied()
            .unwrap_or_else(|| fallback_notional(position));
        let item = grouped
            .entry(position.symbol.clone())
            .or_insert_with(|| ExposureItem {
                symbol: position.symbol.clone(),
                long_notional: 0.0,
                short_notional: 0.0,
                net_notional: 0.0,
                account_ids: Vec::new(),
            });

        if !item.account_ids.contains(&position.account_id) {
            item.account_ids.push(position.account_id.clone());
        }

        match position.side {
            PositionSide::Long => {
                item.long_notional += notional;
                item.net_notional += notional;
            }
            PositionSide::Short => {
                item.short_notional += notional;
                item.net_notional -= notional;
            }
        }
    }

    grouped.into_values().collect()
}

pub fn performance(
    accounts: &[ExchangeAccount],
    positions: &[PortfolioPosition],
    closed_trades: &[ClosedTradeRecord],
) -> PerformanceMetrics {
    let realized = closed_trades
        .iter()
        .map(|trade| trade.realized_pnl)
        .sum::<f64>();
    let unrealized = positions
        .iter()
        .map(|position| position.unrealized_pnl)
        .sum::<f64>();
    let fee_drag = positions
        .iter()
        .map(|position| position.fee_paid + position.funding_paid)
        .sum::<f64>();
    let closed_positions = closed_trades.len();
    let wins = closed_trades
        .iter()
        .filter(|trade| trade.realized_pnl > 0.0)
        .count();
    let total_hold_hours = closed_trades
        .iter()
        .map(|trade| (trade.closed_at - trade.opened_at).num_minutes().max(0) as f64 / 60.0)
        .sum::<f64>();

    let total_bonus_offset = accounts
        .iter()
        .map(|account| {
            let account_positions = positions
                .iter()
                .filter(|position| position.account_id == account.id)
                .cloned()
                .collect::<Vec<_>>();
            compute_account_bonus_offset(account, &account_positions)
        })
        .sum::<f64>();

    PerformanceMetrics {
        realized_pnl: realized,
        unrealized_pnl: unrealized,
        total_bonus_offset,
        closed_positions,
        win_rate: if closed_positions > 0 {
            (wins as f64 / closed_positions as f64) * 100.0
        } else {
            0.0
        },
        average_hold_hours: if closed_positions == 0 {
            0.0
        } else {
            total_hold_hours / closed_positions as f64
        },
        fee_drag,
    }
}

pub fn account_sync_health(
    accounts: &[ExchangeAccount],
    latest_sync_jobs: &[SyncJobRecord],
) -> Vec<AccountSyncHealth> {
    account_sync_health_at(accounts, latest_sync_jobs, Utc::now())
}

pub fn summarize_sync_health(
    accounts: &[ExchangeAccount],
    latest_sync_jobs: &[SyncJobRecord],
) -> SyncHealthSummary {
    summarize_sync_health_at(accounts, latest_sync_jobs, Utc::now())
}

fn account_sync_health_at(
    accounts: &[ExchangeAccount],
    latest_sync_jobs: &[SyncJobRecord],
    now: DateTime<Utc>,
) -> Vec<AccountSyncHealth> {
    accounts
        .iter()
        .map(|account| {
            derive_account_sync_health(
                account,
                latest_sync_jobs
                    .iter()
                    .find(|job| job.account_id == account.id),
                now,
            )
        })
        .collect()
}

fn summarize_sync_health_at(
    accounts: &[ExchangeAccount],
    latest_sync_jobs: &[SyncJobRecord],
    now: DateTime<Utc>,
) -> SyncHealthSummary {
    let live_accounts = accounts
        .iter()
        .filter(|account| account.account_mode == AccountMode::Live)
        .collect::<Vec<_>>();
    if live_accounts.is_empty() {
        return SyncHealthSummary {
            state: SyncHealthState::Local,
            label: "local only".into(),
            tone: SyncHealthTone::Neutral,
            detail: "no live connectors in scope".into(),
            error_message: None,
            last_synced_at: None,
            live_accounts: 0,
            stale_count: 0,
            degraded_count: 0,
            awaiting_count: 0,
            syncing_count: 0,
        };
    }

    let snapshots = live_accounts
        .iter()
        .map(|account| {
            derive_account_sync_health(
                account,
                latest_sync_jobs
                    .iter()
                    .find(|job| job.account_id == account.id),
                now,
            )
        })
        .collect::<Vec<_>>();
    let degraded_count = snapshots
        .iter()
        .filter(|snapshot| snapshot.state == SyncHealthState::Degraded)
        .count();
    let stale_count = snapshots
        .iter()
        .filter(|snapshot| snapshot.state == SyncHealthState::Stale)
        .count();
    let awaiting_count = snapshots
        .iter()
        .filter(|snapshot| snapshot.state == SyncHealthState::Awaiting)
        .count();
    let syncing_count = snapshots
        .iter()
        .filter(|snapshot| snapshot.state == SyncHealthState::Syncing)
        .count();

    if degraded_count > 0 {
        return SyncHealthSummary {
            state: SyncHealthState::Degraded,
            label: "degraded".into(),
            tone: SyncHealthTone::Negative,
            detail: if stale_count > 0 {
                format!("{degraded_count} degraded · {stale_count} stale")
            } else {
                format!(
                    "{degraded_count} degraded account{}",
                    if degraded_count == 1 { "" } else { "s" }
                )
            },
            error_message: None,
            last_synced_at: None,
            live_accounts: live_accounts.len(),
            stale_count,
            degraded_count,
            awaiting_count,
            syncing_count,
        };
    }

    if syncing_count > 0 {
        return SyncHealthSummary {
            state: SyncHealthState::Syncing,
            label: "syncing".into(),
            tone: SyncHealthTone::Neutral,
            detail: format!(
                "{syncing_count} live account{} in flight",
                if syncing_count == 1 { "" } else { "s" }
            ),
            error_message: None,
            last_synced_at: None,
            live_accounts: live_accounts.len(),
            stale_count,
            degraded_count,
            awaiting_count,
            syncing_count,
        };
    }

    if stale_count > 0 {
        return SyncHealthSummary {
            state: SyncHealthState::Stale,
            label: "stale".into(),
            tone: SyncHealthTone::Neutral,
            detail: format!(
                "{stale_count} stale · {} fresh",
                live_accounts.len() - stale_count
            ),
            error_message: None,
            last_synced_at: None,
            live_accounts: live_accounts.len(),
            stale_count,
            degraded_count,
            awaiting_count,
            syncing_count,
        };
    }

    if awaiting_count > 0 {
        return SyncHealthSummary {
            state: SyncHealthState::Awaiting,
            label: "awaiting sync".into(),
            tone: SyncHealthTone::Neutral,
            detail: format!("{awaiting_count} awaiting first pull"),
            error_message: None,
            last_synced_at: None,
            live_accounts: live_accounts.len(),
            stale_count,
            degraded_count,
            awaiting_count,
            syncing_count,
        };
    }

    SyncHealthSummary {
        state: SyncHealthState::Synced,
        label: "synced".into(),
        tone: SyncHealthTone::Positive,
        detail: format!("{} live fresh", live_accounts.len()),
        error_message: None,
        last_synced_at: None,
        live_accounts: live_accounts.len(),
        stale_count,
        degraded_count,
        awaiting_count,
        syncing_count,
    }
}

fn derive_account_sync_health(
    account: &ExchangeAccount,
    latest_job: Option<&SyncJobRecord>,
    now: DateTime<Utc>,
) -> AccountSyncHealth {
    if account.account_mode != AccountMode::Live {
        return AccountSyncHealth {
            account_id: account.id.clone(),
            state: SyncHealthState::Local,
            label: "local".into(),
            tone: SyncHealthTone::Neutral,
            detail: if account.account_mode == AccountMode::Import {
                "import-managed book".into()
            } else {
                "manual/local book".into()
            },
            error_message: None,
            last_synced_at: account.last_synced_at,
        };
    }

    if latest_job.map(|job| job.state) == Some(SyncJobState::Running) {
        return AccountSyncHealth {
            account_id: account.id.clone(),
            state: SyncHealthState::Syncing,
            label: "syncing".into(),
            tone: SyncHealthTone::Neutral,
            detail: account
                .last_synced_at
                .map(|value| format!("last {}", format_relative_age(value, now)))
                .unwrap_or_else(|| "fetching first live snapshot".into()),
            error_message: None,
            last_synced_at: account.last_synced_at,
        };
    }

    let error_message = latest_job
        .and_then(|job| job.error_message.clone())
        .or_else(|| account.sync_error.clone());
    if account.sync_status == crate::domain::SyncStatus::Error
        || latest_job.map(|job| job.state) == Some(SyncJobState::Failed)
    {
        return AccountSyncHealth {
            account_id: account.id.clone(),
            state: SyncHealthState::Degraded,
            label: "degraded".into(),
            tone: SyncHealthTone::Negative,
            detail: account
                .last_synced_at
                .map(|value| format!("last good {}", format_relative_age(value, now)))
                .unwrap_or_else(|| "no successful sync recorded".into()),
            error_message,
            last_synced_at: account.last_synced_at,
        };
    }

    let Some(last_synced_at) = account.last_synced_at else {
        return AccountSyncHealth {
            account_id: account.id.clone(),
            state: SyncHealthState::Awaiting,
            label: "awaiting sync".into(),
            tone: SyncHealthTone::Neutral,
            detail: "no live snapshot yet".into(),
            error_message: None,
            last_synced_at: None,
        };
    };

    if now - last_synced_at > STALE_SYNC_WINDOW {
        return AccountSyncHealth {
            account_id: account.id.clone(),
            state: SyncHealthState::Stale,
            label: "stale".into(),
            tone: SyncHealthTone::Neutral,
            detail: format!("last {}", format_relative_age(last_synced_at, now)),
            error_message: None,
            last_synced_at: Some(last_synced_at),
        };
    }

    AccountSyncHealth {
        account_id: account.id.clone(),
        state: SyncHealthState::Synced,
        label: "synced".into(),
        tone: SyncHealthTone::Positive,
        detail: format!("last {}", format_relative_age(last_synced_at, now)),
        error_message: None,
        last_synced_at: Some(last_synced_at),
    }
}

fn format_relative_age(value: DateTime<Utc>, now: DateTime<Utc>) -> String {
    let diff_minutes = (now - value).num_minutes().max(0);
    if diff_minutes < 1 {
        return "just now".into();
    }
    if diff_minutes < 60 {
        return format!("{diff_minutes}m ago");
    }

    let diff_hours = diff_minutes / 60;
    if diff_hours < 24 {
        return format!("{diff_hours}h ago");
    }

    format!("{}d ago", diff_hours / 24)
}

#[cfg(test)]
mod tests {
    use chrono::{Duration, TimeZone, Utc};

    use crate::domain::{
        AccountMode, ClosedTradeRecord, ExchangeAccount, ExchangeKind, FundingMode,
        PortfolioPosition, PositionSide, SyncHealthState, SyncHealthTone, SyncJobRecord,
        SyncJobState, SyncStatus,
    };

    use super::{
        account_sync_health_at, exposure, exposure_with_notionals, summarize,
        summarize_sync_health_at, summarize_with_notionals,
    };

    #[test]
    fn computes_exposure_and_summary() {
        let accounts = vec![ExchangeAccount {
            id: "a".into(),
            name: "Alpha".into(),
            exchange: ExchangeKind::Manual,
            account_mode: AccountMode::Manual,
            wallet_balance: 1000.0,
            available_balance: 1000.0,
            snapshot_equity: 1000.0,
            currency: "USDT".into(),
            external_reference: None,
            notes: None,
            sync_status: SyncStatus::Manual,
            sync_error: None,
            created_at: Utc::now(),
            last_synced_at: None,
            bonus_balance: 0.0,
            bonus_fee_deduction_rate: 0.0,
            bonus_loss_deduction_rate: 0.0,
            bonus_funding_deduction_rate: 0.0,
        }];
        let positions = vec![PortfolioPosition {
            id: "p".into(),
            account_id: "a".into(),
            account_name: "Alpha".into(),
            exchange: ExchangeKind::Manual,
            exchange_symbol: None,
            margin_mode: None,
            symbol: "BTCUSDT".into(),
            side: PositionSide::Long,
            quantity: 1.0,
            entry_price: 100.0,
            mark_price: Some(110.0),
            margin_used: Some(20.0),
            liquidation_price: Some(81.0),
            maintenance_margin: Some(1.0),
            maintenance_margin_rate: None,
            risk_source: None,
            leverage: 5.0,
            unrealized_pnl: 10.0,
            realized_pnl: 0.0,
            fee_paid: 0.0,
            funding_paid: 0.0,
            funding_mode: FundingMode::Manual,
            take_profit: None,
            stop_loss: None,
            opened_at: Utc::now(),
            notes: None,
        }];

        let summary = summarize(&accounts, &positions, "test".into());
        let exposure_items = exposure(&positions);

        assert_eq!(summary.open_positions, 1);
        assert_eq!(exposure_items.len(), 1);
        assert_eq!(exposure_items[0].symbol, "BTCUSDT");
    }

    #[test]
    fn notionals_override_quantity_based_summary_and_exposure() {
        let accounts = vec![ExchangeAccount {
            id: "a".into(),
            name: "Alpha".into(),
            exchange: ExchangeKind::Blofin,
            account_mode: AccountMode::Manual,
            wallet_balance: 1000.0,
            available_balance: 1000.0,
            snapshot_equity: 1097.0,
            currency: "USDT".into(),
            external_reference: None,
            notes: None,
            sync_status: SyncStatus::Manual,
            sync_error: None,
            created_at: Utc::now(),
            last_synced_at: None,
            bonus_balance: 0.0,
            bonus_fee_deduction_rate: 0.0,
            bonus_loss_deduction_rate: 0.0,
            bonus_funding_deduction_rate: 0.0,
        }];
        let positions = vec![PortfolioPosition {
            id: "p".into(),
            account_id: "a".into(),
            account_name: "Alpha".into(),
            exchange: ExchangeKind::Blofin,
            exchange_symbol: Some("ETH-USDT".into()),
            margin_mode: None,
            symbol: "ETH-PERP".into(),
            side: PositionSide::Long,
            quantity: 10.0,
            entry_price: 1500.0,
            mark_price: Some(1600.0),
            margin_used: Some(300.0),
            liquidation_price: Some(1200.0),
            maintenance_margin: Some(8.0),
            maintenance_margin_rate: Some(0.004),
            risk_source: None,
            leverage: 5.0,
            unrealized_pnl: 97.0,
            realized_pnl: 0.0,
            fee_paid: 2.0,
            funding_paid: 1.0,
            funding_mode: FundingMode::Manual,
            take_profit: None,
            stop_loss: None,
            opened_at: Utc::now(),
            notes: None,
        }];

        let summary = summarize_with_notionals(&accounts, &positions, &[1600.0], "test".into());
        let exposure_items = exposure_with_notionals(&positions, &[1600.0]);

        assert_eq!(summary.gross_notional, 1600.0);
        assert_eq!(summary.total_unrealized_pnl, 97.0);
        assert_eq!(exposure_items.len(), 1);
        assert_eq!(exposure_items[0].long_notional, 1600.0);
        assert_eq!(exposure_items[0].net_notional, 1600.0);
    }

    #[test]
    fn derives_sync_health_states_from_accounts_and_latest_jobs() {
        let now = Utc
            .with_ymd_and_hms(2026, 4, 3, 3, 0, 0)
            .single()
            .expect("timestamp should be valid");
        let accounts = vec![
            ExchangeAccount {
                id: "live-fresh".into(),
                name: "Alpha".into(),
                exchange: ExchangeKind::Blofin,
                account_mode: AccountMode::Live,
                wallet_balance: 1000.0,
                available_balance: 800.0,
                snapshot_equity: 1010.0,
                currency: "USDT".into(),
                external_reference: Some("alpha".into()),
                notes: None,
                sync_status: SyncStatus::Active,
                sync_error: None,
                created_at: now,
                last_synced_at: Some(now - Duration::minutes(5)),
                bonus_balance: 0.0,
                bonus_fee_deduction_rate: 0.0,
                bonus_loss_deduction_rate: 0.0,
                bonus_funding_deduction_rate: 0.0,
            },
            ExchangeAccount {
                id: "live-stale".into(),
                name: "Beta".into(),
                exchange: ExchangeKind::Hyperliquid,
                account_mode: AccountMode::Live,
                wallet_balance: 900.0,
                available_balance: 700.0,
                snapshot_equity: 920.0,
                currency: "USDC".into(),
                external_reference: Some("beta".into()),
                notes: None,
                sync_status: SyncStatus::Active,
                sync_error: None,
                created_at: now,
                last_synced_at: Some(now - Duration::minutes(30)),
                bonus_balance: 0.0,
                bonus_fee_deduction_rate: 0.0,
                bonus_loss_deduction_rate: 0.0,
                bonus_funding_deduction_rate: 0.0,
            },
            ExchangeAccount {
                id: "live-error".into(),
                name: "Gamma".into(),
                exchange: ExchangeKind::Blofin,
                account_mode: AccountMode::Live,
                wallet_balance: 800.0,
                available_balance: 650.0,
                snapshot_equity: 815.0,
                currency: "USDT".into(),
                external_reference: Some("gamma".into()),
                notes: None,
                sync_status: SyncStatus::Error,
                sync_error: Some("bad auth".into()),
                created_at: now,
                last_synced_at: Some(now - Duration::minutes(10)),
                bonus_balance: 0.0,
                bonus_fee_deduction_rate: 0.0,
                bonus_loss_deduction_rate: 0.0,
                bonus_funding_deduction_rate: 0.0,
            },
        ];
        let jobs = vec![
            SyncJobRecord {
                id: "job-fresh".into(),
                account_id: "live-fresh".into(),
                account_name: "Alpha".into(),
                exchange: ExchangeKind::Blofin,
                state: SyncJobState::Success,
                started_at: now - Duration::minutes(5),
                finished_at: Some(now - Duration::minutes(5)),
                attempt_count: 1,
                synced_positions: 1,
                funding_entries: 1,
                error_message: None,
            },
            SyncJobRecord {
                id: "job-stale".into(),
                account_id: "live-stale".into(),
                account_name: "Beta".into(),
                exchange: ExchangeKind::Hyperliquid,
                state: SyncJobState::Success,
                started_at: now - Duration::minutes(30),
                finished_at: Some(now - Duration::minutes(30)),
                attempt_count: 1,
                synced_positions: 1,
                funding_entries: 0,
                error_message: None,
            },
            SyncJobRecord {
                id: "job-error".into(),
                account_id: "live-error".into(),
                account_name: "Gamma".into(),
                exchange: ExchangeKind::Blofin,
                state: SyncJobState::Failed,
                started_at: now - Duration::minutes(2),
                finished_at: Some(now - Duration::minutes(2)),
                attempt_count: 3,
                synced_positions: 0,
                funding_entries: 0,
                error_message: Some("bad auth".into()),
            },
        ];

        let snapshots = accounts
            .iter()
            .map(|account| {
                super::derive_account_sync_health(
                    account,
                    jobs.iter().find(|job| job.account_id == account.id),
                    now,
                )
            })
            .collect::<Vec<_>>();

        assert_eq!(snapshots[0].state, SyncHealthState::Synced);
        assert_eq!(snapshots[1].state, SyncHealthState::Stale);
        assert_eq!(snapshots[2].state, SyncHealthState::Degraded);
        assert_eq!(snapshots[2].tone, SyncHealthTone::Negative);
        assert_eq!(snapshots[2].error_message.as_deref(), Some("bad auth"));

        let summary = summarize_sync_health_at(&accounts, &jobs, now);
        assert_eq!(summary.live_accounts, 3);
        assert_eq!(summary.state, SyncHealthState::Degraded);
        assert_eq!(summary.degraded_count, 1);
        assert_eq!(summary.stale_count, 1);

        let helper = account_sync_health_at(&accounts, &jobs, now);
        assert_eq!(helper.len(), 3);
    }

    fn make_account(
        id: &str,
        bonus: f64,
        fee_rate: f64,
        loss_rate: f64,
        funding_rate: f64,
    ) -> ExchangeAccount {
        ExchangeAccount {
            id: id.into(),
            name: format!("Account {}", id),
            exchange: ExchangeKind::Blofin,
            account_mode: AccountMode::Manual,
            wallet_balance: 10000.0,
            available_balance: 10000.0,
            snapshot_equity: 10000.0,
            currency: "USDT".into(),
            external_reference: None,
            notes: None,
            sync_status: SyncStatus::Manual,
            sync_error: None,
            created_at: Utc::now(),
            last_synced_at: None,
            bonus_balance: bonus,
            bonus_fee_deduction_rate: fee_rate,
            bonus_loss_deduction_rate: loss_rate,
            bonus_funding_deduction_rate: funding_rate,
        }
    }

    fn make_position(account_id: &str, pnl: f64, fee: f64, funding: f64) -> PortfolioPosition {
        PortfolioPosition {
            id: format!("pos-{}", account_id),
            account_id: account_id.into(),
            account_name: format!("Account {}", account_id),
            exchange: ExchangeKind::Blofin,
            exchange_symbol: None,
            margin_mode: None,
            symbol: "BTCUSDT".into(),
            side: PositionSide::Long,
            quantity: 1.0,
            entry_price: 50000.0,
            mark_price: Some(50000.0 + pnl),
            margin_used: Some(5000.0),
            liquidation_price: None,
            maintenance_margin: None,
            maintenance_margin_rate: None,
            risk_source: None,
            leverage: 10.0,
            unrealized_pnl: pnl,
            realized_pnl: 0.0,
            fee_paid: fee,
            funding_paid: funding,
            funding_mode: FundingMode::Manual,
            take_profit: None,
            stop_loss: None,
            opened_at: Utc::now(),
            notes: None,
        }
    }

    #[test]
    fn test_bonus_offset_blofin_defaults() {
        // BloFin: 100% fee / 50% loss / 50% funding
        let account = make_account("a", 500.0, 1.0, 0.5, 0.5);
        // Position with $20 fee, $100 loss (unrealized_pnl = -100), $10 funding
        let positions = vec![make_position("a", -100.0, 20.0, 10.0)];

        let offset = super::compute_account_bonus_offset(&account, &positions);
        // fee_offset = 20 * 1.0 = 20
        // loss_offset = 100 * 0.5 = 50
        // funding_offset = 10 * 0.5 = 5
        // total = 75, capped at 500 → 75
        assert!(
            (offset - 75.0).abs() < 0.001,
            "expected 75.0, got {}",
            offset
        );
    }

    #[test]
    fn test_bonus_offset_zero_when_no_bonus() {
        let account = make_account("b", 0.0, 1.0, 0.5, 0.5);
        let positions = vec![make_position("b", -200.0, 50.0, 30.0)];

        let offset = super::compute_account_bonus_offset(&account, &positions);
        assert_eq!(offset, 0.0, "should be zero when bonus_balance is 0");
    }

    #[test]
    fn test_bonus_capped_at_balance() {
        // Small bonus: only $10
        let account = make_account("c", 10.0, 1.0, 0.5, 0.5);
        // Position with $50 fee, $200 loss, $100 funding → desired = 50+100+50 = 200
        let positions = vec![make_position("c", -200.0, 50.0, 100.0)];

        let offset = super::compute_account_bonus_offset(&account, &positions);
        // desired = 200, but capped at 10
        assert!(
            (offset - 10.0).abs() < 0.001,
            "expected 10.0 (capped), got {}",
            offset
        );
    }

    #[test]
    fn performance_uses_closed_trade_history_for_realized_metrics() {
        let account = make_account("p", 0.0, 0.0, 0.0, 0.0);
        let positions = vec![make_position("p", 25.0, 2.0, 1.0)];
        let opened_at = Utc
            .with_ymd_and_hms(2026, 1, 10, 10, 0, 0)
            .single()
            .expect("timestamp should be valid");
        let closed_trades = vec![
            ClosedTradeRecord {
                id: "win".into(),
                account_id: account.id.clone(),
                account_name: account.name.clone(),
                position_id: Some("pos-win".into()),
                exchange: ExchangeKind::Manual,
                exchange_symbol: None,
                margin_mode: None,
                symbol: "BTCUSDT".into(),
                side: PositionSide::Long,
                quantity: 1.0,
                entry_price: 100.0,
                exit_price: 120.0,
                leverage: 5.0,
                realized_pnl: 18.0,
                fee_paid: 1.0,
                funding_paid: 1.0,
                opened_at,
                closed_at: opened_at + Duration::hours(2),
                note: None,
            },
            ClosedTradeRecord {
                id: "loss".into(),
                account_id: account.id.clone(),
                account_name: account.name.clone(),
                position_id: Some("pos-loss".into()),
                exchange: ExchangeKind::Manual,
                exchange_symbol: None,
                margin_mode: None,
                symbol: "ETHUSDT".into(),
                side: PositionSide::Short,
                quantity: 1.0,
                entry_price: 200.0,
                exit_price: 210.0,
                leverage: 4.0,
                realized_pnl: -12.0,
                fee_paid: 1.0,
                funding_paid: 0.0,
                opened_at,
                closed_at: opened_at + Duration::hours(4),
                note: None,
            },
        ];

        let metrics = super::performance(&[account], &positions, &closed_trades);

        assert!((metrics.realized_pnl - 6.0).abs() < 1e-9);
        assert_eq!(metrics.closed_positions, 2);
        assert!((metrics.win_rate - 50.0).abs() < 1e-9);
        assert!((metrics.average_hold_hours - 3.0).abs() < 1e-9);
        assert!((metrics.unrealized_pnl - 25.0).abs() < 1e-9);
    }
}
