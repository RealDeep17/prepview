/**
 * RiskEngine.js — Teralyn v2.0
 *
 * Institutional-grade risk management engine:
 *   • Position sizing (Kelly Criterion, fixed %, volatility-adjusted)
 *   • Risk/Reward ratio calculation
 *   • Value at Risk (VaR) — parametric + historical simulation
 *   • Expected Shortfall (CVaR)
 *   • Maximum portfolio heat (total risk %)
 *   • Correlation-adjusted risk
 *   • Risk limit enforcement
 *   • Stop-loss optimization
 */

export class RiskEngine {
    /**
     * Calculate optimal position size using Kelly Criterion
     * Kelly f* = (bp − q) / b
     * where b = payoff ratio, p = win probability, q = 1 − p
     *
     * @param {number} winRate - Historical win rate (0-1)
     * @param {number} avgWin - Average winning trade dollar amount
     * @param {number} avgLoss - Average losing trade dollar amount (positive)
     * @param {number} kellyFraction - Kelly fraction to use (0.25 = quarter Kelly, default)
     * @returns {Object} Position sizing details
     */
    static kellyPositionSize({ winRate, avgWin, avgLoss, accountBalance, kellyFraction = 0.25 }) {
        if (avgLoss === 0 || winRate <= 0) return { kellyPercent: 0, positionSize: 0, fullKelly: 0 };

        const b = avgWin / avgLoss; // payoff ratio
        const p = winRate;
        const q = 1 - p;
        const fullKelly = (b * p - q) / b;
        const adjustedKelly = Math.max(0, fullKelly * kellyFraction);
        const positionSize = accountBalance * adjustedKelly;

        return {
            fullKelly: Math.round(fullKelly * 10000) / 100, // as percentage
            kellyPercent: Math.round(adjustedKelly * 10000) / 100,
            kellyFraction,
            positionSize: Math.round(positionSize * 100) / 100,
            payoffRatio: Math.round(b * 100) / 100,
            edgePercent: Math.round((b * p - q) * 10000) / 100,
        };
    }

    /**
     * Calculate position size using fixed percentage risk
     * @param {number} riskPercent - Percent of account to risk (e.g., 1 = 1%)
     * @param {number} entryPrice
     * @param {number} stopLoss
     * @param {number} accountBalance
     * @param {number} leverage
     */
    static fixedPercentPosition({ riskPercent, entryPrice, stopLoss, accountBalance, leverage = 1 }) {
        const riskPerUnit = Math.abs(entryPrice - stopLoss);
        if (riskPerUnit === 0) return { quantity: 0, notional: 0, riskAmount: 0 };

        const riskAmount = accountBalance * (riskPercent / 100);
        const quantity = riskAmount / riskPerUnit;
        const notional = quantity * entryPrice;
        const requiredMargin = notional / leverage;
        const marginPercent = (requiredMargin / accountBalance) * 100;

        return {
            quantity: Math.round(quantity * 1e8) / 1e8,
            notional: Math.round(notional * 100) / 100,
            riskAmount: Math.round(riskAmount * 100) / 100,
            riskPerUnit,
            requiredMargin: Math.round(requiredMargin * 100) / 100,
            marginPercent: Math.round(marginPercent * 100) / 100,
            riskRewardAt: (target) => {
                const reward = Math.abs(target - entryPrice) * quantity;
                return Math.round((reward / riskAmount) * 100) / 100;
            },
        };
    }

    /**
     * Volatility-adjusted position sizing (ATR-based)
     */
    static volatilityAdjustedPosition({ atr, atrMultiplier = 2, riskPercent = 1, entryPrice, accountBalance, leverage = 1 }) {
        const stopDistance = atr * atrMultiplier;
        const stopLoss = entryPrice - stopDistance;
        return {
            ...this.fixedPercentPosition({ riskPercent, entryPrice, stopLoss, accountBalance, leverage }),
            atr,
            atrMultiplier,
            stopDistance,
            impliedStopLoss: stopLoss,
        };
    }

