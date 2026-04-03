/**
 * FeeEngine.js — Teralyn v2.0
 *
 * Comprehensive trading fee calculator:
 *   • Binance-style tiered maker/taker fee schedule (VIP 0-9)
 *   • BNB discount (25% off)
 *   • Funding rate cost estimation
 *   • Slippage estimation based on order size vs depth
 *   • Total cost analysis (fees + funding + slippage)
 *   • Fee impact on breakeven price
 *   • Historical fee tracking
 */

// Binance Futures fee tiers (USDT-M)
const BINANCE_FEE_TIERS = [
    { vip: 0, maker: 0.0200, taker: 0.0400, bnbMaker: 0.0180, bnbTaker: 0.0360, minVolume: 0 },
    { vip: 1, maker: 0.0160, taker: 0.0400, bnbMaker: 0.0144, bnbTaker: 0.0360, minVolume: 15e6 },
    { vip: 2, maker: 0.0140, taker: 0.0350, bnbMaker: 0.0126, bnbTaker: 0.0315, minVolume: 100e6 },
    { vip: 3, maker: 0.0120, taker: 0.0320, bnbMaker: 0.0108, bnbTaker: 0.0288, minVolume: 500e6 },
    { vip: 4, maker: 0.0100, taker: 0.0300, bnbMaker: 0.0090, bnbTaker: 0.0270, minVolume: 1e9 },
    { vip: 5, maker: 0.0080, taker: 0.0270, bnbMaker: 0.0072, bnbTaker: 0.0243, minVolume: 5e9 },
    { vip: 6, maker: 0.0060, taker: 0.0250, bnbMaker: 0.0054, bnbTaker: 0.0225, minVolume: 10e9 },
    { vip: 7, maker: 0.0040, taker: 0.0220, bnbMaker: 0.0036, bnbTaker: 0.0198, minVolume: 25e9 },
    { vip: 8, maker: 0.0020, taker: 0.0200, bnbMaker: 0.0018, bnbTaker: 0.0180, minVolume: 50e9 },
    { vip: 9, maker: 0.0000, taker: 0.0170, bnbMaker: 0.0000, bnbTaker: 0.0153, minVolume: 100e9 },
];

export class FeeEngine {
    /**
     * Get fee rates for a given VIP level
     * @param {number} vipLevel - 0-9
     * @param {boolean} useBNB - Whether BNB discount is active
     */
    static getFeeRates(vipLevel = 0, useBNB = false) {
        const tier = BINANCE_FEE_TIERS[Math.min(vipLevel, 9)];
        return {
            maker: useBNB ? tier.bnbMaker : tier.maker,
            taker: useBNB ? tier.bnbTaker : tier.taker,
            vip: tier.vip,
        };
    }

    /**
     * Calculate fee for a single trade
     * @param {Object} params
     * @returns {Object} Fee breakdown
     */
    static calculateTradeFee({ notional, orderType = 'market', vipLevel = 0, useBNB = false }) {
        const rates = this.getFeeRates(vipLevel, useBNB);
        const rate = orderType === 'limit' ? rates.maker : rates.taker;
        const fee = notional * (rate / 100);

        return {
            fee,
            rate,
            ratePercent: rate,
            orderType,
            notional,
            useBNB,
            vipLevel,
        };
    }

    /**
     * Calculate round-trip (open + close) fee
     */
    static calculateRoundTripFee({ entryPrice, exitPrice, quantity, entryType = 'market', exitType = 'limit', vipLevel = 0, useBNB = false }) {
        const entryNotional = entryPrice * quantity;
        const exitNotional = exitPrice * quantity;

        const entryFee = this.calculateTradeFee({ notional: entryNotional, orderType: entryType, vipLevel, useBNB });
        const exitFee = this.calculateTradeFee({ notional: exitNotional, orderType: exitType, vipLevel, useBNB });

        const totalFee = entryFee.fee + exitFee.fee;
        const feeAsPercentOfPnl = exitPrice !== entryPrice
            ? (totalFee / Math.abs((exitPrice - entryPrice) * quantity)) * 100
            : 0;

        return {
            entryFee,
            exitFee,
            totalFee,
            feeAsPercentOfPnl,
            breakEvenTicks: totalFee / quantity,
        };
    }

