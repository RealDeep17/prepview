import { useCallback } from 'react';
import { useAppStore, selectedPosition } from '../store/appStore';
import { fmtCurrency, fmtPnl, fmtPnlClass, fmtPercent, fmtTimestamp, fmtRelativeTime } from '../lib/fmt';
import { deleteManualPosition, syncLiveAccount, setLanProjection, configureLanProjection } from '../lib/bridge';

export function DetailRail() {
  const bootstrap = useAppStore((s) => s.bootstrap);
  const openOverlay = useAppStore((s) => s.openOverlay);
  const fetchBootstrap = useAppStore((s) => s.fetchBootstrap);
  const state = useAppStore.getState();
  const position = selectedPosition(state);

  if (!bootstrap) return null;

  const handleDelete = useCallback(async () => {
    if (!position) return;
    if (!confirm(`Delete position ${position.symbol}?`)) return;
    await deleteManualPosition(position.id);
    useAppStore.getState().setSelectedPositionId(null);
    await fetchBootstrap();
  }, [position, fetchBootstrap]);

  const handleSync = useCallback(async () => {
    if (!position) return;
    await syncLiveAccount(position.accountId);
    await fetchBootstrap();
  }, [position, fetchBootstrap]);

  const handleLanToggle = useCallback(async () => {
    const current = bootstrap.lanStatus.enabled;
    await setLanProjection(!current);
    await fetchBootstrap();
  }, [bootstrap.lanStatus.enabled, fetchBootstrap]);

  const handleLanExpose = useCallback(async () => {
    await configureLanProjection(true, true);
    await fetchBootstrap();
  }, [fetchBootstrap]);

  // Position detail
  if (position) {
    const posAccount = bootstrap.accounts.find((a) => a.id === position.accountId);
    let positionBonusOffset = 0;
    if (posAccount && posAccount.bonusBalance > 0) {
      const loss = position.unrealizedPnl < 0 ? Math.abs(position.unrealizedPnl) : 0;
      const feeOffset = position.feePaid * posAccount.bonusFeeDeductionRate;
      const lossOffset = loss * posAccount.bonusLossDeductionRate;
      const fundingOffset = position.fundingPaid * posAccount.bonusFundingDeductionRate;
      positionBonusOffset = Math.min(feeOffset + lossOffset + fundingOffset, posAccount.bonusBalance);
    }
    const market = bootstrap.markets.find((m) => m.symbol.toUpperCase() === position.symbol.toUpperCase() && m.exchange.toLowerCase() === position.exchange.toLowerCase());
    const faceValue = market?.contractValue ?? 1.0;
    const notional = (position.markPrice ?? position.entryPrice) * position.quantity * faceValue;

    return (
      <>
        <div className="rail-header">
          <span>{position.symbol}</span>
          <span className={`side-tag side-tag--${position.side}`}>
            {position.side === 'long' ? 'Long' : 'Short'}
          </span>
          <span className="account-label">{position.accountName}</span>
        </div>

        <div className="panel-title">Position Detail</div>
        <DetailRow label="Entry Price" value={fmtCurrency(position.entryPrice)} />
        <DetailRow label="Mark Price" value={position.markPrice != null ? fmtCurrency(position.markPrice) : '—'} />
        <DetailRow
          label="Liquidation"
          value={position.liquidationPrice != null ? fmtCurrency(position.liquidationPrice) : '—'}
          suffix={position.riskSource === 'local_engine' ? 'est.' : position.riskSource === 'user_input' ? 'manual' : undefined}
        />
        <DetailRow label="Size" value={`${position.quantity}`} />
        <DetailRow label="Notional" value={fmtCurrency(notional)} />
        <DetailRow label="Leverage" value={`${position.leverage}×`} />
        {position.marginMode && <DetailRow label="Margin Mode" value={position.marginMode} />}
        <DetailRow label="Margin Used" value={position.marginUsed != null ? fmtCurrency(position.marginUsed) : '—'} />
        <DetailRow label="Maint. Margin" value={position.maintenanceMargin != null ? fmtCurrency(position.maintenanceMargin) : '—'} />
        {position.maintenanceMarginRate != null && (
          <DetailRow label="MMR" value={fmtPercent(position.maintenanceMarginRate * 100)} />
        )}

        <div className="panel-title">P&amp;L Breakdown</div>
        <div className="detail-row">
          <span className="detail-label">Unrealized</span>
          <span className={`detail-value ${fmtPnlClass(position.unrealizedPnl)}`}>{fmtPnl(position.unrealizedPnl)}</span>
        </div>
        <DetailRow label="Realized" value={fmtCurrency(position.realizedPnl)} />
        <div className="detail-row">
          <span className="detail-label">Fees Paid</span>
          <span className="detail-value pnl-negative">{fmtCurrency(position.feePaid)}</span>
        </div>
        <div className="detail-row">
          <span className="detail-label">Funding Paid</span>
          <span className="detail-value pnl-negative">{fmtCurrency(position.fundingPaid)}</span>
        </div>
        {positionBonusOffset > 0 && (
          <div className="detail-row">
            <span className="detail-label">Bonus Offset</span>
            <span className="detail-value" style={{ color: 'var(--accent)' }}>+{fmtCurrency(positionBonusOffset)}</span>
          </div>
        )}
        {position.takeProfit != null && (
          <div className="detail-row">
            <span className="detail-label">Take Profit</span>
            <span className="detail-value" style={{ color: 'var(--green)' }}>{fmtCurrency(position.takeProfit)}</span>
          </div>
        )}
        {position.stopLoss != null && (
          <div className="detail-row">
            <span className="detail-label">Stop Loss</span>
            <span className="detail-value" style={{ color: 'var(--red)' }}>{fmtCurrency(position.stopLoss)}</span>
          </div>
        )}
        <DetailRow label="Opened" value={fmtTimestamp(position.openedAt)} />

        {posAccount?.accountMode === 'manual' || posAccount?.accountMode === 'import' ? (
          <div className="rail-actions">
            <button className="btn btn--ghost" onClick={() => openOverlay('edit-position', position.id)}>
              Edit
            </button>
            <button className="btn btn--danger" onClick={handleDelete}>
              Delete
            </button>
          </div>
        ) : (
          <div className="rail-actions">
            <button className="btn btn--ghost" onClick={handleSync}>
              Sync Account
            </button>
          </div>
        )}

        <BottomPanels bootstrap={bootstrap} handleLanToggle={handleLanToggle} handleLanExpose={handleLanExpose} />
      </>
    );
  }

  // Default: portfolio overview info
  return (
    <>
      <div className="panel-title">Portfolio</div>
      <DetailRow label="Accounts" value={`${bootstrap.accounts.length}`} />
      <DetailRow label="Positions" value={`${bootstrap.positions.length}`} />
      <DetailRow label="Total Equity" value={fmtCurrency(bootstrap.summary.totalEquity)} />
      <DetailRow label="Fee Drag" value={fmtCurrency(bootstrap.performance.feeDrag)} />
      {bootstrap.performance.totalBonusOffset > 0 && (
        <DetailRow label="Total Bonus Offset" value={`+${fmtCurrency(bootstrap.performance.totalBonusOffset)}`} />
      )}

      <BottomPanels bootstrap={bootstrap} handleLanToggle={handleLanToggle} handleLanExpose={handleLanExpose} />
    </>
  );
}

