import React, { useMemo, useEffect, useRef } from 'react';
import { createChart } from 'lightweight-charts';
import usePortfolioStore from '../../store/usePortfolioStore.js';
import { Settings, Maximize2, DownloadCloud } from 'lucide-react';

/**
 * SnapshotHistoryPanel.jsx — Teralyn v2.0
 * Deep historical analysis panel integrating tabular records and
 * an interactive Lightweight Chart tracking equity, peak watermarks,
 * and drawdown depth.
 */
export default function SnapshotHistoryPanel() {
    const { snapshots } = usePortfolioStore();
    const chartContainerRef = useRef(null);
    const chartInstanceRef = useRef(null);

    // Compute Metrics
    const data = useMemo(() => {
        const sorted = [...snapshots].sort((a, b) => b.timestamp - a.timestamp); // newest first
        const chronological = [...snapshots].sort((a, b) => a.timestamp - b.timestamp); // oldest first
        
        let maxE = 0;
        let minE = Infinity;
        let maxDD = 0;
        
        const chartData = chronological.map(s => {
            if (s.equity > maxE) maxE = s.equity;
            if (s.equity < minE) minE = s.equity;
            if (s.drawdown > maxDD) maxDD = s.drawdown;
            
            // convert ms ts to seconds for LWC
            return {
                time: Math.floor(s.timestamp / 1000),
                value: s.equity
            };
        });

        // Compute high-water mark line
        let hwm = 0;
        const hwmData = chronological.map(s => {
            if (s.equity > hwm) hwm = s.equity;
            return {
                time: Math.floor(s.timestamp / 1000),
                value: hwm
            };
        });

        return { sorted, chartData, hwmData, stats: { maxE, minE, maxDD } };
    }, [snapshots]);

    // Setup Engine Context
    useEffect(() => {
        if (!chartContainerRef.current || data.chartData.length === 0) return;

        const colors = {
            bg: '#161a25',
            text: '#787b86',
            grid: 'rgba(255,255,255,0.03)',
        };

        const chart = createChart(chartContainerRef.current, {
            layout: { background: { type: 'solid', color: colors.bg }, textColor: colors.text, fontFamily: 'Inter, sans-serif' },
            grid: { vertLines: { color: colors.grid }, horzLines: { color: colors.grid } },
            rightPriceScale: { borderVisible: false, scaleMargins: { top: 0.1, bottom: 0.1 } },
            timeScale: { 
                borderVisible: false, 
                timeVisible: true,
                fixLeftEdge: true,
                fixRightEdge: true
            },
            crosshair: { mode: 1 },
            autoSize: true,
        });

        chartInstanceRef.current = chart;

        // Peak High Water Mark (HWM)
        const hwmSeries = chart.addLineSeries({
            color: 'rgba(38, 166, 154, 0.4)',
            lineWidth: 1,
            lineStyle: 1, // Dotted
            crosshairMarkerVisible: false,
            priceLineVisible: false
        });
        hwmSeries.setData(data.hwmData);

        // Core Equity Curve
        const equitySeries = chart.addAreaSeries({
            lineColor: '#2962ff',
            topColor: 'rgba(41, 98, 255, 0.2)',
            bottomColor: 'rgba(41, 98, 255, 0.0)',
            lineWidth: 2,
            crosshairMarkerVisible: true
        });
        equitySeries.setData(data.chartData);

        chart.timeScale().fitContent();

        return () => {
            if (chartInstanceRef.current) {
                chartInstanceRef.current.remove();
            }
        };
    }, [data.chartData, data.hwmData]);

    const formatUsd = (v) => v >= 0 ? `$${Math.abs(v).toLocaleString('en', {minimumFractionDigits: 2, maximumFractionDigits: 2})}` : `-$$\Math.abs(v).toLocaleString('en', {minimumFractionDigits: 2, maximumFractionDigits: 2})}`;

    if (data.sorted.length === 0) {
        return (
            <div className="flex flex-col items-center justify-center h-full text-text-muted bg-bg-app py-16">
                <div className="text-4xl mb-4 opacity-30 cursor-default">📅</div>
                <div className="text-[14px] font-bold uppercase tracking-wider text-text-primary mb-1">No Historical Snapshots</div>
                <div className="text-[11px]">System generates snapshots automatically at EOD or after major operations.</div>
            </div>
        );
    }

    return (
        <div className="flex flex-col h-full bg-bg-app border-l border-border-default overflow-hidden font-sans">
            
            {/* Context Actions */}
            <div className="flex justify-between items-center p-3 border-b border-[rgba(255,255,255,0.05)] bg-bg-elevated shrink-0">
                <div className="flex items-center gap-3">
                    <span className="text-[13px] font-bold text-text-primary">Snapshot History</span>
                    <span className="text-[10px] text-text-muted bg-white/5 px-2 py-0.5 rounded-full">{data.sorted.length} Days</span>
                </div>
                <div className="flex gap-2">
                    <button className="p-1 text-text-muted hover:text-white transition-colors" title="Export to CSV"><DownloadCloud size={14}/></button>
                    <button className="p-1 text-text-muted hover:text-white transition-colors" title="Configure Tracking"><Settings size={14}/></button>
                </div>
            </div>

            {/* Core Stats Overview */}
            <div className="grid grid-cols-4 gap-px bg-border-default shrink-0">
                <div className="bg-[#161a25] p-3 flex flex-col justify-center">
                    <span className="text-[10px] uppercase tracking-wider text-text-muted font-bold mb-1">Peak Equity</span>
                    <span className="text-[13px] font-mono text-tv-green font-bold">{formatUsd(data.stats.maxE)}</span>
                </div>
                <div className="bg-[#161a25] p-3 flex flex-col justify-center">
                    <span className="text-[10px] uppercase tracking-wider text-text-muted font-bold mb-1">Initial Capital</span>
                    <span className="text-[13px] font-mono text-text-primary font-bold">{formatUsd(data.sorted[data.sorted.length-1]?.equity)}</span>
                </div>
                <div className="bg-[#161a25] p-3 flex flex-col justify-center">
                    <span className="text-[10px] uppercase tracking-wider text-text-muted font-bold mb-1">Max Drawdown</span>
                    <span className="text-[13px] font-mono text-tv-red font-bold animate-pulse">{data.stats.maxDD.toFixed(1)}%</span>
                </div>
                <div className="bg-[#161a25] p-3 flex flex-col justify-center">
                    <span className="text-[10px] uppercase tracking-wider text-text-muted font-bold mb-1">All-Time Return</span>
                    <span className={`text-[13px] font-mono font-bold ${(data.sorted[0]?.equity / data.sorted[data.sorted.length-1]?.equity) > 1 ? 'text-tv-green' : 'text-tv-red'}`}>
                        {(((data.sorted[0]?.equity || 1) / (data.sorted[data.sorted.length-1]?.equity || 1) - 1) * 100).toFixed(2)}%
                    </span>
                </div>
            </div>

            {/* Interactive Chart Region */}
            <div className="h-[220px] shrink-0 border-b border-bg-hover relative">
                <div ref={chartContainerRef} className="absolute inset-0 z-0 bg-transparent"></div>
                <div className="absolute top-2 left-3 pointer-events-none z-10 flex gap-4">
                    <div className="flex items-center gap-1.5 opacity-80">
                        <div className="w-2 h-0 border-t-2 border-dashed border-tv-green"></div>
                        <span className="text-[9px] font-mono text-text-muted font-bold">High Water Mark (HWM)</span>
                    </div>
                </div>
            </div>

            {/* Tabular History Log */}
            <div className="flex-1 overflow-x-auto overflow-y-auto no-scrollbar relative min-w-[700px]">
                <table className="w-full text-[11px] border-collapse relative">
                    <thead className="sticky top-0 z-20 bg-[#1a1e28] shadow-sm">
                        <tr className="border-b border-border-default">
                            <th className="text-left px-4 py-2 text-text-secondary font-bold uppercase tracking-wider">Date Mark</th>
                            <th className="text-right px-4 py-2 text-text-secondary font-bold uppercase tracking-wider">Gross Equity</th>
                            <th className="text-right px-4 py-2 text-text-secondary font-bold uppercase tracking-wider">24h Net Change</th>
                            <th className="text-right px-4 py-2 text-text-secondary font-bold uppercase tracking-wider">DD% Depth</th>
                            <th className="text-right px-4 py-2 text-text-secondary font-bold uppercase tracking-wider">Lev Matrix</th>
                            <th className="text-right px-4 py-2 text-text-secondary font-bold uppercase tracking-wider">Open Pos</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-[rgba(255,255,255,0.02)]">
                        {data.sorted.map((snap, i) => {
                            const prev = data.sorted[i + 1];
                            const change = prev ? snap.equity - prev.equity : 0;
                            const changePct = prev && prev.equity > 0 ? (change / prev.equity) * 100 : 0;
                            const isUp = change >= 0;

                            return (
                                <tr key={snap.timestamp || i} className="hover:bg-bg-elevated transition-colors group cursor-default">
                                    <td className="px-4 py-2 text-gray-400 font-mono text-[10px]">
                                        <div className="flex items-center gap-2">
                                            {snap.date}
                                            <span className="opacity-0 group-hover:opacity-100 transition-opacity text-[9px] text-tv-blue">(T-{i})</span>
                                        </div>
                                    </td>
                                    
                                    <td className="px-4 py-2 text-right text-gray-200 font-mono font-bold">
                                        {formatUsd(snap.equity)}
                                    </td>
                                    
                                    <td className="px-4 py-2 text-right font-mono">
                                        <div className={`flex items-center justify-end gap-1.5 ${isUp ? 'text-tv-green' : 'text-tv-red'}`}>
                                            <span>{change !== 0 ? `${isUp ? '+' : ''}${formatUsd(change)}` : '—'}</span>
                                            <span className={`text-[9px] px-1 rounded ${isUp ? 'bg-tv-green/10' : 'bg-tv-red/10'}`}>
                                                {change !== 0 ? `(${isUp ? '+' : ''}${changePct.toFixed(2)}%)` : ''}
                                            </span>
                                        </div>
                                    </td>
                                    
                                    <td className="px-4 py-2 text-right font-mono">
                                        <span className={`${(snap.drawdown || 0) > 10 ? 'text-tv-red font-bold' : (snap.drawdown || 0) > 5 ? 'text-orange-400 font-bold' : 'text-text-secondary'}`}>
                                            {(snap.drawdown || 0).toFixed(1)}%
                                        </span>
                                    </td>
                                    
                                    <td className="px-4 py-2 text-right font-mono">
                                        <span className={`px-1.5 py-0.5 rounded text-[10px] ${(snap.leverageRatio || 0) > 5 ? 'bg-tv-red/10 text-tv-red' : 'bg-amber-400/10 text-amber-500'}`}>
                                            {(snap.leverageRatio || 0).toFixed(1)}x
                                        </span>
                                    </td>
                                    
                                    <td className="px-4 py-2 text-right font-mono text-gray-500">
                                        {snap.openPositions || 0}
                                    </td>
                                </tr>
                            );
                        })}
                    </tbody>
                </table>
            </div>

        </div>
    );
}
