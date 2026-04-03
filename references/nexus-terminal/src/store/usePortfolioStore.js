import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { FeeEngine } from '../services/portfolio/FeeEngine.js';
import { RiskEngine } from '../services/portfolio/RiskEngine.js';
import { LiqCalculator } from '../services/portfolio/LiqCalculator.js';

/**
 * usePortfolioStore.js — Teralyn v2.0
 *
 * Global state for the portfolio management system:
 *   • Multi-account management (sub-accounts, exchanges)
 *   • Position tracking (open + closed)
 *   • Journal entries linked to trades
 *   • Performance snapshots (daily equity curve)
 *   • Risk limit configuration
 *   • Fund transfer history
 *   • Account notes
 */

const usePortfolioStore = create(
    persist(
        (set, get) => ({
            // ═══ Accounts ═══
            accounts: [
                { id: 'default', name: 'Main Account', exchange: 'binance_futures', balance: 10000, peakEquity: 10000, createdAt: Date.now(), notes: '' },
            ],
            activeAccountId: 'default',

            addAccount: (account) => set(s => ({
                accounts: [...s.accounts, { id: `acc_${Date.now()}`, createdAt: Date.now(), peakEquity: account.balance || 0, notes: '', ...account }]
            })),
            updateAccount: (id, updates) => set(s => ({
                accounts: (s.accounts || []).map(a => a.id === id ? { ...a, ...updates } : a)
            })),
            removeAccount: (id) => set(s => ({
                accounts: (s.accounts || []).filter(a => a.id !== id),
                positions: (s.positions || []).filter(p => p.accountId !== id),
            })),
            setActiveAccount: (id) => set({ activeAccountId: id }),

            // ═══ Positions ═══
            positions: [],
            positionIdCounter: 1,

            addPosition: (position) => set(s => {
                const id = `pos_${s.positionIdCounter}`;
                const entryPrice = position.entryPrice || 0;
                const quantity = position.quantity || 0;
                const leverage = position.leverage || 1;
                const notional = entryPrice * quantity;

                // Compute entry fee via FeeEngine
                const feeResult = FeeEngine.calculateTradeFee({
                    notional,
                    orderType: position.orderType || 'market',
                    vipLevel: 0,
                    useBNB: false,
                });

                // Compute liquidation price via LiqCalculator
                const liqResult = LiqCalculator.calculateIsolatedLiquidation({
                    side: position.side || 'LONG',
                    entryPrice,
                    quantity,
                    leverage,
                    walletBalance: notional / leverage,
                    symbol: position.symbol,
                });

                return {
                    positions: [...s.positions, {
                        id,
                        accountId: s.activeAccountId,
                        status: 'open',
                        createdAt: Date.now(),
                        leverage,
                        marginMode: 'isolated',
                        stopLoss: 0,
                        takeProfit: 0,
                        accumulatedFunding: 0,
                        realizedPnl: 0,
                        notes: '',
                        tags: [],
                        fee: feeResult.fee,
                        feeRate: feeResult.ratePercent,
                        liqPrice: liqResult.liqPrice,
                        bankruptcyPrice: liqResult.bankruptcyPrice,
                        ...position,
                    }],
                    positionIdCounter: s.positionIdCounter + 1,
                };
            }),

            updatePosition: (id, updates) => set(s => ({
                positions: s.positions.map(p => p.id === id ? { ...p, ...updates } : p)
            })),

            closePosition: (id, exitPrice, exitDate) => set(s => {
                const pos = s.positions.find(p => p.id === id);
                if (!pos) return {};
                const grossPnl = pos.side === 'LONG'
                    ? (exitPrice - pos.entryPrice) * pos.quantity
                    : (pos.entryPrice - exitPrice) * pos.quantity;

                // Compute exit fee via FeeEngine
                const exitNotional = exitPrice * pos.quantity;
                const exitFee = FeeEngine.calculateTradeFee({
                    notional: exitNotional,
                    orderType: 'market',
                    vipLevel: 0,
                    useBNB: false,
                });

                const totalFees = (pos.fee || 0) + exitFee.fee;
                const netPnl = grossPnl - (pos.accumulatedFunding || 0) - totalFees;

                return {
                    positions: s.positions.map(p => p.id === id ? {
                        ...p,
                        status: 'closed',
                        exitPrice,
                        exitDate: exitDate || Date.now(),
                        exitFee: exitFee.fee,
                        totalFees,
                        grossPnl,
                        realizedPnl: netPnl,
                    } : p),
                };
            }),

            scalePosition: (id, additionalQty, newPrice) => set(s => {
                const pos = s.positions.find(p => p.id === id);
                if (!pos) return {};
                const totalCost = pos.entryPrice * pos.quantity + newPrice * additionalQty;
                const newQty = pos.quantity + additionalQty;
                return {
                    positions: s.positions.map(p => p.id === id ? {
                        ...p,
                        quantity: newQty,
                        entryPrice: totalCost / newQty,
                    } : p),
                };
            }),

            partialClose: (id, closeQty, exitPrice) => set(s => {
                const pos = s.positions.find(p => p.id === id);
                if (!pos || closeQty >= pos.quantity) return get().closePosition(id, exitPrice);
                const partialPnl = pos.side === 'LONG'
                    ? (exitPrice - pos.entryPrice) * closeQty
                    : (pos.entryPrice - exitPrice) * closeQty;
                return {
                    positions: (s.positions || []).map(p => p.id === id ? {
                        ...p,
                        quantity: p.quantity - closeQty,
                        realizedPnl: (p.realizedPnl || 0) + partialPnl,
                    } : p),
                };
            }),

            removePosition: (id) => set(s => ({
                positions: (s.positions || []).filter(p => p.id !== id)
            })),

            // ═══ Fund Transfers ═══
            transfers: [],
            addTransfer: (transfer) => set(s => ({
                transfers: [...(s.transfers || []), { id: `tf_${Date.now()}`, date: Date.now(), ...transfer }],
                accounts: (s.accounts || []).map(a => {
                    if (a.id === transfer.fromAccountId) return { ...a, balance: a.balance - transfer.amount };
                    if (a.id === transfer.toAccountId) return { ...a, balance: a.balance + transfer.amount };
                    return a;
                }),
            })),

            // ═══ Performance Snapshots ═══
            snapshots: [],
            addSnapshot: (snapshot) => set(s => ({
                snapshots: [...(s.snapshots || []).slice(-365), { date: new Date().toISOString().slice(0, 10), timestamp: Date.now(), ...snapshot }]
            })),

            // ═══ Risk Limits ═══
            riskLimits: {
                maxPositionSize: 5000,
                maxDailyLoss: 500,
                maxOpenPositions: 10,
                maxLeverage: 20,
                maxPortfolioHeat: 10,
                maxSingleSymbolExposure: 3000,
            },
            updateRiskLimits: (limits) => set(s => ({
                riskLimits: { ...s.riskLimits, ...limits }
            })),

            // ═══ Journal ═══
            journalEntries: [],
            addJournalEntry: (entry) => set(s => ({
                journalEntries: [...s.journalEntries, {
                    id: `j_${Date.now()}`,
                    date: new Date().toISOString(),
                    mood: 'neutral',
                    tags: [],
                    ...entry,
                }]
            })),
            updateJournalEntry: (id, updates) => set(s => ({
                journalEntries: (s.journalEntries || []).map(e => e.id === id ? { ...e, ...updates } : e)
            })),
            removeJournalEntry: (id) => set(s => ({
                journalEntries: s.journalEntries.filter(e => e.id !== id)
            })),

            // ═══ Import History ═══
            importHistory: [],
            addImport: (importData) => set(s => ({
                importHistory: [...(s.importHistory || []), { id: `imp_${Date.now()}`, date: Date.now(), ...importData }]
            })),

            /**
             * Parses and injects an array of CSV row objects representing positions.
             * Expected shape: { Symbol: string, Side: string, "Entry Price": string|number, Quantity: string|number, Leverage: string|number }
             */
            importCsvPositions: (rows, targetAccountId) => set(s => {
                const newPositions = [];
                let currentPosId = s.positionIdCounter;

                rows.forEach(row => {
                    // Smart CSV Header Mapping (ignores case and symbols)
                    const getVal = (possibleNames) => {
                        const key = Object.keys(row).find(k => possibleNames.includes(k.toLowerCase().replace(/[^a-z0-9]/g, '')));
                        return key ? row[key] : undefined;
                    };

                    const symbolRaw = getVal(['symbol', 'ticker', 'market', 'contract']);
                    const sideRaw = getVal(['side', 'direction', 'position', 'type', 'action']);
                    const priceRaw = getVal(['entryprice', 'price', 'avgprice', 'openprice']);
                    const qtyRaw = getVal(['quantity', 'qty', 'size', 'amount', 'contracts']);
                    const levRaw = getVal(['leverage', 'lev']);

                    if (!symbolRaw || !priceRaw || !qtyRaw) return; // Skip invalid rows

                    const symbol = String(symbolRaw).toUpperCase().replace(/[^A-Z0-9-]/g, '');
                    const sideStr = String(sideRaw || 'LONG').toUpperCase();
                    const side = (sideStr.includes('SHORT') || sideStr.includes('SELL')) ? 'SHORT' : 'LONG';
                    
                    const entryPrice = parseFloat(String(priceRaw).replace(/[^0-9.-]/g, ''));
                    const quantity = parseFloat(String(qtyRaw).replace(/[^0-9.-]/g, ''));
                    const leverage = parseFloat(String(levRaw || '1').replace(/[^0-9.-]/g, '')) || 1;

                    if (isNaN(entryPrice) || isNaN(quantity)) return;

                    const notional = entryPrice * quantity;
                    const feeResult = FeeEngine.calculateTradeFee({ notional, orderType: 'market', vipLevel: 0, useBNB: false });
                    const liqResult = LiqCalculator.calculateIsolatedLiquidation({
                        side, entryPrice, quantity, leverage, walletBalance: notional / leverage, symbol
                    });

                    newPositions.push({
                        id: `pos_${currentPosId++}`,
                        accountId: targetAccountId || s.activeAccountId,
                        status: 'open',
                        createdAt: Date.now(),
                        symbol,
                        side,
                        entryPrice,
                        quantity,
                        leverage,
                        marginMode: 'isolated',
                        stopLoss: 0,
                        takeProfit: 0,
                        accumulatedFunding: 0,
                        realizedPnl: 0,
                        notes: 'Imported via CSV',
                        tags: ['CSV_IMPORT'],
                        fee: feeResult.fee,
                        feeRate: feeResult.ratePercent,
                        liqPrice: liqResult.liqPrice,
                        bankruptcyPrice: liqResult.bankruptcyPrice,
                    });
                });

                if (newPositions.length === 0) return s;

                return {
                    positions: [...(s.positions || []), ...newPositions],
                    positionIdCounter: currentPosId,
                    importHistory: [...(s.importHistory || []), { id: `imp_${Date.now()}`, date: Date.now(), itemsCount: newPositions.length, accountId: targetAccountId || s.activeAccountId }]
                };
            }),

            // ═══ UI State ═══
            portfolioTab: 'dashboard', // dashboard, positions, journal, performance, risk
            setPortfolioTab: (tab) => set({ portfolioTab: tab }),

            // ═══ Selectors ═══
            getActiveAccount: () => {
                const s = get();
                return s.accounts.find(a => a.id === s.activeAccountId) || s.accounts[0];
            },
            getOpenPositions: (accountId) => {
                const s = get();
                const id = accountId || s.activeAccountId;
                return s.positions.filter(p => p.accountId === id && p.status === 'open');
            },
            getClosedPositions: (accountId) => {
                const s = get();
                const id = accountId || s.activeAccountId;
                return s.positions.filter(p => p.accountId === id && p.status === 'closed');
            },
            getAllOpenPositions: () => get().positions.filter(p => p.status === 'open'),
            getJournalForPosition: (posId) => get().journalEntries.filter(e => e.positionId === posId),

            // ═══ Risk Check (delegates to RiskEngine) ═══
            computeRiskCheck: (proposedTrade) => {
                const s = get();
                const account = s.accounts.find(a => a.id === s.activeAccountId);
                if (!account) return { allowed: true, violations: [] };
                return RiskEngine.enforceRiskLimits({
                    proposedTrade,
                    currentPositions: s.positions,
                    accountBalance: account.balance,
                    riskLimits: s.riskLimits,
                });
            },

            // ═══ Portfolio Heat (delegates to RiskEngine) ═══
            computePortfolioHeat: () => {
                const s = get();
                const account = s.accounts.find(a => a.id === s.activeAccountId);
                if (!account) return { heatPercent: 0, status: 'SAFE', positionRisks: [] };
                return RiskEngine.calculatePortfolioHeat(s.positions, account.balance);
            },
        }),
        {
            name: 'nexus-portfolio-store',
            partialize: (state) => ({
                accounts: state.accounts,
                activeAccountId: state.activeAccountId,
                positions: state.positions,
                positionIdCounter: state.positionIdCounter,
                transfers: state.transfers,
                snapshots: state.snapshots,
                riskLimits: state.riskLimits,
                journalEntries: state.journalEntries,
                importHistory: state.importHistory,
            }),
        }
    )
);

export default usePortfolioStore;
