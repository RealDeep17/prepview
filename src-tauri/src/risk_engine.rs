use crate::domain::{
    ExchangeKind, ExchangeMarket, ExchangeRiskTier, PositionSide, RiskTierBasis,
};

pub(crate) const BLOFIN_DEFAULT_LIQUIDATION_FEE_RATE: f64 = 0.0006;

#[derive(Debug, Clone, Copy, PartialEq)]
pub(crate) struct TierSelection {
    pub maintenance_margin_rate: f64,
    pub maintenance_amount_deduction: f64,
    pub max_leverage: f64,
}

pub(crate) fn contract_value_for_market(market: Option<&ExchangeMarket>) -> f64 {
    market
        .and_then(|item| item.contract_value)
        .filter(|value| *value > 0.0)
        .unwrap_or(1.0)
}

pub(crate) fn position_size_base_units(
    quantity: f64,
    market: Option<&ExchangeMarket>,
) -> f64 {
    quantity.abs() * contract_value_for_market(market)
}

pub(crate) fn pnl_amount(
    side: PositionSide,
    entry_price: f64,
    mark_price: f64,
    quantity: f64,
    market: Option<&ExchangeMarket>,
) -> f64 {
    let size = position_size_base_units(quantity, market);
    match side {
        PositionSide::Long => (mark_price - entry_price) * size,
        PositionSide::Short => (entry_price - mark_price) * size,
    }
}

pub(crate) fn notional_usd(
    quantity: f64,
    market: Option<&ExchangeMarket>,
    price: f64,
) -> f64 {
    position_size_base_units(quantity, market) * price.abs()
}

pub(crate) fn derive_margin_used(
    entry_price: f64,
    quantity: f64,
    leverage: f64,
    market: Option<&ExchangeMarket>,
) -> f64 {
    notional_usd(quantity, market, entry_price) / leverage.max(1.0)
}

pub(crate) fn select_risk_tier<'a>(
    exchange: ExchangeKind,
    quantity: f64,
    market: Option<&ExchangeMarket>,
    price: f64,
    tiers: &'a [ExchangeRiskTier],
) -> Option<&'a ExchangeRiskTier> {
    let metric = match exchange {
        ExchangeKind::Blofin => quantity.abs(),
        ExchangeKind::Hyperliquid => notional_usd(quantity, market, price),
        _ => quantity.abs(),
    };

    let mut selected = None;
    for tier in tiers.iter().filter(|tier| tier.lower_bound <= metric + 1e-9) {
        let basis_matches = match (exchange, tier.tier_basis) {
            (ExchangeKind::Blofin, RiskTierBasis::ExchangeQuantity) => true,
            (ExchangeKind::Hyperliquid, RiskTierBasis::NotionalUsd) => true,
            (ExchangeKind::Manual | ExchangeKind::Import, _) => true,
            _ => false,
        };
        if !basis_matches {
            continue;
        }

        if tier
            .upper_bound
            .map(|upper| metric < upper - 1e-9 || (metric - upper).abs() <= 1e-9)
            .unwrap_or(true)
        {
            selected = Some(tier);
        }
    }

    selected
}

pub(crate) fn current_tier_selection(
    exchange: ExchangeKind,
    quantity: f64,
    market: Option<&ExchangeMarket>,
    price: f64,
    tiers: &[ExchangeRiskTier],
) -> Option<TierSelection> {
    select_risk_tier(exchange, quantity, market, price, tiers).map(|tier| TierSelection {
        maintenance_margin_rate: tier.maintenance_margin_rate,
        maintenance_amount_deduction: tier.maintenance_amount_deduction,
        max_leverage: tier.max_leverage,
    })
}

pub(crate) fn maintenance_margin_amount(
    quantity: f64,
    market: Option<&ExchangeMarket>,
    price: f64,
    selection: TierSelection,
) -> f64 {
    (notional_usd(quantity, market, price) * selection.maintenance_margin_rate
        - selection.maintenance_amount_deduction)
        .max(0.0)
}

pub(crate) fn blofin_required_amount(
    quantity: f64,
    market: Option<&ExchangeMarket>,
    price: f64,
    maintenance_margin_rate: f64,
) -> f64 {
    notional_usd(quantity, market, price)
        * (maintenance_margin_rate + BLOFIN_DEFAULT_LIQUIDATION_FEE_RATE)
}

pub(crate) fn estimate_blofin_liquidation_price(
    side: PositionSide,
    collateral_pool: f64,
    other_required: f64,
    entry_price: f64,
    quantity: f64,
    market: Option<&ExchangeMarket>,
    maintenance_margin_rate: f64,
) -> Option<f64> {
    let size = position_size_base_units(quantity, market);
    if size <= 0.0 {
        return None;
    }

    let numerator = match side {
        PositionSide::Long => {
            collateral_pool - other_required - (size * entry_price)
        }
        PositionSide::Short => {
            collateral_pool - other_required + (size * entry_price)
        }
    };
    let denominator = match side {
        PositionSide::Long => {
            size * (maintenance_margin_rate + BLOFIN_DEFAULT_LIQUIDATION_FEE_RATE - 1.0)
        }
        PositionSide::Short => {
            size * (1.0 + maintenance_margin_rate + BLOFIN_DEFAULT_LIQUIDATION_FEE_RATE)
        }
    };

    (denominator.abs() > 1e-9)
        .then_some(numerator / denominator)
        .filter(|price| *price > 0.0 && price.is_finite())
}

pub(crate) fn hyperliquid_required_amount(
    quantity: f64,
    market: Option<&ExchangeMarket>,
    price: f64,
    selection: TierSelection,
) -> f64 {
    maintenance_margin_amount(quantity, market, price, selection)
}

