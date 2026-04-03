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
  
  type QuantityMode = 'contract' | 'token' | 'usd';
  const [quantityMode, setQuantityMode] = useState<QuantityMode>('contract');
  const [quantity, setQuantity] = useState('');
  const [entryPrice, setEntryPrice] = useState('');
  const [markPrice, setMarkPrice] = useState('');
  const [leverage, setLeverage] = useState('');
  const [marginUsed, setMarginUsed] = useState('');
  const [liquidationPrice, setLiquidationPrice] = useState('');
  const [maintenanceMargin, setMaintenanceMargin] = useState('');
  const [feePaid, setFeePaid] = useState('');
  const [fundingPaid, setFundingPaid] = useState('');
  const [takeProfit, setTakeProfit] = useState('');
  const [stopLoss, setStopLoss] = useState('');
  const [notes, setNotes] = useState('');

  // Close fields
  const [exitPrice, setExitPrice] = useState('');
  const [closeQty, setCloseQty] = useState('');
  const [closeFee, setCloseFee] = useState('');
  const [closeFunding, setCloseFunding] = useState('');
  const [closeNote, setCloseNote] = useState('');

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  const convertQty = (valStr: string, oldMode: QuantityMode, newMode: QuantityMode): string => {
    if (!valStr || isNaN(parseFloat(valStr))) return valStr;
    const currentVal = parseFloat(valStr);
    const bs = useAppStore.getState().bootstrap;
    const market = bs?.markets?.find((m: any) => m.symbol.toUpperCase() === position?.symbol.toUpperCase() && m.exchange.toLowerCase() === position?.exchange.toLowerCase());
    const faceValue = market?.contractValue ?? 1.0;
    const entryPx = parseFloat(entryPrice) || position?.entryPrice || 1.0;
    
    let rawContracts = currentVal;
    if (oldMode === 'token') rawContracts = currentVal / faceValue;
    else if (oldMode === 'usd') rawContracts = currentVal / (entryPx * faceValue);
    
    let newVal = rawContracts;
    if (newMode === 'token') newVal = rawContracts * faceValue;
    else if (newMode === 'usd') newVal = rawContracts * faceValue * entryPx;
    
    return String(Number(newVal.toFixed(8)));
  };

  const handleModeSwitch = (newMode: QuantityMode) => {
    if (newMode === quantityMode) return;
    setQuantity(convertQty(quantity, quantityMode, newMode));
    if (closeQty) setCloseQty(convertQty(closeQty, quantityMode, newMode));
    setQuantityMode(newMode);
  };

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
    const isLocalEngine = position.riskSource === 'local_engine';
    setMarginUsed(!isLocalEngine && position.marginUsed != null ? String(position.marginUsed) : '');
    setLiquidationPrice(!isLocalEngine && position.liquidationPrice != null ? String(position.liquidationPrice) : '');
    setMaintenanceMargin(!isLocalEngine && position.maintenanceMargin != null ? String(position.maintenanceMargin) : '');
    setFeePaid(String(position.feePaid));
    setFundingPaid(String(position.fundingPaid));
    setTakeProfit(position.takeProfit != null ? String(position.takeProfit) : '');
    setStopLoss(position.stopLoss != null ? String(position.stopLoss) : '');
    setNotes(position.notes ?? '');
  }, [position]);

  const handleSave = useCallback(async () => {
    if (!position || !quantity) return;
    setSubmitting(true);
    setError('');

    let rawQuantity = parseFloat(quantity);
    if (!isNaN(rawQuantity)) {
      const bs = useAppStore.getState().bootstrap;
      const market = bs?.markets?.find((m: any) => m.symbol.toUpperCase() === position.symbol.toUpperCase() && m.exchange.toLowerCase() === position.exchange.toLowerCase());
      const faceValue = market?.contractValue ?? 1.0;
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
    }
    setSubmitting(false);
  }, [position, symbol, exchangeSymbol, side, marginMode, quantity, entryPrice, markPrice, leverage, marginUsed, liquidationPrice, maintenanceMargin, feePaid, fundingPaid, takeProfit, stopLoss, notes, fetchBootstrap, closeOverlay]);

  const handleClose = useCallback(async () => {
    if (!position) return;
    if (!exitPrice || parseFloat(exitPrice) <= 0) { setError('Exit price is required'); return; }
    setSubmitting(true);
    setError('');

    let rawCloseQty: number | undefined = undefined;
    if (closeQty) {
      let numericQty = parseFloat(closeQty);
      if (!isNaN(numericQty)) {
        const bs = useAppStore.getState().bootstrap;
        const market = bs?.markets?.find((m: any) => m.symbol.toUpperCase() === position.symbol.toUpperCase() && m.exchange.toLowerCase() === position.exchange.toLowerCase());
        const faceValue = market?.contractValue ?? 1.0;
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
