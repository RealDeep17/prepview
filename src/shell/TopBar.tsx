import { useState, useCallback, useEffect, useRef } from 'react';
import { useAppStore } from '../store/appStore';
import { syncAllLiveAccounts, refreshPortfolioQuotes } from '../lib/bridge';
import type { ExchangeKind } from '../lib/types';

// SVG icons that mirror the VS Code / IDE layout panel toggle style
const IconLeft = ({ active }: { active: boolean }) => (
  <svg width="16" height="14" viewBox="0 0 16 14" fill="none">
    <rect x="0.5" y="0.5" width="15" height="13" rx="1.5" stroke="currentColor" strokeOpacity={active ? 1 : 0.4} />
    <rect x="1" y="1" width="5" height="12" rx="1" fill="currentColor" fillOpacity={active ? 0.9 : 0.2} />
  </svg>
);
const IconRight = ({ active }: { active: boolean }) => (
  <svg width="16" height="14" viewBox="0 0 16 14" fill="none">
    <rect x="0.5" y="0.5" width="15" height="13" rx="1.5" stroke="currentColor" strokeOpacity={active ? 1 : 0.4} />
    <rect x="10" y="1" width="5" height="12" rx="1" fill="currentColor" fillOpacity={active ? 0.9 : 0.2} />
  </svg>
);
const IconBottom = ({ active }: { active: boolean }) => (
  <svg width="16" height="14" viewBox="0 0 16 14" fill="none">
    <rect x="0.5" y="0.5" width="15" height="13" rx="1.5" stroke="currentColor" strokeOpacity={active ? 1 : 0.4} />
    <rect x="1" y="8" width="14" height="5" rx="1" fill="currentColor" fillOpacity={active ? 0.9 : 0.2} />
  </svg>
);

const ZOOM_LEVELS = [0.75, 0.85, 1, 1.25, 1.5, 2] as const;

export function TopBar() {
  const bootstrap        = useAppStore((s) => s.bootstrap);
  const scopeExchange    = useAppStore((s) => s.scopeExchange);
  const setScopeExchange = useAppStore((s) => s.setScopeExchange);
  const openOverlay      = useAppStore((s) => s.openOverlay);
  const fetchBootstrap   = useAppStore((s) => s.fetchBootstrap);
  const leftPanelOpen    = useAppStore((s) => s.leftPanelOpen);
  const rightPanelOpen   = useAppStore((s) => s.rightPanelOpen);
  const chartOpen        = useAppStore((s) => s.chartOpen);
  const toggleLeftPanel  = useAppStore((s) => s.toggleLeftPanel);
  const toggleRightPanel = useAppStore((s) => s.toggleRightPanel);
  const toggleChart      = useAppStore((s) => s.toggleChart);
  const [nowTick, setNowTick] = useState(() => Date.now());
  const [zoom, setZoom] = useState(1);
  const [zoomOpen, setZoomOpen] = useState(false);
  const zoomRef = useRef<HTMLDivElement>(null);

  const sync = bootstrap?.syncHealthSummary;
  const autoSync = bootstrap?.autoSyncStatus;
  const nextScheduledMs = autoSync?.nextScheduledAt
    ? new Date(autoSync.nextScheduledAt).getTime()
    : null;

  useEffect(() => {
    if (!nextScheduledMs) return;
    const id = setInterval(() => {
      setNowTick(Date.now());
    }, 1000);
    return () => clearInterval(id);
  }, [nextScheduledMs]);

  const countdownValue = nextScheduledMs
    ? Math.max(0, Math.floor((nextScheduledMs - nowTick) / 1000))
    : null;

  // Close zoom dropdown on outside click
  useEffect(() => {
    if (!zoomOpen) return;
    const handler = (e: MouseEvent) => {
      if (zoomRef.current && !zoomRef.current.contains(e.target as Node)) setZoomOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [zoomOpen]);

  const handleZoom = useCallback((level: number) => {
    setZoom(level);
    setZoomOpen(false);
    document.documentElement.style.setProperty('--app-zoom', String(level));
  }, []);

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
      <span className="topbar-logo">PREPVIEW</span>
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

      {/* Zoom dropdown */}
      <div className="zoom-dropdown" ref={zoomRef}>
        <button
          className="btn btn--ghost btn--small zoom-trigger"
          onClick={() => setZoomOpen(!zoomOpen)}
          title="UI Scale"
        >
          {Math.round(zoom * 100)}%
        </button>
        {zoomOpen && (
          <div className="zoom-popover">
            <div className="zoom-popover-label">UI Scale</div>
            {ZOOM_LEVELS.map((level) => (
              <button
                key={level}
                className={`zoom-popover-item${zoom === level ? ' zoom-popover-item--active' : ''}`}
                onClick={() => handleZoom(level)}
              >
                {Math.round(level * 100)}%
                {level === 1 && <span className="zoom-default-badge">default</span>}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Layout panel toggles — IDE style, next to zoom */}
      <div className="layout-toggles">
        <button
          className={`layout-toggle-btn${leftPanelOpen ? ' active' : ''}`}
          onClick={toggleLeftPanel}
          title={leftPanelOpen ? 'Hide accounts panel' : 'Show accounts panel'}
        >
          <IconLeft active={leftPanelOpen} />
        </button>
        <button
          className={`layout-toggle-btn${chartOpen ? ' active' : ''}`}
          onClick={toggleChart}
          title={chartOpen ? 'Hide charts' : 'Show charts'}
        >
          <IconBottom active={chartOpen} />
        </button>
        <button
          className={`layout-toggle-btn${rightPanelOpen ? ' active' : ''}`}
          onClick={toggleRightPanel}
          title={rightPanelOpen ? 'Hide detail panel' : 'Show detail panel'}
        >
          <IconRight active={rightPanelOpen} />
        </button>
      </div>
      <div className="sync-badge" onClick={handleSyncAll} style={{ cursor: 'pointer' }} title="Click to sync all">
        <span className={`sync-dot ${dotClass}`} />
        <span>{sync?.label ?? 'local'}</span>
        {countdownValue !== null && <span>· {countdownValue}s</span>}
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
