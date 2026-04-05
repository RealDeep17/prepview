import { useState } from 'react';
import { useAppStore } from '../store/appStore';
import { updateManualPosition, closeManualPosition } from '../lib/bridge';
import { findExchangeMarket } from '../lib/fmt';
import type { MarginMode, PositionSide } from '../lib/types';

type QuantityMode = 'contract' | 'token' | 'usd';

function convertQuantityValue(
  value: string,
  oldMode: QuantityMode,
  newMode: QuantityMode,
  faceValue: number,
  entryPrice: number,
): string {
  if (!value || Number.isNaN(parseFloat(value))) return value;

  let rawContracts = parseFloat(value);
  if (oldMode === 'token') rawContracts = rawContracts / faceValue;
  else if (oldMode === 'usd') rawContracts = rawContracts / (entryPrice * faceValue);

  let nextValue = rawContracts;
  if (newMode === 'token') nextValue = rawContracts * faceValue;
  else if (newMode === 'usd') nextValue = rawContracts * faceValue * entryPrice;

  return String(Number(nextValue.toFixed(8)));
}

export function EditPositionOverlay() {
  const closeOverlay = useAppStore((s) => s.closeOverlay);
  const fetchBootstrap = useAppStore((s) => s.fetchBootstrap);
  const bootstrap = useAppStore((s) => s.bootstrap);
  const position = useAppStore((s) => {
    const positionId = s.editingPositionId ?? s.selectedPositionId;
    if (!positionId || !s.bootstrap) return null;
    return s.bootstrap.positions.find((entry) => entry.id === positionId) ?? null;
  });

  const [showClose, setShowClose] = useState(false);

  const currentMarket = position
    ? findExchangeMarket(
        bootstrap?.markets ?? [],
        position.exchange,
        position.symbol,
        position.exchangeSymbol,
      )
    : undefined;
  const currentFaceValue = currentMarket?.contractValue ?? 1.0;
  const currentEntryPrice = position?.entryPrice ?? 1.0;

  // Edit fields
  const [symbol, setSymbol] = useState(() => position?.symbol ?? '');
  const [exchangeSymbol, setExchangeSymbol] = useState(() => position?.exchangeSymbol ?? '');
  const [side, setSide] = useState<PositionSide>(() => position?.side ?? 'long');
  const [marginMode, setMarginMode] = useState<MarginMode | ''>(() => position?.marginMode ?? '');
  const [quantityMode, setQuantityMode] = useState<QuantityMode>('token');
  const [quantity, setQuantity] = useState(() => (
    position
      ? convertQuantityValue(
          String(position.quantity),
          'contract',
          'token',
          currentFaceValue,
          currentEntryPrice,
        )
      : ''
  ));
  const [entryPrice, setEntryPrice] = useState(() => position ? String(position.entryPrice) : '');
  const [markPrice, setMarkPrice] = useState(() => position?.markPrice != null ? String(position.markPrice) : '');
  const [leverage, setLeverage] = useState(() => position ? String(position.leverage) : '');
  const [marginUsed, setMarginUsed] = useState(() => {
    if (!position || position.riskSource === 'local_engine' || position.marginUsed == null) return '';
    return String(position.marginUsed);
  });
  const [liquidationPrice] = useState(() => {
    if (!position || position.riskSource === 'local_engine' || position.liquidationPrice == null) return '';
    return String(position.liquidationPrice);
  });
  const [maintenanceMargin] = useState(() => {
    if (!position || position.riskSource === 'local_engine' || position.maintenanceMargin == null) return '';
    return String(position.maintenanceMargin);
  });
  const [feePaid, setFeePaid] = useState(() => position ? String(position.feePaid) : '');
  const [fundingPaid, setFundingPaid] = useState(() => position ? String(position.fundingPaid) : '');
  const [takeProfit, setTakeProfit] = useState(() => position?.takeProfit != null ? String(position.takeProfit) : '');
  const [stopLoss, setStopLoss] = useState(() => position?.stopLoss != null ? String(position.stopLoss) : '');
  const [notes, setNotes] = useState(() => position?.notes ?? '');

  // Close fields
  const [exitPrice, setExitPrice] = useState('');
  const [closeQty, setCloseQty] = useState('');
  const [closeFee, setCloseFee] = useState('');
  const [closeFunding, setCloseFunding] = useState('');
  const [closeNote, setCloseNote] = useState('');

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  const convertQty = (valStr: string, oldMode: QuantityMode, newMode: QuantityMode): string => {
    const faceValue = currentMarket?.contractValue ?? 1.0;
    const entryPx = parseFloat(entryPrice) || position?.entryPrice || 1.0;
    return convertQuantityValue(valStr, oldMode, newMode, faceValue, entryPx);
  };

  const handleModeSwitch = (newMode: QuantityMode) => {
    if (newMode === quantityMode) return;
    setQuantity(convertQty(quantity, quantityMode, newMode));
    if (closeQty) setCloseQty(convertQty(closeQty, quantityMode, newMode));
    setQuantityMode(newMode);
  };

  const handleSave = async () => {
    if (!position || !quantity) return;
    setSubmitting(true);
    setError('');

    let rawQuantity = parseFloat(quantity);
    if (!isNaN(rawQuantity)) {
      const faceValue = currentMarket?.contractValue ?? 1.0;
      if (quantityMode === 'token') rawQuantity = rawQuantity / faceValue;
      else if (quantityMode === 'usd') {
        const entryPx = parseFloat(entryPrice) || position.entryPrice || 1.0;
        if (entryPx > 0 && faceValue > 0) rawQuantity = rawQuantity / (entryPx * faceValue);
      }
    }

    try {
      await updateManualPosition({
        id: position.id,
        accountId: position.accountId,
        exchangeSymbol: exchangeSymbol || undefined,
        symbol: symbol.trim().toUpperCase(),
        marginMode: marginMode || null,
        side,
        quantity: rawQuantity,
        entryPrice: parseFloat(entryPrice),
        markPrice: markPrice ? parseFloat(markPrice) : undefined,
        leverage: parseFloat(leverage) || 1,
        marginUsed: marginUsed ? parseFloat(marginUsed) : undefined,
        liquidationPrice: liquidationPrice ? parseFloat(liquidationPrice) : undefined,
        maintenanceMargin: maintenanceMargin ? parseFloat(maintenanceMargin) : undefined,
        feePaid: feePaid ? parseFloat(feePaid) : undefined,
        fundingPaid: fundingPaid ? parseFloat(fundingPaid) : undefined,
        takeProfit: takeProfit ? parseFloat(takeProfit) : undefined,
        stopLoss: stopLoss ? parseFloat(stopLoss) : undefined,
        notes: notes || undefined,
      });
      await fetchBootstrap();
      closeOverlay();
    } catch (e) {
      setError(String(e));
    } finally {
      setSubmitting(false);
    }
  };

  const handleClose = async () => {
    if (!position) return;
    if (!exitPrice || parseFloat(exitPrice) <= 0) { setError('Exit price is required'); return; }
    setSubmitting(true);
    setError('');

    let rawCloseQty: number | undefined = undefined;
    if (closeQty) {
      let numericQty = parseFloat(closeQty);
      if (!isNaN(numericQty)) {
        const faceValue = currentMarket?.contractValue ?? 1.0;
        if (quantityMode === 'token') numericQty = numericQty / faceValue;
        else if (quantityMode === 'usd') {
          const entryPx = parseFloat(entryPrice) || position.entryPrice || 1.0;
          if (entryPx > 0 && faceValue > 0) numericQty = numericQty / (entryPx * faceValue);
        }
        rawCloseQty = numericQty;
      }
    }

    try {
      await closeManualPosition({
        positionId: position.id,
        exitPrice: parseFloat(exitPrice),
        quantity: rawCloseQty,
        feePaid: closeFee ? parseFloat(closeFee) : undefined,
        fundingPaid: closeFunding ? parseFloat(closeFunding) : undefined,
        note: closeNote || undefined,
      });
      useAppStore.getState().setSelectedPositionId(null);
      await fetchBootstrap();
      closeOverlay();
    } catch (e) {
      setError(String(e));
    } finally {
      setSubmitting(false);
    }
  };

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
              <div className="form-group" style={{ position: 'relative' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                  <label className="form-label" style={{ marginBottom: 0 }}>Quantity</label>
                  <div className="form-toggle form-toggle--pill" style={{ display: 'inline-flex', padding: 2, background: 'rgba(255,255,255,0.05)', borderRadius: 4 }}>
                    <button 
                      type="button"
                      style={{ fontSize: 10, padding: '2px 6px', background: quantityMode === 'token' ? 'rgba(255,255,255,0.1)' : 'transparent', color: quantityMode === 'token' ? '#fff' : 'var(--text-muted)', border: 'none', borderRadius: 2, cursor: 'pointer' }}
                      onClick={() => handleModeSwitch('token')}
                    >Token</button>
                    <button 
                      type="button"
                      style={{ fontSize: 10, padding: '2px 6px', background: quantityMode === 'usd' ? 'rgba(255,255,255,0.1)' : 'transparent', color: quantityMode === 'usd' ? '#fff' : 'var(--text-muted)', border: 'none', borderRadius: 2, cursor: 'pointer' }}
                      onClick={() => handleModeSwitch('usd')}
                    >USD</button>
                    <button 
                      type="button"
                      style={{ fontSize: 10, padding: '2px 6px', background: quantityMode === 'contract' ? 'rgba(255,255,255,0.1)' : 'transparent', color: quantityMode === 'contract' ? '#fff' : 'var(--text-muted)', border: 'none', borderRadius: 2, cursor: 'pointer' }}
                      onClick={() => handleModeSwitch('contract')}
                    >Cont</button>
                  </div>
                </div>
                <input className="form-input" type="number" step="any" value={quantity} onChange={(e) => setQuantity(e.target.value)} required placeholder={quantityMode === 'contract' ? 'Contracts' : (quantityMode === 'usd' ? 'Total $' : 'Base Asset')} />
              </div>
              <div className="form-group">
                <label className="form-label" style={{ marginTop: 2 }}>Entry Price</label>
                <input className="form-input" type="number" step="any" value={entryPrice} onChange={(e) => setEntryPrice(e.target.value)} required />
              </div>
            </div>

            <div className="form-row">
              <div className="form-group">
                <label className="form-label">Mark Price</label>
                <input className="form-input" type="number" step="any" value={markPrice} onChange={(e) => setMarkPrice(e.target.value)} />
              </div>
              <div className="form-group">
                <label className="form-label">Leverage</label>
                <input className="form-input" type="number" step="any" value={leverage} onChange={(e) => setLeverage(e.target.value)} />
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
                <input className="form-input" type="number" step="any" value={marginUsed} onChange={(e) => setMarginUsed(e.target.value)} placeholder="Auto" />
              </div>
            </div>

            <div className="form-row">
              <div className="form-group">
                <label className="form-label">Fee Paid</label>
                <input className="form-input" type="number" step="any" value={feePaid} onChange={(e) => setFeePaid(e.target.value)} />
              </div>
              <div className="form-group">
                <label className="form-label">Funding Paid</label>
                <input className="form-input" type="number" step="any" value={fundingPaid} onChange={(e) => setFundingPaid(e.target.value)} />
              </div>
            </div>

            <div className="form-row">
              <div className="form-group">
                <label className="form-label">Take Profit</label>
                <input className="form-input" type="number" step="any" value={takeProfit} onChange={(e) => setTakeProfit(e.target.value)} placeholder="Optional" />
              </div>
              <div className="form-group">
                <label className="form-label">Stop Loss</label>
                <input className="form-input" type="number" step="any" value={stopLoss} onChange={(e) => setStopLoss(e.target.value)} placeholder="Optional" />
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
              <input className="form-input" type="number" step="any" value={exitPrice} onChange={(e) => setExitPrice(e.target.value)} placeholder="Required" />
            </div>
            <div className="form-group" style={{ position: 'relative' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                <label className="form-label" style={{ marginBottom: 0 }}>Quantity to Close (blank = full)</label>
                <div className="form-toggle form-toggle--pill" style={{ display: 'inline-flex', padding: 2, background: 'rgba(255,255,255,0.05)', borderRadius: 4 }}>
                  <button 
                    type="button"
                    style={{ fontSize: 10, padding: '2px 6px', background: quantityMode === 'token' ? 'rgba(255,255,255,0.1)' : 'transparent', color: quantityMode === 'token' ? '#fff' : 'var(--text-muted)', border: 'none', borderRadius: 2, cursor: 'pointer' }}
                    onClick={() => handleModeSwitch('token')}
                  >Token</button>
                  <button 
                    type="button"
                    style={{ fontSize: 10, padding: '2px 6px', background: quantityMode === 'usd' ? 'rgba(255,255,255,0.1)' : 'transparent', color: quantityMode === 'usd' ? '#fff' : 'var(--text-muted)', border: 'none', borderRadius: 2, cursor: 'pointer' }}
                    onClick={() => handleModeSwitch('usd')}
                  >USD</button>
                  <button 
                    type="button"
                    style={{ fontSize: 10, padding: '2px 6px', background: quantityMode === 'contract' ? 'rgba(255,255,255,0.1)' : 'transparent', color: quantityMode === 'contract' ? '#fff' : 'var(--text-muted)', border: 'none', borderRadius: 2, cursor: 'pointer' }}
                    onClick={() => handleModeSwitch('contract')}
                  >Cont</button>
                </div>
              </div>
              <input className="form-input" type="number" step="any" value={closeQty} onChange={(e) => setCloseQty(e.target.value)} placeholder={`Full position (${quantityMode})`} />
            </div>
            <div className="form-row">
              <div className="form-group">
                <label className="form-label">Fee Paid</label>
                <input className="form-input" type="number" step="any" value={closeFee} onChange={(e) => setCloseFee(e.target.value)} placeholder="0" />
              </div>
              <div className="form-group">
                <label className="form-label">Funding Paid</label>
                <input className="form-input" type="number" step="any" value={closeFunding} onChange={(e) => setCloseFunding(e.target.value)} placeholder="0" />
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
