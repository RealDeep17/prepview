import { useState } from 'react';
import { useAppStore, scopedPositions } from '../store/appStore';
import { useContextMenu } from '../shell/ContextMenu';
import { useToast } from '../shell/Toast';
import { fmtCurrency, fmtPnl, fmtPnlClass, fmtNumber } from '../lib/fmt';
import { deleteManualPosition, syncLiveAccount } from '../lib/bridge';

export function PositionsPane() {
  const state = useAppStore.getState();
  const selectedPositionId = useAppStore((s) => s.selectedPositionId);
  const setSelectedPositionId = useAppStore((s) => s.setSelectedPositionId);
  const openOverlay = useAppStore((s) => s.openOverlay);
  const fetchBootstrap = useAppStore((s) => s.fetchBootstrap);
  const positions = scopedPositions(state);
  const { show: showCtx } = useContextMenu();
  const { toast } = useToast();
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  const handleDelete = async (posId: string, posSymbol: string) => {
    try {
      await deleteManualPosition(posId);
      setSelectedPositionId(null);
      setConfirmDeleteId(null);
      await fetchBootstrap();
      toast(`Deleted ${posSymbol}`, 'info');
    } catch (e) {
      toast(`Failed: ${e}`, 'error');
    }
  };

  const handleContextMenu = (e: React.MouseEvent, posId: string, posSymbol: string, posExchange: string, posAccountId: string) => {
    e.preventDefault();
    e.stopPropagation();
    setSelectedPositionId(posId);

    const isManual = posExchange === 'manual' || posExchange === 'import';
    const items = [];

    if (isManual) {
      items.push(
        { label: 'Edit Position', action: () => openOverlay('edit-position', posId) },
        { label: 'Close Position', action: () => openOverlay('edit-position', posId) },
        { label: 'Delete Position', action: () => setConfirmDeleteId(posId), danger: true },
      );
    } else {
      items.push(
        { label: 'Sync Account', action: async () => {
          try {
            await syncLiveAccount(posAccountId);
            await fetchBootstrap();
            toast('Sync complete', 'success');
          } catch (e) { toast(`Sync failed: ${e}`, 'error'); }
        }},
      );
    }

    items.push(
      { label: 'Add Position', action: () => openOverlay('add-position') },
    );

    showCtx(e.clientX, e.clientY, items, posSymbol);
  };

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
          <th className="num">TP</th>
          <th className="num">SL</th>
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
              onContextMenu={(e) => handleContextMenu(e, pos.id, pos.symbol, pos.exchange, pos.accountId)}
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
              <td className="num" style={{ color: pos.takeProfit ? 'var(--green)' : undefined }}>
                {pos.takeProfit != null ? fmtCurrency(pos.takeProfit) : '—'}
              </td>
              <td className="num" style={{ color: pos.stopLoss ? 'var(--red)' : undefined }}>
                {pos.stopLoss != null ? fmtCurrency(pos.stopLoss) : '—'}
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
      {confirmDeleteId && (
        <tfoot>
          <tr>
            <td colSpan={14}>
              <div className="inline-confirm">
                <span>Delete position "{positions.find((p) => p.id === confirmDeleteId)?.symbol}"?</span>
                <button className="btn btn--danger btn--small" onClick={() => {
                  const pos = positions.find((p) => p.id === confirmDeleteId);
                  if (pos) handleDelete(pos.id, pos.symbol);
                }}>Confirm</button>
                <button className="btn btn--ghost btn--small" onClick={() => setConfirmDeleteId(null)}>Cancel</button>
              </div>
            </td>
          </tr>
        </tfoot>
      )}
    </table>
  );
}