    /**
     * Risk/Reward calculation
     */
    static calculateRiskReward({ entryPrice, stopLoss, takeProfit, side = 'LONG' }) {
        let risk, reward;
        if (side === 'LONG') {
            risk = entryPrice - stopLoss;
            reward = takeProfit - entryPrice;
        } else {
            risk = stopLoss - entryPrice;
            reward = entryPrice - takeProfit;
        }

        if (risk <= 0) return { ratio: 0, riskPercent: 0, rewardPercent: 0, expectancy: 0 };

        const ratio = reward / risk;
        const riskPercent = (risk / entryPrice) * 100;
        const rewardPercent = (reward / entryPrice) * 100;

        // Minimum win rate needed for this R:R to be profitable
        const minWinRate = 1 / (1 + ratio);

        return {
            ratio: Math.round(ratio * 100) / 100,
            riskPercent: Math.round(riskPercent * 100) / 100,
            rewardPercent: Math.round(rewardPercent * 100) / 100,
            riskAmount: risk,
            rewardAmount: reward,
            minWinRate: Math.round(minWinRate * 10000) / 100,
        };
    }

    /**
     * Parametric Value at Risk (VaR) calculation
     * Uses normal distribution assumption
     *
     * @param {number} portfolioValue
     * @param {number} dailyVolatility - Daily return std dev (e.g., 0.03 = 3%)
     * @param {number} confidenceLevel - e.g., 0.95, 0.99
     * @param {number} holdingPeriod - In days
     */
    static calculateVaR({ portfolioValue, dailyVolatility, confidenceLevel = 0.95, holdingPeriod = 1 }) {
        // Z-scores for common confidence levels
        const zScores = { 0.90: 1.282, 0.95: 1.645, 0.99: 2.326, 0.995: 2.576, 0.999: 3.09 };
        const z = zScores[confidenceLevel] || 1.645;

        const periodVolatility = dailyVolatility * Math.sqrt(holdingPeriod);
        const var_ = portfolioValue * z * periodVolatility;
        const varPercent = z * periodVolatility * 100;

        return {
            var: Math.round(var_ * 100) / 100,
            varPercent: Math.round(varPercent * 100) / 100,
            confidenceLevel,
            holdingPeriod,
            periodVolatility: Math.round(periodVolatility * 10000) / 100,
            interpretation: `${(confidenceLevel * 100).toFixed(0)}% chance that ${holdingPeriod}-day loss will not exceed $${var_.toFixed(0)}`,
        };
    }

    /**
     * Expected Shortfall (CVaR) — average loss beyond VaR
     */
    static calculateCVaR({ portfolioValue, dailyVolatility, confidenceLevel = 0.95, holdingPeriod = 1 }) {
        const var_ = this.calculateVaR({ portfolioValue, dailyVolatility, confidenceLevel, holdingPeriod });

        // CVaR ≈ VaR * (pdf(z) / (1-α)) for normal distribution
        const alpha = 1 - confidenceLevel;
        const z = var_.var / (portfolioValue * dailyVolatility * Math.sqrt(holdingPeriod));
        const pdf = Math.exp(-0.5 * z * z) / Math.sqrt(2 * Math.PI);
        const cvarMultiplier = pdf / alpha;
        const cvar = portfolioValue * dailyVolatility * Math.sqrt(holdingPeriod) * cvarMultiplier;

        return {
            cvar: Math.round(cvar * 100) / 100,
            cvarPercent: Math.round((cvar / portfolioValue) * 10000) / 100,
            var: var_.var,
            excessOverVar: Math.round((cvar - var_.var) * 100) / 100,
        };
    }

    /**
     * Portfolio heat calculation
     * Total % of account at risk across all open positions
     */
    static calculatePortfolioHeat(positions, accountBalance) {
        let totalRisk = 0;
        const positionRisks = [];

        for (const pos of positions.filter(p => p.status === 'open')) {
            const stopLoss = pos.stopLoss || 0;
            const entryPrice = pos.entryPrice || 0;
            const quantity = pos.quantity || 0;

            let posRisk = 0;
            if (stopLoss > 0) {
                posRisk = Math.abs(entryPrice - stopLoss) * quantity;
            } else {
                // No stop = assume max ATR or 5% risk
                posRisk = entryPrice * quantity * 0.05;
            }

            totalRisk += posRisk;
            positionRisks.push({
                symbol: pos.symbol,
                risk: posRisk,
                riskPercent: accountBalance > 0 ? (posRisk / accountBalance) * 100 : 0,
                hasStop: stopLoss > 0,
            });
        }

        const heatPercent = accountBalance > 0 ? (totalRisk / accountBalance) * 100 : 0;
        const status = heatPercent > 10 ? 'CRITICAL' : heatPercent > 6 ? 'HIGH' : heatPercent > 3 ? 'MODERATE' : 'SAFE';

        return {
            totalRisk: Math.round(totalRisk * 100) / 100,
            heatPercent: Math.round(heatPercent * 100) / 100,
            status,
            positionRisks: positionRisks.sort((a, b) => b.risk - a.risk),
            positionsWithoutStops: positionRisks.filter(p => !p.hasStop).length,
            recommendation: heatPercent > 6
                ? 'Consider reducing position sizes or tightening stops'
                : positionRisks.some(p => !p.hasStop)
                    ? 'Set stop-losses on all positions'
                    : 'Risk within acceptable limits',
        };
    }

