import { useState } from 'react';
import { useAppStore } from '../store/appStore';
import { getPositionEvents, getClosedTrades } from '../lib/bridge';
import { fmtCurrency, fmtPnl, fmtPnlClass, fmtTimestamp, fmtNumber } from '../lib/fmt';
import type { PositionEventRecord, ClosedTradeRecord } from '../lib/types';

interface Props {
  showClosed: boolean;
}

export function JournalPane({ showClosed }: Props) {
  const bootstrap = useAppStore((s) => s.bootstrap);
  const [extraEvents, setExtraEvents] = useState<PositionEventRecord[]>([]);
  const [extraClosed, setExtraClosed] = useState<ClosedTradeRecord[]>([]);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMoreEvents, setHasMoreEvents] = useState(true);
  const [hasMoreClosed, setHasMoreClosed] = useState(true);

  if (!bootstrap) return null;

  const baseEvents = bootstrap.recentPositionEvents ?? [];
  const baseClosed = bootstrap.recentClosedTrades ?? [];
  const events = [...baseEvents, ...extraEvents];
  const closed = [...baseClosed, ...extraClosed];

  const loadMoreEvents = async () => {
    setLoadingMore(true);
    try {
      const requestedLimit = Math.min(events.length + 50, 512);
      const more = await getPositionEvents({ limit: requestedLimit });
      setExtraEvents(more.slice(baseEvents.length));
      setHasMoreEvents(more.length === requestedLimit);
    } catch { /* ignore */ }
    setLoadingMore(false);
  };

  const loadMoreClosed = async () => {
    setLoadingMore(true);
    try {
      const requestedLimit = Math.min(closed.length + 50, 512);
      const more = await getClosedTrades({ limit: requestedLimit });
      setExtraClosed(more.slice(baseClosed.length));
      setHasMoreClosed(more.length === requestedLimit);
    } catch { /* ignore */ }
    setLoadingMore(false);
  };

  if (showClosed) {
    if (closed.length === 0) {
      return (
        <div className="empty-state">
          <div>No closed trades yet.</div>
        </div>
      );
    }

    return (
      <>
        <table className="data-table">
          <thead>
            <tr>
              <th>Closed</th>
              <th>Symbol</th>
              <th>Account</th>
              <th>Side</th>
              <th className="num">Size</th>
              <th className="num">Entry</th>
              <th className="num">Exit</th>
              <th className="num">Lev</th>
              <th className="num">P&amp;L</th>
              <th className="num">Fees</th>
              <th className="num">Funding</th>
            </tr>
          </thead>
          <tbody>
            {closed.map((trade) => (
              <tr key={trade.id}>
                <td>{fmtTimestamp(trade.closedAt)}</td>
                <td className="mono" style={{ fontWeight: 600 }}>{trade.symbol}</td>
                <td>{trade.accountName}</td>
                <td>
                  <span className={`side-tag side-tag--${trade.side}`}>
                    {trade.side === 'long' ? 'Long' : 'Short'}
                  </span>
                </td>
                <td className="num">
                  {fmtNumber(
                    trade.quantity * (bootstrap.markets.find((m) => m.symbol.toUpperCase() === trade.symbol.toUpperCase() && m.exchange.toLowerCase() === trade.exchange.toLowerCase())?.contractValue ?? 1.0),
                    4
                  )}
                </td>
                <td className="num">{fmtCurrency(trade.entryPrice)}</td>
                <td className="num">{fmtCurrency(trade.exitPrice)}</td>
                <td className="num">{trade.leverage}×</td>
                <td className={`num ${fmtPnlClass(trade.realizedPnl)}`}>{fmtPnl(trade.realizedPnl)}</td>
                <td className="num pnl-negative">{fmtCurrency(trade.feePaid)}</td>
                <td className="num pnl-negative">{fmtCurrency(trade.fundingPaid)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {hasMoreClosed && (
          <div style={{ padding: 12, textAlign: 'center' }}>
            <button className="btn btn--ghost btn--small" onClick={loadMoreClosed} disabled={loadingMore}>
              {loadingMore ? 'Loading…' : 'Load More'}
            </button>
          </div>
        )}
      </>
    );
  }

  // Position Events view
  if (events.length === 0) {
    return (
      <div className="empty-state">
        <div>No position events yet.</div>
      </div>
    );
  }

  return (
    <>
      <table className="data-table">
        <thead>
          <tr>
            <th>Time</th>
            <th>Event</th>
            <th>Symbol</th>
            <th>Account</th>
            <th>Side</th>
            <th className="num">Size</th>
            <th className="num">Entry</th>
            <th className="num">Mark</th>
            <th className="num">P&amp;L</th>
          </tr>
        </thead>
        <tbody>
          {events.map((event) => (
            <tr key={event.id}>
              <td>{fmtTimestamp(event.eventTime)}</td>
              <td>
                <span className={`event-badge event-badge--${event.eventKind}`}>
                  {event.eventKind}
                </span>
              </td>
              <td className="mono" style={{ fontWeight: 600 }}>{event.symbol}</td>
              <td>{event.accountName}</td>
              <td>
                <span className={`side-tag side-tag--${event.side}`}>
                  {event.side === 'long' ? 'L' : 'S'}
                </span>
              </td>
              <td className="num">
                {fmtNumber(
                  event.quantity * (bootstrap.markets.find((m) => m.symbol.toUpperCase() === event.symbol.toUpperCase() && m.exchange.toLowerCase() === event.exchange.toLowerCase())?.contractValue ?? 1.0),
                  4
                )}
              </td>
              <td className="num">{fmtCurrency(event.entryPrice)}</td>
              <td className="num">{event.markPrice != null ? fmtCurrency(event.markPrice) : '—'}</td>
              <td className={`num ${fmtPnlClass(event.eventKind === 'closed' ? event.realizedPnl : event.unrealizedPnl)}`}>
                {fmtPnl(event.eventKind === 'closed' ? event.realizedPnl : event.unrealizedPnl)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {hasMoreEvents && (
        <div style={{ padding: 12, textAlign: 'center' }}>
          <button className="btn btn--ghost btn--small" onClick={loadMoreEvents} disabled={loadingMore}>
            {loadingMore ? 'Loading…' : 'Load More'}
          </button>
        </div>
      )}
    </>
  );
}
