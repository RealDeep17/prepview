import React, { useMemo, useState } from 'react';
import usePortfolioStore from '../../store/usePortfolioStore.js';
import useMarketStore from '../../store/useMarketStore.js';
import PortfolioComputeContext from '../../services/portfolio/PortfolioComputeContext.js';
import { PieChart, List, AlertTriangle, Layers } from 'lucide-react';

/**
 * ExposurePanel.jsx — Teralyn v2.0
 * Deep visual exposure breakdown. By symbol, sector, and direction,
 * featuring interactive SVG donut charts and risk concentrations.
 */

export default function ExposurePanel() {
    const { accounts, positions, activeAccountId } = usePortfolioStore();
    const prices = useMarketStore(s => s.prices);
    
    const [viewMode, setViewMode] = useState('sector'); // 'sector' or 'symbol'

    const data = useMemo(() => {
        PortfolioComputeContext.updatePrices(prices);
        const openPos = positions.filter(p => p.status === 'open' && p.accountId === activeAccountId);
        
        const bySymbol = {};
        let totalLong = 0;
        let totalShort = 0;

        for (const pos of openPos) {
            const notional = PortfolioComputeContext.getNotional(pos);
            bySymbol[pos.symbol] = (bySymbol[pos.symbol] || 0) + (pos.side === 'LONG' ? notional : -notional);
            if (pos.side === 'LONG') totalLong += notional; else totalShort += notional;
        }

        const account = accounts.find(a => a.id === activeAccountId);
        const balance = account?.balance || 1;
        const gross = totalLong + totalShort;
        const net = totalLong - totalShort;
        
        const sectorExposureOrig = PortfolioComputeContext.computeSectorExposure(openPos);
        // Process for charting
        const sectors = Object.entries(sectorExposureOrig)
            .map(([name, val]) => ({ name, value: val, pct: gross > 0 ? val/gross*100 : 0 }))
            .sort((a,b) => b.value - a.value);

        const symbols = Object.entries(bySymbol)
            .map(([name, val]) => ({ name, value: Math.abs(val), raw: val, pct: gross > 0 ? Math.abs(val)/gross*100 : 0 }))
            .sort((a,b) => b.value - a.value);

        return { 
            bySymbol: symbols, 
            sectors, 
            totalLong, 
            totalShort, 
            net, 
            gross, 
            balance, 
            leverage: gross / balance 
        };
    }, [positions, prices, activeAccountId, accounts]);

    const formatUsd = (v) => `$${Math.abs(v).toLocaleString('en', { maximumFractionDigits: 0 })}`;

    if (!data.gross) {
        return (
            <div className="flex flex-col items-center justify-center p-8 text-text-muted text-[13px] h-full">
                <PieChart size={32} className="mb-4 opacity-20" />
                No active exposure to analyze.
            </div>
        );
    }

    // SVG Donut Generator Helper
    const DonutChart = ({ items, size = 120, thickness = 20 }) => {
        let currentAngle = 0;
        const center = size / 2;
        const radius = center - thickness / 2;
        const circumference = 2 * Math.PI * radius;
        
        const colors = ['#2962ff', '#ef5350', '#26a69a', '#ab47bc', '#ffa726', '#8d6e63', '#78909c'];

        return (
            <div className="relative flex justify-center items-center" style={{ width: size, height: size }}>
                <svg width={size} height={size} className="-rotate-90">
                    {items.map((item, i) => {
                        const slicePct = item.pct / 100;
                        const dasharray = `${slicePct * circumference} ${circumference}`;
                        const offset = currentAngle * circumference;
                        currentAngle += slicePct;

                        return (
                            <circle
                                key={item.name}
                                cx={center}
                                cy={center}
                                r={radius}
                                fill="none"
                                stroke={item.color || colors[i % colors.length]}
                                strokeWidth={thickness}
                                strokeDasharray={dasharray}
                                strokeDashoffset={-offset}
                                className="transition-all duration-500 hover:opacity-80 cursor-pointer"
                                strokeLinecap={items.length === 1 ? 'round' : 'butt'}
                            >
                                <title>{item.name}: {item.pct.toFixed(1)}%</title>
                            </circle>
                        );
                    })}
                </svg>
                <div className="absolute inset-0 flex flex-col items-center justify-center text-center pointer-events-none">
                    <span className="text-[10px] text-text-muted font-bold tracking-widest uppercase mb-[-2px]">Gross</span>
                    <span className="text-[12px] font-mono font-bold text-white">{formatUsd(data.gross)}</span>
                </div>
            </div>
        );
    };

    return (
        <div className="flex flex-col h-full bg-bg-app border-l border-border-default overflow-hidden font-sans">
            
            {/* Header */}
            <div className="flex justify-between items-center p-3 border-b border-[rgba(255,255,255,0.05)] bg-bg-elevated shrink-0">
                <div className="flex items-center gap-2">
                    <Layers size={14} className="text-tv-blue"/>
                    <span className="text-[13px] font-bold text-text-primary">Exposure Distribution</span>
                </div>
                
                <div className="flex bg-[#161a25] p-0.5 rounded border border-border-default">
                    <button 
                        className={`px-2 py-1 text-[10px] font-bold uppercase rounded ${viewMode === 'sector' ? 'bg-tv-blue text-white' : 'text-text-muted hover:text-white'}`}
                        onClick={() => setViewMode('sector')}
                    >Sector</button>
                    <button 
                        className={`px-2 py-1 text-[10px] font-bold uppercase rounded ${viewMode === 'symbol' ? 'bg-tv-blue text-white' : 'text-text-muted hover:text-white'}`}
                        onClick={() => setViewMode('symbol')}
                    >Asset</button>
                </div>
            </div>

            <div className="flex-1 overflow-y-auto no-scrollbar p-4 space-y-6">
                
                {/* At-a-Glance Donut Array */}
                <div className="flex gap-4">
                    
                    {/* Direction Donut */}
                    <div className="bg-[#161a25] border border-border-default rounded-[3px] p-4 flex-1 flex flex-col items-center justify-center">
                        <div className="text-[10px] uppercase font-bold text-text-muted tracking-wider mb-4 w-full text-left">Directional Risk</div>
                        <div className="flex justify-between w-full items-center gap-4">
                            <DonutChart 
                                size={100} 
                                thickness={12} 
                                items={[
                                    { name: 'Long', pct: (data.totalLong / data.gross) * 100, color: '#26a69a' },
                                    { name: 'Short', pct: (data.totalShort / data.gross) * 100, color: '#ef5350' }
                                ]} 
                            />
                            <div className="flex-1 space-y-2">
                                <div>
                                    <div className="text-[10px] text-tv-green font-bold uppercase flex justify-between"><span>Long</span> <span>{((data.totalLong / data.gross) * 100).toFixed(0)}%</span></div>
                                    <div className="text-[12px] font-mono font-bold text-white">{formatUsd(data.totalLong)}</div>
                                </div>
                                <div className="border-t border-border-default pt-2">
                                    <div className="text-[10px] text-tv-red font-bold uppercase flex justify-between"><span>Short</span> <span>{((data.totalShort / data.gross) * 100).toFixed(0)}%</span></div>
                                    <div className="text-[12px] font-mono font-bold text-white">{formatUsd(data.totalShort)}</div>
                                </div>
                            </div>
                        </div>
                    </div>

                    {/* Breakdown Donut */}
                    <div className="bg-[#161a25] border border-border-default rounded-[3px] p-4 flex-1 flex flex-col items-center justify-center">
                        <div className="text-[10px] uppercase font-bold text-text-muted tracking-wider mb-4 w-full text-left">
                            Capital Allocation ({viewMode})
                        </div>
                        <div className="flex justify-center w-full">
                            <DonutChart 
                                size={120} 
                                thickness={24} 
                                items={viewMode === 'sector' ? data.sectors : data.bySymbol} 
                            />
                        </div>
                    </div>
                </div>

                {/* Leverage Meter */}
                <div className="bg-bg-panel border border-[rgba(255,255,255,0.05)] rounded-[3px] p-4">
                    <div className="flex justify-between items-end mb-2">
                        <div className="flex items-center gap-1.5">
                            {data.leverage > 8 ? <AlertTriangle size={14} className="text-tv-red animate-pulse"/> : null}
                            <span className="text-[11px] font-bold text-text-secondary uppercase tracking-wider">Effective Leverage Rating</span>
                        </div>
                        <span className={`text-[16px] font-mono font-bold ${data.leverage > 8 ? 'text-tv-red' : data.leverage > 3 ? 'text-amber-400' : 'text-tv-blue'}`}>
                            {data.leverage.toFixed(2)}x
                        </span>
                    </div>
                    
                    {/* Visual Meter */}
                    <div className="w-full h-[8px] bg-bg-panel rounded-full overflow-hidden flex relative">
                        {/* Safe Zone (1x) */}
                        <div className="h-full bg-tv-green/40 absolute left-0" style={{ width: '10%' }} title="Neutral (0-1x)"></div>
                        {/* Moderate Zone (to 3x) */}
                        <div className="h-full bg-amber-400/40 absolute left-[10%]" style={{ width: '20%' }} title="Margined (1-3x)"></div>
                        {/* High Risk Zone (3x+) */}
                        <div className="h-full bg-tv-red/40 absolute left-[30%] right-0" title="High Leverage (>3x)"></div>
                        
                        {/* Current Marker Tracker */}
                        <div 
                            className="absolute top-0 bottom-0 w-[4px] bg-white rounded-full shadow-[0_0_8px_white] transition-all z-10" 
                            style={{ left: `${Math.min(98, data.leverage * 10)}%` }}
                        />
                    </div>
                    
                    <div className="flex justify-between mt-1 px-1">
                        <span className="text-[9px] text-text-muted font-mono">0x</span>
                        <span className="text-[9px] text-text-muted font-mono">10x</span>
                    </div>
                </div>

                {/* Deep Dive List */}
                <div className="bg-[#161a25] border border-border-default rounded-[3px] p-4">
                    <div className="flex items-center gap-2 mb-4">
                        <List size={14} className="text-tv-blue"/>
                        <h4 className="text-[11px] font-bold text-text-primary uppercase tracking-wider">
                            Ranked by {viewMode} Concentration
                        </h4>
                    </div>
                    
                    <div className="space-y-3">
                        {(viewMode === 'sector' ? data.sectors : data.bySymbol).map((item, idx) => {
                            const isSymbol = viewMode === 'symbol';
                            const isLong = isSymbol && item.raw >= 0;
                            
                            return (
                                <div key={item.name} className="flex flex-col gap-1 group">
                                    <div className="flex justify-between items-center text-[11px]">
                                        <div className="flex items-center gap-2">
                                            <span className="text-text-muted font-mono text-[9px]">{(idx + 1).toString().padStart(2, '0')}</span>
                                            <span className={`font-bold ${isSymbol ? 'text-gray-200' : 'text-gray-400'}`}>
                                                {item.name.replace('USDT', '')}
                                            </span>
                                            {isSymbol && (
                                                <span className={`text-[9px] px-1 rounded [font-size:8px] leading-tight flex items-center justify-center ${isLong ? 'bg-tv-green/20 text-tv-green' : 'bg-tv-red/20 text-tv-red'}`}>
                                                    {isLong ? 'L' : 'S'}
                                                </span>
                                            )}
                                        </div>
                                        <div className="flex items-center gap-3">
                                            <span className="font-mono text-gray-400">{formatUsd(item.value)}</span>
                                            <span className="font-mono font-bold text-white w-10 text-right">{item.pct.toFixed(1)}%</span>
                                        </div>
                                    </div>
                                    
                                    <div className="w-full h-1.5 bg-bg-panel rounded-full overflow-hidden">
                                        <div 
                                            className={`h-full rounded-full transition-all group-hover:brightness-125 ${!isSymbol ? 'bg-tv-blue/70' : isLong ? 'bg-tv-green/50' : 'bg-tv-red/50'}`} 
                                            style={{ width: `${item.pct}%` }} 
                                        />
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                </div>

            </div>
        </div>
    );
}