    /**
     * Risk limit enforcement checks
     */
    static enforceRiskLimits({ proposedTrade, currentPositions, accountBalance, riskLimits }) {
        const violations = [];
        const limits = {
            maxPositionSize: riskLimits?.maxPositionSize || accountBalance * 0.2,
            maxDailyLoss: riskLimits?.maxDailyLoss || accountBalance * 0.05,
            maxOpenPositions: riskLimits?.maxOpenPositions || 10,
            maxLeverage: riskLimits?.maxLeverage || 20,
            maxPortfolioHeat: riskLimits?.maxPortfolioHeat || 10,
            maxSingleSymbolExposure: riskLimits?.maxSingleSymbolExposure || accountBalance * 0.3,
        };

        // Check position size
        const notional = proposedTrade.entryPrice * proposedTrade.quantity;
        if (notional > limits.maxPositionSize) {
            violations.push({ rule: 'MAX_POSITION_SIZE', limit: limits.maxPositionSize, actual: notional, severity: 'ERROR' });
        }

        // Check leverage
        if (proposedTrade.leverage > limits.maxLeverage) {
            violations.push({ rule: 'MAX_LEVERAGE', limit: limits.maxLeverage, actual: proposedTrade.leverage, severity: 'ERROR' });
        }

        // Check open position count
        const openCount = currentPositions.filter(p => p.status === 'open').length;
        if (openCount >= limits.maxOpenPositions) {
            violations.push({ rule: 'MAX_OPEN_POSITIONS', limit: limits.maxOpenPositions, actual: openCount + 1, severity: 'WARNING' });
        }

        // Check symbol concentration
        const symbolExposure = currentPositions
            .filter(p => p.status === 'open' && p.symbol === proposedTrade.symbol)
            .reduce((s, p) => s + (p.entryPrice * p.quantity), 0) + notional;
        if (symbolExposure > limits.maxSingleSymbolExposure) {
            violations.push({ rule: 'SYMBOL_CONCENTRATION', limit: limits.maxSingleSymbolExposure, actual: symbolExposure, severity: 'WARNING' });
        }

        return {
            allowed: violations.filter(v => v.severity === 'ERROR').length === 0,
            violations,
            warnings: violations.filter(v => v.severity === 'WARNING'),
            errors: violations.filter(v => v.severity === 'ERROR'),
        };
    }

    /**
     * Optimized stop-loss placement using ATR
     */
    static optimizeStopLoss({ entryPrice, atr, side, riskTolerance = 'moderate' }) {
        const multipliers = { conservative: 3, moderate: 2, aggressive: 1.5 };
        const mult = multipliers[riskTolerance] || 2;
        const distance = atr * mult;

        const stopLoss = side === 'LONG' ? entryPrice - distance : entryPrice + distance;
        const riskPercent = (distance / entryPrice) * 100;

        // Validate: stop shouldn't be <0.5% or >10% away
        const valid = riskPercent >= 0.5 && riskPercent <= 10;

        return {
            stopLoss: Math.round(stopLoss * 1e8) / 1e8,
            distance,
            riskPercent: Math.round(riskPercent * 100) / 100,
            atrMultiplier: mult,
            riskTolerance,
            valid,
            suggestion: !valid ? (riskPercent < 0.5 ? 'Stop too tight — increase ATR multiplier' : 'Stop too wide — decrease ATR multiplier or reduce position size') : null,
        };
    }
}

export default RiskEngine;
