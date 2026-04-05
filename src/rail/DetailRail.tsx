import { useState } from 'react';
import { useAppStore, selectedPosition } from '../store/appStore';
import { findExchangeMarket, fmtCompactCurrency, fmtCompactNumber, fmtCostClass, fmtCurrency, fmtPnl, fmtPnlClass, fmtPercent, fmtTimestamp, fmtRelativeTime } from '../lib/fmt';
import { buildFundingRateRows } from '../lib/fundingView';
import { deleteManualPosition, syncLiveAccount, setLanProjection, resetDatabase } from '../lib/bridge';
import { useToast } from '../shell/toastContext';
import type { PortfolioPosition } from '../lib/types';

export function DetailRail() {
  const bootstrap = useAppStore((s) => s.bootstrap);
  const openOverlay = useAppStore((s) => s.openOverlay);
  const fetchBootstrap = useAppStore((s) => s.fetchBootstrap);
  const position = useAppStore(selectedPosition);

  if (!bootstrap) return null;

  const handleDelete = async () => {
    if (!position) return;
    if (!confirm(`Delete position ${position.symbol}?`)) return;
    await deleteManualPosition(position.id);
    useAppStore.getState().setSelectedPositionId(null);
    await fetchBootstrap();
  };

  const handleSync = async () => {
    if (!position) return;
    await syncLiveAccount(position.accountId);
    await fetchBootstrap();
  };

  const handleReset = async () => {
    await resetDatabase();
    window.location.reload();
  };

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
    const market = findExchangeMarket(
      bootstrap.markets,
      position.exchange,
      position.symbol,
      position.exchangeSymbol,
    );
    const faceValue = market?.contractValue ?? 1.0;
    const tokenSize = position.quantity * faceValue;
    const notional = (position.markPrice ?? position.entryPrice) * tokenSize;

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
        <DetailRow label="Entry Price" value={fmtCompactCurrency(position.entryPrice)} />
        <DetailRow label="Mark Price" value={position.markPrice != null ? fmtCompactCurrency(position.markPrice) : '—'} />
        <DetailRow
          label="Liquidation"
          value={position.liquidationPrice != null ? fmtCompactCurrency(position.liquidationPrice) : '—'}
          suffix={position.riskSource === 'local_engine' ? 'est.' : position.riskSource === 'user_input' ? 'manual' : undefined}
        />
        <DetailRow label="Size" value={fmtCompactNumber(tokenSize, 6)} suffix={market?.baseAsset} />
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
          <span className={`detail-value ${fmtCostClass(position.feePaid)}`.trim()}>{fmtCurrency(position.feePaid)}</span>
        </div>
        <div className="detail-row">
          <span className="detail-label">Funding Paid</span>
          <span className={`detail-value ${fmtCostClass(position.fundingPaid)}`.trim()}>{fmtCurrency(position.fundingPaid)}</span>
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
            <span className="detail-value" style={{ color: 'var(--green)' }}>{fmtCompactCurrency(position.takeProfit)}</span>
          </div>
        )}
        {position.stopLoss != null && (
          <div className="detail-row">
            <span className="detail-label">Stop Loss</span>
            <span className="detail-value" style={{ color: 'var(--red)' }}>{fmtCompactCurrency(position.stopLoss)}</span>
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

        <BottomPanels bootstrap={bootstrap} position={position} onReset={handleReset} />
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

      <BottomPanels bootstrap={bootstrap} position={null} onReset={handleReset} />
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

function BottomPanels({
  bootstrap,
  position,
  onReset,
}: {
  bootstrap: NonNullable<ReturnType<typeof useAppStore.getState>['bootstrap']>;
  position: PortfolioPosition | null;
  onReset: () => Promise<void>;
}) {
  const fetchBootstrap = useAppStore((s) => s.fetchBootstrap);
  const { toast } = useToast();
  const [lanPassphrase, setLanPassphrase] = useState('');
  const [lanSaving, setLanSaving] = useState(false);
  const [lanError, setLanError] = useState<string | null>(null);
  const [resetStep, setResetStep] = useState<'idle' | 'confirm' | 'running' | 'error'>('idle');
  const [resetError, setResetError] = useState<string | null>(null);

  const applyLanState = async (enabled: boolean, exposeToLan: boolean) => {
    setLanSaving(true);
    setLanError(null);
    try {
      await setLanProjection(enabled, exposeToLan, lanPassphrase.trim() || undefined);
      await fetchBootstrap();
      if (lanPassphrase.trim()) {
        setLanPassphrase('');
      }
      toast(
        enabled
          ? exposeToLan
            ? 'LAN projection is live on your local network'
            : 'LAN projection is live on this machine only'
          : 'LAN projection disabled',
        enabled ? 'success' : 'info',
      );
    } catch (error) {
      setLanError(String(error));
    } finally {
      setLanSaving(false);
    }
  };

  const saveLanPassphrase = async () => {
    if (!lanPassphrase.trim()) {
      setLanError('Enter a LAN passphrase before saving.');
      return;
    }
    await applyLanState(bootstrap.lanStatus.enabled, bootstrap.lanStatus.exposeToLan);
  };

  const handleResetClick = async () => {
    if (resetStep === 'idle') { setResetStep('confirm'); return; }
    if (resetStep === 'confirm') {
      setResetStep('running');
      try {
        await onReset();
        // onReset calls location.reload() — we won't get here unless it fails
      } catch (err) {
        setResetError(String(err));
        setResetStep('error');
      }
    }
  };

  const relevantSyncJobs = position
    ? bootstrap.recentSyncJobs.filter((job) => job.accountId === position.accountId)
    : bootstrap.recentSyncJobs;
  const fundingRows = buildFundingRateRows(
    bootstrap.positions,
    bootstrap.markets,
    bootstrap.recentFundingEntries,
    position,
  );

  return (
    <>
      {fundingRows.length > 0 && (
        <>
          <div className="panel-title">Funding Rates</div>
          {fundingRows.map((row) => (
            <div key={row.key} className="funding-row">
              <div className="funding-stack">
                <span className="funding-symbol">{row.symbol}</span>
                <span className="funding-meta">
                  {row.accountName} · {row.side === 'long' ? 'Long' : 'Short'}
                </span>
              </div>
              <span className={`funding-rate ${row.rate == null ? '' : row.rate >= 0 ? 'pnl-positive' : 'pnl-negative'}`.trim()}>
                {row.rate == null ? '—' : fmtPercent(row.rate * 100)}
              </span>
            </div>
          ))}
        </>
      )}

      <div className="panel-title">{position ? 'Account Syncs' : 'Recent Syncs'}</div>
      {relevantSyncJobs.slice(0, 5).map((job) => (
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
      {relevantSyncJobs.length === 0 && (
        <div style={{ fontSize: 11, color: 'var(--text-muted)', padding: '4px 0' }}>
          {position ? 'No recent syncs for this account' : 'No sync jobs yet'}
        </div>
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
      <div className="detail-row">
        <span className="detail-label">Scope</span>
        <span className="detail-value">{bootstrap.lanStatus.exposeToLan ? 'Local network' : 'This machine only'}</span>
      </div>
      <div className="detail-row">
        <span className="detail-label">Auth</span>
        <span className="detail-value">{bootstrap.lanStatus.passphraseConfigured ? 'Bearer passphrase set' : 'Passphrase required'}</span>
      </div>
      {bootstrap.lanStatus.publicUrl && (
        <div className="lan-url" onClick={() => navigator.clipboard.writeText(bootstrap.lanStatus.publicUrl!)} title="Click to copy">
          {bootstrap.lanStatus.publicUrl}
        </div>
      )}
      <div style={{ marginTop: 8 }}>
        <input
          className="form-input"
          type="password"
          value={lanPassphrase}
          onChange={(event) => setLanPassphrase(event.target.value)}
          placeholder={bootstrap.lanStatus.passphraseConfigured ? 'Rotate saved LAN passphrase' : 'Set a LAN passphrase'}
        />
        <div className="form-hint" style={{ marginTop: 6 }}>
          LAN clients must send `Authorization: Bearer &lt;your-passphrase&gt;`. The passphrase is stored locally and never shown back in the UI.
        </div>
        {lanError && (
          <div style={{ color: 'var(--red)', fontSize: 11, marginTop: 6 }}>{lanError}</div>
        )}
      </div>
      <div style={{ marginTop: 8, display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        <button className="btn btn--ghost btn--small" onClick={saveLanPassphrase} disabled={lanSaving}>
          {lanSaving ? 'Saving…' : bootstrap.lanStatus.passphraseConfigured ? 'Rotate Pass' : 'Save Pass'}
        </button>
        <button className="btn btn--ghost btn--small" onClick={() => applyLanState(true, false)} disabled={lanSaving}>
          Local Only
        </button>
        <button className="btn btn--ghost btn--small" onClick={() => applyLanState(true, true)} disabled={lanSaving}>
          Expose on LAN
        </button>
        {bootstrap.lanStatus.enabled && (
          <button className="btn btn--ghost btn--small" onClick={() => applyLanState(false, bootstrap.lanStatus.exposeToLan)} disabled={lanSaving}>
            Disable
          </button>
        )}
      </div>
      {bootstrap.lanStatus.publicUrl && (
        <div className="form-hint" style={{ marginTop: 8 }}>
          Example:
          {' '}
          <span className="mono">curl -H "Authorization: Bearer &lt;passphrase&gt;" {bootstrap.lanStatus.publicUrl}/api/portfolio/summary</span>
        </div>
      )}

      {/* Danger zone — inline confirm, no native dialogs */}
      <div style={{ marginTop: 16, borderTop: '1px solid rgba(224,80,80,0.25)', paddingTop: 10 }}>
        <div style={{ fontSize: 10, color: 'var(--text-muted)', letterSpacing: '0.05em', marginBottom: 6 }}>DANGER ZONE</div>

        {resetStep === 'idle' && (
          <button
            className="btn btn--danger btn--small"
            style={{ width: '100%', fontSize: 10 }}
            onClick={handleResetClick}
          >
            Reset Database
          </button>
        )}

        {resetStep === 'confirm' && (
          <div style={{ background: 'rgba(224,80,80,0.12)', border: '1px solid rgba(224,80,80,0.4)', borderRadius: 4, padding: '8px 10px' }}>
            <div style={{ fontSize: 10, color: '#e05050', marginBottom: 6, lineHeight: 1.4 }}>
              ⚠ This will delete ALL accounts, positions and history. Cannot be undone.
            </div>
            <div style={{ display: 'flex', gap: 6 }}>
              <button className="btn btn--danger btn--small" style={{ flex: 1, fontSize: 10 }} onClick={handleResetClick}>
                Confirm Reset
              </button>
              <button className="btn btn--ghost btn--small" style={{ fontSize: 10 }} onClick={() => setResetStep('idle')}>
                Cancel
              </button>
            </div>
          </div>
        )}

        {resetStep === 'running' && (
          <div style={{ fontSize: 10, color: 'var(--text-muted)', padding: '6px 0' }}>Resetting…</div>
        )}

        {resetStep === 'error' && (
          <div style={{ fontSize: 10, color: '#e05050', padding: '6px 0' }}>
            Failed: {resetError}
            <button className="btn btn--ghost btn--small" style={{ marginLeft: 6, fontSize: 9 }} onClick={() => setResetStep('idle')}>Dismiss</button>
          </div>
        )}
      </div>
    </>
  );
}
