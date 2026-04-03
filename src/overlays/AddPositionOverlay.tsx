import { useState, useCallback } from 'react';
import { useAppStore } from '../store/appStore';
import { addManualPosition } from '../lib/bridge';
import type { ExchangeKind, PositionSide, MarginMode } from '../lib/types';

export function AddPositionOverlay() {
  const closeOverlay = useAppStore((s) => s.closeOverlay);
  const fetchBootstrap = useAppStore((s) => s.fetchBootstrap);
  const bootstrap = useAppStore((s) => s.bootstrap);

  const manualAccounts = (bootstrap?.accounts ?? []).filter(
    (a) => a.accountMode === 'manual' || a.accountMode === 'import'
  );

  const [accountId, setAccountId] = useState(manualAccounts[0]?.id ?? '');
  const [symbol, setSymbol] = useState('');
  const [exchangeSymbol, setExchangeSymbol] = useState('');
  const [side, setSide] = useState<PositionSide>('long');
  const [marginMode, setMarginMode] = useState<MarginMode | ''>('');
  const [quantity, setQuantity] = useState('');
  const [entryPrice, setEntryPrice] = useState('');
  const [markPrice, setMarkPrice] = useState('');
  const [leverage, setLeverage] = useState('1');
  const [marginUsed, setMarginUsed] = useState('');
  const [liquidationPrice, setLiquidationPrice] = useState('');
  const [maintenanceMargin, setMaintenanceMargin] = useState('');
  const [feePaid, setFeePaid] = useState('');
  const [fundingPaid, setFundingPaid] = useState('');
  const [notes, setNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  const selectedAccount = manualAccounts.find((a) => a.id === accountId);
  const exchange: ExchangeKind = selectedAccount?.exchange ?? 'manual';

  const handleSubmit = useCallback(async () => {
    if (!symbol.trim()) { setError('Symbol is required'); return; }
    if (!quantity || parseFloat(quantity) <= 0) { setError('Quantity must be > 0'); return; }
    if (!entryPrice || parseFloat(entryPrice) <= 0) { setError('Entry price must be > 0'); return; }
    if (!accountId) { setError('Select an account'); return; }

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
  }, [accountId, exchange, exchangeSymbol, symbol, marginMode, side, quantity, entryPrice, markPrice, leverage, marginUsed, liquidationPrice, maintenanceMargin, feePaid, fundingPaid, notes, fetchBootstrap, closeOverlay]);

  return (
    <>
      <div className="overlay-backdrop" onClick={closeOverlay} />
      <div className="overlay-drawer">
        <div className="overlay-title">Add Position</div>
        {error && <div style={{ color: 'var(--red)', fontSize: 12, marginBottom: 12 }}>{error}</div>}

        <div className="form-group">
          <label className="form-label">Account</label>
          <select className="form-select" value={accountId} onChange={(e) => setAccountId(e.target.value)}>
            {manualAccounts.map((a) => (
              <option key={a.id} value={a.id}>{a.name} ({a.exchange})</option>
            ))}
          </select>
          {manualAccounts.length === 0 && <div className="form-hint">Create a manual account first</div>}
        </div>

        <div className="form-row">
          <div className="form-group">
            <label className="form-label">Symbol</label>
            <input className="form-input" value={symbol} onChange={(e) => setSymbol(e.target.value)} placeholder="BTC-PERP" />
          </div>
          <div className="form-group">
            <label className="form-label">Exchange Symbol</label>
            <input className="form-input" value={exchangeSymbol} onChange={(e) => setExchangeSymbol(e.target.value)} placeholder="Optional" />
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
            <input className="form-input" type="number" value={leverage} onChange={(e) => setLeverage(e.target.value)} />
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
            <input className="form-input" type="number" value={markPrice} onChange={(e) => setMarkPrice(e.target.value)} placeholder="Auto" />
          </div>
          <div className="form-group">
            <label className="form-label">Margin Used</label>
            <input className="form-input" type="number" value={marginUsed} onChange={(e) => setMarginUsed(e.target.value)} placeholder="Auto" />
          </div>
        </div>

        <div className="form-row">
          <div className="form-group">
            <label className="form-label">Liquidation Price</label>
            <input className="form-input" type="number" value={liquidationPrice} onChange={(e) => setLiquidationPrice(e.target.value)} placeholder="Optional" />
          </div>
          <div className="form-group">
            <label className="form-label">Maint. Margin</label>
            <input className="form-input" type="number" value={maintenanceMargin} onChange={(e) => setMaintenanceMargin(e.target.value)} placeholder="Optional" />
          </div>
        </div>

        <div className="form-row">
          <div className="form-group">
            <label className="form-label">Fee Paid</label>
            <input className="form-input" type="number" value={feePaid} onChange={(e) => setFeePaid(e.target.value)} placeholder="0" />
          </div>
          <div className="form-group">
            <label className="form-label">Funding Paid</label>
            <input className="form-input" type="number" value={fundingPaid} onChange={(e) => setFundingPaid(e.target.value)} placeholder="0" />
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
