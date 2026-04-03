/**
 * PortfolioComputeContext.js — Teralyn v2.0
 *
 * Central computation context for portfolio analytics.
 * Provides real-time P&L, margin, exposure, and risk calculations
 * across all accounts and positions.
 *
 * Responsibilities:
 *   • Aggregate portfolio metrics (total equity, unrealized PnL, realized PnL)
 *   • Position-level mark-to-market with live prices
 *   • Multi-account consolidation
 *   • Margin utilization tracking
 *   • Portfolio heat (% of capital at risk)
 *   • Daily/weekly/monthly performance snapshots
 *   • Drawdown tracking (max drawdown, current drawdown)
 */

export class PortfolioComputeContext {
    constructor() {
        this.priceCache = {};
        this.fundingRateCache = {};
    }

    /**
     * Update live price cache from market data feed
     */
    updatePrices(prices) {
        this.priceCache = { ...this.priceCache, ...prices };
    }

    updateFundingRates(rates) {
        this.fundingRateCache = { ...this.fundingRateCache, ...rates };
    }

    /**
     * Compute full portfolio snapshot
     * @param {Array} accounts - Array of account objects
     * @param {Array} positions - Array of position objects
     * @returns {Object} Complete portfolio metrics
     */
    computeSnapshot(accounts, positions) {
        const accountMetrics = accounts.map(acc => this.computeAccountMetrics(acc, positions.filter(p => p.accountId === acc.id)));
        const totalEquity = accountMetrics.reduce((s, a) => s + a.equity, 0);
        const totalUnrealizedPnl = accountMetrics.reduce((s, a) => s + a.unrealizedPnl, 0);
        const totalRealizedPnl = accountMetrics.reduce((s, a) => s + a.realizedPnl, 0);
        const totalMarginUsed = accountMetrics.reduce((s, a) => s + a.marginUsed, 0);
        const totalNotional = accountMetrics.reduce((s, a) => s + a.totalNotional, 0);
        const openPositionCount = positions.filter(p => p.status === 'open').length;

        // Portfolio-wide drawdown
        const peakEquity = Math.max(totalEquity, ...accountMetrics.map(a => a.peakEquity || a.equity));
        const currentDrawdown = peakEquity > 0 ? ((peakEquity - totalEquity) / peakEquity) * 100 : 0;

        // Exposure breakdown by direction
        const longExposure = positions.filter(p => p.status === 'open' && p.side === 'LONG')
            .reduce((s, p) => s + this.getNotional(p), 0);
        const shortExposure = positions.filter(p => p.status === 'open' && p.side === 'SHORT')
            .reduce((s, p) => s + this.getNotional(p), 0);
        const netExposure = longExposure - shortExposure;
        const grossExposure = longExposure + shortExposure;

        // Sector exposure
        const sectorExposure = this.computeSectorExposure(positions);

        // Correlation risk (simplified — number of highly correlated positions)
        const correlationRisk = this.estimateCorrelationRisk(positions);

        return {
            totalEquity,
            totalUnrealizedPnl,
            totalRealizedPnl,
            totalMarginUsed,
            totalNotional,
            openPositionCount,
            accountCount: accounts.length,
            accountMetrics,
            peakEquity,
            currentDrawdown,
            maxDrawdown: Math.max(currentDrawdown, 0),
            longExposure,
            shortExposure,
            netExposure,
            grossExposure,
            leverageRatio: totalEquity > 0 ? grossExposure / totalEquity : 0,
            marginUtilization: totalEquity > 0 ? (totalMarginUsed / totalEquity) * 100 : 0,
            sectorExposure,
            correlationRisk,
            timestamp: Date.now(),
        };
    }

    /**
     * Compute metrics for a single account
     */
    computeAccountMetrics(account, positions) {
        const openPositions = positions.filter(p => p.status === 'open');
        const closedPositions = positions.filter(p => p.status === 'closed');

        let unrealizedPnl = 0;
        let marginUsed = 0;
        let totalNotional = 0;

        for (const pos of openPositions) {
            const pnl = this.computePositionPnl(pos);
            unrealizedPnl += pnl.unrealizedPnl;
            marginUsed += pnl.margin;
            totalNotional += pnl.notional;
        }

        const realizedPnl = closedPositions.reduce((s, p) => s + (p.realizedPnl || 0), 0);
        const equity = (account.balance || 0) + unrealizedPnl;

        // Win/loss stats
        const wins = closedPositions.filter(p => (p.realizedPnl || 0) > 0);
        const losses = closedPositions.filter(p => (p.realizedPnl || 0) < 0);
        const winRate = closedPositions.length > 0 ? (wins.length / closedPositions.length) * 100 : 0;
        const avgWin = wins.length > 0 ? wins.reduce((s, p) => s + p.realizedPnl, 0) / wins.length : 0;
        const avgLoss = losses.length > 0 ? Math.abs(losses.reduce((s, p) => s + p.realizedPnl, 0) / losses.length) : 0;
        const profitFactor = avgLoss > 0 ? avgWin / avgLoss : avgWin > 0 ? Infinity : 0;
        const expectancy = closedPositions.length > 0 ? (winRate / 100 * avgWin) - ((1 - winRate / 100) * avgLoss) : 0;

        return {
            accountId: account.id,
            accountName: account.name,
            balance: account.balance || 0,
            equity,
            unrealizedPnl,
            realizedPnl,
            marginUsed,
            totalNotional,
            openPositionCount: openPositions.length,
            closedTradeCount: closedPositions.length,
            winRate,
            avgWin,
            avgLoss,
            profitFactor,
            expectancy,
            peakEquity: Math.max(equity, account.peakEquity || 0),
            availableMargin: equity - marginUsed,
            marginUtilization: equity > 0 ? (marginUsed / equity) * 100 : 0,
        };
    }

