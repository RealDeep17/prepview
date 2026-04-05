import { useEffect, useMemo, useState } from 'react';
import { useAppStore } from '../store/appStore';
import {
  closeManualPosition,
  previewPositionFunding,
  updateManualPosition,
} from '../lib/bridge';
import { findExchangeMarket } from '../lib/fmt';
import type { MarginMode, PositionFundingEstimate, PositionSide } from '../lib/types';

type QuantityMode = 'contract' | 'token' | 'usd';

const QUANTITY_MODE_OPTIONS: Array<{ key: QuantityMode; label: string }> = [
  { key: 'token', label: 'Base' },
  { key: 'usd', label: 'USD' },
  { key: 'contract', label: 'Contracts' },
];

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

function toDateTimeParts(value: string | null | undefined): { date: string; time: string } {
  if (!value) return { date: '', time: '' };
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return { date: '', time: '' };
  const offsetMs = parsed.getTimezoneOffset() * 60_000;
  const localValue = new Date(parsed.getTime() - offsetMs).toISOString();
  return {
    date: localValue.slice(0, 10),
    time: localValue.slice(11, 16),
  };
}

function nowDateTimeParts(): { date: string; time: string } {
  return toDateTimeParts(new Date().toISOString());
}

function fromDateTimeParts(date: string, time: string): string | undefined {
  if (!date || !time) return undefined;
  const parsed = new Date(`${date}T${time}`);
  if (Number.isNaN(parsed.getTime())) return undefined;
  return parsed.toISOString();
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
  const initialTradePlacedParts = useMemo(
    () => (position?.fundingMode === 'auto' ? toDateTimeParts(position.openedAt) : { date: '', time: '' }),
    [position?.fundingMode, position?.openedAt],
  );
  const [tradePlacedDate, setTradePlacedDate] = useState(() => initialTradePlacedParts.date);
  const [tradePlacedTime, setTradePlacedTime] = useState(() => initialTradePlacedParts.time);
  const [fundingManualOverride, setFundingManualOverride] = useState(() => position?.fundingMode !== 'auto');
  const [fundingPreview, setFundingPreview] = useState<PositionFundingEstimate | null>(null);
  const [fundingPreviewLoading, setFundingPreviewLoading] = useState(false);
  const [fundingPreviewError, setFundingPreviewError] = useState('');
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
  const isSupportedLocalExchange =
    position?.exchange === 'blofin' || position?.exchange === 'hyperliquid';
  const rawQuantity = useMemo(() => {
    const parsed = parseFloat(quantity);
    if (!Number.isFinite(parsed) || parsed <= 0) return null;
    const faceValue = currentMarket?.contractValue ?? 1.0;
    if (quantityMode === 'token') return parsed / faceValue;
    if (quantityMode === 'usd') {
      const entryPx = parseFloat(entryPrice);
      if (!Number.isFinite(entryPx) || entryPx <= 0 || faceValue <= 0) return null;
      return parsed / (entryPx * faceValue);
    }
    return parsed;
  }, [currentMarket?.contractValue, entryPrice, quantity, quantityMode]);
  const autoFundingEnabled =
    isSupportedLocalExchange && tradePlacedDate.length > 0 && tradePlacedTime.length > 0 && !fundingManualOverride;

  const convertQty = (valStr: string, oldMode: QuantityMode, newMode: QuantityMode): string => {
    const faceValue = currentMarket?.contractValue ?? 1.0;
    const entryPx = parseFloat(entryPrice) || position?.entryPrice || 1.0;
    return convertQuantityValue(valStr, oldMode, newMode, faceValue, entryPx);
  };

  const convertCloseQty = (
    valStr: string,
    oldMode: QuantityMode,
    newMode: QuantityMode,
  ): string => {
    const faceValue = currentMarket?.contractValue ?? 1.0;
    const closePx =
      parseFloat(exitPrice) || position?.markPrice || position?.entryPrice || 1.0;
    return convertQuantityValue(valStr, oldMode, newMode, faceValue, closePx);
  };

  const handleModeSwitch = (newMode: QuantityMode) => {
    if (newMode === quantityMode) return;
    setQuantity(convertQty(quantity, quantityMode, newMode));
    if (closeQty) setCloseQty(convertCloseQty(closeQty, quantityMode, newMode));
    setQuantityMode(newMode);
  };

  useEffect(() => {
    if (!position || !autoFundingEnabled || !rawQuantity || !tradePlacedDate || !tradePlacedTime || !symbol.trim()) {
      setFundingPreview(null);
      setFundingPreviewLoading(false);
      setFundingPreviewError('');
      return;
    }

    let cancelled = false;
    const timer = window.setTimeout(() => {
      setFundingPreviewLoading(true);
      setFundingPreviewError('');
      previewPositionFunding({
        exchange: position.exchange as 'blofin' | 'hyperliquid',
        exchangeSymbol: exchangeSymbol || position.exchangeSymbol || undefined,
        symbol: symbol.trim().toUpperCase(),
        side,
        quantity: rawQuantity,
        openedAt: fromDateTimeParts(tradePlacedDate, tradePlacedTime) ?? position.openedAt,
      })
        .then((estimate) => {
          if (cancelled) return;
          setFundingPreview(estimate);
        })
        .catch((previewError) => {
          if (cancelled) return;
          setFundingPreview(null);
          setFundingPreviewError(String(previewError));
        })
        .finally(() => {
          if (!cancelled) setFundingPreviewLoading(false);
        });
    }, 220);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [
    autoFundingEnabled,
    exchangeSymbol,
    position,
    rawQuantity,
    side,
    symbol,
    tradePlacedDate,
    tradePlacedTime,
  ]);

  const handleSave = async () => {
    if (!position || !quantity) return;
    if (autoFundingEnabled && (!fundingPreview || fundingPreviewLoading)) {
      setError('Funding preview is still loading. Wait a moment and try again.');
      return;
    }
    if (autoFundingEnabled && fundingPreviewError) {
      setError(`Automatic funding preview failed: ${fundingPreviewError}`);
      return;
    }
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
        fundingPaid: autoFundingEnabled
          ? fundingPreview?.fundingPaid
          : (fundingPaid ? parseFloat(fundingPaid) : undefined),
        fundingMode: autoFundingEnabled ? 'auto' : 'manual',
        takeProfit: takeProfit ? parseFloat(takeProfit) : undefined,
        stopLoss: stopLoss ? parseFloat(stopLoss) : undefined,
        openedAt: tradePlacedDate && tradePlacedTime ? fromDateTimeParts(tradePlacedDate, tradePlacedTime) : undefined,
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
          const exitPx = parseFloat(exitPrice) || position.markPrice || position.entryPrice || 1.0;
          if (exitPx > 0 && faceValue > 0) numericQty = numericQty / (exitPx * faceValue);
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
              <div className="form-group">
                <div className="form-field-head">
                  <label className="form-label">Quantity</label>
                  <div className="form-toggle form-toggle--compact">
                    {QUANTITY_MODE_OPTIONS.map((option) => (
                      <button
                        key={option.key}
                        type="button"
                        className={`form-toggle-option form-toggle-option--compact${quantityMode === option.key ? ' form-toggle-option--active' : ''}`}
                        onClick={() => handleModeSwitch(option.key)}
                      >
                        {option.label}
                      </button>
                    ))}
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

            {isSupportedLocalExchange && (
              <div className="timing-inline-panel">
                <div className="timing-inline-head">
                  <label className="form-label">Entry Time</label>
                  <div className="timing-inline-toolbar">
                    <div className="form-toggle form-toggle--compact">
                      <button
                        type="button"
                        className={`form-toggle-option form-toggle-option--compact${!fundingManualOverride ? ' form-toggle-option--active' : ''}`}
                        onClick={() => setFundingManualOverride(false)}
                      >
                        Auto
                      </button>
                      <button
                        type="button"
                        className={`form-toggle-option form-toggle-option--compact${fundingManualOverride ? ' form-toggle-option--active' : ''}`}
                        onClick={() => setFundingManualOverride(true)}
                      >
                        Manual
                      </button>
                    </div>
                    <div className="timing-inline-actions">
                      <button
                        type="button"
                        className="btn btn--ghost btn--small"
                        onClick={() => {
                          const now = nowDateTimeParts();
                          setTradePlacedDate(now.date);
                          setTradePlacedTime(now.time);
                        }}
                      >
                        Now
                      </button>
                      <button
                        type="button"
                        className="btn btn--ghost btn--small"
                        onClick={() => {
                          setTradePlacedDate('');
                          setTradePlacedTime('');
                          setFundingManualOverride(false);
                        }}
                        disabled={!tradePlacedDate && !tradePlacedTime}
                      >
                        Clear
                      </button>
                    </div>
                  </div>
                </div>
                <div className="timing-inline-datetime">
                  <input
                    className="form-input"
                    type="date"
                    value={tradePlacedDate}
                    onChange={(e) => {
                      const nextValue = e.target.value;
                      setTradePlacedDate(nextValue);
                      if (!nextValue) {
                        setFundingManualOverride(false);
                      }
                    }}
                  />
                  <input
                    className="form-input"
                    type="time"
                    step="60"
                    value={tradePlacedTime}
                    onChange={(e) => {
                      const nextValue = e.target.value;
                      setTradePlacedTime(nextValue);
                      if (!nextValue) {
                        setFundingManualOverride(false);
                      }
                    }}
                  />
                </div>
                {(tradePlacedDate || tradePlacedTime || fundingPreviewLoading || fundingPreviewError) && (
                  <div className="timing-inline-status">
                    {!tradePlacedDate || !tradePlacedTime
                      ? 'Choose both date and time to enable auto funding.'
                      : autoFundingEnabled
                      ? (fundingPreviewLoading
                        ? 'Fetching funding history and settlement prices…'
                        : fundingPreviewError
                          ? `Auto funding unavailable: ${fundingPreviewError}`
                          : fundingPreview
                            ? `Funding auto-calculated across ${fundingPreview.settlements} settlement${fundingPreview.settlements === 1 ? '' : 's'}.`
                            : 'Auto funding will calculate after the form is valid.')
                      : 'Manual funding is active for this position.'}
                  </div>
                )}
              </div>
            )}

            <div className="form-row">
              <div className="form-group">
                <label className="form-label">Fee Paid</label>
                <input className="form-input" type="number" step="any" value={feePaid} onChange={(e) => setFeePaid(e.target.value)} />
              </div>
              <div className="form-group">
                <div className="funding-field-head">
                  <label className="form-label" style={{ marginBottom: 0 }}>Funding Paid</label>
                  {isSupportedLocalExchange && tradePlacedDate && tradePlacedTime && (
                    <span className={`timing-chip timing-chip--inline${autoFundingEnabled ? ' timing-chip--auto' : ''}`}>
                      {autoFundingEnabled ? 'AUTO' : 'MANUAL'}
                    </span>
                  )}
                </div>
                <input
                  className="form-input"
                  type="number"
                  step="any"
                  value={
                    autoFundingEnabled
                      ? (fundingPreview != null ? String(Number(fundingPreview.fundingPaid.toFixed(6))) : '')
                      : fundingPaid
                  }
                  onChange={(e) => setFundingPaid(e.target.value)}
                  placeholder={autoFundingEnabled ? 'Calculating…' : '0'}
                  readOnly={autoFundingEnabled}
                />
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
            <div className="form-group">
              <div className="form-field-head">
                <label className="form-label">Quantity to Close</label>
                <div className="form-toggle form-toggle--compact">
                  {QUANTITY_MODE_OPTIONS.map((option) => (
                    <button
                      key={option.key}
                      type="button"
                      className={`form-toggle-option form-toggle-option--compact${quantityMode === option.key ? ' form-toggle-option--active' : ''}`}
                      onClick={() => handleModeSwitch(option.key)}
                    >
                      {option.label}
                    </button>
                  ))}
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
