import { useState, useCallback } from 'react';
import { useAppStore } from '../store/appStore';
import { importCsvPositions } from '../lib/bridge';
import type { ExchangeKind, CsvImportResult } from '../lib/types';

export function CsvImportOverlay() {
  const closeOverlay = useAppStore((s) => s.closeOverlay);
  const fetchBootstrap = useAppStore((s) => s.fetchBootstrap);
  const bootstrap = useAppStore((s) => s.bootstrap);

  const [exchange, setExchange] = useState<ExchangeKind>('blofin');
  const [targetAccountId, setTargetAccountId] = useState('');
  const [csv, setCsv] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<CsvImportResult | null>(null);

  const accounts = bootstrap?.accounts ?? [];

  const handleImport = useCallback(async () => {
    if (!csv.trim()) { setError('CSV content is required'); return; }
    setSubmitting(true);
    setError('');
    setResult(null);
    try {
      const res = await importCsvPositions({
        csv: csv.trim(),
        exchange,
        targetAccountId: targetAccountId || undefined,
      });
      setResult(res);
      await fetchBootstrap();
    } catch (e) {
      setError(String(e));
    }
    setSubmitting(false);
  }, [csv, exchange, targetAccountId, fetchBootstrap]);

  const handleFileUpload = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      setCsv(ev.target?.result as string ?? '');
    };
    reader.readAsText(file);
  }, []);

  return (
    <>
      <div className="overlay-backdrop" onClick={closeOverlay} />
      <div className="overlay-drawer">
        <div className="overlay-title">Import CSV</div>
        {error && <div style={{ color: 'var(--red)', fontSize: 12, marginBottom: 12 }}>{error}</div>}

        <div className="form-group">
          <label className="form-label">Exchange</label>
          <select className="form-select" value={exchange} onChange={(e) => setExchange(e.target.value as ExchangeKind)}>
            <option value="blofin">BloFin</option>
            <option value="hyperliquid">Hyperliquid</option>
            <option value="manual">Manual</option>
          </select>
        </div>

        <div className="form-group">
          <label className="form-label">Target Account (optional)</label>
          <select className="form-select" value={targetAccountId} onChange={(e) => setTargetAccountId(e.target.value)}>
            <option value="">Create new account</option>
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>{a.name}</option>
            ))}
          </select>
        </div>

        <div className="form-group">
          <label className="form-label">CSV File</label>
          <input type="file" accept=".csv,.txt" onChange={handleFileUpload} style={{ fontSize: 12, color: 'var(--text-secondary)' }} />
        </div>

        <div className="form-group">
          <label className="form-label">Or Paste CSV</label>
          <textarea
            className="form-textarea"
            value={csv}
            onChange={(e) => setCsv(e.target.value)}
            placeholder="Paste CSV content here…"
            style={{ minHeight: 120, fontFamily: 'var(--font-mono)', fontSize: 11 }}
          />
        </div>

        {result && (
          <div className="import-result">
            <div style={{ fontSize: 13, marginBottom: 6 }}>
              <span className="pnl-positive">{result.importedCount} imported</span>
              {result.rejectedRows.length > 0 && (
                <span className="pnl-negative" style={{ marginLeft: 8 }}>{result.rejectedRows.length} rejected</span>
              )}
            </div>
            {result.rejectedRows.length > 0 && (
              <div className="import-rejections">
                {result.rejectedRows.map((row, i) => (
                  <div key={i}>{row}</div>
                ))}
              </div>
            )}
          </div>
        )}

        <div className="form-actions">
          <button className="btn btn--ghost" onClick={closeOverlay}>
            {result ? 'Done' : 'Cancel'}
          </button>
          {!result && (
            <button className="btn btn--primary" onClick={handleImport} disabled={submitting}>
              {submitting ? 'Importing…' : 'Import'}
            </button>
          )}
        </div>
      </div>
    </>
  );
}