    /**
     * Compute P&L for a single position
     */
    computePositionPnl(position) {
        const currentPrice = this.priceCache[position.symbol]?.price || position.entryPrice;
        const qty = position.quantity || 0;
        const entry = position.entryPrice || 0;
        const leverage = position.leverage || 1;
        const notional = currentPrice * qty;
        const margin = notional / leverage;

        let unrealizedPnl = 0;
        if (position.side === 'LONG') {
            unrealizedPnl = (currentPrice - entry) * qty;
        } else {
            unrealizedPnl = (entry - currentPrice) * qty;
        }

        // Subtract accumulated funding
        const fundingPaid = position.accumulatedFunding || 0;
        unrealizedPnl -= fundingPaid;

        const pnlPercent = entry > 0 ? (unrealizedPnl / (entry * qty)) * 100 : 0;
        const roe = margin > 0 ? (unrealizedPnl / margin) * 100 : 0;

        // Distance to liquidation
        const liqPrice = this.computeLiquidationPrice(position);
        const distToLiq = currentPrice > 0 ? Math.abs((currentPrice - liqPrice) / currentPrice) * 100 : 0;

        return {
            symbol: position.symbol,
            side: position.side,
            entryPrice: entry,
            currentPrice,
            quantity: qty,
            notional,
            margin,
            leverage,
            unrealizedPnl,
            pnlPercent,
            roe,
            liqPrice,
            distToLiq,
            fundingPaid,
        };
    }

    /**
     * Simplified liquidation price calculation
     */
    computeLiquidationPrice(position) {
        const { entryPrice, leverage, side } = position;
        if (!entryPrice || !leverage) return 0;
        const maintenanceMarginRate = 0.004; // 0.4% typical
        if (side === 'LONG') {
            return entryPrice * (1 - (1 / leverage) + maintenanceMarginRate);
        } else {
            return entryPrice * (1 + (1 / leverage) - maintenanceMarginRate);
        }
    }

    getNotional(position) {
        const price = this.priceCache[position.symbol]?.price || position.entryPrice || 0;
        return price * (position.quantity || 0);
    }

    computeSectorExposure(positions) {
        const SECTORS = {
            BTCUSDT: 'L1', ETHUSDT: 'L1', SOLUSDT: 'L1', ADAUSDT: 'L1', DOTUSDT: 'L1', AVAXUSDT: 'L1',
            MATICUSDT: 'L2', ARBUSDT: 'L2', OPUSDT: 'L2',
            UNIUSDT: 'DeFi', AAVEUSDT: 'DeFi', MKRUSDT: 'DeFi',
            DOGEUSDT: 'Meme', SHIBUSDT: 'Meme', PEPEUSDT: 'Meme',
            LINKUSDT: 'Infra', FILUSDT: 'Infra',
        };
        const groups = {};
        for (const p of positions.filter(p => p.status === 'open')) {
            const sector = SECTORS[p.symbol] || 'Other';
            groups[sector] = (groups[sector] || 0) + this.getNotional(p);
        }
        return groups;
    }

    estimateCorrelationRisk(positions) {
        const openSymbols = [...new Set(positions.filter(p => p.status === 'open').map(p => p.symbol))];
        // Simplified: high correlation risk if >5 positions in same sector
        const sectorCounts = {};
        for (const sym of openSymbols) {
            const sector = this.computeSectorExposure([{ symbol: sym, status: 'open', quantity: 1, entryPrice: 1 }]);
            const key = Object.keys(sector)[0] || 'Other';
            sectorCounts[key] = (sectorCounts[key] || 0) + 1;
        }
        const maxConcentration = Math.max(...Object.values(sectorCounts), 0);
        return maxConcentration >= 5 ? 'HIGH' : maxConcentration >= 3 ? 'MEDIUM' : 'LOW';
    }

    /**
     * Generate daily performance snapshot
     */
    generateDailySnapshot(accounts, positions) {
        const snapshot = this.computeSnapshot(accounts, positions);
        return {
            date: new Date().toISOString().slice(0, 10),
            equity: snapshot.totalEquity,
            unrealizedPnl: snapshot.totalUnrealizedPnl,
            realizedPnl: snapshot.totalRealizedPnl,
            openPositions: snapshot.openPositionCount,
            drawdown: snapshot.currentDrawdown,
            leverageRatio: snapshot.leverageRatio,
            marginUtilization: snapshot.marginUtilization,
            longExposure: snapshot.longExposure,
            shortExposure: snapshot.shortExposure,
            timestamp: Date.now(),
        };
    }
}

export default new PortfolioComputeContext();
