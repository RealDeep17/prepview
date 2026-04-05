import { useState, useEffect, useMemo, useRef } from 'react';
import { useAppStore } from '../store/appStore';
import {
  addManualPosition,
  getExchangeMarkets,
  getExchangeMarketQuote,
  previewPositionFunding,
} from '../lib/bridge';
import { findExchangeMarket, fmtCompactCurrency } from '../lib/fmt';
import type {
  ExchangeKind,
  ExchangeMarket,
  MarginMode,
  PositionFundingEstimate,
  PositionSide,
} from '../lib/types';

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

export function AddPositionOverlay() {
  const closeOverlay = useAppStore((s) => s.closeOverlay);
  const fetchBootstrap = useAppStore((s) => s.fetchBootstrap);
  const bootstrap = useAppStore((s) => s.bootstrap);
  const selectedAccountId = useAppStore((s) => s.selectedAccountId);

  const allAccounts = bootstrap?.accounts ?? [];

  const [accountId, setAccountId] = useState(selectedAccountId ?? allAccounts[0]?.id ?? '');
  const [symbol, setSymbol] = useState('');
  const [exchangeSymbol, setExchangeSymbol] = useState('');
  const [side, setSide] = useState<PositionSide>('long');
  const [marginMode, setMarginMode] = useState<MarginMode | ''>('cross');
  const [quantityMode, setQuantityMode] = useState<QuantityMode>('token');
  const [quantity, setQuantity] = useState('');
  const [entryPrice, setEntryPrice] = useState('');
  const [markPrice, setMarkPrice] = useState('');
  const [leverage, setLeverage] = useState('20');
  const [marginUsed, setMarginUsed] = useState('');
  const [liquidationPrice, setLiquidationPrice] = useState('');
  const [maintenanceMargin, setMaintenanceMargin] = useState('');
  const [feePaid, setFeePaid] = useState('');
  const [fundingPaid, setFundingPaid] = useState('');
  const [tradePlacedDate, setTradePlacedDate] = useState('');
  const [tradePlacedTime, setTradePlacedTime] = useState('');
  const [fundingManualOverride, setFundingManualOverride] = useState(false);
  const [fundingPreview, setFundingPreview] = useState<PositionFundingEstimate | null>(null);
  const [fundingPreviewLoading, setFundingPreviewLoading] = useState(false);
  const [fundingPreviewError, setFundingPreviewError] = useState('');
  const [takeProfit, setTakeProfit] = useState('');
  const [stopLoss, setStopLoss] = useState('');
  const [notes, setNotes] = useState('');
  const [showAutoFields, setShowAutoFields] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  // Autocomplete state
  const [markets, setMarkets] = useState<ExchangeMarket[]>([]);
  const [marketsExchange, setMarketsExchange] = useState<Extract<ExchangeKind, 'blofin' | 'hyperliquid'> | null>(null);
  const [loadingMarkets, setLoadingMarkets] = useState(false);
  const [showAc, setShowAc] = useState(false);
  const [highlightIdx, setHighlightIdx] = useState(0);
  const acRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const selectedAccount = allAccounts.find((a) => a.id === accountId);
  const exchange: ExchangeKind = selectedAccount?.exchange ?? 'manual';
  const isLive = exchange === 'blofin' || exchange === 'hyperliquid';
  const isSupportedLocalExchange =
    selectedAccount?.accountMode !== 'live' && (exchange === 'blofin' || exchange === 'hyperliquid');

  // Fetch markets when account changes to a live exchange
  useEffect(() => {
    if (!isLive) return;
    let cancelled = false;
    setLoadingMarkets(true);
    getExchangeMarkets(exchange)
      .then((data) => {
        if (!cancelled) {
          setMarkets(data);
          setMarketsExchange(exchange);
        }
      })
      .catch(() => {})
      .finally(() => { if (!cancelled) setLoadingMarkets(false); });
    return () => { cancelled = true; };
  }, [exchange, isLive]);

  // Filter markets as user types
  const query = symbol.toUpperCase();
  const activeMarkets = useMemo(
    () => (isLive && marketsExchange === exchange ? markets : []),
    [exchange, isLive, markets, marketsExchange],
  );
  const filteredMarkets = useMemo(() => (
    query.length >= 1
      ? activeMarkets.filter((m) =>
        m.symbol.toUpperCase().includes(query) ||
        m.exchangeSymbol.toUpperCase().includes(query) ||
        m.baseAsset.toUpperCase().includes(query)
      ).slice(0, 20)
      : []
  ), [activeMarkets, query]);
  const selectedMarket = useMemo(
    () => findExchangeMarket(activeMarkets, exchange, symbol, exchangeSymbol),
    [activeMarkets, exchange, exchangeSymbol, symbol],
  );
  const rawQuantity = useMemo(() => {
    const parsed = parseFloat(quantity);
    if (!Number.isFinite(parsed) || parsed <= 0) return null;
    const faceValue = selectedMarket?.contractValue ?? 1.0;
    if (quantityMode === 'token') return parsed / faceValue;
    if (quantityMode === 'usd') {
      const entryPx = parseFloat(entryPrice);
      if (!Number.isFinite(entryPx) || entryPx <= 0 || faceValue <= 0) return null;
      return parsed / (entryPx * faceValue);
    }
    return parsed;
  }, [entryPrice, quantity, quantityMode, selectedMarket?.contractValue]);
  const autoFundingEnabled =
    isSupportedLocalExchange && tradePlacedDate.length > 0 && tradePlacedTime.length > 0 && !fundingManualOverride;

  const handleSelectMarket = (market: ExchangeMarket) => {
    setSymbol(market.symbol);
    setExchangeSymbol(market.exchangeSymbol);
    setShowAc(false);
    if (market.markPrice != null) {
      setMarkPrice(String(market.markPrice));
      setEntryPrice(String(market.markPrice));
    }
    if (market.maxLeverage != null) {
      setLeverage(String(Math.min(market.maxLeverage, parseFloat(leverage) || 1)));
    }
    // Also fetch live quote
    if (exchange === 'blofin' || exchange === 'hyperliquid') {
      getExchangeMarketQuote(exchange, market.exchangeSymbol)
        .then((quote) => {
          if (quote.markPrice != null) {
            setMarkPrice(String(quote.markPrice));
            if (!entryPrice) setEntryPrice(String(quote.markPrice));
          }
        })
        .catch(() => {});
    }
  };

  const handleSymbolKeyDown = (e: React.KeyboardEvent) => {
    if (!showAc || filteredMarkets.length === 0) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setHighlightIdx((i) => Math.min(i + 1, filteredMarkets.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlightIdx((i) => Math.max(i - 1, 0));
    } else if (e.key === 'Enter' && filteredMarkets[highlightIdx]) {
      e.preventDefault();
      handleSelectMarket(filteredMarkets[highlightIdx]);
    } else if (e.key === 'Escape') {
      setShowAc(false);
    }
  };

  const handleModeSwitch = (newMode: QuantityMode) => {
    if (newMode === quantityMode) return;
    const faceValue = selectedMarket?.contractValue ?? 1.0;
    const entryPx = parseFloat(entryPrice) || 1.0;
    setQuantity(convertQuantityValue(quantity, quantityMode, newMode, faceValue, entryPx));
    setQuantityMode(newMode);
  };

  useEffect(() => {
    if (!autoFundingEnabled || !rawQuantity || !symbol.trim() || !tradePlacedDate || !tradePlacedTime) {
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
        exchange: exchange as 'blofin' | 'hyperliquid',
        exchangeSymbol: exchangeSymbol || selectedMarket?.exchangeSymbol,
        symbol: symbol.trim().toUpperCase(),
        side,
        quantity: rawQuantity,
        openedAt: fromDateTimeParts(tradePlacedDate, tradePlacedTime) ?? new Date().toISOString(),
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
    exchange,
    exchangeSymbol,
    rawQuantity,
    selectedMarket?.exchangeSymbol,
    side,
    symbol,
    tradePlacedDate,
    tradePlacedTime,
  ]);

  useEffect(() => {
    if (!isSupportedLocalExchange) {
      setFundingManualOverride(false);
      setTradePlacedDate('');
      setTradePlacedTime('');
      setFundingPreview(null);
      setFundingPreviewError('');
    }
  }, [isSupportedLocalExchange]);

  const handleSubmit = async () => {
    if (!symbol.trim()) { setError('Symbol is required'); return; }
    if (!quantity || parseFloat(quantity) <= 0) { setError('Quantity must be > 0'); return; }
    if (!entryPrice || parseFloat(entryPrice) <= 0) { setError('Entry price must be > 0'); return; }
    if (!accountId) { setError('Select an account'); return; }
    if (autoFundingEnabled && (!fundingPreview || fundingPreviewLoading)) {
      setError('Funding preview is still loading. Wait a moment and try again.');
      return;
    }
    if (autoFundingEnabled && fundingPreviewError) {
      setError(`Automatic funding preview failed: ${fundingPreviewError}`);
      return;
    }

    let rawQuantity = parseFloat(quantity);
    if (!isNaN(rawQuantity)) {
      const faceValue = selectedMarket?.contractValue ?? 1.0;
      if (quantityMode === 'token') {
        rawQuantity = rawQuantity / faceValue;
      } else if (quantityMode === 'usd') {
        const entryPx = parseFloat(entryPrice) || 1.0;
        if (entryPx > 0 && faceValue > 0) {
          rawQuantity = rawQuantity / (entryPx * faceValue);
        }
      }
    }

    setSubmitting(true);
    setError('');
    try {
      await addManualPosition({
        accountId,
        exchange,
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
        openedAt: autoFundingEnabled ? fromDateTimeParts(tradePlacedDate, tradePlacedTime) : undefined,
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

  return (
    <>
      <div className="overlay-backdrop" onClick={closeOverlay} />
      <div className="overlay-drawer">
        <div className="overlay-title">Add Position</div>
        {error && <div style={{ color: 'var(--red)', fontSize: 12, marginBottom: 12 }}>{error}</div>}

        <div className="form-group">
          <label className="form-label">Account</label>
          <select className="form-select" value={accountId} onChange={(e) => setAccountId(e.target.value)}>
            {allAccounts.map((a) => (
              <option key={a.id} value={a.id}>{a.name} ({a.exchange})</option>
            ))}
          </select>
        </div>

        <div className="form-row">
          <div className="form-group" style={{ flex: 2 }}>
            <label className="form-label">
              Symbol
              {isLive && loadingMarkets && <span style={{ color: 'var(--text-muted)', marginLeft: 6 }}>loading markets…</span>}
            </label>
            <div className="symbol-ac-wrap" ref={acRef}>
              <input
                ref={inputRef}
                className="form-input"
                value={symbol}
                onChange={(e) => {
                  setSymbol(e.target.value);
                  setShowAc(true);
                  setHighlightIdx(0);
                }}
                onFocus={() => { if (filteredMarkets.length > 0) setShowAc(true); }}
                onKeyDown={handleSymbolKeyDown}
                placeholder={isLive ? 'Type to search…' : 'BTC-PERP'}
                autoComplete="off"
              />
              {showAc && symbol.length >= 1 && isLive && (
                <div className="symbol-ac-list">
                  {filteredMarkets.length > 0 ? filteredMarkets.map((m, i) => (
                    <div
                      key={m.exchangeSymbol}
                      className={`symbol-ac-item${i === highlightIdx ? ' symbol-ac-item--highlight' : ''}`}
                      onMouseEnter={() => setHighlightIdx(i)}
                      onClick={() => handleSelectMarket(m)}
                    >
                      <span>
                        <strong>{m.symbol}</strong>
                        <span style={{ marginLeft: 6, color: 'var(--text-muted)', fontSize: 10 }}>{m.exchangeSymbol}</span>
                      </span>
                      <span className="mark">{m.markPrice != null ? fmtCompactCurrency(m.markPrice) : '—'}</span>
                    </div>
                  )) : (
                    <div className="symbol-ac-empty">
                      {loadingMarkets ? 'Loading…' : `No markets matching "${symbol}"`}
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
          <div className="form-group" style={{ flex: 1 }}>
            <label className="form-label">Exchange Symbol</label>
            <input className="form-input" value={exchangeSymbol} onChange={(e) => setExchangeSymbol(e.target.value)} placeholder="Auto" />
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
            <label className="form-label">Margin Mode</label>
            <select className="form-select" value={marginMode} onChange={(e) => setMarginMode(e.target.value as MarginMode | '')}>
              <option value="">—</option>
              <option value="cross">Cross</option>
              <option value="isolated">Isolated</option>
            </select>
          </div>
          <div className="form-group">
            <label className="form-label">Leverage</label>
            <input className="form-input" type="number" step="any" value={leverage} onChange={(e) => setLeverage(e.target.value)} />
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
            <input className="form-input" type="number" step="any" value={quantity} onChange={(e) => setQuantity(e.target.value)} placeholder={quantityMode === 'contract' ? 'Contracts' : (quantityMode === 'usd' ? 'Total $' : 'Base Asset')} />
          </div>
          <div className="form-group">
            <label className="form-label">Entry Price</label>
            <input className="form-input" type="number" step="any" value={entryPrice} onChange={(e) => setEntryPrice(e.target.value)} />
          </div>
        </div>

        <button
          type="button"
          className="btn btn--ghost btn--small form-section-toggle"
          onClick={() => setShowAutoFields((value) => !value)}
        >
          {showAutoFields ? 'Hide Advanced Fields' : 'Advanced Fields'}
        </button>

        {showAutoFields && (
          <>
            <div className="form-row">
              <div className="form-group">
                <label className="form-label">Mark Price</label>
                <input className="form-input" type="number" step="any" value={markPrice} onChange={(e) => setMarkPrice(e.target.value)} placeholder="Auto" />
              </div>
              <div className="form-group">
                <label className="form-label">Margin Used</label>
                <input className="form-input" type="number" step="any" value={marginUsed} onChange={(e) => setMarginUsed(e.target.value)} placeholder="Auto" />
              </div>
            </div>

            <div className="form-row">
              <div className="form-group">
                <label className="form-label">Liquidation Price</label>
                <input className="form-input" type="number" step="any" value={liquidationPrice} onChange={(e) => setLiquidationPrice(e.target.value)} placeholder="Optional" />
              </div>
              <div className="form-group">
                <label className="form-label">Maint. Margin</label>
                <input className="form-input" type="number" step="any" value={maintenanceMargin} onChange={(e) => setMaintenanceMargin(e.target.value)} placeholder="Optional" />
              </div>
            </div>
          </>
        )}

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
            <input className="form-input" type="number" step="any" value={feePaid} onChange={(e) => setFeePaid(e.target.value)} placeholder="0" />
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
          <textarea className="form-textarea" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Optional…" />
        </div>

        <div className="form-actions">
          <button className="btn btn--ghost" onClick={closeOverlay}>Cancel</button>
          <button className="btn btn--primary" onClick={handleSubmit} disabled={submitting}>
            {submitting ? 'Adding…' : 'Add Position'}
          </button>
        </div>
      </div>
    </>
  );
}
