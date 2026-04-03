/**
 * LiqCalculator.js — Teralyn v2.0
 *
 * Institutional-grade liquidation price calculator:
 *   • Cross-margin and Isolated-margin modes
 *   • Multi-tier maintenance margin rates (Binance-style)
 *   • Bankruptcy price vs liquidation price
 *   • ADL (Auto-Deleverage) risk score
 *   • Funding rate impact on effective liquidation
 *   • Partial liquidation thresholds
 *   • Distance-to-liquidation metrics
 */

// Binance Futures maintenance margin rate tiers (USDT-margined)
const BINANCE_MARGIN_TIERS = [
    { maxNotional: 50000,     mmr: 0.004, maintenanceAmount: 0 },
    { maxNotional: 250000,    mmr: 0.005, maintenanceAmount: 50 },
    { maxNotional: 1000000,   mmr: 0.01,  maintenanceAmount: 1300 },
    { maxNotional: 5000000,   mmr: 0.025, maintenanceAmount: 16300 },
    { maxNotional: 10000000,  mmr: 0.05,  maintenanceAmount: 141300 },
    { maxNotional: 20000000,  mmr: 0.1,   maintenanceAmount: 641300 },
    { maxNotional: 50000000,  mmr: 0.125, maintenanceAmount: 1141300 },
    { maxNotional: 100000000, mmr: 0.15,  maintenanceAmount: 2391300 },
    { maxNotional: 200000000, mmr: 0.25,  maintenanceAmount: 12391300 },
    { maxNotional: Infinity,  mmr: 0.5,   maintenanceAmount: 62391300 },
];

// BTC-specific tiers (higher limits)
const BTC_MARGIN_TIERS = [
    { maxNotional: 250000,     mmr: 0.004, maintenanceAmount: 0 },
    { maxNotional: 1000000,    mmr: 0.005, maintenanceAmount: 250 },
    { maxNotional: 5000000,    mmr: 0.01,  maintenanceAmount: 5250 },
    { maxNotional: 10000000,   mmr: 0.025, maintenanceAmount: 80250 },
    { maxNotional: 20000000,   mmr: 0.05,  maintenanceAmount: 330250 },
    { maxNotional: 50000000,   mmr: 0.1,   maintenanceAmount: 1330250 },
    { maxNotional: 100000000,  mmr: 0.125, maintenanceAmount: 2580250 },
    { maxNotional: 200000000,  mmr: 0.15,  maintenanceAmount: 5080250 },
    { maxNotional: 500000000,  mmr: 0.25,  maintenanceAmount: 25080250 },
    { maxNotional: Infinity,   mmr: 0.5,   maintenanceAmount: 150080250 },
];

export class LiqCalculator {
    /**
     * Get the appropriate margin tier for a symbol
     */
    static getMarginTiers(symbol) {
        if (symbol?.includes('BTC')) return BTC_MARGIN_TIERS;
        return BINANCE_MARGIN_TIERS;
    }

    /**
     * Get MMR and maintenance amount for a given notional
     */
    static getMaintenanceMarginRate(notional, symbol) {
        const tiers = this.getMarginTiers(symbol);
        for (const tier of tiers) {
            if (notional <= tier.maxNotional) {
                return { mmr: tier.mmr, maintenanceAmount: tier.maintenanceAmount };
            }
        }
        return { mmr: 0.5, maintenanceAmount: 0 };
    }

    /**
     * Calculate liquidation price for ISOLATED margin
     * Based on Binance's formula: https://www.binance.com/en/support/faq
     *
     * @param {Object} params
     * @param {string} params.side - 'LONG' or 'SHORT'
     * @param {number} params.entryPrice
     * @param {number} params.quantity - Base asset quantity
     * @param {number} params.leverage
     * @param {number} params.walletBalance - Isolated wallet balance (margin + added margin)
     * @param {string} params.symbol
     * @returns {Object} Liquidation details
     */
    static calculateIsolatedLiquidation({ side, entryPrice, quantity, leverage, walletBalance, symbol }) {
        const notional = entryPrice * quantity;
        const { mmr, maintenanceAmount } = this.getMaintenanceMarginRate(notional, symbol);
        const initialMargin = notional / leverage;
        const balance = walletBalance || initialMargin;

        let liqPrice;
        if (side === 'LONG') {
            // liqPrice = (balance + maintenanceAmount - quantity * entryPrice) / (quantity * (mmr - 1))
            liqPrice = (balance + maintenanceAmount - quantity * entryPrice) / (quantity * (mmr - 1));
            liqPrice = Math.max(0, Math.abs(liqPrice));
        } else {
            // liqPrice = (balance + maintenanceAmount + quantity * entryPrice) / (quantity * (mmr + 1))
            liqPrice = (balance + maintenanceAmount + quantity * entryPrice) / (quantity * (mmr + 1));
        }

        // Bankruptcy price (where loss = initial margin)
        let bankruptcyPrice;
        if (side === 'LONG') {
            bankruptcyPrice = entryPrice * (1 - 1 / leverage);
        } else {
            bankruptcyPrice = entryPrice * (1 + 1 / leverage);
        }

        const currentPrice = entryPrice; // Will be overridden by live data
        const distanceToLiq = currentPrice > 0 ? Math.abs((currentPrice - liqPrice) / currentPrice) * 100 : 0;
        const maintenanceMargin = notional * mmr - maintenanceAmount;

        return {
            liqPrice: Math.max(0, liqPrice),
            bankruptcyPrice: Math.max(0, bankruptcyPrice),
            maintenanceMarginRate: mmr,
            maintenanceMargin: Math.max(0, maintenanceMargin),
            maintenanceAmount,
            initialMargin,
            distanceToLiq,
            notional,
            mode: 'isolated',
        };
    }

