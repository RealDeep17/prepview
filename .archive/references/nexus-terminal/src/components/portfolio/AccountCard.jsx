import React, { useMemo, useState } from 'react';
import usePortfolioStore from '../../store/usePortfolioStore.js';
import useMarketStore from '../../store/useMarketStore.js';
import PortfolioComputeContext from '../../services/portfolio/PortfolioComputeContext.js';
import { Activity, Shield, Hash, Settings, Star, AlertCircle } from 'lucide-react';

/**
 * AccountCard.jsx — Teralyn v2.0
 * High density account summary card rendering micro-equity paths, connection status,
 * margin usage bars and sub-account specific trading performance metadata.
 */

export default function AccountCard({ account, isActive, onSelect }) {
    const { positions, snapshots, updateAccount } = usePortfolioStore();
    const prices = useMarketStore(s => s.prices);
    
    // Toggle for pinning/starring an account locally
    const [isHovered, setIsHovered] = useState(false);

    // Compute active metrics scoped strictly to this account
    const { metrics, sparkline } = useMemo(() => {
        PortfolioComputeContext.updatePrices(prices);
        const scopedPositions = positions.filter(p => p.accountId === account.id);
        const calcMetrics = PortfolioComputeContext.computeAccountMetrics(account, scopedPositions);

        // Filter snapshots for this specific account if we supported account-level snaps.
        // Assuming global snaps for now, or just mapping a simulated local line.
        // We'll generate a smooth simulated local line based on open positions.
        let localSpark = [];
        if (scopedPositions.length > 0) {
            let base = account.balance;
            localSpark = scopedPositions.map((p, i) => {
                base += (p.unrealizedPnl || 0) * (i / scopedPositions.length);
                return base;
            });
            localSpark.push(calcMetrics.equity); // Current at the end
        } else {
            localSpark = [account.balance, account.balance];
        }

        return { metrics: calcMetrics, sparkline: localSpark };
    }, [prices, positions, account.id, account.balance]);

    // Formatters
    const formatUsd = (v) => v >= 0 ? `$${Math.abs(v).toLocaleString('en', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : `-$${Math.abs(v).toLocaleString('en', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

    // SVG Sparkline generator
    const SparklineRenderer = ({ data, color, w = 120, h = 30 }) => {
        if (data.length < 2) return <div className="text-[9px] text-text-muted text-right w-[120px]">No active trades</div>;
        
        const max = Math.max(...data);
        const min = Math.min(...data);
        const range = max - min || 1;
        
        const points = data.map((val, i) => {
            const x = (i / (data.length - 1)) * w;
            const y = h - ((val - min) / range) * h;
            return `${x},${y}`;
        }).join(' L ');

        return (
            <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} className="drop-shadow-sm">
                <path d={`M ${points}`} fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
        );
    };

    const isConnected = account.exchange !== 'paper';
    const isUp = metrics.unrealizedPnl >= 0;
    const sparkColor = isUp ? '#26a69a' : '#ef5350'; 

    return (
        <div 
            onClick={() => onSelect?.(account.id)}
            onMouseEnter={() => setIsHovered(true)}
            onMouseLeave={() => setIsHovered(false)}
            className={`relative p-3 rounded-[4px] border cursor-pointer transition-colors duration-200 overflow-hidden font-sans group ${
                isActive 
                    ? 'border-tv-blue bg-tv-blue/5' 
                    : 'border-border-default bg-bg-elevated hover:border-[#3a3e49]'
            }`}
        >
            {/* Active Highlight Band */}
            {isActive && <div className="absolute top-0 left-0 w-1 h-full bg-tv-blue"></div>}

            {/* Header / Meta */}
            <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                    <div className="flex flex-col">
                        <div className="flex items-center gap-2">
                            <span className={`text-[13px] font-bold tracking-wide transition-colors ${isActive ? 'text-white' : 'text-gray-300 group-hover:text-white'}`}>
                                {account.name}
                            </span>
                            {/* Paper/Live Tag */}
                            <span className={`text-[9px] uppercase font-bold tracking-[0.16em] px-1.5 py-0.5 rounded-[2px] flex items-center gap-1
                                ${isConnected ? 'bg-amber-400/10 text-amber-500 border border-amber-400/20' : 'bg-gray-800 text-gray-400 border border-gray-700'}`}>
                                {isConnected ? <Activity size={8}/> : <Hash size={8}/>}
                                {account.exchange?.replace('_', ' ')}
                            </span>
                        </div>
                    </div>
                </div>

                {/* Top Right Actions */}
                <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button 
                        className="p-1 text-text-muted hover:text-amber-400 transition-colors"
                        onClick={(e) => { e.stopPropagation(); updateAccount(account.id, { isStarred: !account.isStarred }); }}
                    >
                        <Star size={14} className={account.isStarred ? 'fill-amber-400 text-amber-400' : ''} />
                    </button>
                    <button className="p-1 text-text-muted hover:text-white transition-colors">
                        <Settings size={14} />
                    </button>
                </div>
                {/* Fallback pinned star visibility */}
                {account.isStarred && !isHovered && <Star size={14} className="fill-amber-400 text-amber-400 absolute top-3 right-3" />}
            </div>

            {/* Core Equity & Sparkline */}
            <div className="flex justify-between items-end mb-4">
                <div className="flex flex-col">
                    <span className="text-[10px] text-text-muted uppercase font-bold tracking-widest mb-1">Gross Equity</span>
                    <span className={`text-[22px] font-mono font-bold tracking-tighter ${isActive ? 'text-white' : 'text-gray-200'}`}>
                        {formatUsd(metrics.equity)}
                    </span>
                </div>
                <div>
                    <SparklineRenderer data={sparkline} color={sparkColor} />
                </div>
            </div>

            {/* Micro Stats Grid */}
            <div className="grid grid-cols-2 gap-x-5 gap-y-2.5 text-[11px] mb-4 border-t border-[rgba(255,255,255,0.05)] pt-3">
                <div className="flex justify-between items-center group/stat">
                    <span className="text-text-muted group-hover/stat:text-gray-400 transition-colors">Initial Bal:</span>
                    <span className="font-mono text-gray-300">{formatUsd(account.balance)}</span>
                </div>
                <div className="flex justify-between items-center group/stat">
                    <span className="text-text-muted group-hover/stat:text-gray-400 transition-colors">Unrealized:</span>
                    <span className={`font-mono font-bold ${isUp ? 'text-tv-green' : 'text-tv-red'}`}>
                        {formatUsd(metrics.unrealizedPnl)}
                    </span>
                </div>
                <div className="flex justify-between items-center group/stat">
                    <span className="text-text-muted group-hover/stat:text-gray-400 transition-colors">Open Pos:</span>
                    <span className="font-mono text-white">{metrics.openPositionCount}</span>
                </div>
                <div className="flex justify-between items-center group/stat">
                    <span className="text-text-muted group-hover/stat:text-gray-400 transition-colors">Win Rate:</span>
                    <span className={`font-mono ${metrics.winRate > 50 ? 'text-tv-green' : 'text-amber-400'}`}>
                        {metrics.winRate.toFixed(1)}%
                    </span>
                </div>
                <div className="flex justify-between items-center group/stat col-span-2">
                    <span className="text-text-muted group-hover/stat:text-gray-400 transition-colors">Profit Factor:</span>
                    <span className="font-mono text-tv-blue font-bold">
                        {metrics.profitFactor === Infinity ? '∞' : metrics.profitFactor.toFixed(2)}
                    </span>
                </div>
            </div>

            {/* Margin Health Bar */}
            <div className="w-full bg-bg-panel p-2 border border-bg-hover">
                <div className="flex justify-between items-center mb-1">
                    <span className="text-[10px] uppercase font-bold text-text-muted tracking-wider flex items-center gap-1">
                        <Shield size={10}/> Margin Utilization
                    </span>
                    <span className={`text-[10px] font-mono font-bold ${metrics.marginUtilization > 80 ? 'text-tv-red' : metrics.marginUtilization > 50 ? 'text-amber-500' : 'text-tv-blue'}`}>
                        {metrics.marginUtilization.toFixed(1)}%
                    </span>
                </div>
                
                <div className="w-full h-[6px] bg-bg-app overflow-hidden flex relative">
                    <div 
                        className={`h-full transition-all duration-500 ease-out ${metrics.marginUtilization > 80 ? 'bg-tv-red' : metrics.marginUtilization > 50 ? 'bg-amber-500' : 'bg-tv-blue'}`}
                        style={{ width: `${Math.min(100, Math.max(2, metrics.marginUtilization))}%` }} 
                    />
                    {/* Markers */}
                    <div className="absolute top-0 bottom-0 left-[50%] w-px bg-white/20"></div>
                    <div className="absolute top-0 bottom-0 left-[80%] w-px bg-tv-red/40"></div>
                </div>

                <div className="flex justify-between text-[9px] text-gray-500 font-mono mt-1.5">
                    <span>Used: {formatUsd(metrics.equity - metrics.availableMargin)}</span>
                    <span className="text-gray-400">Avail: {formatUsd(metrics.availableMargin)}</span>
                </div>
            </div>
            
            {/* Warning Overlay Box (Hidden unless critical) */}
            {metrics.marginUtilization > 90 && (
                <div className="mt-3 bg-tv-red/10 border border-tv-red/20 p-2 flex items-start gap-2 animate-pulse">
                    <AlertCircle size={12} className="text-tv-red shrink-0 mt-0.5" />
                    <span className="text-[9px] text-tv-red leading-tight">Critical Margin level. Addition of new positions or extreme market volatility may result in immediate liquidation.</span>
                </div>
            )}
        </div>
    );
}
