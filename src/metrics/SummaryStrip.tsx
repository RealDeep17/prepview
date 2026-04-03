import { useAppStore } from '../store/appStore';
import { fmtCurrency, fmtPnl, fmtPnlClass, fmtPercent, heatClass } from '../lib/fmt';

export function SummaryStrip() {
  const bootstrap = useAppStore((s) => s.bootstrap);

  if (!bootstrap) return null;

  const { summary, performance } = bootstrap;
  const pnlPercent = summary.totalEquity > 0
    ? ((summary.totalUnrealizedPnl / summary.totalEquity) * 100)
    : 0;

  return (
    <div className="summary-strip">
      <div className="summary-item">
        <div className="summary-label">Total Equity</div>
        <div className="summary-value">{fmtCurrency(summary.totalEquity)}</div>
        <div className="summary-sub">{summary.accountCount} accounts</div>
      </div>
      <div className="summary-item">
        <div className="summary-label">Unrealized P&amp;L</div>
        <div className={`summary-value ${fmtPnlClass(summary.totalUnrealizedPnl)}`}>
          {fmtPnl(summary.totalUnrealizedPnl)}
        </div>
        <div className="summary-sub">
          {fmtPercent(pnlPercent)}
          {summary.totalBonusOffset > 0 && (
            <span className="bonus-badge" style={{ marginLeft: 6 }}>
              +{fmtCurrency(summary.totalBonusOffset)} bonus
            </span>
          )}
        </div>
      </div>
      <div className="summary-item">
        <div className="summary-label">Gross Notional</div>
        <div className="summary-value">{fmtCurrency(summary.grossNotional)}</div>
        <div className="summary-sub">{summary.openPositions} positions</div>
      </div>
      <div className="summary-item">
        <div className="summary-label">Portfolio Heat</div>
        <div className="summary-value">{fmtPercent(summary.portfolioHeatPercent)}</div>
        <div className="summary-sub">
          <div className="heat-bar">
            <div
              className={heatClass(summary.portfolioHeatPercent)}
              style={{ width: `${Math.min(100, summary.portfolioHeatPercent)}%` }}
            />
          </div>
        </div>
      </div>
      <div className="summary-item">
        <div className="summary-label">Win Rate</div>
        <div className="summary-value">{fmtPercent(performance.winRate)}</div>
        <div className="summary-sub">{performance.closedPositions} closed</div>
      </div>
    </div>
  );
}
