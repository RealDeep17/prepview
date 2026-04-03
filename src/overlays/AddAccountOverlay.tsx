import { useState, useCallback } from 'react';
import { useAppStore } from '../store/appStore';
import { createAccount, validateLiveAccount, createLiveAccount } from '../lib/bridge';
import type { ExchangeKind, CreateLiveAccountInput, LiveAccountValidation } from '../lib/types';

export function AddAccountOverlay() {
  const closeOverlay = useAppStore((s) => s.closeOverlay);
  const fetchBootstrap = useAppStore((s) => s.fetchBootstrap);

  const [mode, setMode] = useState<'manual' | 'live'>('manual');

  // Manual fields
  const [name, setName] = useState('');
  const [exchange, setExchange] = useState<ExchangeKind>('manual');
  const [walletBalance, setWalletBalance] = useState('');
  const [notes, setNotes] = useState('');
  const [bonusBalance, setBonusBalance] = useState('');
  const [bonusFeeRate, setBonusFeeRate] = useState('');
  const [bonusLossRate, setBonusLossRate] = useState('');
  const [bonusFundingRate, setBonusFundingRate] = useState('');

  // Live fields
  const [liveExchange, setLiveExchange] = useState<'blofin' | 'hyperliquid'>('blofin');
  const [liveName, setLiveName] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [apiSecret, setApiSecret] = useState('');
  const [apiPassphrase, setApiPassphrase] = useState('');
  const [walletAddress, setWalletAddress] = useState('');

  const [validation, setValidation] = useState<LiveAccountValidation | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  // Auto-fill bonus rates when exchange changes
  const handleExchangeChange = useCallback((ex: ExchangeKind) => {
    setExchange(ex);
    if (ex === 'blofin') {
      setBonusFeeRate('100');
      setBonusLossRate('50');
      setBonusFundingRate('50');
    } else {
      setBonusFeeRate('');
      setBonusLossRate('');
      setBonusFundingRate('');
    }
  }, []);

  const handleCreateManual = useCallback(async () => {
    if (!name.trim()) { setError('Name is required'); return; }
    setSubmitting(true);
    setError('');
    try {
      await createAccount({
        name: name.trim(),
        exchange,
        walletBalance: parseFloat(walletBalance) || 0,
        notes: notes || undefined,
        bonusBalance: bonusBalance ? parseFloat(bonusBalance) : undefined,
        bonusFeeDeductionRate: bonusFeeRate ? parseFloat(bonusFeeRate) / 100 : undefined,
        bonusLossDeductionRate: bonusLossRate ? parseFloat(bonusLossRate) / 100 : undefined,
        bonusFundingDeductionRate: bonusFundingRate ? parseFloat(bonusFundingRate) / 100 : undefined,
      });
      await fetchBootstrap();
      closeOverlay();
    } catch (e) {
      setError(String(e));
    }
    setSubmitting(false);
  }, [name, exchange, walletBalance, notes, bonusBalance, bonusFeeRate, bonusLossRate, bonusFundingRate, fetchBootstrap, closeOverlay]);

  const liveInput = useCallback((): CreateLiveAccountInput => ({
    name: liveName.trim(),
    exchange: liveExchange,
    apiKey: liveExchange === 'blofin' ? apiKey : undefined,
    apiSecret: liveExchange === 'blofin' ? apiSecret : undefined,
    apiPassphrase: liveExchange === 'blofin' ? apiPassphrase : undefined,
    walletAddress: liveExchange === 'hyperliquid' ? walletAddress : undefined,
  }), [liveName, liveExchange, apiKey, apiSecret, apiPassphrase, walletAddress]);

  const handleValidate = useCallback(async () => {
    if (!liveName.trim()) { setError('Name is required'); return; }
    setSubmitting(true);
    setError('');
    try {
      const result = await validateLiveAccount(liveInput());
      setValidation(result);
    } catch (e) {
      setError(String(e));
    }
    setSubmitting(false);
  }, [liveName, liveInput]);

  const handleConnect = useCallback(async () => {
    setSubmitting(true);
    setError('');
    try {
      await createLiveAccount(liveInput());
      await fetchBootstrap();
      closeOverlay();
    } catch (e) {
      setError(String(e));
    }
    setSubmitting(false);
  }, [liveInput, fetchBootstrap, closeOverlay]);

  return (
    <>
      <div className="overlay-backdrop" onClick={closeOverlay} />
      <div className="overlay-drawer">
        <div className="overlay-title">Add Account</div>

        <div className="form-toggle" style={{ marginBottom: 16 }}>
          <button className={`form-toggle-option${mode === 'manual' ? ' form-toggle-option--active' : ''}`} onClick={() => setMode('manual')}>
            Manual
          </button>
          <button className={`form-toggle-option${mode === 'live' ? ' form-toggle-option--active' : ''}`} onClick={() => setMode('live')}>
            Live (API)
          </button>
        </div>

        {error && <div style={{ color: 'var(--red)', fontSize: 12, marginBottom: 12 }}>{error}</div>}

        {mode === 'manual' ? (
          <>
            <div className="form-group">
              <label className="form-label">Account Name</label>
              <input className="form-input" value={name} onChange={(e) => setName(e.target.value)} placeholder="Main Trading" />
            </div>
            <div className="form-group">
              <label className="form-label">Exchange</label>
              <select className="form-select" value={exchange} onChange={(e) => handleExchangeChange(e.target.value as ExchangeKind)}>
                <option value="manual">Manual</option>
                <option value="blofin">BloFin</option>
                <option value="hyperliquid">Hyperliquid</option>
              </select>
            </div>
            <div className="form-group">
              <label className="form-label">Wallet Balance (USDT)</label>
              <input className="form-input" type="number" value={walletBalance} onChange={(e) => setWalletBalance(e.target.value)} placeholder="0.00" />
            </div>
            <div className="form-group">
              <label className="form-label">Bonus Balance (USDT)</label>
              <input className="form-input" type="number" value={bonusBalance} onChange={(e) => setBonusBalance(e.target.value)} placeholder="0.00" />
            </div>
            <div className="form-row">
              <div className="form-group">
                <label className="form-label">Fee Rate %</label>
                <input className="form-input" type="number" value={bonusFeeRate} onChange={(e) => setBonusFeeRate(e.target.value)} placeholder="0" />
              </div>
              <div className="form-group">
                <label className="form-label">Loss Rate %</label>
                <input className="form-input" type="number" value={bonusLossRate} onChange={(e) => setBonusLossRate(e.target.value)} placeholder="0" />
              </div>
              <div className="form-group">
                <label className="form-label">Funding Rate %</label>
                <input className="form-input" type="number" value={bonusFundingRate} onChange={(e) => setBonusFundingRate(e.target.value)} placeholder="0" />
              </div>
            </div>
            <div className="form-hint">Bonus deduction rates: what % of fees/losses/funding the bonus covers. BloFin default: 100/50/50</div>
            <div className="form-group">
              <label className="form-label">Notes</label>
              <textarea className="form-textarea" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Optional notes…" />
            </div>
            <div className="form-actions">
              <button className="btn btn--ghost" onClick={closeOverlay}>Cancel</button>
              <button className="btn btn--primary" onClick={handleCreateManual} disabled={submitting}>
                {submitting ? 'Creating…' : 'Create Account'}
              </button>
            </div>
          </>
        ) : (
          <>
            <div className="form-group">
              <label className="form-label">Account Name</label>
              <input className="form-input" value={liveName} onChange={(e) => setLiveName(e.target.value)} placeholder="My BloFin" />
            </div>
            <div className="form-group">
              <label className="form-label">Exchange</label>
              <select className="form-select" value={liveExchange} onChange={(e) => setLiveExchange(e.target.value as 'blofin' | 'hyperliquid')}>
                <option value="blofin">BloFin</option>
                <option value="hyperliquid">Hyperliquid</option>
              </select>
            </div>
            {liveExchange === 'blofin' && (
              <>
                <div className="form-group">
                  <label className="form-label">API Key</label>
                  <input className="form-input" type="password" value={apiKey} onChange={(e) => setApiKey(e.target.value)} />
                </div>
                <div className="form-group">
                  <label className="form-label">API Secret</label>
                  <input className="form-input" type="password" value={apiSecret} onChange={(e) => setApiSecret(e.target.value)} />
                </div>
                <div className="form-group">
                  <label className="form-label">API Passphrase</label>
                  <input className="form-input" type="password" value={apiPassphrase} onChange={(e) => setApiPassphrase(e.target.value)} />
                </div>
              </>
            )}
            {liveExchange === 'hyperliquid' && (
              <div className="form-group">
                <label className="form-label">Wallet Address</label>
                <input className="form-input" value={walletAddress} onChange={(e) => setWalletAddress(e.target.value)} placeholder="0x…" />
              </div>
            )}

            {validation && (
              <div className="validation-result validation-ok">
                <div className="validation-row"><span>Exchange</span><span>{validation.exchange}</span></div>
                <div className="validation-row"><span>Balance</span><span>${validation.walletBalance.toFixed(2)}</span></div>
                <div className="validation-row"><span>Equity</span><span>${validation.snapshotEquity.toFixed(2)}</span></div>
                <div className="validation-row"><span>Open Positions</span><span>{validation.openPositions}</span></div>
              </div>
            )}

            <div className="form-actions">
              <button className="btn btn--ghost" onClick={closeOverlay}>Cancel</button>
              {!validation ? (
                <button className="btn btn--primary" onClick={handleValidate} disabled={submitting}>
                  {submitting ? 'Validating…' : 'Validate'}
                </button>
              ) : (
                <button className="btn btn--primary" onClick={handleConnect} disabled={submitting}>
                  {submitting ? 'Connecting…' : 'Connect'}
                </button>
              )}
            </div>
          </>
        )}
      </div>
    </>
  );
}
