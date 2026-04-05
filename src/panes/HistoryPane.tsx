import { useAppStore } from '../store/appStore';
import { fmtCurrency, fmtTimestamp } from '../lib/fmt';

export function HistoryPane() {
  const bootstrap = useAppStore((s) => s.bootstrap);
  if (!bootstrap) return null;

  const history = bootstrap.portfolioHistory;

  if (history.length === 0) {
    return (
      <div className="empty-state">
        <div>No equity snapshots yet.</div>
        <div>Snapshots are recorded after each sync.</div>
      </div>
    );
  }

  return (
    <table className="data-table data-table--history">
      <colgroup>
        <col style={{ width: '136px' }} />
        <col style={{ width: '132px' }} />
        <col style={{ width: '132px' }} />
        <col style={{ width: '132px' }} />
      </colgroup>
      <thead>
        <tr>
          <th>Time</th>
          <th className="num">Balance</th>
          <th className="num">Equity</th>
          <th className="num">Change</th>
        </tr>
      </thead>
      <tbody>
        {history.map((point, i) => {
          const prev = i < history.length - 1 ? history[i + 1] : null;
          const delta = prev ? point.equity - prev.equity : 0;
          return (
            <tr key={`${point.recordedAt}-${i}`}>
              <td><span className="table-text">{fmtTimestamp(point.recordedAt)}</span></td>
              <td className="num">{fmtCurrency(point.balance)}</td>
              <td className="num">{fmtCurrency(point.equity)}</td>
              <td className={`num ${delta >= 0 ? 'pnl-positive' : 'pnl-negative'}`}>
                {i < history.length - 1 ? (delta >= 0 ? '+' : '') + fmtCurrency(Math.abs(delta)) : '—'}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
