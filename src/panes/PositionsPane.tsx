import { useAppStore, scopedPositions } from '../store/appStore';
import { fmtCurrency, fmtPnl, fmtPnlClass, fmtNumber } from '../lib/fmt';

export function PositionsPane() {
  const state = useAppStore.getState();
  const selectedPositionId = useAppStore((s) => s.selectedPositionId);
  const setSelectedPositionId = useAppStore((s) => s.setSelectedPositionId);
  const positions = scopedPositions(state);

  if (positions.length === 0) {
    return (
      <div className="empty-state">
        <div>No open positions</div>
        <div>Add a position or sync a live account to get started.</div>
      </div>
    );
  }

  return (
    <table className="data-table">
      <thead>
        <tr>
          <th>Symbol</th>
          <th>Account</th>
          <th>Side</th>
          <th>Margin</th>
          <th className="num">Size</th>
          <th className="num">Entry</th>
          <th className="num">Mark</th>
          <th className="num">Liq. Price</th>
          <th className="num">Lev</th>
          <th className="num">Margin Used</th>
          <th className="num">Unrealized P&amp;L</th>
          <th className="num">Notional</th>
        </tr>
      </thead>
      <tbody>
        {positions.map((pos) => {
          const notional = (pos.markPrice ?? pos.entryPrice) * pos.quantity;
          return (
            <tr
              key={pos.id}
              className={selectedPositionId === pos.id ? 'row--selected' : ''}
              onClick={() => setSelectedPositionId(pos.id)}
            >
              <td>
                <span className="mono" style={{ fontWeight: 600 }}>{pos.symbol}</span>
              </td>
              <td>{pos.accountName}</td>
              <td>
                <span className={`side-tag side-tag--${pos.side}`}>
                  {pos.side === 'long' ? 'Long' : 'Short'}
                </span>
              </td>
              <td>
                {pos.marginMode && <span className="margin-tag">{pos.marginMode}</span>}
              </td>
              <td className="num">{fmtNumber(pos.quantity, 4)}</td>
              <td className="num">{fmtCurrency(pos.entryPrice)}</td>
              <td className="num">{pos.markPrice != null ? fmtCurrency(pos.markPrice) : '—'}</td>
              <td className="num">
                {pos.liquidationPrice != null ? fmtCurrency(pos.liquidationPrice) : '—'}
                {pos.riskSource === 'local_engine' && <span className="risk-chip">est.</span>}
                {pos.riskSource === 'user_input' && <span className="risk-chip">manual</span>}
              </td>
              <td className="num">{pos.leverage}×</td>
              <td className="num">{pos.marginUsed != null ? fmtCurrency(pos.marginUsed) : '—'}</td>
              <td className={`num ${fmtPnlClass(pos.unrealizedPnl)}`}>
                {fmtPnl(pos.unrealizedPnl)}
              </td>
              <td className="num">{fmtCurrency(notional)}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
