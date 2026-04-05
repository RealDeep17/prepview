import { useMemo, useState, type ReactNode } from 'react';
import { useAppStore } from '../store/appStore';
import { useContextMenu, type CtxMenuItem } from '../shell/contextMenuContext';
import { useToast } from '../shell/toastContext';
import {
  fmtCompactCurrency,
  findExchangeMarket,
  fmtCompactNumber,
  fmtCurrency,
  fmtPnl,
  fmtPnlClass,
} from '../lib/fmt';
import { deleteManualPosition, syncLiveAccount } from '../lib/bridge';
import type { PositionColumnKey } from '../lib/positionView';
import type { ExchangeMarket, PortfolioPosition } from '../lib/types';

type PositionRow = {
  pos: PortfolioPosition;
  market?: ExchangeMarket;
  tokenSize: number;
  notional: number;
  index: number;
};

const positionColumnDefinitions: Record<
  PositionColumnKey,
  {
    label: string;
    numeric?: boolean;
    sortable?: boolean;
    render: (row: PositionRow) => ReactNode;
  }
> = {
  symbol: {
    label: 'Symbol',
    sortable: true,
    render: ({ pos }) => <span className="mono" style={{ fontWeight: 600 }}>{pos.symbol}</span>,
  },
  account: {
    label: 'Account',
    sortable: true,
    render: ({ pos }) => pos.accountName,
  },
  side: {
    label: 'Side',
    sortable: true,
    render: ({ pos }) => (
      <span className={`side-tag side-tag--${pos.side}`}>
        {pos.side === 'long' ? 'Long' : 'Short'}
      </span>
    ),
  },
  margin: {
    label: 'Margin',
    sortable: true,
    render: ({ pos }) => pos.marginMode ? <span className="margin-tag">{pos.marginMode}</span> : '—',
  },
  size: {
    label: 'Size',
    numeric: true,
    sortable: true,
    render: ({ tokenSize }) => fmtCompactNumber(tokenSize, 4),
  },
  entry: {
    label: 'Entry',
    numeric: true,
    sortable: true,
    render: ({ pos }) => fmtCompactCurrency(pos.entryPrice),
  },
  mark: {
    label: 'Mark',
    numeric: true,
    sortable: true,
    render: ({ pos }) => pos.markPrice != null ? fmtCompactCurrency(pos.markPrice) : '—',
  },
  liq: {
    label: 'Liq. Price',
    numeric: true,
    sortable: true,
    render: ({ pos }) => (
      <>
        {pos.liquidationPrice != null ? fmtCompactCurrency(pos.liquidationPrice) : '—'}
        {pos.riskSource === 'local_engine' && <span className="risk-chip">est.</span>}
        {pos.riskSource === 'user_input' && <span className="risk-chip">manual</span>}
      </>
    ),
  },
  tp: {
    label: 'TP',
    numeric: true,
    sortable: true,
    render: ({ pos }) => (
      <span style={{ color: pos.takeProfit != null ? 'var(--green)' : undefined }}>
        {pos.takeProfit != null ? fmtCompactCurrency(pos.takeProfit) : '—'}
      </span>
    ),
  },
  sl: {
    label: 'SL',
    numeric: true,
    sortable: true,
    render: ({ pos }) => (
      <span style={{ color: pos.stopLoss != null ? 'var(--red)' : undefined }}>
        {pos.stopLoss != null ? fmtCompactCurrency(pos.stopLoss) : '—'}
      </span>
    ),
  },
  lev: {
    label: 'Lev',
    numeric: true,
    sortable: true,
    render: ({ pos }) => `${pos.leverage}×`,
  },
  marginUsed: {
    label: 'Margin Used',
    numeric: true,
    sortable: true,
    render: ({ pos }) => pos.marginUsed != null ? fmtCurrency(pos.marginUsed) : '—',
  },
  unrealizedPnl: {
    label: 'Unrealized P&L',
    numeric: true,
    sortable: true,
    render: ({ pos }) => (
      <span className={fmtPnlClass(pos.unrealizedPnl)}>
        {fmtPnl(pos.unrealizedPnl)}
      </span>
    ),
  },
  notional: {
    label: 'Notional',
    numeric: true,
    sortable: true,
    render: ({ notional }) => fmtCurrency(notional),
  },
};

