import React, { useMemo, useState } from 'react';
import usePortfolioStore from '../../store/usePortfolioStore.js';
import useMarketStore from '../../store/useMarketStore.js';
import RiskEngine from '../../services/portfolio/RiskEngine.js';
import { AlertTriangle, Info, CheckCircle, Flame } from 'lucide-react';

/**
 * PortfolioHeatPanel.jsx — Teralyn v2.0
 * Advanced visual D3-style treemap modeling portfolio heat (capital at risk).
 * Sizes elements dynamically based on their proportion of the total risk pool.
 */

export default function PortfolioHeatPanel() {
    const { positions, activeAccountId, accounts } = usePortfolioStore();
    const prices = useMarketStore(s => s.prices);
    const [hoveredPos, setHoveredPos] = useState(null);

    const heat = useMemo(() => {
        const account = accounts.find(a => a.id === activeAccountId);
        const balance = account?.balance || 1;
        const openPos = positions.filter(p => p.status === 'open' && p.accountId === activeAccountId);
        return RiskEngine.calculatePortfolioHeat(openPos, balance);
    }, [positions, activeAccountId, accounts, prices]);

    // Status styling maps
    const STATUS_MAP = {
        'CRITICAL': { color: 'text-tv-red', bg: 'bg-tv-red', border: 'border-tv-red', glow: 'shadow-[0_0_15px_rgba(239,83,80,0.3)]', icon: Flame },
        'HIGH': { color: 'text-amber-500', bg: 'bg-amber-500', border: 'border-amber-500', glow: 'shadow-[0_0_15px_rgba(245,158,11,0.3)]', icon: AlertTriangle },
        'MODERATE': { color: 'text-yellow-400', bg: 'bg-yellow-400', border: 'border-yellow-400', glow: 'shadow-none', icon: Info },
        'OPTIMAL': { color: 'text-tv-green', bg: 'bg-tv-green', border: 'border-tv-green', glow: 'shadow-none', icon: CheckCircle }
    };

    const cfg = STATUS_MAP[heat.status] || STATUS_MAP['OPTIMAL'];
    const StatusIcon = cfg.icon;

    // Treemap layout calculation
    const treemapNodes = useMemo(() => {
        // We only map positions that have actual defined risk.
        // Positions without stops have 100% risk but we map them aggressively to flag them.
        const validRisks = heat.positionRisks.filter(p => p.riskAmount > 0);
        if (validRisks.length === 0) return [];

        const totalValidRisk = validRisks.reduce((s, p) => s + p.riskAmount, 0);
        
        // Simple linear fractional sizing for display boxes
        let cumulativePct = 0;
        return validRisks.sort((a,b) => b.riskAmount - a.riskAmount).map(p => {
            const fraction = p.riskAmount / totalValidRisk;
            const node = {
                ...p,
                width: `${fraction * 100}%`,
                left: `${cumulativePct * 100}%`
            };
            cumulativePct += fraction;
            return node;
        });

    }, [heat.positionRisks]);

    return (
        <div className="w-full flex flex-col font-sans h-full bg-bg-app border-l border-border-default overflow-hidden relative">
            
            {/* Header */}
            <div className="flex justify-between items-center px-4 py-3 border-b border-border-default bg-bg-elevated shrink-0">
                <div className="flex items-center gap-2">
                    <Flame size={14} className={cfg.color}/>
                    <span className="text-[12px] font-bold text-white uppercase tracking-wider">Portfolio Heat</span>
                </div>
                <div className={`flex items-center gap-1.5 px-2 py-0.5 rounded border text-[10px] font-bold tracking-widest uppercase ${cfg.color} ${cfg.border} bg-black/20 ${cfg.glow}`}>
                    <StatusIcon size={10}/>
                    {heat.status}
                </div>
            </div>

            <div className="flex-1 overflow-y-auto p-4 space-y-6">
                
                {/* Main Gauge Area */}
                <div className="flex flex-col items-center bg-bg-panel border border-[rgba(255,255,255,0.05)] rounded-[3px] p-6 shadow-sm">
                    <div className="text-[11px] font-bold text-text-muted uppercase tracking-wider mb-2">Total Capital Exposed</div>
                    
                    <div className="flex items-end gap-2 mb-6">
                        <span className={`text-5xl font-mono font-bold tracking-tighter ${cfg.color}`}>
                            {heat.heatPercent.toFixed(1)}<span className="text-[24px]">%</span>
                        </span>
                    </div>

                    {/* Gradient Threshold Bar */}
                    <div className="w-full h-[14px] bg-bg-panel rounded-full overflow-hidden relative shadow-inner">
                        <div className={`h-full rounded-full transition-all ${cfg.bg}`} style={{ width: `${Math.min(100, heat.heatPercent * 5)}%` }} />
                        
                        {/* Threshold vertical markers */}
                        <div className="absolute top-0 left-[15%] w-[2px] h-full bg-bg-panel" title="3% Boundary (Optimal)" />
                        <div className="absolute top-0 left-[30%] w-[2px] h-full bg-bg-panel" title="6% Boundary (Moderate)" />
                        <div className="absolute top-0 left-[50%] w-[2px] h-full bg-bg-panel" title="10% Boundary (High)" />
                    </div>

                    <div className="flex w-full justify-between items-center text-[9px] font-mono text-text-muted mt-1 px-1">
                        <span>0%</span>
                        <span className="absolute left-[15%] -translate-x-1/2">3% (Mod)</span>
                        <span className="absolute left-[30%] -translate-x-1/2">6% (High)</span>
                        <span className="absolute left-[50%] -translate-x-1/2 text-tv-red font-bold">10% (Crit)</span>
                        <span>20%+</span>
                    </div>
                </div>

                {/* Algorithmic Analysis Block */}
                <div className="grid grid-cols-2 gap-4">
                    <div className="bg-[#161a25] rounded-[3px] border border-border-default p-4 flex flex-col justify-center">
                        <span className="text-[10px] uppercase text-text-muted font-bold tracking-wider mb-1">Max Simulated Loss</span>
                        <span className="text-[18px] font-mono text-white font-bold">${heat.totalRisk.toFixed(2)}</span>
                        <span className="text-[10px] text-text-secondary mt-1">Sum of risk across all open positions.</span>
                    </div>

                    <div className={`rounded-[3px] border p-4 flex flex-col justify-center ${heat.positionsWithoutStops > 0 ? 'bg-tv-red/10 border-tv-red/30' : 'bg-[#161a25] border-border-default'}`}>
                        <span className={`text-[10px] uppercase font-bold tracking-wider mb-1 ${heat.positionsWithoutStops > 0 ? 'text-tv-red' : 'text-text-muted'}`}>
                            Positions w/o Safety
                        </span>
                        <span className={`text-[18px] font-mono font-bold ${heat.positionsWithoutStops > 0 ? 'text-white' : 'text-tv-green'}`}>
                            {heat.positionsWithoutStops}
                        </span>
                        <span className="text-[10px] text-text-secondary mt-1">
                            {heat.positionsWithoutStops > 0 ? 'Requires immediate Stop-Loss mapping.' : 'All positions strictly protected.'}
                        </span>
                    </div>
                </div>

                {/* AI Recommendation Panel */}
                <div className="bg-tv-blue/5 border border-tv-blue/20 rounded-[3px] p-4 text-[12px] leading-relaxed">
                    <div className="flex items-center gap-2 mb-2">
                        <Info size={14} className="text-tv-blue" />
                        <strong className="text-tv-blue tracking-wide uppercase font-bold text-[10px]">System Recommendation</strong>
                    </div>
                    <p className="text-white/80">{heat.recommendation}</p>
                </div>

                {/* Active Heat Treemap Area */}
                {treemapNodes.length > 0 && (
                    <div className="pt-2">
                        <h4 className="text-[10px] font-bold uppercase text-text-muted tracking-wider mb-3">Risk Allocation Treemap</h4>
                        
                        <div className="w-full h-[120px] bg-bg-panel rounded flex border border-border-default overflow-hidden relative">
                            {treemapNodes.map((node, i) => {
                                const isDanger = !node.hasStop || node.riskPercent > 5;
                                return (
                                    <div 
                                        key={node.symbol + String(i)}
                                        onMouseEnter={() => setHoveredPos(node)}
                                        onMouseLeave={() => setHoveredPos(null)}
                                        className={`h-full border-r border-bg-panel flex flex-col items-center justify-center relative cursor-crosshair transition-all hover:brightness-125
                                            ${!node.hasStop ? 'bg-tv-red border-tv-red/80' : node.riskPercent > 3 ? 'bg-amber-600 border-amber-500' : 'bg-tv-blue border-tv-blue/80'}`}
                                        style={{ width: node.width }}
                                    >
                                        {/* Truncated interior text depending on slice size */}
                                        {parseFloat(node.width) > 10 && (
                                            <>
                                                <span className="text-[10px] font-bold text-white uppercase tracking-widest opacity-90">{node.symbol.replace('USDT','')}</span>
                                                <span className="text-[9px] font-mono text-white/70">{node.riskPercent.toFixed(1)}%</span>
                                                {!node.hasStop && <Flame size={12} className="text-white animate-pulse mt-1"/>}
                                            </>
                                        )}
                                    </div>
                                );
                            })}
                        </div>
                    </div>
                )}
                
                {/* Details Popup when hovering Treemap */}
                {hoveredPos && (
                    <div className="bg-bg-elevated border border-gray-700/80 p-3 rounded-[3px] shadow-2xl flex flex-col gap-1 w-full mt-2 animate-in fade-in duration-100">
                        <div className="flex justify-between items-center border-b border-border-default pb-2 mb-1">
                            <span className="text-[12px] font-bold text-white uppercase tracking-wider">{hoveredPos.symbol}</span>
                            {!hoveredPos.hasStop ? (
                                <span className="bg-tv-red/10 text-tv-red border border-tv-red/20 px-2 py-0.5 rounded text-[9px] font-bold uppercase tracking-widest flex items-center gap-1">Unprotected</span>
                            ) : (
                                <span className="bg-tv-green/10 text-tv-green border border-tv-green/20 px-2 py-0.5 rounded text-[9px] font-bold uppercase tracking-widest">Protected</span>
                            )}
                        </div>
                        <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-[11px] pt-1">
                            <div className="flex justify-between"><span className="text-text-muted">Allocated Risk:</span> <span className={`font-mono font-bold ${hoveredPos.riskPercent > 3 ? 'text-tv-red' : 'text-white'}`}>{hoveredPos.riskPercent.toFixed(2)}%</span></div>
                            <div className="flex justify-between"><span className="text-text-muted">Risk Amount:</span> <span className="font-mono text-gray-300">${hoveredPos.riskAmount.toFixed(2)}</span></div>
                        </div>
                    </div>
                )}

            </div>
        </div>
    );
}
