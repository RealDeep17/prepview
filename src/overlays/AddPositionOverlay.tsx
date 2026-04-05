import { useState, useEffect, useMemo, useRef } from 'react';
import { useAppStore } from '../store/appStore';
import { addManualPosition, getExchangeMarkets, getExchangeMarketQuote } from '../lib/bridge';
import { findExchangeMarket, fmtCompactCurrency } from '../lib/fmt';
import type { ExchangeKind, ExchangeMarket, PositionSide, MarginMode } from '../lib/types';

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

  const handleSubmit = async () => {
    if (!symbol.trim()) { setError('Symbol is required'); return; }
    if (!quantity || parseFloat(quantity) <= 0) { setError('Quantity must be > 0'); return; }
    if (!entryPrice || parseFloat(entryPrice) <= 0) { setError('Entry price must be > 0'); return; }
    if (!accountId) { setError('Select an account'); return; }

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
              {isLive && !loadingMarkets && activeMarkets.length > 0 && (
                <span style={{ color: 'var(--accent)', marginLeft: 6 }}>{activeMarkets.length} pairs</span>
              )}
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
          {showAutoFields ? 'Hide Auto-Fetched Fields' : 'Show Auto-Fetched Fields'}
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

        <div className="form-row">
          <div className="form-group">
            <label className="form-label">Fee Paid</label>
            <input className="form-input" type="number" step="any" value={feePaid} onChange={(e) => setFeePaid(e.target.value)} placeholder="0" />
          </div>
          <div className="form-group">
            <label className="form-label">Funding Paid</label>
            <input className="form-input" type="number" step="any" value={fundingPaid} onChange={(e) => setFundingPaid(e.target.value)} placeholder="0" />
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
