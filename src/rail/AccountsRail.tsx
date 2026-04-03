import { useAppStore, scopedAccounts, scopedPositions } from '../store/appStore';
import { useContextMenu } from '../shell/ContextMenu';
import { fmtCurrency, fmtPnl, fmtPnlClass, fmtPercent, fmtRelativeTime, exchangeTagClass, syncDotClass } from '../lib/fmt';
import { deleteAccount, syncLiveAccount } from '../lib/bridge';

export function AccountsRail() {
  const bootstrap = useAppStore((s) => s.bootstrap);
  const selectedAccountId = useAppStore((s) => s.selectedAccountId);
  const setSelectedAccountId = useAppStore((s) => s.setSelectedAccountId);
  const setScopeAccountId = useAppStore((s) => s.setScopeAccountId);
  const openOverlay = useAppStore((s) => s.openOverlay);
  const fetchBootstrap = useAppStore((s) => s.fetchBootstrap);
  const state = useAppStore.getState();
  const { show: showCtx } = useContextMenu();

  if (!bootstrap) return null;

  const accounts = scopedAccounts(state);
  const positions = scopedPositions(state);

  const handleClick = (accountId: string) => {
    if (selectedAccountId === accountId) {
      setSelectedAccountId(null);
      setScopeAccountId(null);
    } else {
      setSelectedAccountId(accountId);
      setScopeAccountId(accountId);
    }
  };

  const handleContextMenu = (e: React.MouseEvent, accountId: string, accountName: string, exchange: string) => {
    e.preventDefault();
    e.stopPropagation();
    setSelectedAccountId(accountId);

    const items = [
      { label: 'Edit Account', action: () => { setSelectedAccountId(accountId); openOverlay('edit-account'); } },
      { label: 'Add Position', action: () => openOverlay('add-position') },
    ];

    if (exchange === 'blofin' || exchange === 'hyperliquid') {
      items.push({ label: 'Sync Account', action: async () => { await syncLiveAccount(accountId); await fetchBootstrap(); } });
    }

    items.push(
      { label: 'Delete Account', action: async () => {
        if (confirm(`Delete "${accountName}" and all its positions?`)) {
          await deleteAccount(accountId);
          setSelectedAccountId(null);
          setScopeAccountId(null);
          await fetchBootstrap();
        }
      }, danger: true },
    );

    showCtx(e.clientX, e.clientY, items, accountName);
  };

  return (
    <>
      <div className="section-label">ACCOUNTS · {accounts.length}</div>
      {accounts.map((account) => {
        const accountPnl = positions
          .filter((p) => p.accountId === account.id)
          .reduce((sum, p) => sum + p.unrealizedPnl, 0);

        const health = bootstrap.accountSyncHealth.find((h) => h.accountId === account.id);

        return (
          <div
            key={account.id}
            className={`account-card${selectedAccountId === account.id ? ' account-card--selected' : ''}`}
            onClick={() => handleClick(account.id)}
            onContextMenu={(e) => handleContextMenu(e, account.id, account.name, account.exchange)}
          >
            <div className="account-header">
              <span className="account-name">{account.name}</span>
              <span className={exchangeTagClass(account.exchange)}>{account.exchange}</span>
            </div>
            <div className="account-metrics">
              <div>
                <div className="account-metric-label">Equity</div>
                <div className="account-metric-value">{fmtCurrency(account.snapshotEquity)}</div>
              </div>
              <div>
                <div className="account-metric-label">P&amp;L</div>
                <div className={`account-metric-value ${fmtPnlClass(accountPnl)}`}>
                  {fmtPnl(accountPnl)}
                </div>
              </div>
            </div>
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
            {health && (
              <div className="sync-row">
                <span className={syncDotClass(health.state)} />
                <span>{health.label}</span>
                {health.lastSyncedAt && <span>· {fmtRelativeTime(health.lastSyncedAt)}</span>}
              </div>
            )}
          </div>
        );
      })}
      {accounts.length === 0 && (
        <div className="empty-state" style={{ padding: '20px 12px' }}>
          No accounts yet
        </div>
      )}
    </>
  );
}
