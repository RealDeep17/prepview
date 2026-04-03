import { useState, useCallback, useEffect } from 'react';
import { useAppStore, selectedPosition } from '../store/appStore';
import { updateManualPosition, closeManualPosition } from '../lib/bridge';
import type { PositionSide, MarginMode } from '../lib/types';

export function EditPositionOverlay() {
  const closeOverlay = useAppStore((s) => s.closeOverlay);
  const fetchBootstrap = useAppStore((s) => s.fetchBootstrap);
  const state = useAppStore.getState();
  const position = selectedPosition(state);

  const [showClose, setShowClose] = useState(false);

  // Edit fields
  const [symbol, setSymbol] = useState('');
  const [exchangeSymbol, setExchangeSymbol] = useState('');
  const [side, setSide] = useState<PositionSide>('long');
  const [marginMode, setMarginMode] = useState<MarginMode | ''>('');
  const [quantity, setQuantity] = useState('');
  const [entryPrice, setEntryPrice] = useState('');
  const [markPrice, setMarkPrice] = useState('');
  const [leverage, setLeverage] = useState('');
  const [marginUsed, setMarginUsed] = useState('');
  const [liquidationPrice, setLiquidationPrice] = useState('');
  const [maintenanceMargin, setMaintenanceMargin] = useState('');
  const [feePaid, setFeePaid] = useState('');
  const [fundingPaid, setFundingPaid] = useState('');
  const [notes, setNotes] = useState('');

  // Close fields
  const [exitPrice, setExitPrice] = useState('');
  const [closeQty, setCloseQty] = useState('');
  const [closeFee, setCloseFee] = useState('');
  const [closeFunding, setCloseFunding] = useState('');
  const [closeNote, setCloseNote] = useState('');

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!position) return;
    setSymbol(position.symbol);
    setExchangeSymbol(position.exchangeSymbol ?? '');
    setSide(position.side);
    setMarginMode(position.marginMode ?? '');
    setQuantity(String(position.quantity));
    setEntryPrice(String(position.entryPrice));
    setMarkPrice(position.markPrice != null ? String(position.markPrice) : '');
    setLeverage(String(position.leverage));
    setMarginUsed(position.marginUsed != null ? String(position.marginUsed) : '');
    setLiquidationPrice(position.liquidationPrice != null ? String(position.liquidationPrice) : '');
    setMaintenanceMargin(position.maintenanceMargin != null ? String(position.maintenanceMargin) : '');
    setFeePaid(String(position.feePaid));
    setFundingPaid(String(position.fundingPaid));
    setNotes(position.notes ?? '');
  }, [position]);

  const handleSave = useCallback(async () => {
    if (!position) return;
    setSubmitting(true);
    setError('');
    try {
      await updateManualPosition({
        id: position.id,
        accountId: position.accountId,
        exchangeSymbol: exchangeSymbol || undefined,
        symbol: symbol.trim().toUpperCase(),
        marginMode: marginMode || null,
        side,
        quantity: parseFloat(quantity),
        entryPrice: parseFloat(entryPrice),
        markPrice: markPrice ? parseFloat(markPrice) : undefined,
        leverage: parseFloat(leverage) || 1,
        marginUsed: marginUsed ? parseFloat(marginUsed) : undefined,
        liquidationPrice: liquidationPrice ? parseFloat(liquidationPrice) : undefined,
        maintenanceMargin: maintenanceMargin ? parseFloat(maintenanceMargin) : undefined,
        feePaid: feePaid ? parseFloat(feePaid) : undefined,
        fundingPaid: fundingPaid ? parseFloat(fundingPaid) : undefined,
        notes: notes || undefined,
      });
      await fetchBootstrap();
      closeOverlay();
    } catch (e) {
      setError(String(e));
    }
    setSubmitting(false);
  }, [position, symbol, exchangeSymbol, side, marginMode, quantity, entryPrice, markPrice, leverage, marginUsed, liquidationPrice, maintenanceMargin, feePaid, fundingPaid, notes, fetchBootstrap, closeOverlay]);

  const handleClose = useCallback(async () => {
    if (!position) return;
    if (!exitPrice || parseFloat(exitPrice) <= 0) { setError('Exit price is required'); return; }
    setSubmitting(true);
    setError('');
    try {
      await closeManualPosition({
        positionId: position.id,
        exitPrice: parseFloat(exitPrice),
        quantity: closeQty ? parseFloat(closeQty) : undefined,
        feePaid: closeFee ? parseFloat(closeFee) : undefined,
        fundingPaid: closeFunding ? parseFloat(closeFunding) : undefined,
        note: closeNote || undefined,
      });
      useAppStore.getState().setSelectedPositionId(null);
      await fetchBootstrap();
      closeOverlay();
    } catch (e) {
      setError(String(e));
    }
    setSubmitting(false);
  }, [position, exitPrice, closeQty, closeFee, closeFunding, closeNote, fetchBootstrap, closeOverlay]);

  if (!position) {
    return (
      <>
        <div className="overlay-backdrop" onClick={closeOverlay} />
        <div className="overlay-drawer">
          <div className="overlay-title">No Position Selected</div>
          <button className="btn btn--ghost" onClick={closeOverlay}>Close</button>
        </div>
      </>
    );
  }

  return (
    <>
      <div className="overlay-backdrop" onClick={closeOverlay} />
      <div className="overlay-drawer">
        <div className="overlay-title">
          {showClose ? 'Close Position' : 'Edit Position'} — {position.symbol}
        </div>
        {error && <div style={{ color: 'var(--red)', fontSize: 12, marginBottom: 12 }}>{error}</div>}

        {!showClose ? (
          <>
            <div className="form-row">
              <div className="form-group">
                <label className="form-label">Symbol</label>
                <input className="form-input" value={symbol} onChange={(e) => setSymbol(e.target.value)} />
              </div>
              <div className="form-group">
                <label className="form-label">Exchange Symbol</label>
                <input className="form-input" value={exchangeSymbol} onChange={(e) => setExchangeSymbol(e.target.value)} />
              </div>
            </div>

            <div className="form-group">
              <label className="form-label">Side</label>
              <div className="form-toggle">
                <button className={`form-toggle-option${side === 'long' ? ' form-toggle-option--active' : ''}`} onClick={() => setSide('long')}>Long</button>
                <button className={`form-toggle-option${side === 'short' ? ' form-toggle-option--active' : ''}`} onClick={() => setSide('short')}>Short</button>
              </div>
            </div>

            <div className="form-row">
              <div className="form-group">
                <label className="form-label">Quantity</label>
                <input className="form-input" type="number" value={quantity} onChange={(e) => setQuantity(e.target.value)} />
              </div>
              <div className="form-group">
                <label className="form-label">Entry Price</label>
                <input className="form-input" type="number" value={entryPrice} onChange={(e) => setEntryPrice(e.target.value)} />
              </div>
            </div>

            <div className="form-row">
              <div className="form-group">
                <label className="form-label">Mark Price</label>
                <input className="form-input" type="number" value={markPrice} onChange={(e) => setMarkPrice(e.target.value)} />
              </div>
              <div className="form-group">
                <label className="form-label">Leverage</label>
                <input className="form-input" type="number" value={leverage} onChange={(e) => setLeverage(e.target.value)} />
              </div>
            </div>

            <div className="form-row">
              <div className="form-group">
                <label className="form-label">Margin Mode</label>
                <select className="form-select" value={marginMode} onChange={(e) => setMarginMode(e.target.value as MarginMode | '')}>
                  <option value="">—</option>
                  <option value="cross">Cross</option>
                  <option value="isolated">Isolated</option>
                </select>
              </div>
              <div className="form-group">
                <label className="form-label">Margin Used</label>
                <input className="form-input" type="number" value={marginUsed} onChange={(e) => setMarginUsed(e.target.value)} />
              </div>
            </div>

            <div className="form-row">
              <div className="form-group">
                <label className="form-label">Fee Paid</label>
                <input className="form-input" type="number" value={feePaid} onChange={(e) => setFeePaid(e.target.value)} />
              </div>
              <div className="form-group">
                <label className="form-label">Funding Paid</label>
                <input className="form-input" type="number" value={fundingPaid} onChange={(e) => setFundingPaid(e.target.value)} />
              </div>
            </div>

            <div className="form-group">
              <label className="form-label">Notes</label>
              <textarea className="form-textarea" value={notes} onChange={(e) => setNotes(e.target.value)} />
            </div>

            <div className="form-actions">
              <button className="btn btn--ghost" onClick={() => setShowClose(true)}>Close Position</button>
              <button className="btn btn--primary" onClick={handleSave} disabled={submitting}>
                {submitting ? 'Saving…' : 'Save Changes'}
              </button>
            </div>
          </>
        ) : (
          <>
            <div className="form-group">
              <label className="form-label">Exit Price</label>
              <input className="form-input" type="number" value={exitPrice} onChange={(e) => setExitPrice(e.target.value)} placeholder="Required" />
            </div>
            <div className="form-group">
              <label className="form-label">Quantity to Close (blank = full)</label>
              <input className="form-input" type="number" value={closeQty} onChange={(e) => setCloseQty(e.target.value)} placeholder={String(position.quantity)} />
            </div>
            <div className="form-row">
              <div className="form-group">
                <label className="form-label">Fee Paid</label>
                <input className="form-input" type="number" value={closeFee} onChange={(e) => setCloseFee(e.target.value)} placeholder="0" />
              </div>
              <div className="form-group">
                <label className="form-label">Funding Paid</label>
                <input className="form-input" type="number" value={closeFunding} onChange={(e) => setCloseFunding(e.target.value)} placeholder="0" />
              </div>
            </div>
            <div className="form-group">
              <label className="form-label">Note</label>
              <textarea className="form-textarea" value={closeNote} onChange={(e) => setCloseNote(e.target.value)} />
            </div>
            <div className="form-actions">
              <button className="btn btn--ghost" onClick={() => setShowClose(false)}>Back to Edit</button>
              <button className="btn btn--primary" onClick={handleClose} disabled={submitting}>
                {submitting ? 'Closing…' : 'Close Position'}
              </button>
            </div>
          </>
        )}
      </div>
    </>
  );
}