function getPositionSortValue(row: PositionRow, key: PositionColumnKey): number | string | null {
  const { pos, tokenSize, notional } = row;
  switch (key) {
    case 'symbol':
      return pos.symbol;
    case 'account':
      return pos.accountName;
    case 'side':
      return pos.side;
    case 'margin':
      return pos.marginMode ?? null;
    case 'size':
      return tokenSize;
    case 'entry':
      return pos.entryPrice;
    case 'mark':
      return pos.markPrice ?? null;
    case 'liq':
      return pos.liquidationPrice ?? null;
    case 'tp':
      return pos.takeProfit ?? null;
    case 'sl':
      return pos.stopLoss ?? null;
    case 'lev':
      return pos.leverage;
    case 'marginUsed':
      return pos.marginUsed ?? null;
    case 'unrealizedPnl':
      return pos.unrealizedPnl;
    case 'notional':
      return notional;
  }
}

export function PositionsPane() {
  const bootstrap = useAppStore((s) => s.bootstrap);
  const scopeExchange = useAppStore((s) => s.scopeExchange);
  const scopeAccountId = useAppStore((s) => s.scopeAccountId);
  const selectedPositionId = useAppStore((s) => s.selectedPositionId);
  const setSelectedPositionId = useAppStore((s) => s.setSelectedPositionId);
  const positionColumns = useAppStore((s) => s.positionColumns);
  const positionSortKey = useAppStore((s) => s.positionSortKey);
  const positionSortDirection = useAppStore((s) => s.positionSortDirection);
  const togglePositionSort = useAppStore((s) => s.togglePositionSort);
  const openOverlay = useAppStore((s) => s.openOverlay);
  const fetchBootstrap = useAppStore((s) => s.fetchBootstrap);
  const { show: showCtx } = useContextMenu();
  const { toast } = useToast();
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  const positions = useMemo(() => {
    if (!bootstrap) return [];

    let accounts = bootstrap.accounts;
    if (scopeExchange !== 'all') {
      accounts = accounts.filter((account) => account.exchange === scopeExchange);
    }
    if (scopeAccountId) {
      accounts = accounts.filter((account) => account.id === scopeAccountId);
    }

    const accountIds = new Set(accounts.map((account) => account.id));
    return bootstrap.positions.filter((position) => accountIds.has(position.accountId));
  }, [bootstrap, scopeAccountId, scopeExchange]);

  const rows = useMemo(() => {
    if (!bootstrap) return [];

    return positions
      .map((pos, index) => {
        const market = findExchangeMarket(bootstrap.markets, pos.exchange, pos.symbol, pos.exchangeSymbol);
        const faceValue = market?.contractValue ?? 1.0;
        const tokenSize = pos.quantity * faceValue;
        const notional = (pos.markPrice ?? pos.entryPrice) * tokenSize;
        return { pos, market, tokenSize, notional, index };
      })
      .sort((left, right) => {
        if (!positionSortKey) return left.index - right.index;

        const leftValue = getPositionSortValue(left, positionSortKey);
        const rightValue = getPositionSortValue(right, positionSortKey);
        const leftMissing = leftValue == null || leftValue === '';
        const rightMissing = rightValue == null || rightValue === '';

        if (leftMissing && rightMissing) return left.index - right.index;
        if (leftMissing) return 1;
        if (rightMissing) return -1;

        let comparison = 0;
        if (typeof leftValue === 'number' && typeof rightValue === 'number') {
          comparison = leftValue - rightValue;
        } else {
          comparison = String(leftValue).localeCompare(String(rightValue), undefined, {
            sensitivity: 'base',
          });
        }

        if (comparison === 0) return left.index - right.index;
        return comparison * (positionSortDirection === 'asc' ? 1 : -1);
      });
  }, [bootstrap, positionSortDirection, positionSortKey, positions]);

  const visibleColumns = positionColumns.filter((column) => positionColumnDefinitions[column]);

  const handleDelete = async (posId: string, posSymbol: string) => {
    try {
      await deleteManualPosition(posId);
      setSelectedPositionId(null);
      setConfirmDeleteId(null);
      await fetchBootstrap();
      toast(`Deleted ${posSymbol}`, 'info');
    } catch (e) {
      toast(`Failed: ${e}`, 'error');
    }
  };

  const handleContextMenu = (e: React.MouseEvent, posId: string, posSymbol: string, _posExchange: string, posAccountId: string) => {
    e.preventDefault();
    e.stopPropagation();
    setSelectedPositionId(posId);

    const isManual = !bootstrap ? false : (() => {
      const account = bootstrap.accounts.find(a => a.id === posAccountId);
      return account?.accountMode === 'manual' || account?.accountMode === 'import';
    })();
    const items: CtxMenuItem[] = [];

    if (isManual) {
      items.push(
        { label: 'Edit Position', action: () => openOverlay('edit-position', posId) },
        { label: 'Close Position', action: () => openOverlay('edit-position', posId) },
        { label: 'Delete Position', action: () => setConfirmDeleteId(posId), danger: true },
      );
    } else {
      items.push(
        { label: 'Sync Account', action: async () => {
          try {
            await syncLiveAccount(posAccountId);
            await fetchBootstrap();
            toast('Sync complete', 'success');
          } catch (e) { toast(`Sync failed: ${e}`, 'error'); }
        }},
      );
    }

    items.push(
      { label: 'Add Position', action: () => openOverlay('add-position') },
    );

    showCtx(e.clientX, e.clientY, items, posSymbol);
  };

  if (positions.length === 0) {
    return (
      <div className="empty-state">
        <div>No open positions</div>
        <div>Add a position or sync a live account to get started.</div>
      </div>
    );
  }

  return (
    <table className="data-table">
      <thead>
        <tr>
          {visibleColumns.map((column) => {
            const definition = positionColumnDefinitions[column];
            const sortableClass = definition.sortable ? 'data-table-sortable' : '';
            const isSorted = positionSortKey === column;
            return (
              <th
                key={column}
                className={`${definition.numeric ? 'num ' : ''}${sortableClass}`.trim()}
                onClick={definition.sortable ? () => togglePositionSort(column) : undefined}
              >
                <span className="th-content">
                  {definition.label}
                  {isSorted && (
                    <span className="sort-indicator">{positionSortDirection === 'asc' ? '↑' : '↓'}</span>
                  )}
                </span>
              </th>
            );
          })}
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr
            key={row.pos.id}
            className={selectedPositionId === row.pos.id ? 'row--selected' : ''}
            onClick={() => setSelectedPositionId(row.pos.id)}
            onContextMenu={(e) => handleContextMenu(e, row.pos.id, row.pos.symbol, row.pos.exchange, row.pos.accountId)}
          >
            {visibleColumns.map((column) => {
              const definition = positionColumnDefinitions[column];
              return (
                <td key={column} className={definition.numeric ? 'num' : undefined}>
                  {definition.render(row)}
                </td>
              );
            })}
          </tr>
        ))}
      </tbody>
      {confirmDeleteId && (
        <tfoot>
          <tr>
            <td colSpan={visibleColumns.length}>
              <div className="inline-confirm">
                <span>Delete position "{positions.find((p) => p.id === confirmDeleteId)?.symbol}"?</span>
                <button className="btn btn--danger btn--small" onClick={() => {
                  const pos = positions.find((p) => p.id === confirmDeleteId);
                  if (pos) handleDelete(pos.id, pos.symbol);
                }}>Confirm</button>
                <button className="btn btn--ghost btn--small" onClick={() => setConfirmDeleteId(null)}>Cancel</button>
              </div>
            </td>
          </tr>
        </tfoot>
      )}
    </table>
  );
}