pub(crate) fn estimate_hyperliquid_liquidation_price(
    side: PositionSide,
    collateral_pool: f64,
    other_required: f64,
    entry_price: f64,
    quantity: f64,
    market: Option<&ExchangeMarket>,
    tiers: &[ExchangeRiskTier],
) -> Option<f64> {
    let size = position_size_base_units(quantity, market);
    if size <= 0.0 || tiers.is_empty() {
        return None;
    }

    let mut ordered = tiers.to_vec();
    ordered.sort_by(|left, right| {
        left.lower_bound
            .partial_cmp(&right.lower_bound)
            .unwrap_or(std::cmp::Ordering::Equal)
    });

    for tier in ordered {
        let rate = tier.maintenance_margin_rate;
        let deduction = tier.maintenance_amount_deduction;
        let numerator = match side {
            PositionSide::Long => {
                collateral_pool - other_required - (size * entry_price) + deduction
            }
            PositionSide::Short => {
                collateral_pool - other_required + (size * entry_price) + deduction
            }
        };
        let denominator = match side {
            PositionSide::Long => size * (rate - 1.0),
            PositionSide::Short => size * (1.0 + rate),
        };
        if denominator.abs() <= 1e-9 {
            continue;
        }

        let liquidation_price = numerator / denominator;
        if !(liquidation_price.is_finite() && liquidation_price > 0.0) {
            continue;
        }

        let metric = match tier.tier_basis {
            RiskTierBasis::ExchangeQuantity => quantity.abs(),
            RiskTierBasis::NotionalUsd => {
                notional_usd(quantity, market, liquidation_price)
            }
        };
        let in_bounds = metric + 1e-9 >= tier.lower_bound
            && tier
                .upper_bound
                .map(|upper| metric <= upper + 1e-9)
                .unwrap_or(true);
        if in_bounds {
            return Some(liquidation_price);
        }
    }

    None
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::domain::{ExchangeKind, ExchangeMarket, ExchangeRiskTier, PositionSide};

    fn blofin_market() -> ExchangeMarket {
        ExchangeMarket {
            exchange: ExchangeKind::Blofin,
            exchange_symbol: "ETH-USDT".into(),
            symbol: "ETH-PERP".into(),
            base_asset: "ETH".into(),
            quote_asset: "USDT".into(),
            settle_asset: Some("USDT".into()),
            contract_type: "linear".into(),
            contract_value: Some(0.1),
            price_tick_size: Some(0.01),
            quantity_step: Some(0.1),
            min_quantity: Some(0.1),
            max_leverage: Some(150.0),
            mark_price: Some(1591.69),
            oracle_price: Some(1591.5),
            funding_rate: None,
            next_funding_time: None,
            is_active: true,
        }
    }

    #[test]
    fn derives_margin_with_contract_value() {
        let market = blofin_market();
        let margin = derive_margin_used(1591.8, 1.0, 3.0, Some(&market));
        assert!((margin - 53.06).abs() < 1e-6);
    }

    #[test]
    fn blofin_isolated_long_matches_fixture_shape() {
        let market = blofin_market();
        let liquidation = estimate_blofin_liquidation_price(
            PositionSide::Long,
            53.06,
            0.0,
            1591.8,
            1.0,
            Some(&market),
            0.004,
        )
        .expect("blofin liquidation should resolve");

        assert!((liquidation - 1066.1040787623).abs() < 1e-6);
    }

    #[test]
    fn hyperliquid_deduction_keeps_second_tier_continuous() {
        let tiers = vec![
            ExchangeRiskTier {
                exchange: ExchangeKind::Hyperliquid,
                exchange_symbol: "BTC".into(),
                margin_mode: Some(crate::domain::MarginMode::Cross),
                tier_basis: RiskTierBasis::NotionalUsd,
                lower_bound: 0.0,
                upper_bound: Some(150_000_000.0),
                maintenance_margin_rate: 0.0125,
                maintenance_amount_deduction: 0.0,
                max_leverage: 40.0,
            },
            ExchangeRiskTier {
                exchange: ExchangeKind::Hyperliquid,
                exchange_symbol: "BTC".into(),
                margin_mode: Some(crate::domain::MarginMode::Cross),
                tier_basis: RiskTierBasis::NotionalUsd,
                lower_bound: 150_000_000.0,
                upper_bound: None,
                maintenance_margin_rate: 0.025,
                maintenance_amount_deduction: 1_875_000.0,
                max_leverage: 20.0,
            },
        ];
        let market = ExchangeMarket {
            exchange: ExchangeKind::Hyperliquid,
            exchange_symbol: "BTC".into(),
            symbol: "BTC-PERP".into(),
            base_asset: "BTC".into(),
            quote_asset: "USDC".into(),
            settle_asset: Some("USDC".into()),
            contract_type: "perpetual".into(),
            contract_value: Some(1.0),
            price_tick_size: None,
            quantity_step: Some(0.00001),
            min_quantity: Some(0.00001),
            max_leverage: Some(40.0),
            mark_price: Some(50_000.0),
            oracle_price: Some(50_000.0),
            funding_rate: None,
            next_funding_time: None,
            is_active: true,
        };

        let first = current_tier_selection(
            ExchangeKind::Hyperliquid,
            3000.0,
            Some(&market),
            50_000.0,
            &tiers,
        )
        .expect("tier should resolve");
        let second = current_tier_selection(
            ExchangeKind::Hyperliquid,
            3000.02,
            Some(&market),
            50_000.0,
            &tiers,
        )
        .expect("tier should resolve");

        let first_required =
            maintenance_margin_amount(3000.0, Some(&market), 50_000.0, first);
        let second_required =
            maintenance_margin_amount(3000.0, Some(&market), 50_000.0, second);

        assert!((first_required - second_required).abs() < 1e-6);
    }
}
