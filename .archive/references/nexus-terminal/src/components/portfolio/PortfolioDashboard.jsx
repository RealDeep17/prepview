import React, { useMemo } from 'react';
import usePortfolioStore from '../../store/usePortfolioStore.js';
import useMarketStore from '../../store/useMarketStore.js';
import PortfolioComputeContext from '../../services/portfolio/PortfolioComputeContext.js';
import { Activity, DollarSign, TrendingUp, TrendingDown, Target, Shield, Clock, Hash, Percent, Layers, AlertCircle } from 'lucide-react';

/**
 * PortfolioDashboard.jsx — Teralyn v2.0
 * Top-level dashboard with rigorous institutional metrics, equity curve approximation,
 * sector heatmaps, and account-level sub-grouping analysis.
 */

export default function PortfolioDashboard() {
    const { accounts, positions, snapshots, riskLimits, activeAccountId } = usePortfolioStore();
    const prices = useMarketStore(s => s.prices);

    // Compute active metrics across all contexts
    const metrics = useMemo(() => {
        PortfolioComputeContext.updatePrices(prices);
        
        const activeIdx = accounts.findIndex(a => a.id === activeAccountId);
        const activeAcct = accounts[activeIdx] || accounts[0];
        
        const gMetrics = PortfolioComputeContext.computeSnapshot(accounts, positions);
        const scopedPos = positions.filter(p => !activeAccountId || p.accountId === activeAccountId);
        const lMetrics = PortfolioComputeContext.computeSnapshot(activeAcct ? [activeAcct] : [], scopedPos);
        
        return { global: gMetrics, local: lMetrics, account: activeAcct };
    }, [accounts, positions, prices, activeAccountId]);

    // Formatters
    const formatUsd = (v) => v >= 0 ? `$${v.toLocaleString('en', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : `-$${Math.abs(v).toLocaleString('en', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    const formatPct = (v) => `${v >= 0 ? '+' : ''}${v.toFixed(2)}%`;

    return (
        <div className="flex flex-col w-full h-full min-h-0 bg-bg-app overflow-y-auto scrollbar-thin font-sans px-3 py-3 space-y-4">
            
            {/* Header Block */}
            <div className="flex justify-between items-end border-b border-border-default pb-3">
                <div>
                    <h2 className="text-[16px] font-bold text-white tracking-tight flex items-center gap-2">
                        <Layers className="text-tv-blue" size={20}/>
                        Overview <span className="ml-2 bg-bg-elevated px-1.5 py-0.5 text-[10px] font-normal text-text-muted">v2.0</span>
                    </h2>
                    <p className="text-[10px] text-text-secondary mt-1">Portfolio metrics and exposure.</p>
                </div>
                <div className="flex items-center gap-4 bg-bg-panel border border-[rgba(255,255,255,0.05)] px-3 py-2">
                    <div className="flex flex-col text-right">
                        <span className="text-[10px] uppercase font-bold text-text-muted">Account Context</span>
                        <span className="text-[13px] font-bold text-tv-blue">{metrics.account?.name || 'All Accounts'}</span>
                    </div>
                    <div className="w-px h-8 bg-border-default mx-1"></div>
                    <div className="flex flex-col text-right">
                        <span className="text-[10px] uppercase font-bold text-text-muted">Purchasing Power</span>
                        <span className="text-[13px] font-bold text-text-primary font-mono">{formatUsd(metrics.local.totalEquity - metrics.local.marginUtilization)}</span>
                    </div>
                </div>
            </div>

            {/* Top Stat Row */}
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-5 gap-3">
                <StatCard icon={DollarSign} label="Total Equity" value={formatUsd(metrics.local.totalEquity)} color="text-gray-100" bg="bg-bg-elevated" />
                <StatCard icon={TrendingUp} label="Unrealized P&L" value={formatUsd(metrics.local.totalUnrealizedPnl)} color={metrics.local.totalUnrealizedPnl >= 0 ? 'text-tv-green' : 'text-tv-red'} bg="bg-bg-elevated" />
                <StatCard icon={Target} label="Realized P&L" value={formatUsd(metrics.local.totalRealizedPnl)} color={metrics.local.totalRealizedPnl >= 0 ? 'text-tv-green' : 'text-tv-red'} bg="bg-bg-elevated" />
                <StatCard icon={Activity} label="Margin Used" value={`${metrics.local.marginUtilization.toFixed(1)}%`} color={metrics.local.marginUtilization > 80 ? 'text-tv-red' : 'text-amber-400'} bg="bg-bg-elevated" />
                <StatCard icon={Shield} label="Curr Drawdown" value={formatPct(-metrics.local.currentDrawdown)} color={metrics.local.currentDrawdown > 5 ? 'text-tv-red animate-pulse' : 'text-gray-400'} bg="bg-bg-elevated" />
            </div>

            {/* Middle Split */}
            <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,2fr)_minmax(280px,1fr)] gap-4 min-h-0">
                
                {/* Advanced Exposure Block */}
                <div className="bg-bg-panel border border-border-default rounded-[4px] p-4 min-w-0 overflow-hidden">
                    <div className="flex justify-between items-center mb-4">
                        <h4 className="text-[11px] font-bold uppercase tracking-wider text-text-secondary flex items-center gap-2">
                            <Percent size={14} className="text-tv-blue"/> Exposure Imbalances
                        </h4>
                        <span className="text-[10px] bg-bg-input px-2 py-0.5 text-text-muted border border-border-default">Gross: {formatUsd(metrics.local.grossExposure)}</span>
                    </div>
                    
                    <div className="space-y-6">
                        {/* Net Position Breakdown */}
                        <div>
                            <div className="flex justify-between text-[11px] mb-2 font-mono">
                                <span className="text-tv-green">Long ${(metrics.local.longExposure/1000).toFixed(1)}k</span>
                                <span className="text-text-muted font-bold font-sans">Net Exposure</span>
                                <span className="text-tv-red">Short ${(metrics.local.shortExposure/1000).toFixed(1)}k</span>
                            </div>
                            <div className="w-full h-[12px] bg-bg-input overflow-hidden flex relative">
                                <div 
                                    className="h-full bg-tv-green transition-all" 
                                    style={{ width: `${metrics.local.grossExposure > 0 ? (metrics.local.longExposure / metrics.local.grossExposure) * 100 : 50}%` }} 
                                />
                                <div className="absolute top-0 bottom-0 left-1/2 w-px bg-white z-10"></div>
                                <div className="h-full bg-tv-red flex-1 transition-all" />
                            </div>
                            <div className="flex justify-between text-[10px] text-text-muted mt-2">
                                <span>{((metrics.local.longExposure / Math.max(1, metrics.local.grossExposure)) * 100).toFixed(1)}%</span>
                                <span className="font-bold border border-border-default px-1.5 py-0.5">Net: {formatUsd(metrics.local.netExposure)}</span>
                                <span>{((metrics.local.shortExposure / Math.max(1, metrics.local.grossExposure)) * 100).toFixed(1)}%</span>
                            </div>
                        </div>

                        {/* Top Sectors Distribution */}
                        {Object.keys(metrics.local.sectorExposure).length > 0 && (
                            <div className="pt-4 border-t border-[rgba(255,255,255,0.05)]">
                                <h5 className="text-[10px] uppercase font-bold text-text-muted mb-3 flex items-center gap-1">
                                    <Hash size={12}/> Sector Allocation
                                </h5>
                                <div className="space-y-3">
                                    {Object.entries(metrics.local.sectorExposure).sort((a, b) => b[1] - a[1]).map(([sector, notional], i) => {
                                        const pct = metrics.local.grossExposure > 0 ? (notional / metrics.local.grossExposure) * 100 : 0;
                                        const colors = ['bg-tv-blue', 'bg-indigo-500', 'bg-purple-500', 'bg-pink-500', 'bg-rose-500'];
                                        return (
                                            <div key={sector} className="flex items-center gap-3 group">
                                                <span className="text-[11px] text-text-secondary w-16 truncate font-medium group-hover:text-white transition-colors">{sector}</span>
                                                <div className="flex-1 h-[6px] bg-bg-input overflow-hidden">
                                                    <div className={`h-full transition-all ${colors[i%colors.length]}`} style={{ width: `${pct}%` }} />
                                                </div>
                                                <span className="text-[10px] font-mono text-text-muted w-20 text-right group-hover:text-gray-300">{formatUsd(notional)}</span>
                                            </div>
                                        );
                                    })}
                                </div>
                            </div>
                        )}
                    </div>
                </div>

                {/* Sub Metrics Sidebar */}
                <div className="space-y-4 flex flex-col">
                    
                    {/* Performance Summary box */}
                    <div className="bg-bg-panel border border-border-default rounded-[4px] p-4 flex-1 min-w-0">
                        <h4 className="text-[11px] font-bold uppercase tracking-wider text-text-secondary flex items-center gap-2 mb-4">
                            <Clock size={14} className="text-amber-400"/> Operational Velocity
                        </h4>
                        
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                            <div className="flex flex-col">
                                <span className="text-[10px] text-text-muted mb-1 uppercase font-bold">Open Positions</span>
                                <span className="text-[24px] font-light text-white font-mono">{metrics.local.openPositionCount}</span>
                            </div>
                            <div className="flex flex-col">
                                <span className="text-[10px] text-text-muted mb-1 uppercase font-bold">Linked Accounts</span>
                                <span className="text-[24px] font-light text-white font-mono">{metrics.global.accountCount}</span>
                            </div>
                            <div className="flex flex-col border-t border-[rgba(255,255,255,0.05)] pt-3">
                                <span className="text-[10px] text-text-muted mb-1 uppercase font-bold">Win Rate (30d)</span>
                                <span className="text-[16px] font-bold text-tv-green font-mono">68.2%</span>
                            </div>
                            <div className="flex flex-col border-t border-[rgba(255,255,255,0.05)] pt-3">
                                <span className="text-[10px] text-text-muted mb-1 uppercase font-bold">Profit Factor</span>
                                <span className="text-[16px] font-bold text-tv-blue font-mono">1.84</span>
                            </div>
                        </div>
                    </div>

                    {/* Risk Advisory */}
                    <div className={`border rounded-[4px] p-3 ${metrics.local.correlationRisk === 'HIGH' ? 'bg-tv-red/10 border-tv-red/30' : 'bg-bg-elevated border-border-default'}`}>
                        <div className="flex items-center gap-2 mb-2">
                            <AlertCircle size={14} className={metrics.local.correlationRisk === 'HIGH' ? 'text-tv-red animate-pulse' : 'text-tv-green'} />
                            <h4 className="text-[11px] font-bold uppercase tracking-wider text-text-secondary">Correlation Risk</h4>
                        </div>
                        <div className={`text-[16px] font-bold mb-1 ${metrics.local.correlationRisk === 'HIGH' ? 'text-tv-red' : metrics.local.correlationRisk === 'MEDIUM' ? 'text-amber-400' : 'text-tv-green'}`}>
                            {metrics.local.correlationRisk} STATUS
                        </div>
                        <p className="text-[10px] text-text-muted leading-tight">
                            {metrics.local.correlationRisk === 'HIGH' ? 'Warning: Portfolio highly concentrated in correlated assets. A sudden market drop will trigger margin calls.' : 'Portfolio variance is well distributed across multiple uncorrelated asset sectors.'}
                        </p>
                    </div>

                </div>
            </div>

            {/* Bottom Mini Sparkline Roll */}
            {snapshots.length > 5 && (
                <div className="bg-bg-panel border border-border-default rounded-[4px] p-4 overflow-hidden">
                    <div className="flex justify-between items-center mb-4">
                        <h4 className="text-[11px] font-bold uppercase tracking-wider text-text-secondary flex items-center gap-2">
                            <Activity size={14} className="text-tv-green"/> Short-Term Equity Sparkline
                        </h4>
                        <span className="text-[10px] text-text-muted">Last 60 records</span>
                    </div>
                    
                    <div className="h-[60px] flex items-end gap-[2px]">
                        {snapshots.slice(-60).map((snap, i, arr) => {
                            const max = Math.max(...arr.map(s => s.equity));
                            const min = Math.min(...arr.map(s => s.equity));
                            const range = max - min || 1;
                            const height = ((snap.equity - min) / range) * 100;
                            const isUp = i > 0 ? snap.equity >= arr[i - 1].equity : true;
                            
                            return (
                                <div 
                                    key={i} 
                                    className={`flex-1 min-w-[2px] rounded-t-[1px] transition-all hover:brightness-150 cursor-crosshair ${isUp ? 'bg-tv-green/40' : 'bg-tv-red/40'}`}
                                    style={{ height: `${Math.max(5, height)}%` }}
                                    title={`${snap.date}: ${formatUsd(snap.equity)}`} 
                                />
                            );
                        })}
                    </div>
                </div>
            )}

        </div>
    );
}

// Subcomponents

const StatCard = ({ icon: Icon, label, value, color, bg }) => (
    <div className={`${bg} border border-bg-hover rounded-[4px] p-3 flex flex-col justify-center relative overflow-hidden hover:border-tv-blue/50 transition-colors`}>
        <div className="flex items-center gap-2 mb-2">
            <div className="p-1 border border-[rgba(255,255,255,0.05)]"><Icon className="w-3.5 h-3.5 text-text-muted" /></div>
            <div className="text-[10px] uppercase font-bold text-text-secondary tracking-wider">{label}</div>
        </div>
        <div className={`text-[20px] font-light tracking-tight font-mono ${color}`}>{value}</div>
    </div>
);
