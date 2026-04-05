import { useState } from 'react';
import { useAppStore } from '../store/appStore';
import { useContextMenu, type CtxMenuItem } from '../shell/contextMenuContext';
import { useToast } from '../shell/toastContext';
import { fmtCurrency, fmtPnl, fmtPnlClass, fmtPercent, fmtRelativeTime, exchangeTagClass, syncDotClass } from '../lib/fmt';
import { deleteAccount, syncLiveAccount } from '../lib/bridge';

export function AccountsRail() {
  // Reactive selectors — these will re-render on bootstrap changes
  const bootstrap = useAppStore((s) => s.bootstrap);
  const scopeAccountId = useAppStore((s) => s.scopeAccountId);
  const setSelectedAccountId = useAppStore((s) => s.setSelectedAccountId);
  const setScopeAccountId = useAppStore((s) => s.setScopeAccountId);
  const openOverlay = useAppStore((s) => s.openOverlay);
  const fetchBootstrap = useAppStore((s) => s.fetchBootstrap);
  const { show: showCtx } = useContextMenu();
  const { toast } = useToast();
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  if (!bootstrap) return null;

  const accounts = bootstrap.accounts;
  const positions = bootstrap.positions;

  const handleClick = (accountId: string) => {
    if (scopeAccountId === accountId) {
      setSelectedAccountId(null);
      setScopeAccountId(null);
    } else {
      setSelectedAccountId(accountId);
      setScopeAccountId(accountId);
    }
  };

  const handleDelete = async (accountId: string, accountName: string) => {
    try {
      await deleteAccount(accountId);
      setSelectedAccountId(null);
      setScopeAccountId(null);
      setConfirmDeleteId(null);
      await fetchBootstrap();
      toast(`Deleted "${accountName}"`, 'info');
    } catch (e) {
      toast(`Failed to delete: ${e}`, 'error');
    }
  };

  const handleContextMenu = (e: React.MouseEvent, accountId: string, accountName: string, exchange: string) => {
    e.preventDefault();
    e.stopPropagation();
    setSelectedAccountId(accountId);

    const items: CtxMenuItem[] = [
      { label: 'Edit Account', action: () => { setSelectedAccountId(accountId); openOverlay('edit-account'); } },
      { label: 'Add Position', action: () => { setSelectedAccountId(accountId); setScopeAccountId(accountId); openOverlay('add-position'); } },
    ];

    if (exchange === 'blofin' || exchange === 'hyperliquid') {
      items.push({
        label: 'Sync Account', action: async () => {
          try {
            await syncLiveAccount(accountId);
            await fetchBootstrap();
            toast('Sync complete', 'success');
          } catch (e) { toast(`Sync failed: ${e}`, 'error'); }
        }
      });
    }

    items.push(
      { label: 'Delete Account', action: () => setConfirmDeleteId(accountId), danger: true },
    );

    showCtx(e.clientX, e.clientY, items, accountName);
  };

  return (
    <>
      <div className="section-label account-section-header">
        <span>ACCOUNTS · {accounts.length}</span>
        <button
          className="btn btn--ghost btn--small account-section-add"
          onClick={() => openOverlay('add-account')}
          title="New Account"
        >+ New</button>
      </div>

      {accounts.map((account) => {
        const acctPositions = positions.filter((p) => p.accountId === account.id);
        const accountPnl = acctPositions.reduce((sum, p) => sum + p.unrealizedPnl, 0);
        const marginUsed = acctPositions.reduce((sum, p) => sum + (p.marginUsed ?? 0), 0);
        const utilizationPct = account.walletBalance > 0 ? Math.min(marginUsed / account.walletBalance, 1) : 0;
        const health = bootstrap.accountSyncHealth.find((h) => h.accountId === account.id);
        const isSelected = scopeAccountId === account.id;
        const isLive = account.accountMode === 'live';

        // Utilization color: green → yellow → red
        const utilColor = utilizationPct > 0.75 ? 'var(--red)' : utilizationPct > 0.4 ? 'var(--yellow)' : 'var(--green)';

        return (
          <div key={account.id}>
            <div
              className={`account-card${isSelected ? ' account-card--selected' : ''}`}
              onClick={() => handleClick(account.id)}
              onContextMenu={(e) => handleContextMenu(e, account.id, account.name, account.exchange)}
            >
              {/* Header */}
              <div className="account-header">
                <span className="account-name">{account.name}</span>
                <div className="account-header-meta">
                  {acctPositions.length > 0 && (
                    <span className="account-pos-count">{acctPositions.length}p</span>
                  )}
                  <span className={exchangeTagClass(account.exchange)}>{account.exchange}</span>
                </div>
              </div>

              {/* Utilization bar */}
              {utilizationPct > 0 && (
                <div className="account-utilization">
                  <div className="account-utilization-fill" style={{ width: `${utilizationPct * 100}%`, background: utilColor }} />
                </div>
              )}

              {/* Metrics */}
              <div className="account-metrics">
                <div>
                  <div className="account-metric-label">Equity</div>
                  <div className="account-metric-value">{fmtCurrency(account.snapshotEquity)}</div>
                </div>
                <div>
                  <div className="account-metric-label">P&L</div>
                  <div className={`account-metric-value ${fmtPnlClass(accountPnl)}`}>
                    {fmtPnl(accountPnl)}
                  </div>
                </div>
                {utilizationPct > 0 && (
                  <div>
                    <div className="account-metric-label">Margin</div>
                    <div className="account-metric-value" style={{ color: utilColor }}>
                      {fmtPercent(utilizationPct * 100)}
                    </div>
                  </div>
                )}
              </div>

              {/* Bonus row */}
              {account.bonusBalance > 0 && (
                <div className="bonus-row">
                  <span className="bonus-badge">B: {fmtCurrency(account.bonusBalance)}</span>
                  <span className="bonus-rates">
                    {fmtPercent(account.bonusFeeDeductionRate * 100)}/
                    {fmtPercent(account.bonusLossDeductionRate * 100)}/
                    {fmtPercent(account.bonusFundingDeductionRate * 100)}
                  </span>
                </div>
              )}

              {/* Sync row */}
              {health && (
                <div className="sync-row">
                  <span className={syncDotClass(health.state)} />
                  <span>{health.label}</span>
                  {health.lastSyncedAt && <span>· {fmtRelativeTime(health.lastSyncedAt)}</span>}
                </div>
              )}

              {/* Quick action row — always visible for cleaner UX */}
              <div className="account-actions">
                <button
                  className="acct-action-btn"
                  title="Add Position"
                  onClick={(e) => { e.stopPropagation(); setSelectedAccountId(account.id); setScopeAccountId(account.id); openOverlay('add-position'); }}
                >＋</button>
                {isLive && (
                  <button
                    className="acct-action-btn"
                    title="Sync"
                    onClick={async (e) => {
                      e.stopPropagation();
                      try {
                        await syncLiveAccount(account.id);
                        await fetchBootstrap();
                        toast('Sync complete', 'success');
                      } catch (ex) { toast(`Sync failed: ${ex}`, 'error'); }
                    }}
                  >↺</button>
                )}
                <button
                  className="acct-action-btn"
                  title="Edit"
                  onClick={(e) => { e.stopPropagation(); setSelectedAccountId(account.id); openOverlay('edit-account'); }}
                >✎</button>
              </div>
            </div>

            {confirmDeleteId === account.id && (
              <div className="inline-confirm">
                <span>Delete "{account.name}" and all positions?</span>
                <button className="btn btn--danger btn--small" onClick={() => handleDelete(account.id, account.name)}>
                  Confirm
                </button>
                <button className="btn btn--ghost btn--small" onClick={() => setConfirmDeleteId(null)}>
                  Cancel
                </button>
              </div>
            )}
          </div>
        );
      })}

      {accounts.length === 0 && (
        <div className="rail-empty-state">
          <div className="text-muted">No accounts yet</div>
          <button className="btn btn--primary btn--small" onClick={() => openOverlay('add-account')}>
            + Add Account
          </button>
        </div>
      )}


    </>
  );
}