function DetailRow({ label, value, suffix }: { label: string; value: string; suffix?: string }) {
  return (
    <div className="detail-row">
      <span className="detail-label">{label}</span>
      <span className="detail-value">
        {value}
        {suffix && <span className="risk-chip">{suffix}</span>}
      </span>
    </div>
  );
}

function BottomPanels({ bootstrap, handleLanToggle, handleLanExpose }: { bootstrap: NonNullable<ReturnType<typeof useAppStore.getState>['bootstrap']>; handleLanToggle: () => void; handleLanExpose: () => void }) {
  // Funding rates — deduplicate by symbol, show latest rate
  const fundingMap = new Map<string, number>();
  for (const entry of bootstrap.recentFundingEntries) {
    if (!fundingMap.has(entry.symbol)) {
      fundingMap.set(entry.symbol, entry.rate);
    }
  }

  return (
    <>
      {fundingMap.size > 0 && (
        <>
          <div className="panel-title">Funding Rates</div>
          {Array.from(fundingMap.entries()).map(([symbol, rate]) => (
            <div key={symbol} className="funding-row">
              <span className="funding-symbol">{symbol}</span>
              <span className={`funding-rate ${rate >= 0 ? 'pnl-positive' : 'pnl-negative'}`}>
                {(rate * 100).toFixed(4)}%
              </span>
            </div>
          ))}
        </>
      )}

      <div className="panel-title">Recent Syncs</div>
      {bootstrap.recentSyncJobs.slice(0, 5).map((job) => (
        <div key={job.id} className="sync-log-item">
          <div className="sync-log-header">
            <span className={`sync-dot ${job.state === 'success' ? 'sync-dot--synced' : job.state === 'failed' ? 'sync-dot--degraded' : 'sync-dot--syncing'}`} />
            <span>{job.accountName}</span>
            <span style={{ marginLeft: 'auto', color: 'var(--text-muted)' }}>{fmtRelativeTime(job.startedAt)}</span>
          </div>
          <div className="sync-log-detail">
            {job.syncedPositions} pos · {job.fundingEntries} funding · {job.attemptCount} att
            {job.errorMessage && <span className="pnl-negative"> · {job.errorMessage}</span>}
          </div>
        </div>
      ))}
      {bootstrap.recentSyncJobs.length === 0 && (
        <div style={{ fontSize: 11, color: 'var(--text-muted)', padding: '4px 0' }}>No sync jobs yet</div>
      )}

      <div className="panel-title">LAN Projection</div>
      <div className="detail-row">
        <span className="detail-label">Status</span>
        <span className="detail-value" style={{ color: bootstrap.lanStatus.enabled ? 'var(--green)' : 'var(--text-muted)' }}>
          {bootstrap.lanStatus.enabled ? 'Active' : 'Inactive'}
        </span>
      </div>
      <div className="detail-row">
        <span className="detail-label">Bind</span>
        <span className="detail-value">{bootstrap.lanStatus.bindAddress ?? '—'}</span>
      </div>
      {bootstrap.lanStatus.publicUrl && (
        <div className="lan-url" onClick={() => navigator.clipboard.writeText(bootstrap.lanStatus.publicUrl!)} title="Click to copy">
          {bootstrap.lanStatus.publicUrl}
        </div>
      )}
      <div style={{ marginTop: 8, display: 'flex', gap: 6 }}>
        <button className="btn btn--ghost btn--small" onClick={handleLanToggle}>
          {bootstrap.lanStatus.enabled ? 'Disable' : 'Enable'} LAN
        </button>
        {!bootstrap.lanStatus.publicUrl && bootstrap.lanStatus.enabled && (
          <button className="btn btn--ghost btn--small" onClick={handleLanExpose}>
            Expose to LAN
          </button>
        )}
      </div>
    </>
  );
}