    /**
     * Calculate liquidation price for CROSS margin
     * Uses total available balance across all positions
     */
    static calculateCrossLiquidation({ side, entryPrice, quantity, totalWalletBalance, allPositions, symbol }) {
        const notional = entryPrice * quantity;
        const { mmr, maintenanceAmount } = this.getMaintenanceMarginRate(notional, symbol);

        // Sum unrealized PnL from other positions
        const otherPnl = (allPositions || [])
            .filter(p => p.symbol !== symbol && p.status === 'open')
            .reduce((sum, p) => {
                const pPrice = p.currentPrice || p.entryPrice;
                const pnl = p.side === 'LONG'
                    ? (pPrice - p.entryPrice) * p.quantity
                    : (p.entryPrice - pPrice) * p.quantity;
                return sum + pnl;
            }, 0);

        const availableBalance = totalWalletBalance + otherPnl;

        let liqPrice;
        if (side === 'LONG') {
            liqPrice = (availableBalance + maintenanceAmount - quantity * entryPrice) / (quantity * (mmr - 1));
            liqPrice = Math.max(0, Math.abs(liqPrice));
        } else {
            liqPrice = (availableBalance + maintenanceAmount + quantity * entryPrice) / (quantity * (mmr + 1));
        }

        return {
            liqPrice: Math.max(0, liqPrice),
            maintenanceMarginRate: mmr,
            maintenanceAmount,
            availableBalance,
            notional,
            mode: 'cross',
        };
    }

    /**
     * Calculate partial liquidation thresholds
     * When position is too large, exchange liquidates in chunks
     */
    static calculatePartialLiquidation({ quantity, entryPrice, leverage, symbol }) {
        const notional = entryPrice * quantity;
        const tiers = this.getMarginTiers(symbol);

        const thresholds = [];
        let remainingQty = quantity;

        for (let i = tiers.length - 1; i >= 0; i--) {
            if (notional > (i > 0 ? tiers[i - 1].maxNotional : 0)) {
                const tierNotional = Math.min(notional, tiers[i].maxNotional) - (i > 0 ? tiers[i - 1].maxNotional : 0);
                const tierQty = tierNotional / entryPrice;
                thresholds.push({
                    tier: i + 1,
                    mmr: tiers[i].mmr,
                    notionalRange: `${i > 0 ? (tiers[i - 1].maxNotional / 1e6).toFixed(1) : 0}M - ${(tiers[i].maxNotional / 1e6).toFixed(1)}M`,
                    quantity: tierQty,
                    percentOfPosition: (tierQty / quantity) * 100,
                });
            }
        }

        return thresholds;
    }

    /**
     * Estimate ADL (Auto-Deleverage) risk score
     * Higher leverage + higher profit = higher ADL risk
     */
    static calculateADLRisk({ leverage, pnlPercent, side }) {
        // ADL quantile estimation (0-5 light indicator)
        const profitAbs = Math.abs(pnlPercent || 0);
        const leverageScore = Math.min(leverage / 125, 1); // Normalize to 0-1

        let score = 0;
        if (pnlPercent > 0) {
            score = (profitAbs / 100) * 0.4 + leverageScore * 0.6;
        } else {
            score = leverageScore * 0.3;
        }

        const lights = Math.round(score * 5);
        return {
            lights: Math.max(0, Math.min(5, lights)),
            score,
            risk: lights >= 4 ? 'HIGH' : lights >= 2 ? 'MEDIUM' : 'LOW',
        };
    }

    /**
     * Calculate effective liquidation accounting for funding rates
     */
    static adjustForFunding({ liqPrice, fundingRate, hoursHeld, side, leverage }) {
        if (!fundingRate || !hoursHeld) return liqPrice;
        const periodsHeld = hoursHeld / 8; // Funding every 8 hours
        const totalFundingImpact = Math.abs(fundingRate) * periodsHeld * leverage;

        // If paying funding, liquidation is closer
        const payingFunding = (side === 'LONG' && fundingRate > 0) || (side === 'SHORT' && fundingRate < 0);

        if (payingFunding) {
            return side === 'LONG'
                ? liqPrice * (1 + totalFundingImpact)
                : liqPrice * (1 - totalFundingImpact);
        }
        return liqPrice;
    }

    /**
     * Batch calculate liquidations for all open positions
     */
    static batchCalculate(positions, totalWalletBalance) {
        return positions.filter(p => p.status === 'open').map(pos => {
            const isolated = this.calculateIsolatedLiquidation({
                side: pos.side,
                entryPrice: pos.entryPrice,
                quantity: pos.quantity,
                leverage: pos.leverage,
                walletBalance: pos.isolatedMargin,
                symbol: pos.symbol,
            });

            const cross = this.calculateCrossLiquidation({
                side: pos.side,
                entryPrice: pos.entryPrice,
                quantity: pos.quantity,
                totalWalletBalance,
                allPositions: positions,
                symbol: pos.symbol,
            });

            const adl = this.calculateADLRisk({
                leverage: pos.leverage,
                pnlPercent: pos.pnlPercent || 0,
                side: pos.side,
            });

            return {
                symbol: pos.symbol,
                side: pos.side,
                isolated,
                cross,
                adl,
                effectiveLiqPrice: pos.marginMode === 'cross' ? cross.liqPrice : isolated.liqPrice,
            };
        });
    }
}

export default LiqCalculator;
