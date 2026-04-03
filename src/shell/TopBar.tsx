import { useState, useEffect, useCallback } from 'react';
import { useAppStore } from '../store/appStore';
import { syncAllLiveAccounts, refreshPortfolioQuotes } from '../lib/bridge';
import { syncDotClass } from '../lib/fmt';
import type { ExchangeKind } from '../lib/types';

export function TopBar() {
  const bootstrap = useAppStore((s) => s.bootstrap);
  const scopeExchange = useAppStore((s) => s.scopeExchange);
  const setScopeExchange = useAppStore((s) => s.setScopeExchange);
  const openOverlay = useAppStore((s) => s.openOverlay);
  const fetchBootstrap = useAppStore((s) => s.fetchBootstrap);
  const [countdown, setCountdown] = useState<number | null>(null);

  const sync = bootstrap?.syncHealthSummary;
  const autoSync = bootstrap?.autoSyncStatus;

  useEffect(() => {
    if (!autoSync?.nextScheduledAt) { setCountdown(null); return; }
    const tick = () => {
      const remaining = Math.max(0, Math.floor((new Date(autoSync.nextScheduledAt!).getTime() - Date.now()) / 1000));
      setCountdown(remaining);
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [autoSync?.nextScheduledAt]);

  const uniqueExchanges = Array.from(new Set(bootstrap?.accounts.map((a) => a.exchange) ?? []));

  const handleSyncAll = useCallback(async () => {
    try {
      await syncAllLiveAccounts();
      await fetchBootstrap();
    } catch { /* error shown via sync health */ }
  }, [fetchBootstrap]);

  const handleRefreshQuotes = useCallback(async () => {
    try {
      await refreshPortfolioQuotes();
      await fetchBootstrap();
    } catch { /* ignore */ }
  }, [fetchBootstrap]);

  const dotClass = sync
    ? sync.tone === 'positive' ? 'sync-dot--synced'
    : sync.tone === 'negative' ? 'sync-dot--degraded'
    : 'sync-dot--local'
    : 'sync-dot--local';

  return (
    <div className="topbar">
      <span className="topbar-logo">CASSINI</span>
      <div className="scope-pills">
        <button
          className={`scope-pill${scopeExchange === 'all' ? ' scope-pill--active' : ''}`}
          onClick={() => setScopeExchange('all')}
        >
          All
        </button>
        {uniqueExchanges.map((ex) => (
          <button
            key={ex}
            className={`scope-pill${scopeExchange === ex ? ' scope-pill--active' : ''}`}
            onClick={() => setScopeExchange(ex as ExchangeKind)}
          >
            {ex === 'blofin' ? 'BloFin' : ex === 'hyperliquid' ? 'Hyperliquid' : ex === 'manual' ? 'Manual' : ex}
          </button>
        ))}
      </div>
      <span className="topbar-spacer" />
      <div className="sync-badge" onClick={handleSyncAll} style={{ cursor: 'pointer' }} title="Click to sync all">
        <span className={`sync-dot ${dotClass}`} />
        <span>{sync?.label ?? 'local'}</span>
        {countdown !== null && <span>· {countdown}s</span>}
      </div>
      <button className="btn btn--ghost btn--small" onClick={handleRefreshQuotes} title="Refresh quotes">
        ↻
      </button>
      <button className="btn btn--ghost" onClick={() => openOverlay('csv-import')}>
        Import CSV
      </button>
      <button className="btn btn--ghost" onClick={() => openOverlay('add-position')}>
        + Position
      </button>
      <button className="btn btn--primary" onClick={() => openOverlay('add-account')}>
        + Account
      </button>
    </div>
  );
}
