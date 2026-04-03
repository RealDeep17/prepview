import React, { useMemo } from 'react';
import usePortfolioStore from '../../store/usePortfolioStore.js';
import { Target, TrendingUp, TrendingDown, Clock, Activity, BarChart2, ShieldAlert } from 'lucide-react';

/**
 * PerformancePanel.jsx — Teralyn v2.0
 * Deep dive performance analytics incorporating institutional ratios (Sharpe, Sortino, Calmar),
 * multi-timeframe expectancy models, and daily PnL distribution visualizations.
 */

export default function PerformancePanel() {
    const { positions, snapshots, activeAccountId } = usePortfolioStore();

    // Heavy statistical computation block
    const stats = useMemo(() => {
        const closed = positions.filter(p => p.status === 'closed' && (!activeAccountId || p.accountId === activeAccountId));
        
        const wins = closed.filter(p => (p.realizedPnl || 0) > 0);
        const losses = closed.filter(p => (p.realizedPnl || 0) < 0);
        const breakevens = closed.filter(p => (p.realizedPnl || 0) === 0);
        
        const totalPnl = closed.reduce((s, p) => s + (p.realizedPnl || 0), 0);
        
        // Averages
        const avgWin = wins.length > 0 ? wins.reduce((s, p) => s + p.realizedPnl, 0) / wins.length : 0;
        const avgLoss = losses.length > 0 ? Math.abs(losses.reduce((s, p) => s + p.realizedPnl, 0) / losses.length) : 0;
        
        const winRate = closed.length > 0 ? (wins.length / closed.length) * 100 : 0;
        const profitFactor = avgLoss > 0 ? avgWin * wins.length / (avgLoss * losses.length) : avgWin > 0 ? Infinity : 0;
        
        // Edge expectancy Models
        const expectancy = closed.length > 0 ? (winRate / 100 * avgWin) - ((1 - winRate / 100) * avgLoss) : 0;
        const payoffRatio = avgLoss > 0 ? avgWin / avgLoss : 0;

        // Peak / Floor values
        const largestWin = wins.length > 0 ? Math.max(...wins.map(p => p.realizedPnl)) : 0;
        const largestLoss = losses.length > 0 ? Math.min(...losses.map(p => p.realizedPnl)) : 0;
        
        // Time in market
        const totalHoldTime = closed.reduce((s, p) => s + ((p.exitDate || p.createdAt) - p.createdAt), 0);
        const avgHoldTime = closed.length > 0 ? totalHoldTime / closed.length : 0;

        // Daily PnL Distribution map
        const dailyReturns = {};
        for (const snap of snapshots) {
            if (snap.date) {
                dailyReturns[snap.date] = snap.equity;
            }
        }
        
        // Compute daily delta sequence for Sharpe
        const deltas = [];
        let maxDD = 0;
        let runningPeak = 0;
        
        const dates = Object.keys(dailyReturns).sort();
        if (dates.length > 1) {
            for (let i = 1; i < dates.length; i++) {
                const prev = dailyReturns[dates[i-1]];
                const curr = dailyReturns[dates[i]];
                
                if (curr > runningPeak) runningPeak = curr;
                const dd = runningPeak > 0 ? (runningPeak - curr) / runningPeak : 0;
                if (dd > maxDD) maxDD = dd;

                if (prev > 0) {
                    deltas.push((curr - prev) / prev);
                }
            }
        }

        // Sharpe/Sortino approx (Assuming RFR ~ 0)
        let sharpe = 0;
        let sortino = 0;
        let calmar = 0;

        if (deltas.length > 0) {
            const meanDelta = deltas.reduce((a,b)=>a+b,0) / deltas.length;
            const variance = deltas.reduce((a,b)=>a+Math.pow(b - meanDelta, 2),0) / deltas.length;
            const stdDev = Math.sqrt(variance);
            
            // Annualize factors assuming 365 trade days for crypto
            const annRef = Math.sqrt(365);
            sharpe = stdDev > 0 ? (meanDelta / stdDev) * annRef : 0;

            const negativeDeltas = deltas.filter(d => d < 0);
            const downsideVar = negativeDeltas.length > 0 
                ? negativeDeltas.reduce((a,b)=>a+Math.pow(b, 2),0) / deltas.length 
                : 0; // Using zero mean target
            
            const downsideStdDev = Math.sqrt(downsideVar);
            sortino = downsideStdDev > 0 ? (meanDelta / downsideStdDev) * annRef : 0;

            // Calmar Ratio (Annualized Return / Max Drawdown)
            const annualizedReturn = meanDelta * 365;
            calmar = maxDD > 0 ? annualizedReturn / maxDD : 0;
        }

        // Streak computation
        let maxConsecWin = 0, maxConsecLoss = 0, consec = 0, prevWin = null;
        for (const p of closed.sort((a, b) => a.createdAt - b.createdAt)) {
            const isWin = (p.realizedPnl || 0) > 0;
            if (isWin === prevWin) consec++; else { consec = 1; prevWin = isWin; }
            if (isWin) maxConsecWin = Math.max(maxConsecWin, consec);
            else maxConsecLoss = Math.max(maxConsecLoss, consec);
        }

        return {
            totalTrades: closed.length, 
            wins: wins.length, 
            losses: losses.length, 
            breakevens: breakevens.length,
            totalPnl, avgWin, avgLoss, winRate, profitFactor, expectancy, payoffRatio,
            largestWin, largestLoss, maxConsecWin, maxConsecLoss,
            sharpe, sortino, calmar, maxDD: maxDD * 100,
            avgHoldTimeHours: avgHoldTime / (1000 * 60 * 60),
            deltas // For SVG distribution
        };
    }, [positions, snapshots, activeAccountId]);

    const formatUsd = (v) => v >= 0 ? `$${v.toFixed(2)}` : `-$$\Math.abs(v).toFixed(2)}`;

    if (stats.totalTrades === 0) {
        return (
            <div className="flex flex-col items-center justify-center h-full text-text-muted p-8 text-center bg-bg-app border-l border-border-default">
                <BarChart2 size={32} className="mb-4 opacity-20" />
                <h4 className="text-[14px] font-bold text-white uppercase tracking-wider mb-2">Insufficient Target Data</h4>
                <p className="text-[11px]">Execute and complete trades over multiple days to populate institutional performance profiles.</p>
            </div>
        );
    }

    return (
        <div className="flex flex-col h-full bg-bg-app border-l border-border-default overflow-hidden font-sans">
            
            {/* Header Area */}
            <div className="flex justify-between items-center p-3 border-b border-[rgba(255,255,255,0.05)] bg-bg-elevated shrink-0">
                <div className="flex items-center gap-2">
                    <Activity size={14} className="text-tv-blue"/>
                    <span className="text-[13px] font-bold text-text-primary">Performance Profile</span>
                </div>
            </div>

            <div className="flex-1 overflow-y-auto overflow-x-hidden no-scrollbar p-4 space-y-6">

                {/* Macro Scorecard Block */}
                <div className="grid grid-cols-2 gap-4">
                    {/* Primary Output */}
                    <div className="bg-bg-panel border border-[rgba(255,255,255,0.05)] rounded-[4px] p-4 col-span-2 flex items-center justify-between">
                        <div>
                            <span className="text-[11px] text-text-secondary uppercase font-bold tracking-wider block mb-1">Cumulative Net P&L</span>
                            <span className={`text-3xl font-mono font-bold tracking-tighter ${stats.totalPnl >= 0 ? 'text-tv-green' : 'text-tv-red'}`}>
                                {formatUsd(stats.totalPnl)}
                            </span>
                        </div>
                        
                        {/* Win rate visual gauge */}
                        <div className="w-[180px]">
                            <div className="flex justify-between text-[11px] font-mono mb-1">
                                <span className="text-tv-green">{stats.wins} Wins</span>
                                <span className="text-tv-red">{stats.losses} Losses</span>
                            </div>
                            <div className="w-full h-[6px] bg-[#1a1e28] rounded-full overflow-hidden flex relative shadow-inner">
                                <div className="h-full bg-tv-green/40 transition-all" style={{ width: `${stats.winRate}%` }} />
                                <div className="absolute top-0 bottom-0 left-1/2 w-px bg-bg-app z-10" />
                                <div className="h-full bg-tv-red/40 flex-1 transition-all" />
                            </div>
                            <div className="text-center text-[13px] font-bold text-white mt-1.5">{stats.winRate.toFixed(1)}% Strike Rate</div>
                        </div>
                    </div>
                </div>

                {/* Risk Adjusted Metrics Row */}
                <div>
                    <h5 className="text-[10px] uppercase font-bold text-text-muted mb-2 tracking-wider flex items-center gap-1.5">
                        <Target size={12}/> Institutional Ratios (Ann.)
                    </h5>
                    <div className="grid grid-cols-3 gap-2">
                        <ScoreCard 
                            name="Sharpe Ratio" 
                            val={stats.sharpe.toFixed(2)} 
                            score={stats.sharpe} 
                            thresholds={[1, 2, 3]} 
                            desc="Return vs Total Volatility"
                        />
                        <ScoreCard 
                            name="Sortino Ratio" 
                            val={stats.sortino.toFixed(2)} 
                            score={stats.sortino} 
                            thresholds={[1.5, 3, 5]} 
                            desc="Return vs Downside Risk"
                        />
                        <ScoreCard 
                            name="Calmar Ratio" 
                            val={stats.calmar.toFixed(2)} 
                            score={stats.calmar} 
                            thresholds={[0.5, 1.5, 3]} 
                            desc="Return vs Max Drawdown"
                        />
                    </div>
                </div>

                {/* Edge Diagnostics */}
                <div className="bg-[#161a25] border border-border-default rounded-[4px] overflow-hidden">
                    <div className="p-3 bg-[#1a1e28] border-b border-border-default">
                        <h5 className="text-[10px] uppercase font-bold text-text-muted tracking-wider">Trading Edge Diagnostics</h5>
                    </div>
                    <div className="grid grid-cols-2 lg:grid-cols-4 divide-y lg:divide-y-0 lg:divide-x divide-border-default">
                        
                        <div className="p-3 flex flex-col justify-center text-center group hover:bg-white/5 transition-colors">
                            <span className="text-[10px] text-text-secondary uppercase mb-1">Profit Factor</span>
                            <span className={`text-[18px] font-mono font-bold ${stats.profitFactor >= 2 ? 'text-tv-green' : stats.profitFactor >= 1.2 ? 'text-tv-blue' : 'text-tv-red'}`}>
                                {stats.profitFactor === Infinity ? '∞' : stats.profitFactor.toFixed(2)}
                            </span>
                        </div>
                        
                        <div className="p-3 flex flex-col justify-center text-center group hover:bg-white/5 transition-colors">
                            <span className="text-[10px] text-text-secondary uppercase mb-1">Expectancy</span>
                            <span className={`text-[18px] font-mono font-bold ${stats.expectancy >= 0 ? 'text-tv-green' : 'text-tv-red'}`}>
                                {formatUsd(stats.expectancy)}
                            </span>
                        </div>
                        
                        <div className="p-3 flex flex-col justify-center text-center group hover:bg-white/5 transition-colors">
                            <span className="text-[10px] text-text-secondary uppercase mb-1">Payoff Ratio</span>
                            <span className="text-[18px] font-mono font-bold text-gray-200">
                                {stats.payoffRatio.toFixed(2)}:1
                            </span>
                        </div>
                        
                        <div className="p-3 flex flex-col justify-center text-center group hover:bg-white/5 transition-colors">
                            <span className="text-[10px] text-text-secondary uppercase mb-1">Avg Hold Time</span>
                            <span className="text-[18px] font-mono font-bold text-gray-200">
                                {stats.avgHoldTimeHours < 1 ? `${(stats.avgHoldTimeHours * 60).toFixed(0)}m` : `${stats.avgHoldTimeHours.toFixed(1)}h`}
                            </span>
                        </div>

                    </div>
                </div>

                {/* Distribution Overview */}
                <div className="grid grid-cols-2 gap-4">
                    {/* Win/Loss Averages */}
                    <div className="bg-[#1a1e28] p-4 rounded-[4px] border border-border-default space-y-3">
                        <div className="flex justify-between items-center border-b border-bg-hover pb-2">
                            <span className="text-[11px] text-text-muted font-bold uppercase tracking-wider">Averages</span>
                            <span className="text-[10px] font-mono text-gray-400">Total: {stats.totalTrades}</span>
                        </div>
                        
                        <div className="flex justify-between items-center">
                            <span className="flex items-center gap-2 text-[11px] text-text-secondary"><TrendingUp size={12} className="text-tv-green"/> Average Win</span>
                            <span className="font-mono text-tv-green font-bold">{formatUsd(stats.avgWin)}</span>
                        </div>
                        
                        <div className="flex justify-between items-center">
                            <span className="flex items-center gap-2 text-[11px] text-text-secondary"><TrendingDown size={12} className="text-tv-red"/> Average Loss</span>
                            <span className="font-mono text-tv-red font-bold">{formatUsd(-stats.avgLoss)}</span>
                        </div>
                        
                        <div className="w-full h-[3px] bg-bg-app rounded-full overflow-hidden mt-1 relative">
                             {/* Size ratio visual */}
                             <div className="absolute top-0 bottom-0 left-0 bg-tv-green/40 transition-all" style={{width: `${stats.avgWin / (stats.avgWin + stats.avgLoss) * 100}%`}}></div>
                             <div className="absolute top-0 bottom-0 right-0 bg-tv-red/40 transition-all" style={{width: `${stats.avgLoss / (stats.avgWin + stats.avgLoss) * 100}%`}}></div>
                        </div>
                    </div>

                    {/* Extremes & Streaks */}
                    <div className="bg-[#1a1e28] p-4 rounded-[4px] border border-border-default space-y-3">
                        <div className="flex justify-between items-center border-b border-bg-hover pb-2">
                            <span className="text-[11px] text-text-muted font-bold uppercase tracking-wider">Outliers & Streaks</span>
                            <ShieldAlert size={12} className="text-amber-500"/>
                        </div>
                        
                        <div className="grid grid-cols-2 gap-x-2 gap-y-3 pt-1">
                            <div className="flex flex-col">
                                <span className="text-[9px] uppercase text-text-muted">Largest Win</span>
                                <span className="font-mono text-[12px] text-tv-green">{formatUsd(stats.largestWin)}</span>
                            </div>
                            <div className="flex flex-col">
                                <span className="text-[9px] uppercase text-text-muted">Largest Loss</span>
                                <span className="font-mono text-[12px] text-tv-red">{formatUsd(stats.largestLoss)}</span>
                            </div>
                            <div className="flex flex-col">
                                <span className="text-[9px] uppercase text-text-muted">Top Win Streak</span>
                                <span className="font-mono text-[12px] text-tv-blue">{stats.maxConsecWin} Trades</span>
                            </div>
                            <div className="flex flex-col">
                                <span className="text-[9px] uppercase text-text-muted">Top Loss Streak</span>
                                <span className="font-mono text-[12px] text-amber-500">{stats.maxConsecLoss} Trades</span>
                            </div>
                        </div>
                    </div>
                </div>

                {/* Ticker Tape distribution mini graphic */}
                {stats.deltas.length > 5 && (
                    <div className="mt-4 pt-4 border-t border-[rgba(255,255,255,0.05)]">
                        <h5 className="text-[10px] uppercase font-bold text-text-muted mb-2 tracking-wider">Return Distribution Profile (Daily Deltas)</h5>
                        <div className="relative h-12 flex items-end justify-center w-full bg-bg-panel border border-bg-hover rounded overflow-hidden p-1 gap-px">
                             {/* Central 0 Line */}
                            <div className="absolute top-1/2 left-0 right-0 h-px bg-white/10 z-0"></div>
                            
                            {stats.deltas.slice(-50).map((d, i) => {
                                // Scale bar height
                                const h = Math.min(100, Math.abs(d) * 500); // 20% move = max height
                                return (
                                    <div 
                                        key={i} 
                                        className={`w-full max-w-[4px] z-10 rounded-sm hover:brightness-150 transition-colors ${d >= 0 ? 'bg-tv-green/60' : 'bg-tv-red/60'}`} 
                                        style={{ 
                                            height: `${Math.max(2, h/2)}%`, 
                                            marginBottom: d >= 0 ? '50%' : `calc(50% - ${Math.max(2, h/2)}%)` 
                                        }}
                                        title={`${(d*100).toFixed(2)}% delta`}
                                    />
                                );
                            })}
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}

// Subcomponents

const ScoreCard = ({ name, val, score, thresholds, desc }) => {
    let colorClass = 'text-tv-red';
    let label = 'Suboptimal';
    if (score >= thresholds[2]) { colorClass = 'text-tv-blue'; label = 'Excellent'; }
    else if (score >= thresholds[1]) { colorClass = 'text-tv-green'; label = 'Good'; }
    else if (score >= thresholds[0]) { colorClass = 'text-amber-500'; label = 'Acceptable'; }

    // Ignore missing data
    if (isNaN(score) || score === 0) {
        colorClass = 'text-gray-500';
        label = 'N/A';
        val = '—';
    }

    return (
        <div className="bg-[#161a25] border border-border-default rounded-[4px] p-3 shadow-sm relative overflow-hidden group hover:border-[#3a3e49] transition-all">
            <div className="text-[10px] uppercase font-bold text-text-muted tracking-wider mb-2">{name}</div>
            <div className={`text-2xl font-mono font-bold ${colorClass} mb-1.5`}>{val}</div>
            
            <div className="flex justify-between items-end">
                <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded-[2px] border ${colorClass.replace('text-', 'bg-').replace('500', '500/10').replace('400', '400/10')} ${colorClass.replace('text-', 'border-').replace('500', '500/20').replace('400', '400/20')} ${colorClass}`}>
                    {label}
                </span>
            </div>

            <div className="absolute inset-0 bg-black/80 flex items-center justify-center p-3 text-center text-[10px] text-gray-300 opacity-0 group-hover:opacity-100 transition-opacity backdrop-blur-sm">
                {desc}
            </div>
        </div>
    );
};
