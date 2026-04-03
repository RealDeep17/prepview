import React, { useMemo } from 'react';
import usePortfolioStore from '../../store/usePortfolioStore.js';

function formatUsd(value) {
    if (!Number.isFinite(value)) return '—';
    const abs = Math.abs(value);
    const prefix = value < 0 ? '-$' : '$';
    if (abs >= 1e9) return `${prefix}${(abs / 1e9).toFixed(2)}B`;
    if (abs >= 1e6) return `${prefix}${(abs / 1e6).toFixed(2)}M`;
    if (abs >= 1e3) return `${prefix}${(abs / 1e3).toFixed(1)}K`;
    return `${prefix}${abs.toFixed(2)}`;
}

function MiniStat({ label, value, tone = 'neutral' }) {
    const toneClass = {
        positive: 'text-emerald-300',
        negative: 'text-rose-300',
        neutral: 'text-gray-100',
        muted: 'text-gray-300'
    }[tone] || 'text-gray-100';

    return (
        <div className="rounded-2xl border border-white/8 bg-white/[0.03] px-3 py-3">
            <div className="text-[10px] uppercase tracking-[0.18em] text-gray-500">{label}</div>
            <div className={`mt-2 text-lg font-semibold tracking-tight ${toneClass}`}>{value}</div>
        </div>
    );
}

export default function DockPortfolioTab() {
    const { accounts, positions, activeAccountId, setActiveAccount } = usePortfolioStore();

    const summary = useMemo(() => {
        const activePositions = (positions || []).filter(position => position.status === 'open');
        const grossExposure = activePositions.reduce((sum, position) => {
            const notional = Number(position.entryPrice || 0) * Number(position.quantity || 0);
            return sum + Math.abs(notional);
        }, 0);
        const realizedPnl = (positions || []).reduce((sum, position) => sum + Number(position.realizedPnl || 0), 0);
        const totalBalance = (accounts || []).reduce((sum, account) => sum + Number(account.balance || 0), 0);

        return {
            openPositions: activePositions.length,
            grossExposure,
            realizedPnl,
            totalBalance
        };
    }, [accounts, positions]);

    return (
        <div className="flex h-full flex-col bg-transparent text-gray-200">
            <div className="border-b border-white/6 px-4 py-4">
                <div className="text-[10px] font-semibold uppercase tracking-[0.24em] text-gray-500">Portfolio Dock</div>
                <div className="mt-1 text-[16px] font-semibold tracking-tight text-white">Exposure snapshot</div>
                <p className="mt-1 text-[11px] leading-relaxed text-gray-500">
                    Monitor live exposure, capital context, and active accounts without loading the full portfolio workspace.
                </p>
            </div>

            <div className="flex-1 overflow-y-auto scrollbar-thin px-4 py-4 space-y-4">
                <div className="grid grid-cols-2 gap-3">
                    <MiniStat label="Equity" value={formatUsd(summary.totalBalance)} />
                    <MiniStat label="Gross Exp." value={formatUsd(summary.grossExposure)} tone="muted" />
                    <MiniStat label="Open Pos." value={String(summary.openPositions)} tone="muted" />
                    <MiniStat
                        label="Realized PnL"
                        value={formatUsd(summary.realizedPnl)}
                        tone={summary.realizedPnl >= 0 ? 'positive' : 'negative'}
                    />
                </div>

                <div className="rounded-[24px] border border-white/8 bg-white/[0.03] px-4 py-4">
                    <div className="flex items-center justify-between">
                        <div className="text-[11px] font-semibold uppercase tracking-[0.2em] text-gray-400">Accounts</div>
                        <div className="text-[10px] text-gray-500">{accounts.length} linked</div>
                    </div>

                    <div className="mt-3 space-y-2">
                        {accounts.map(account => {
                            const isActive = account.id === activeAccountId;
                            return (
                                <button
                                    key={account.id}
                                    onClick={() => setActiveAccount(account.id)}
                                    className={`w-full rounded-2xl border px-3 py-3 text-left transition-colors ${
                                        isActive
                                            ? 'border-blue-400/25 bg-blue-500/10'
                                            : 'border-white/8 bg-black/20 hover:bg-white/[0.04]'
                                    }`}
                                >
                                    <div className="flex items-center justify-between gap-3">
                                        <div className="min-w-0">
                                            <div className="truncate text-[13px] font-semibold text-white">{account.name}</div>
                                            <div className="mt-1 text-[10px] uppercase tracking-[0.16em] text-gray-500">{account.exchange?.replace('_', ' ')}</div>
                                        </div>
                                        <div className="text-right">
                                            <div className="text-[12px] font-semibold text-gray-100">{formatUsd(account.balance || 0)}</div>
                                            {isActive && <div className="mt-1 text-[10px] uppercase tracking-[0.16em] text-blue-200">Active</div>}
                                        </div>
                                    </div>
                                </button>
                            );
                        })}
                    </div>
                </div>
            </div>
        </div>
    );
}
