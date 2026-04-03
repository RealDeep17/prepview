import React, { useState, useCallback, useMemo } from 'react';
import usePortfolioStore from '../../store/usePortfolioStore.js';
import { Target, TrendingUp, TrendingDown, Split, CheckCircle2, AlertCircle, Percent, ArrowLeftRight, Crosshair } from 'lucide-react';

/**
 * ScalePositionModal.jsx — Teralyn v2.0
 * Deeply complex scaling terminal handling DCA (Dollar Cost Average) simulations,
 * partial close algorithms, P&L extrapolations, and margin impact modeling.
 */

export default function ScalePositionModal({ isOpen, onClose, position }) {
    const { scalePosition, partialClose } = usePortfolioStore();

    // Mode: 'add' (Scale In) or 'reduce' (Partial Close)
    const [mode, setMode] = useState('add'); 
    
    // Core Form
    const [price, setPrice] = useState('');
    const [quantity, setQuantity] = useState('');

    // Native Properties
    const entry = position?.entryPrice || 0;
    const currentQty = position?.quantity || 0;
    const isLong = position?.side === 'LONG';
    const notional = entry * currentQty;

    // Derived Input Math
    const addQty = parseFloat(quantity) || 0;
    const addPrice = parseFloat(price) || 0;
    const isReady = addQty > 0 && addPrice > 0;

    // Deep Vector Simulation Core
    const sim = useMemo(() => {
        if (!position) return null;

        let newAvgEntry = entry;
        let newQty = currentQty;
        let dcaChange = 0;
        let newNotional = notional;
        let PnLAtPrice = 0;
        let pnlChange = 0;

        if (mode === 'add' && isReady) {
            // Standard DCA Formula: (V1 + V2) / (Q1 + Q2)
            const addedNotional = addPrice * addQty;
            newNotional = notional + addedNotional;
            newQty = currentQty + addQty;
            newAvgEntry = newNotional / newQty;
            
            // Visual metrics
            dcaChange = ((newAvgEntry - entry) / entry) * 100;

            // Theoretical P&L *if* the price gets to this add price right now
            const distance = isLong ? (addPrice - entry) : (entry - addPrice);
            PnLAtPrice = distance * currentQty; // Pnl right before adding
        } 
        else if (mode === 'reduce' && isReady) {
            // Partial Closing rules
            // Reduce qty exactly. Entry price stays fixed visually in most engines.
            const closingQty = Math.min(addQty, currentQty);
            newQty = currentQty - closingQty;
            newNotional = newQty * entry; // Remaining notional

            // Realized P&L to book from this tranche
            const distance = isLong ? (addPrice - entry) : (entry - addPrice);
            pnlChange = distance * closingQty; // The PnL chunk being booked
            
            PnLAtPrice = distance * currentQty; // The global PnL before cutting
        }

        return {
            newAvgEntry,
            newQty,
            dcaChange,
            newNotional,
            PnLAtPrice,
            pnlChange, // Only relevant for 'reduce'
            isClosingOut: mode === 'reduce' && addQty >= currentQty
        };
    }, [position, mode, entry, currentQty, notional, isLong, addQty, addPrice, isReady]);

    const handleSubmit = useCallback(() => {
        if (!position || !isReady) return;
        
        if (mode === 'add') {
            scalePosition(position.id, addQty, addPrice);
        } else {
            partialClose(position.id, Math.min(addQty, currentQty), addPrice);
        }
        onClose();
    }, [position, mode, addQty, addPrice, scalePosition, partialClose, currentQty, onClose, isReady]);

    // Fast Input Generators
    const handleSlider = (pct) => {
        const targetQty = currentQty * (pct / 100);
        setQuantity(targetQty.toFixed(4));
    };

    if (!isOpen || !position) return null;

    const accentColorClass = mode === 'add' 
        ? 'tv-blue' 
        : isLong ? (sim?.isClosingOut ? 'amber-500' : 'amber-500') : 'amber-500';

    const renderMetricRow = (label, current, next, formatter, isPositive = null) => {
        const hasChange = next !== undefined && current !== next;
        return (
            <div className="flex justify-between items-center py-2.5 border-b border-[rgba(255,255,255,0.02)]">
                <span className="text-[10px] uppercase font-bold text-text-muted tracking-widest">{label}</span>
                <div className="flex items-center gap-3">
                    <span className="text-[12px] font-mono text-gray-400">{formatter(current)}</span>
                    {hasChange && (
                        <>
                            <ArrowLeftRight size={10} className="text-text-muted"/>
                            <span className={`text-[12px] font-mono font-bold ${
                                isPositive === true ? 'text-tv-green' : isPositive === false ? 'text-tv-red' : 'text-white'
                            }`}>
                                {formatter(next)}
                            </span>
                        </>
                    )}
                </div>
            </div>
        );
    };

    return (
        <div className="fixed inset-0 z-[600] flex items-center justify-center font-sans" onClick={onClose}>
            <div className="absolute inset-0 bg-black/80" />
            
            <div 
                className="relative w-[480px] overflow-hidden rounded-[4px] border border-bg-border bg-[#161a25] animate-in fade-in zoom-in-95 duration-200" 
                onClick={e => e.stopPropagation()}
            >
                <div className="flex items-center justify-between border-b border-bg-hover bg-[#1a1e28] px-4 py-3 shrink-0">
                    <div className="flex items-center gap-3">
                        <div className={`flex h-7 w-7 items-center justify-center border ${
                            mode === 'add' ? 'bg-tv-blue/10 border-tv-blue/30 text-tv-blue' : 'bg-amber-500/10 border-amber-500/30 text-amber-500'
                        }`}>
                            {mode === 'add' ? <Target size={16}/> : <Split size={16}/>}
                        </div>
                        <div>
                            <div className="flex items-center gap-2">
                                <h3 className="text-[12px] font-bold uppercase tracking-[0.14em] text-white">
                                    {mode === 'add' ? 'Scale In' : 'Reduce'}
                                </h3>
                                <span className={`px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-[0.14em] ${isLong ? 'bg-tv-green/20 text-tv-green' : 'bg-tv-red/20 text-tv-red'}`}>
                                    {position.side}
                                </span>
                            </div>
                            <p className="text-[10px] text-text-muted font-bold tracking-widest mt-1">{position.symbol?.replace('USDT', '')}</p>
                        </div>
                    </div>
                </div>

                {/* State Engine Toggle Box */}
                <div className="flex bg-bg-panel border-b border-bg-hover p-2 gap-2">
                    <button 
                        onClick={() => setMode('add')}
                        className={`flex-1 py-2 flex items-center justify-center gap-2 rounded-[4px] text-[11px] font-bold uppercase tracking-[0.14em] transition-colors ${
                            mode === 'add' ? 'bg-tv-blue/10 border border-tv-blue/30 text-tv-blue' : 'border border-transparent text-text-muted hover:text-white hover:bg-white/5'
                        }`}
                    >
                        <TrendingUp size={14}/> Add
                    </button>
                    <button 
                        onClick={() => setMode('reduce')}
                        className={`flex-1 py-2 flex items-center justify-center gap-2 rounded-[4px] text-[11px] font-bold uppercase tracking-[0.14em] transition-colors ${
                            mode === 'reduce' ? 'bg-amber-500/10 border border-amber-500/30 text-amber-500' : 'border border-transparent text-text-muted hover:text-white hover:bg-white/5'
                        }`}
                    >
                        <TrendingDown size={14}/> Reduce
                    </button>
                </div>

                <div className="space-y-4 p-4">
                    
                    {/* Primary Config Vectors */}
                    <div className="grid grid-cols-2 gap-4">
                        <div className="relative group border border-bg-hover bg-[#1a1e28] p-3 pt-4 rounded-[4px]">
                            <span className="absolute -top-[9px] left-3 bg-[#1a1e28] px-1 text-[10px] font-bold text-text-muted uppercase tracking-widest flex items-center gap-1"><Crosshair size={10}/> Execution Price</span>
                            <div className="relative">
                                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted text-[14px]">$</span>
                                <input 
                                    type="number" 
                                    value={price} 
                                    onChange={e => setPrice(e.target.value)}
                                    className={`w-full bg-bg-panel border ${!price ? 'border-border-default' : mode === 'add' ? 'border-tv-blue' : 'border-amber-500'} text-white text-[16px] font-mono font-bold rounded-[4px] pl-6 pr-3 py-2 outline-none transition-colors`}
                                    placeholder="0.00" 
                                />
                            </div>
                        </div>

                        <div className="relative group border border-bg-hover bg-[#1a1e28] p-3 pt-4 rounded-[4px]">
                            <span className="absolute -top-[9px] left-3 bg-[#1a1e28] px-1 text-[10px] font-bold text-text-muted uppercase tracking-widest flex items-center gap-1"><Split size={10}/> Size Modifier</span>
                            <div className="relative">
                                <input 
                                    type="number" 
                                    value={quantity} 
                                    onChange={e => setQuantity(e.target.value)}
                                    max={mode === 'reduce' ? currentQty : undefined}
                                    className={`w-full bg-bg-panel border ${!quantity ? 'border-border-default' : mode === 'add' ? 'border-tv-blue' : 'border-amber-500'} text-white text-[16px] font-mono font-bold rounded-[4px] px-3 py-2 outline-none transition-colors`}
                                    placeholder="0.000" 
                                />
                            </div>
                            
                            {/* Fast Fractional Buttons (Only for Reduce conventionally, but viable for DCA) */}
                            {mode === 'reduce' && (
                                <div className="flex gap-1 mt-2">
                                    {[25, 50, 75, 100].map(pct => (
                                        <button 
                                            key={pct} 
                                            onClick={() => handleSlider(pct)}
                                            className="flex-1 rounded-[3px] border border-border-default bg-bg-panel py-1 text-[9px] font-bold text-text-muted transition-colors hover:border-amber-500 hover:text-amber-500"
                                        >
                                            {pct === 100 ? 'ALL' : pct+'%'}
                                        </button>
                                    ))}
                                </div>
                            )}
                        </div>
                    </div>

                    {/* Simulation Engine Block */}
                    <div className="relative overflow-hidden border border-bg-hover bg-[#1a1e28] p-4 rounded-[4px]">
                        
                        {/* Status Watermark */}
                        <div className="absolute right-[-20px] top-[-20px] opacity-[0.03] select-none pointer-events-none">
                            {mode === 'add' ? <Target size={150}/> : <Split size={150}/>}
                        </div>

                        <h4 className="text-[11px] text-text-muted uppercase font-bold tracking-widest mb-3 border-b border-[rgba(255,255,255,0.05)] pb-2 flex items-center gap-2">
                            <Activity size={12}/> Vector Simulation State
                        </h4>

                        <div className="relative z-10">
                            {/* Core Mathematical Properties */}
                            {renderMetricRow('Average Entry Price', entry, isReady && mode === 'add' ? sim.newAvgEntry : undefined, v => `$${v.toFixed(4)}`, mode === 'add' ? (sim?.dcaChange <= 0) : null)}
                            
                            {renderMetricRow('Position Size', currentQty, isReady ? sim.newQty : undefined, v => v.toFixed(4), mode === 'add' ? true : false)}
                            
                            {renderMetricRow('Total Notional Margin', notional, isReady ? sim.newNotional : undefined, v => `$${v.toFixed(2)}`, null)}

                            {/* Secondary Metrics Triggered by readiness */}
                            {isReady && mode === 'add' && (
                                    <div className="mt-3 flex items-center justify-between border border-tv-blue/20 bg-tv-blue/10 p-2.5 text-[10px] font-bold uppercase tracking-[0.14em]">
                                    <span className="text-tv-blue flex items-center gap-1.5"><Percent size={10}/> Dollar Cost Divergence (DCA)</span>
                                    <span className={`font-mono text-[12px] ${sim.dcaChange <= 0 ? (isLong ? 'text-tv-green' : 'text-tv-red') : (isLong ? 'text-tv-red' : 'text-tv-green')}`}>
                                        {sim.dcaChange > 0 ? '+' : ''}{sim.dcaChange.toFixed(3)}%
                                    </span>
                                </div>
                            )}

                            {isReady && mode === 'reduce' && (
                                <div className="grid grid-cols-2 gap-3 mt-3">
                                    {sim.isClosingOut && (
                                        <div className="col-span-2 flex items-center gap-2 border border-tv-red/20 bg-tv-red/10 p-2 text-[10px] font-bold uppercase tracking-[0.14em] text-tv-red">
                                            <AlertCircle size={12}/> Global Close Vector Detected. Position will terminate.
                                        </div>
                                    )}
                                    <div className="border border-bg-hover bg-bg-panel p-2">
                                        <div className="text-[9px] text-text-muted uppercase font-bold tracking-widest mb-1">Booked Realized P&L</div>
                                        <div className={`font-mono text-[14px] font-bold ${sim.pnlChange >= 0 ? 'text-tv-green' : 'text-tv-red'}`}>
                                            {sim.pnlChange >= 0 ? '+' : ''}${sim.pnlChange.toFixed(2)}
                                        </div>
                                    </div>
                                    <div className="border border-bg-hover bg-bg-panel p-2">
                                        <div className="text-[9px] text-text-muted uppercase font-bold tracking-widest mb-1">Global Trade Status (PnL)</div>
                                        <div className={`font-mono text-[14px] font-bold ${sim.PnLAtPrice >= 0 ? 'text-gray-300' : 'text-gray-500'}`}>
                                            {sim.PnLAtPrice >= 0 ? '+' : ''}${sim.PnLAtPrice.toFixed(2)}
                                        </div>
                                    </div>
                                </div>
                            )}
                        </div>
                    </div>

                </div>

                {/* Footer Toolbar */}
                <div className="flex items-center justify-between border-t border-bg-hover bg-[#1a1e28] px-4 py-3 shrink-0">
                    <span className="text-[10px] text-text-muted font-bold tracking-widest uppercase flex items-center gap-2">
                        {isReady ? <><CheckCircle2 size={12} className="text-tv-green"/> Engine Armed</> : 'Awaiting Metrics'}
                    </span>
                    <div className="flex gap-2">
                        <button 
                            onClick={onClose} 
                            className="rounded-[4px] px-4 py-2 text-[11px] font-bold uppercase tracking-[0.14em] text-text-muted transition-colors hover:bg-white/5 hover:text-white"
                        >
                            Cancel
                        </button>
                        <button 
                            onClick={handleSubmit} 
                            disabled={!isReady}
                            className={`rounded-[4px] px-6 py-2 text-[11px] font-bold uppercase tracking-[0.14em] transition-colors disabled:opacity-30
                                ${mode === 'add' ? 'bg-tv-blue hover:bg-[#1e54e5] text-white' : 'bg-amber-500 hover:bg-amber-400 text-[#1a1e28]'}`}
                        >
                            {mode === 'add' ? 'Scale In' : (sim?.isClosingOut ? 'Close Position' : 'Reduce')}
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
}
