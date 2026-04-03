import React, { useState, useCallback, useMemo } from 'react';
import usePortfolioStore from '../../store/usePortfolioStore.js';
import { ArrowLeftRight, CheckCircle2, ShieldAlert, CreditCard, Banknote, History, ChevronRight } from 'lucide-react';

/**
 * FundTransferModal.jsx — Teralyn v2.0
 * Institutional-grade capital routing terminal supporting complex fractional
 * movements, visual capacity warnings, and sub-account isolation boundaries.
 */

export default function FundTransferModal({ isOpen, onClose }) {
    const { accounts, addTransfer, transfers = [] } = usePortfolioStore();
    
    // Core Form
    const [from, setFrom] = useState(accounts[0]?.id || '');
    const [to, setTo] = useState(accounts.length > 1 ? accounts[1]?.id : '');
    const [amount, setAmount] = useState('');
    const [viewHistory, setViewHistory] = useState(false);
    const [step, setStep] = useState('input'); // input, confirm, done

    // Derive active instances
    const fromAccount = accounts.find(a => a.id === from);
    const toAccount = accounts.find(a => a.id === to);
    const amtNum = parseFloat(amount) || 0;

    // Derived Capacity Metrics
    const capacity = useMemo(() => {
        if (!fromAccount) return { available: 0, percent: 0, isExhausted: false };
        // If we had active margins we'd subtract them here. Assuming raw balance for now.
        const available = fromAccount.balance || 0; 
        const afterTransfer = available - amtNum;
        const percentRaw = available > 0 ? (amtNum / available) * 100 : 0;
        
        return {
            available,
            afterTransfer: Math.max(0, afterTransfer),
            percent: Math.min(100, Math.max(0, percentRaw)),
            isExhausted: amtNum > available,
            isWarning: percentRaw > 80 && percentRaw <= 100
        };
    }, [fromAccount, amtNum]);

    // Fast Input
    const setPercent = (pct) => {
        if (fromAccount && fromAccount.balance > 0) {
            setAmount((fromAccount.balance * (pct / 100)).toFixed(2));
        }
    };

    const handleExecute = useCallback(() => {
        if (!from || !to || from === to || amtNum <= 0 || capacity.isExhausted) return;
        
        // Execute real transfer mutation via store
        addTransfer({ 
            fromAccountId: from, 
            toAccountId: to, 
            amount: amtNum,
            timestamp: Date.now(),
            id: `tx-${Math.random().toString(36).substr(2, 9)}`
        });
        
        setStep('done');
    }, [from, to, amtNum, capacity.isExhausted, addTransfer]);

    const handleSwap = () => {
        const temp = from;
        setFrom(to);
        setTo(temp);
    };

    if (!isOpen) return null;

    // Filter local transfers involving these accounts
    const localHistory = transfers.filter(t => t.fromAccountId === from || t.toAccountId === from).slice(-5).reverse();

    return (
        <div className="fixed inset-0 z-[600] flex items-center justify-center font-sans tracking-wide" onClick={onClose}>
            <div className="absolute inset-0 bg-black/80 backdrop-blur-sm" />
            
            <div 
                className="relative w-[500px] bg-[#161a25] border border-bg-border rounded-xl shadow-[0_0_60px_rgba(0,0,0,0.8)] overflow-hidden animate-in fade-in zoom-in-95 duration-200" 
                onClick={e => e.stopPropagation()}
            >
                {/* Header Profile */}
                <div className="flex justify-between items-center px-6 py-4 border-b border-bg-hover bg-[#1a1e28] shrink-0">
                    <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded bg-amber-500/10 flex items-center justify-center border border-amber-500/20 text-amber-500">
                            <ArrowLeftRight size={16}/>
                        </div>
                        <div>
                            <h3 className="text-[13px] font-bold text-white uppercase tracking-widest">Internal Routing</h3>
                            <p className="text-[10px] text-text-muted">Inter-Depot Capital Transfers</p>
                        </div>
                    </div>
                    
                    <button 
                        onClick={() => setViewHistory(!viewHistory)} 
                        className={`p-1.5 rounded transition-colors ${viewHistory ? 'bg-amber-500/20 text-amber-500 border border-amber-500/30' : 'bg-bg-elevated text-text-muted hover:text-white border border-border-default'}`}
                        title="Transfer Ledger"
                    >
                        <History size={14}/>
                    </button>
                </div>

                <div className="flex">
                    {/* Primary Form Area */}
                    <div className="flex-1 p-6 space-y-6">
                        
                        {step === 'input' && (
                            <div className="space-y-6 animate-in slide-in-from-left-2 duration-300">
                                {/* Routing Nodes */}
                                <div className="relative border border-bg-hover bg-[#1a1e28] rounded-xl p-4">
                                    <div className="flex flex-col gap-4">
                                        <div className="relative">
                                            <label className="text-[10px] uppercase font-bold text-text-muted tracking-widest mb-2 flex items-center gap-1.5"><CreditCard size={12}/> Origin Node (Withdraw)</label>
                                            <select 
                                                value={from} 
                                                onChange={e => setFrom(e.target.value)}
                                                className="w-full bg-bg-panel border border-bg-border text-white text-[13px] font-bold rounded-lg px-3 py-2.5 outline-none focus:border-amber-500 transition-colors shadow-inner appearance-none"
                                            >
                                                {accounts.map(a => <option key={a.id} value={a.id}>{a.name} — ${a.balance?.toFixed(2)}</option>)}
                                            </select>
                                        </div>
                                        
                                        <div className="relative">
                                            <label className="text-[10px] uppercase font-bold text-text-muted tracking-widest mb-2 flex items-center gap-1.5"><Banknote size={12}/> Destination Node (Deposit)</label>
                                            <select 
                                                value={to} 
                                                onChange={e => setTo(e.target.value)}
                                                className="w-full bg-bg-panel border border-bg-border text-white text-[13px] font-bold rounded-lg px-3 py-2.5 outline-none focus:border-tv-blue transition-colors shadow-inner appearance-none"
                                            >
                                                <option value="" disabled>Select Target Depot...</option>
                                                {accounts.map(a => <option key={a.id} value={a.id} disabled={a.id === from}>{a.name} — ${a.balance?.toFixed(2)}</option>)}
                                            </select>
                                        </div>
                                    </div>

                                    {/* Swap Action Component */}
                                    <button 
                                        onClick={handleSwap}
                                        className="absolute left-[32px] top-1/2 -translate-y-1/2 w-8 h-8 rounded-full bg-bg-hover border border-[#3a3e49] flex items-center justify-center text-white hover:bg-amber-500 hover:border-amber-400 hover:text-white transition-all shadow-md z-10"
                                    >
                                        <ArrowLeftRight size={14} className="rotate-90" />
                                    </button>
                                </div>

                                {/* Amount Configuration */}
                                <div className="space-y-3">
                                    <div className="flex justify-between items-end">
                                        <label className="text-[10px] text-text-muted uppercase font-bold tracking-widest">Transfer Volume</label>
                                        <span className="text-[10px] font-mono text-gray-400">Avail: <span className="text-white">${capacity.available.toFixed(2)}</span></span>
                                    </div>
                                    
                                    <div className="relative group">
                                        <span className="absolute left-4 top-1/2 -translate-y-1/2 text-xl text-gray-500 group-focus-within:text-amber-500 font-bold">$</span>
                                        <input 
                                            type="number" 
                                            value={amount} 
                                            onChange={e => setAmount(e.target.value)} 
                                            placeholder="0.00"
                                            className={`w-full bg-bg-panel border-2 text-white text-2xl font-mono font-bold rounded-xl pl-8 pr-4 py-4 outline-none transition-colors shadow-inner
                                                ${capacity.isExhausted ? 'border-tv-red/50 focus:border-tv-red' : 'border-bg-border focus:border-amber-500'}`} 
                                        />
                                    </div>

                                    {/* Quick Allocators */}
                                    <div className="flex gap-2">
                                        {[25, 50, 75, 100].map(pct => (
                                            <button 
                                                key={pct} 
                                                onClick={() => setPercent(pct)}
                                                className="flex-1 py-1.5 rounded bg-bg-panel border border-[rgba(255,255,255,0.05)] text-[10px] font-bold text-text-muted hover:border-amber-500/50 hover:text-amber-500 transition-colors uppercase tracking-widest"
                                            >
                                                {pct}%
                                            </button>
                                        ))}
                                    </div>
                                </div>

                                {/* Visual Capacity Bar */}
                                {amtNum > 0 && (
                                    <div className="bg-[#1a1e28] rounded-xl p-4 border border-bg-hover space-y-3">
                                        <div className="flex justify-between items-center text-[10px] uppercase font-bold tracking-widest">
                                            <span className="text-text-muted">Origin Impact</span>
                                            <span className={`font-mono ${capacity.isExhausted ? 'text-tv-red' : capacity.isWarning ? 'text-amber-500' : 'text-tv-blue'}`}>-{capacity.percent.toFixed(1)}%</span>
                                        </div>
                                        <div className="w-full h-2 bg-bg-app rounded-full overflow-hidden flex relative">
                                            <div 
                                                className={`h-full transition-all duration-300 ${capacity.isExhausted ? 'bg-tv-red' : capacity.isWarning ? 'bg-amber-500' : 'bg-amber-500'}`} 
                                                style={{ width: `${capacity.percent}%` }} 
                                            />
                                        </div>
                                        {capacity.isExhausted && (
                                            <div className="flex items-center gap-1.5 text-tv-red text-[10px] uppercase font-bold mt-2">
                                                <ShieldAlert size={12}/> Insufficient Free Capital in Origin Node
                                            </div>
                                        )}
                                        {capacity.isWarning && !capacity.isExhausted && (
                                            <div className="flex items-center gap-1.5 text-amber-500 text-[10px] uppercase font-bold mt-2 animate-pulse">
                                                <AlertCircle size={12}/> High Capital Drain Warning
                                            </div>
                                        )}
                                    </div>
                                )}
                            </div>
                        )}

                        {step === 'done' && (
                            <div className="h-[300px] flex flex-col items-center justify-center animate-in zoom-in duration-500 text-center">
                                <div className="w-16 h-16 bg-tv-green/10 border border-tv-green/30 rounded-full flex items-center justify-center mb-6">
                                    <CheckCircle2 size={32} className="text-tv-green" />
                                </div>
                                <h4 className="text-[14px] font-bold text-white uppercase tracking-widest mb-2">Network Transfer Executed</h4>
                                <div className="text-[24px] font-mono font-bold text-tv-green mb-6">${amtNum.toFixed(2)}</div>
                                
                                <div className="bg-[#1a1e28] border border-bg-hover rounded px-6 py-3 flex items-center gap-4 text-[11px] font-bold text-text-muted">
                                    <span className="truncate max-w-[100px] text-white">{fromAccount?.name}</span>
                                    <ArrowRight size={14} className="text-amber-500" />
                                    <span className="truncate max-w-[100px] text-white">{toAccount?.name}</span>
                                </div>
                            </div>
                        )}

                    </div>

                    {/* History Sidebar Ledger */}
                    {viewHistory && (
                        <div className="w-[200px] border-l border-bg-hover bg-[#1a1e28] flex flex-col animate-in slide-in-from-right-4 duration-300">
                            <div className="px-4 py-3 border-b border-bg-hover text-[10px] uppercase font-bold text-amber-500 tracking-widest shrink-0">
                                Global TX Ledger
                            </div>
                            <div className="flex-1 overflow-y-auto no-scrollbar p-3 space-y-2">
                                {localHistory.length === 0 ? (
                                    <div className="text-[10px] text-text-muted text-center pt-10 px-2 italic">No route logs available for this node.</div>
                                ) : (
                                    localHistory.map((t, i) => (
                                        <div key={i} className="bg-bg-app border border-[rgba(255,255,255,0.02)] rounded p-2 text-left">
                                            <div className="text-[9px] text-text-muted font-mono mb-1">{new Date(t.timestamp).toLocaleTimeString()}</div>
                                            <div className="text-[11px] font-mono text-white font-bold mb-1">${t.amount.toFixed(2)}</div>
                                            <div className="text-[9px] text-text-secondary truncate flex items-center gap-1">
                                                {accounts.find(a=>a.id===t.fromAccountId)?.name} <ChevronRight size={8} className="text-amber-500"/> {accounts.find(a=>a.id===t.toAccountId)?.name}
                                            </div>
                                        </div>
                                    ))
                                )}
                            </div>
                        </div>
                    )}
                </div>

                {/* Footer Toolbar */}
                <div className="flex justify-between items-center px-6 py-4 border-t border-bg-hover bg-[#1a1e28] shrink-0">
                    <span className="text-[10px] text-text-muted font-bold tracking-widest uppercase">
                        Instant Finality Protocol
                    </span>
                    <div className="flex gap-2">
                        <button 
                            onClick={onClose} 
                            className="px-6 py-2.5 text-[11px] font-bold text-text-muted hover:text-white uppercase tracking-widest hover:bg-white/5 rounded transition-colors"
                        >
                            {step === 'done' ? 'Close Protocol' : 'Abort'}
                        </button>
                        {step === 'input' && (
                            <button 
                                onClick={handleExecute} 
                                disabled={capacity.isExhausted || amtNum <= 0 || from === to || !to}
                                className="px-8 py-2.5 text-[11px] font-bold bg-amber-500 hover:bg-amber-400 text-[#1a1e28] uppercase tracking-widest rounded shadow-[0_0_15px_rgba(245,158,11,0.4)] disabled:opacity-30 disabled:shadow-none transition-all"
                            >
                                Dispatch Route
                            </button>
                        )}
                    </div>
                </div>

            </div>
        </div>
    );
}
