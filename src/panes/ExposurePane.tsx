import { useAppStore, scopedAccounts } from '../store/appStore';
import { fmtCurrency, fmtPnlClass } from '../lib/fmt';
import type { ExposureItem } from '../lib/types';

export function ExposurePane() {
  const bootstrap = useAppStore((s) => s.bootstrap);
  const state = useAppStore.getState();
  if (!bootstrap) return null;

  const accountIds = new Set(scopedAccounts(state).map((a) => a.id));

  // Filter exposure items: only include those with at least one accountId in scope
  const filtered: ExposureItem[] = bootstrap.exposure.filter((item) =>
    item.accountIds.some((id) => accountIds.has(id))
  );

  if (filtered.length === 0) {
    return (
      <div className="empty-state">
        <div>No exposure data</div>
        <div>Open positions to see symbol-level exposure.</div>
      </div>
    );
  }

  const maxNotional = Math.max(...filtered.map((i) => Math.max(i.longNotional, i.shortNotional)), 1);

  return (
    <div>
      {filtered.map((item) => (
        <div key={item.symbol} className="exposure-row">
          <span className="exp-symbol">{item.symbol}</span>
          <div className="exp-bar-container">
            <div className="exp-bar-long" style={{ width: `${(item.longNotional / maxNotional) * 50}%` }} />
            <div className="exp-bar-short" style={{ width: `${(item.shortNotional / maxNotional) * 50}%` }} />
          </div>
          <span className={`exp-net ${fmtPnlClass(item.netNotional)}`}>
            {fmtCurrency(item.netNotional)}
          </span>
        </div>
      ))}
    </div>
  );
}