    /**
     * Estimate funding cost over a holding period
     * @param {number} fundingRate - Current 8h funding rate (e.g., 0.0001 = 0.01%)
     * @param {number} notional - Position notional value
     * @param {number} hoursHeld - Expected holding period in hours
     * @param {string} side - 'LONG' or 'SHORT'
     */
    static estimateFundingCost({ fundingRate, notional, hoursHeld, side }) {
        const periodsHeld = hoursHeld / 8;
        const costPerPeriod = notional * Math.abs(fundingRate);
        const totalCost = costPerPeriod * periodsHeld;

        // Long pays positive funding, short pays negative funding
        const isPayingFunding = (side === 'LONG' && fundingRate > 0) || (side === 'SHORT' && fundingRate < 0);
        const annualizedRate = Math.abs(fundingRate) * 3 * 365 * 100; // 3 periods/day * 365 days

        return {
            costPerPeriod,
            totalCost: isPayingFunding ? totalCost : -totalCost,
            periodsHeld,
            isPayingFunding,
            annualizedRate,
            dailyCost: costPerPeriod * 3,
        };
    }

    /**
     * Estimate slippage based on order size relative to typical depth
     * Uses a simple model: slippage increases quadratically with order size
     */
    static estimateSlippage({ notional, averageDailyVolume, side }) {
        if (!averageDailyVolume || averageDailyVolume === 0) return { slippageBps: 0, slippageCost: 0 };

        const orderToVolumeRatio = notional / averageDailyVolume;
        // Empirical model: ~1bp per 0.1% of daily volume, quadratic
        const slippageBps = Math.min(50, orderToVolumeRatio * 1000 * (1 + orderToVolumeRatio * 100));
        const slippageCost = notional * (slippageBps / 10000);

        return {
            slippageBps: Math.round(slippageBps * 100) / 100,
            slippageCost,
            orderToVolumeRatio,
            severity: slippageBps < 1 ? 'LOW' : slippageBps < 5 ? 'MEDIUM' : 'HIGH',
        };
    }

    /**
     * Complete cost analysis for a trade
     * Combines fees + funding + slippage
     */
    static completeCostAnalysis({
        entryPrice, exitPrice, quantity, side,
        entryType = 'market', exitType = 'limit',
        vipLevel = 0, useBNB = false,
        fundingRate = 0, hoursHeld = 24,
        averageDailyVolume = 1e9,
    }) {
        const notional = entryPrice * quantity;
        const roundTrip = this.calculateRoundTripFee({ entryPrice, exitPrice, quantity, entryType, exitType, vipLevel, useBNB });
        const funding = this.estimateFundingCost({ fundingRate, notional, hoursHeld, side });
        const slippage = this.estimateSlippage({ notional, averageDailyVolume, side });

        const grossPnl = side === 'LONG'
            ? (exitPrice - entryPrice) * quantity
            : (entryPrice - exitPrice) * quantity;

        const totalCosts = roundTrip.totalFee + Math.max(0, funding.totalCost) + slippage.slippageCost;
        const netPnl = grossPnl - totalCosts;
        const costAsPctOfNotional = (totalCosts / notional) * 100;

        // Breakeven price accounting for all costs
        const costPerUnit = totalCosts / quantity;
        const breakEvenPrice = side === 'LONG'
            ? entryPrice + costPerUnit
            : entryPrice - costPerUnit;

        return {
            grossPnl,
            netPnl,
            totalCosts,
            costBreakdown: {
                tradingFees: roundTrip.totalFee,
                fundingCost: Math.max(0, funding.totalCost),
                slippageCost: slippage.slippageCost,
            },
            costAsPctOfNotional,
            breakEvenPrice,
            roundTrip,
            funding,
            slippage,
            netReturnPct: notional > 0 ? (netPnl / (notional / (exitPrice / entryPrice))) * 100 : 0,
        };
    }

    /**
     * Calculate fee savings from upgrading VIP tier
     */
    static calculateVIPSavings({ monthlyVolume, currentVIP = 0 }) {
        const currentRates = this.getFeeRates(currentVIP, false);
        const results = [];

        for (let vip = currentVIP + 1; vip <= 9; vip++) {
            const tier = BINANCE_FEE_TIERS[vip];
            if (monthlyVolume >= tier.minVolume) continue;
            const newRates = this.getFeeRates(vip, false);
            const monthlySavings = monthlyVolume * ((currentRates.taker - newRates.taker) / 100);
            results.push({
                vip,
                requiredVolume: tier.minVolume,
                newTakerRate: newRates.taker,
                monthlySavings,
                annualSavings: monthlySavings * 12,
            });
        }

        return results;
    }
}

export default FeeEngine;
