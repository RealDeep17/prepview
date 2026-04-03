import { useState, useCallback, useEffect } from 'react';
import { useAppStore } from '../store/appStore';
import { updateAccount, deleteAccount } from '../lib/bridge';
import { useToast } from '../shell/Toast';

export function EditAccountOverlay() {
  const closeOverlay = useAppStore((s) => s.closeOverlay);
  const fetchBootstrap = useAppStore((s) => s.fetchBootstrap);
  const bootstrap = useAppStore((s) => s.bootstrap);
  const selectedAccountId = useAppStore((s) => s.selectedAccountId);
  const setSelectedAccountId = useAppStore((s) => s.setSelectedAccountId);
  const { toast } = useToast();

  const account = bootstrap?.accounts.find((a) => a.id === selectedAccountId) ?? null;

  const [name, setName] = useState('');
  const [walletBalance, setWalletBalance] = useState('');
  const [notes, setNotes] = useState('');
  const [bonusBalance, setBonusBalance] = useState('');
  const [bonusFeeRate, setBonusFeeRate] = useState('');
  const [bonusLossRate, setBonusLossRate] = useState('');
  const [bonusFundingRate, setBonusFundingRate] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(false);

  useEffect(() => {
    if (!account) return;
    setName(account.name);
    setWalletBalance(String(account.walletBalance));
    setNotes(account.notes ?? '');
    setBonusBalance(String(account.bonusBalance));
    setBonusFeeRate(String(account.bonusFeeDeductionRate * 100));
    setBonusLossRate(String(account.bonusLossDeductionRate * 100));
    setBonusFundingRate(String(account.bonusFundingDeductionRate * 100));
  }, [account]);

  const handleSave = useCallback(async () => {
    if (!account) return;
    if (!name.trim()) { setError('Name is required'); return; }
    setSubmitting(true);
    setError('');
    try {
      await updateAccount({
        id: account.id,
        name: name.trim(),
        walletBalance: parseFloat(walletBalance) || undefined,
        notes: notes || undefined,
        bonusBalance: parseFloat(bonusBalance) || 0,
        bonusFeeDeductionRate: bonusFeeRate ? parseFloat(bonusFeeRate) / 100 : 0,
        bonusLossDeductionRate: bonusLossRate ? parseFloat(bonusLossRate) / 100 : 0,
        bonusFundingDeductionRate: bonusFundingRate ? parseFloat(bonusFundingRate) / 100 : 0,
      });
      await fetchBootstrap();
      toast('Account updated', 'success');
      closeOverlay();
    } catch (e) {
      setError(String(e));
    }
    setSubmitting(false);
  }, [account, name, walletBalance, notes, bonusBalance, bonusFeeRate, bonusLossRate, bonusFundingRate, fetchBootstrap, closeOverlay]);

  const handleDelete = useCallback(async () => {
    if (!account) return;
    setSubmitting(true);
    setError('');
    try {
      await deleteAccount(account.id);
      setSelectedAccountId(null);
      await fetchBootstrap();
      toast(`Deleted "${account.name}"`, 'info');
      closeOverlay();
    } catch (e) {
      setError(String(e));
    }
    setSubmitting(false);
  }, [account, fetchBootstrap, closeOverlay, setSelectedAccountId]);

  if (!account) {
    return (
      <>
        <div className="overlay-backdrop" onClick={closeOverlay} />
        <div className="overlay-drawer">
          <div className="overlay-title">No Account Selected</div>
          <button className="btn btn--ghost" onClick={closeOverlay}>Close</button>
        </div>
      </>
    );
  }

  return (
    <>
      <div className="overlay-backdrop" onClick={closeOverlay} />
      <div className="overlay-drawer">
        <div className="overlay-title">Edit Account — {account.name}</div>
        {error && <div style={{ color: 'var(--red)', fontSize: 12, marginBottom: 12 }}>{error}</div>}

        <div className="form-group">
          <label className="form-label">Account Name</label>
          <input className="form-input" value={name} onChange={(e) => setName(e.target.value)} />
        </div>

        {account.accountMode !== 'live' && (
          <div className="form-group">
            <label className="form-label">Wallet Balance (USDT)</label>
            <input className="form-input" type="number" value={walletBalance} onChange={(e) => setWalletBalance(e.target.value)} />
          </div>
        )}

        <div className="form-group">
          <label className="form-label">Bonus Balance (USDT)</label>
          <input className="form-input" type="number" value={bonusBalance} onChange={(e) => setBonusBalance(e.target.value)} />
        </div>
        <div className="form-row">
          <div className="form-group">
            <label className="form-label">Fee Rate %</label>
            <input className="form-input" type="number" value={bonusFeeRate} onChange={(e) => setBonusFeeRate(e.target.value)} />
          </div>
          <div className="form-group">
            <label className="form-label">Loss Rate %</label>
            <input className="form-input" type="number" value={bonusLossRate} onChange={(e) => setBonusLossRate(e.target.value)} />
          </div>
          <div className="form-group">
            <label className="form-label">Funding Rate %</label>
            <input className="form-input" type="number" value={bonusFundingRate} onChange={(e) => setBonusFundingRate(e.target.value)} />
          </div>
        </div>
        <div className="form-hint">Bonus deduction rates: what % of fees/losses/funding the bonus covers.</div>

        <div className="form-group">
          <label className="form-label">Notes</label>
          <textarea className="form-textarea" value={notes} onChange={(e) => setNotes(e.target.value)} />
        </div>

        <div style={{ marginTop: 8, fontSize: 11, color: 'var(--text-muted)' }}>
          Exchange: {account.exchange} · Mode: {account.accountMode} · Currency: {account.currency}
        </div>

        <div className="form-actions">
          <button className="btn btn--ghost" onClick={closeOverlay}>Cancel</button>
          <button className="btn btn--primary" onClick={handleSave} disabled={submitting}>
            {submitting ? 'Saving…' : 'Save Changes'}
          </button>
        </div>

        <div style={{ marginTop: 20, paddingTop: 16, borderTop: '1px solid var(--border)' }}>
          {!confirmDelete ? (
            <button className="btn btn--danger" style={{ width: '100%' }} onClick={() => setConfirmDelete(true)}>
              Delete Account
            </button>
          ) : (
            <div>
              <div style={{ fontSize: 12, color: 'var(--red)', marginBottom: 8 }}>
                This will permanently delete "{account.name}" and all its positions. Are you sure?
              </div>
              <div className="form-actions">
                <button className="btn btn--ghost" onClick={() => setConfirmDelete(false)}>Cancel</button>
                <button className="btn btn--danger" onClick={handleDelete} disabled={submitting}>
                  {submitting ? 'Deleting…' : 'Confirm Delete'}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
