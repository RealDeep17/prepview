import React, { useState, useCallback, useMemo, useEffect } from 'react';
import usePortfolioStore from '../../store/usePortfolioStore.js';
import useChartStore from '../../store/useChartStore.js';
import useMarketStore from '../../store/useMarketStore.js';
import RiskEngine from '../../services/portfolio/RiskEngine.js';
import { Target, TrendingUp, TrendingDown, DollarSign, Percent, ShieldAlert, Activity, Crosshair, HelpCircle } from 'lucide-react';

/**
 * AddPositionModal.jsx — Teralyn v2.0
 * Institutional synthetics order entry form with real-time risk simulation, 
 * dynamic margin profiling, R:R calculation grids, and leverage stress tests.
 */

export default function AddPositionModal({ isOpen, onClose }) {
    const { addPosition, getActiveAccount } = usePortfolioStore();
    const currentSymbol = useChartStore(s => s.symbol);
    const prices = useMarketStore(s => s.prices);

    // Context Account
    const account = getActiveAccount();

    // Primary Execution Form
    const [form, setForm] = useState({
        symbol: currentSymbol || 'BTCUSDT',
        side: 'LONG',
        entryPrice: '',
        quantity: '',
        leverage: 10,
        marginMode: 'isolated',
        stopLoss: '',
        takeProfit: '',
        notes: '',
        type: 'LIMIT'
    });

    const [isSimulating, setIsSimulating] = useState(false);

    // Sync active symbol on mount if missing
    useEffect(() => {
        if (isOpen && currentSymbol && form.symbol !== currentSymbol) {
            setForm(f => ({ ...f, symbol: currentSymbol }));
        }
    }, [isOpen, currentSymbol, form.symbol]);

    const currentPrice = prices[form.symbol]?.price;

    const autoFill = useCallback(() => {
        if (currentPrice) {
            setForm(f => ({ ...f, entryPrice: currentPrice.toString(), type: 'MARKET' }));
        }
    }, [currentPrice]);

    // Risk & Capacity Simulation Matrix
    const sim = useMemo(() => {
        const entry = parseFloat(form.entryPrice) || 0;
        const sl = parseFloat(form.stopLoss) || 0;
        const tp = parseFloat(form.takeProfit) || 0;
        const qty = parseFloat(form.quantity) || 0;
        const balance = account?.balance || 0;

        if (!entry || !qty) return { isValid: false };

        const notional = entry * qty;
        const marginReq = notional / (form.leverage || 1);
        const marginPct = balance > 0 ? (marginReq / balance) * 100 : 0;
        const isExhausted = marginReq > balance;

        let rr = null;
        let riskAmt = 0;
        let pnlAtTp = 0;
        
        const isLong = form.side === 'LONG';

        if (sl > 0) {
            const riskDist = isLong ? (entry - sl) : (sl - entry);
            riskAmt = Math.max(0, riskDist * qty);
        }
        
        if (tp > 0) {
            const rewardDist = isLong ? (tp - entry) : (entry - tp);
            pnlAtTp = Math.max(0, rewardDist * qty);
        }

        if (sl > 0 && tp > 0) {
            rr = RiskEngine.calculateRiskReward({ entryPrice: entry, stopLoss: sl, takeProfit: tp, side: form.side });
        }

        const riskPct = balance > 0 ? (riskAmt / balance) * 100 : 0;
        const rewardPct = balance > 0 ? (pnlAtTp / balance) * 100 : 0;

        return { 
            isValid: true,
            notional, 
            marginReq, 
            marginPct, 
            isExhausted,
            rr, 
            riskAmt, 
            riskPct,
            pnlAtTp,
            rewardPct,
            liquidationDist: (1 / form.leverage) * 100 // Approximation
        };
    }, [form, account]);

    const handleSubmit = useCallback(() => {
        const entry = parseFloat(form.entryPrice);
        const qty = parseFloat(form.quantity);
        if (!entry || !qty || sim.isExhausted) return;

        setIsSimulating(true);

        // Simulate network latency for dramatic effect
        setTimeout(() => {
            addPosition({
                symbol: form.symbol,
                side: form.side,
                entryPrice: entry,
                quantity: qty,
                leverage: form.leverage,
                marginMode: form.marginMode,
                stopLoss: parseFloat(form.stopLoss) || 0,
                takeProfit: parseFloat(form.takeProfit) || 0,
                notes: form.notes,
            });
            setIsSimulating(false);
            onClose();
        }, 600);
    }, [form, addPosition, onClose, sim.isExhausted]);

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 z-[600] flex items-center justify-center font-sans" onClick={onClose}>
            <div className="absolute inset-0 bg-black/80 backdrop-blur-sm" />
            
            <div 
                className="relative w-[800px] h-[650px] flex overflow-hidden bg-bg-app border border-bg-border rounded-xl shadow-[0_0_60px_rgba(0,0,0,0.8)] animate-in fade-in zoom-in-95 duration-200" 
                onClick={e => e.stopPropagation()}
            >
                {/* Left Side: Order Form */}
                <div className="flex-1 flex flex-col border-r border-bg-hover bg-[#161a25]">
                    
                    {/* Header */}
                    <div className="flex justify-between items-center px-6 py-4 border-b border-bg-hover bg-[#1a1e28] shrink-0">
                        <div className="flex items-center gap-3">
                            <div className="w-8 h-8 rounded bg-tv-blue/10 flex items-center justify-center border border-tv-blue/20 text-tv-blue">
                                <Target size={16}/>
                            </div>
                            <div>
                                <h3 className="text-[13px] font-bold text-white uppercase tracking-widest">Order Terminal</h3>
                                <p className="text-[10px] text-text-muted">Network Node: {account?.name || 'Local Paper'}</p>
                            </div>
                        </div>
                    </div>

                    {/* Scrollable Form Body */}
                    <div className="flex-1 overflow-y-auto no-scrollbar p-6 space-y-6">
                        
                        {/* Primary Identity Group */}
                        <div className="flex gap-4">
                            <div className="w-1/3">
                                <label className="text-[10px] text-text-muted uppercase font-bold tracking-widest mb-1.5 block">Asset Pair</label>
                                <input 
                                    value={form.symbol} 
                                    onChange={e => setForm(f => ({ ...f, symbol: e.target.value.toUpperCase() }))}
                                    className="w-full bg-bg-panel border border-bg-border text-white font-bold text-[13px] rounded px-3 py-2 outline-none focus:border-tv-blue transition-colors uppercase tracking-wider shadow-inner" 
                                />
                            </div>
                            
                            <div className="flex-1">
                                <label className="text-[10px] text-text-muted uppercase font-bold tracking-widest mb-1.5 block">Order Side Vector</label>
                                <div className="flex bg-bg-panel rounded p-1 border border-bg-border">
                                    <button 
                                        onClick={() => setForm(f => ({ ...f, side: 'LONG' }))}
                                        className={`flex-1 py-1.5 text-[11px] uppercase tracking-widest font-bold rounded transition-colors flex justify-center items-center gap-2
                                            ${form.side === 'LONG' ? 'bg-tv-green text-black shadow-sm' : 'text-gray-500 hover:text-white hover:bg-white/5'}`}
                                    >
                                        <TrendingUp size={12}/> Long / Buy
                                    </button>
                                    <button 
                                        onClick={() => setForm(f => ({ ...f, side: 'SHORT' }))}
                                        className={`flex-1 py-1.5 text-[11px] uppercase tracking-widest font-bold rounded transition-colors flex justify-center items-center gap-2
                                            ${form.side === 'SHORT' ? 'bg-tv-red text-white shadow-sm' : 'text-gray-500 hover:text-white hover:bg-white/5'}`}
                                    >
                                        <TrendingDown size={12}/> Short / Sell
                                    </button>
                                </div>
                            </div>
                        </div>

                        {/* Execution Group */}
                        <div className="p-4 bg-[#1a1e28] border border-bg-hover rounded-xl space-y-4">
                            <div className="flex gap-4">
                                <div className="flex-1 relative group">
                                    <label className="text-[10px] text-text-muted uppercase font-bold tracking-widest mb-1.5 flex items-center gap-1.5"><DollarSign size={10}/> Limit Price</label>
                                    <div className="relative">
                                        <input 
                                            type="number" 
                                            value={form.entryPrice} 
                                            onChange={e => setForm(f => ({ ...f, entryPrice: e.target.value, type: 'LIMIT' }))}
                                            className="w-full bg-bg-panel border border-bg-border text-white text-[14px] font-mono font-bold rounded pr-14 pl-3 py-2 outline-none focus:border-tv-blue transition-colors shadow-inner" 
                                            placeholder="0.00" 
                                        />
                                        <button 
                                            onClick={autoFill} 
                                            className="absolute right-1 top-1 bottom-1 bg-tv-blue/10 border border-tv-blue/20 hover:bg-tv-blue text-tv-blue hover:text-white transition-colors text-[9px] uppercase font-bold tracking-widest px-2 rounded flex items-center"
                                        >
                                            MKRT
                                        </button>
                                    </div>
                                </div>
                                <div className="flex-1">
                                    <label className="text-[10px] text-text-muted uppercase font-bold tracking-widest mb-1.5 flex items-center gap-1.5"><Activity size={10}/> Order Size</label>
                                    <input 
                                        type="number" 
                                        value={form.quantity} 
                                        onChange={e => setForm(f => ({ ...f, quantity: e.target.value }))}
                                        className="w-full bg-bg-panel border border-bg-border text-white text-[14px] font-mono font-bold rounded px-3 py-2 outline-none focus:border-tv-blue transition-colors shadow-inner" 
                                        placeholder="Base Asset Amt" 
                                    />
                                </div>
                            </div>
                            
                            <div className="flex gap-4 pt-2 border-t border-[rgba(255,255,255,0.02)]">
                                <div className="flex-1">
                                    <label className="flex items-center justify-between text-[10px] text-text-muted uppercase font-bold tracking-widest mb-1.5">
                                        <span>Initial Leverage</span>
                                        <span className="text-tv-blue">{form.leverage}X</span>
                                    </label>
                                    <input 
                                        type="range" 
                                        min="1" max="100" 
                                        value={form.leverage} 
                                        onChange={e => setForm(f => ({ ...f, leverage: Number(e.target.value) }))}
                                        className="w-full accent-tv-blue"
                                    />
                                    <div className="flex justify-between text-[8px] text-gray-600 font-mono mt-1">
                                        <span>1X</span><span>25X</span><span>50X</span><span>100X</span>
                                    </div>
                                </div>
                            </div>
                        </div>

                        {/* Guardrails Group */}
                        <div className="grid grid-cols-2 gap-4">
                            <div className="relative">
                                <label className="text-[10px] text-tv-red uppercase font-bold tracking-widest mb-1.5 flex items-center gap-1.5"><ShieldAlert size={10}/> Stop Loss Trigger</label>
                                <input 
                                    type="number" 
                                    value={form.stopLoss} 
                                    onChange={e => setForm(f => ({ ...f, stopLoss: e.target.value }))}
                                    className="w-full bg-bg-panel border border-tv-red/20 focus:border-tv-red/60 text-white text-[13px] font-mono rounded px-3 py-2 outline-none transition-colors shadow-inner" 
                                    placeholder="Price Threshold" 
                                />
                            </div>
                            <div className="relative">
                                <label className="text-[10px] text-tv-green uppercase font-bold tracking-widest mb-1.5 flex items-center gap-1.5"><Target size={10}/> Take Profit Marker</label>
                                <input 
                                    type="number" 
                                    value={form.takeProfit} 
                                    onChange={e => setForm(f => ({ ...f, takeProfit: e.target.value }))}
                                    className="w-full bg-bg-panel border border-tv-green/20 focus:border-tv-green/60 text-white text-[13px] font-mono rounded px-3 py-2 outline-none transition-colors shadow-inner" 
                                    placeholder="Price Threshold" 
                                />
                            </div>
                        </div>

                        <div className="pt-2">
                            <label className="text-[10px] text-text-muted uppercase font-bold tracking-widest mb-1.5 block">Strategic Execution Notes (Optional)</label>
                            <input 
                                value={form.notes} 
                                onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
                                className="w-full bg-bg-panel border border-bg-border text-gray-300 text-[11px] rounded px-3 py-2 outline-none focus:border-tv-blue transition-colors shadow-inner" 
                                placeholder="E.g. Support bounce play with HTF confluence..." 
                            />
                        </div>

                    </div>
                </div>

                {/* Right Side: Execution Simulation Panel */}
                <div className="w-[320px] bg-[#1a1e28] flex flex-col">
                    <div className="px-6 py-4 border-b border-bg-hover bg-bg-elevated shrink-0">
                        <h3 className="text-[11px] font-bold text-text-muted uppercase tracking-widest flex items-center gap-2">
                            <Activity size={12} className="text-tv-blue"/> Engine Diagnostics
                        </h3>
                    </div>

                    <div className="flex-1 overflow-y-auto no-scrollbar p-6 space-y-6">
                        
                        {/* Status Check */}
                        {!sim.isValid ? (
                            <div className="flex flex-col items-center justify-center p-8 text-center text-[10px] text-text-muted border border-border-default border-dashed rounded h-full gap-3">
                                <Crosshair size={24} className="opacity-20"/>
                                <span>Input Entry Price and Quantity to compute risk simulations.</span>
                            </div>
                        ) : (
                            <div className="space-y-6 animate-in slide-in-from-right-4 duration-300">
                                
                                {/* Capital Requirements */}
                                <div className="space-y-3">
                                    <h4 className="text-[10px] text-white uppercase font-bold tracking-widest flex justify-between items-center">
                                        <span>Capital Demand</span>
                                        <span className="text-[12px] font-mono text-white">${sim.notional.toFixed(2)} Base</span>
                                    </h4>
                                    
                                    <div className="bg-bg-panel border border-bg-hover rounded p-3 space-y-2">
                                        <div className="flex justify-between items-center text-[10px]">
                                            <span className="text-text-muted">Margin Lock</span>
                                            <span className={`font-mono font-bold ${sim.isExhausted ? 'text-tv-red' : 'text-amber-500'}`}>${sim.marginReq.toFixed(2)}</span>
                                        </div>
                                        <div className="w-full h-1.5 bg-bg-app rounded-full overflow-hidden flex relative">
                                            <div 
                                                className={`h-full transition-all ${sim.isExhausted ? 'bg-tv-red' : 'bg-amber-500'}`} 
                                                style={{ width: `${Math.min(100, sim.marginPct)}%` }} 
                                            />
                                        </div>
                                        <div className="flex justify-between items-center text-[9px] text-text-muted mt-1">
                                            <span>Cap Drain: {sim.marginPct.toFixed(1)}%</span>
                                            <span className="font-mono">Avail: ${(account?.balance || 0).toFixed(2)}</span>
                                        </div>
                                    </div>
                                    
                                    {sim.isExhausted && (
                                        <div className="text-[9px] text-tv-red font-bold uppercase tracking-widest flex gap-1.5 items-center bg-tv-red/10 border border-tv-red/20 p-2 rounded">
                                            <ShieldAlert size={10}/> Engine Rejection: Insufficient available capital
                                        </div>
                                    )}
                                </div>

                                {/* Risk/Reward Matrix */}
                                <div className="space-y-3 pt-4 border-t border-[rgba(255,255,255,0.05)]">
                                    <h4 className="text-[10px] text-white uppercase font-bold tracking-widest">Expected Outcome Ranges</h4>
                                    
                                    <div className="grid grid-cols-2 gap-2">
                                        <div className="bg-bg-panel border border-tv-red/20 rounded p-3 relative overflow-hidden group">
                                            <div className="absolute top-0 right-0 w-8 h-8 rounded-bl-full bg-tv-red/10 flex items-start justify-end p-1 z-0">
                                                <TrendingDown size={10} className="text-tv-red opacity-50"/>
                                            </div>
                                            <div className="text-[9px] text-text-muted font-bold uppercase tracking-widest mb-1 relative z-10">Max Risk (SL)</div>
                                            <div className="text-[14px] font-mono text-tv-red font-bold relative z-10">
                                                {sim.riskAmt > 0 ? `-$${sim.riskAmt.toFixed(2)}` : 'Infinite'}
                                            </div>
                                            <div className="text-[9px] text-tv-red/70 font-mono mt-0.5">-{sim.riskPct.toFixed(1)}% Cap</div>
                                        </div>

                                        <div className="bg-bg-panel border border-tv-green/20 rounded p-3 relative overflow-hidden group">
                                            <div className="absolute top-0 right-0 w-8 h-8 rounded-bl-full bg-tv-green/10 flex items-start justify-end p-1 z-0">
                                                <TrendingUp size={10} className="text-tv-green opacity-50"/>
                                            </div>
                                            <div className="text-[9px] text-text-muted font-bold uppercase tracking-widest mb-1 relative z-10">Max Reward (TP)</div>
                                            <div className="text-[14px] font-mono text-tv-green font-bold relative z-10">
                                                {sim.pnlAtTp > 0 ? `+$${sim.pnlAtTp.toFixed(2)}` : 'Uncapped'}
                                            </div>
                                            <div className="text-[9px] text-tv-green/70 font-mono mt-0.5">+{sim.rewardPct.toFixed(1)}% Cap</div>
                                        </div>
                                    </div>

                                    {/* Ratio Indicator */}
                                    {sim.rr && (
                                        <div className="bg-bg-panel border border-bg-hover rounded px-3 py-2 flex justify-between items-center text-[10px] font-bold uppercase tracking-widest">
                                            <span className="text-text-muted">Edge Ratio</span>
                                            <span className={`font-mono font-bold ${sim.rr.ratio >= 2 ? 'text-tv-green' : sim.rr.ratio >= 1 ? 'text-amber-500' : 'text-tv-red'}`}>
                                                1 : {sim.rr.ratio}
                                            </span>
                                        </div>
                                    )}
                                </div>

                                {/* Liquidation Warning */}
                                {form.leverage > 20 && form.marginMode === 'isolated' && (
                                    <div className="pt-4 border-t border-[rgba(255,255,255,0.05)] text-[9px] text-text-muted uppercase tracking-widest leading-relaxed flex gap-2">
                                        <AlertCircle size={12} className="text-amber-500 shrink-0"/>
                                        High leverage isolated vector active. Estimated liquidation band at ~{sim.liquidationDist.toFixed(1)}% index variance against entry.
                                    </div>
                                )}
                            </div>
                        )}
                    </div>

                    {/* Commit Bar */}
                    <div className="px-6 py-4 border-t border-bg-hover bg-bg-elevated shrink-0">
                        <button 
                            onClick={handleSubmit} 
                            disabled={!sim.isValid || sim.isExhausted || isSimulating}
                            className={`w-full py-3 text-[11px] font-bold uppercase tracking-widest rounded shadow-[0_0_15px_rgba(0,0,0,0.5)] transition-all flex items-center justify-center gap-2
                                ${!sim.isValid || sim.isExhausted 
                                    ? 'bg-bg-hover text-gray-500' 
                                    : form.side === 'LONG' 
                                        ? 'bg-tv-green hover:bg-[#208b80] text-black shadow-[0_0_20px_rgba(38,166,154,0.3)]' 
                                        : 'bg-tv-red hover:bg-[#d64745] text-white shadow-[0_0_20px_rgba(239,83,80,0.3)]'}`}
                        >
                            {isSimulating ? (
                                <><Activity size={14} className="animate-spin"/> Injecting Payload...</>
                            ) : (
                                `Execute ${form.side} Vector`
                            )}
                        </button>
                    </div>

                </div>
            </div>
        </div>
    );
}
