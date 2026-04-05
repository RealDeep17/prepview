import { Fragment, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useAppStore } from '../store/appStore';
import { useContextMenu, type CtxMenuItem } from '../shell/contextMenuContext';
import { useToast } from '../shell/toastContext';
import {
  exchangeTagClass,
  fmtCompactCurrency,
  findExchangeMarket,
  fmtCompactNumber,
  fmtCurrency,
  fmtPnl,
  fmtPnlClass,
} from '../lib/fmt';
import { deleteManualPosition, syncLiveAccount } from '../lib/bridge';
import type { PositionColumnKey } from '../lib/positionView';
import type { ExchangeKind, ExchangeMarket, PortfolioPosition } from '../lib/types';

type PositionRow = {
  pos: PortfolioPosition;
  market?: ExchangeMarket;
  tokenSize: number;
  notional: number;
  index: number;
};

type PositionGroup = {
  accountId: string;
  accountName: string;
  exchange: ExchangeKind;
  rowCount: number;
  unrealizedPnl: number;
  rows: PositionRow[];
};

const SIDE_FILTER_OPTIONS = [
  { key: 'all', label: 'All' },
  { key: 'long', label: 'Long' },
  { key: 'short', label: 'Short' },
] as const;

const PNL_FILTER_OPTIONS = [
  { key: 'all', label: 'All' },
  { key: 'winners', label: 'Win' },
  { key: 'losers', label: 'Loss' },
] as const;

const positionColumnDefinitions: Record<
  PositionColumnKey,
  {
    label: string;
    numeric?: boolean;
    sortable?: boolean;
    width?: number;
    render: (row: PositionRow) => ReactNode;
  }
> = {
  symbol: {
    label: 'Symbol',
    sortable: true,
    width: 184,
    render: ({ pos }) => <span className="table-text table-text--strong mono">{pos.symbol}</span>,
  },
  side: {
    label: 'Side',
    sortable: true,
    width: 92,
    render: ({ pos }) => (
      <span className={`side-tag side-tag--${pos.side}`}>
        {pos.side === 'long' ? 'Long' : 'Short'}
      </span>
    ),
  },
  margin: {
    label: 'Margin',
    sortable: true,
    width: 96,
    render: ({ pos }) => pos.marginMode ? <span className="margin-tag">{pos.marginMode}</span> : '—',
  },
  size: {
    label: 'Size',
    numeric: true,
    sortable: true,
    width: 96,
    render: ({ tokenSize }) => fmtCompactNumber(tokenSize, 4),
  },
  entry: {
    label: 'Entry',
    numeric: true,
    sortable: true,
    width: 124,
    render: ({ pos }) => fmtCompactCurrency(pos.entryPrice),
  },
  mark: {
    label: 'Mark',
    numeric: true,
    sortable: true,
    width: 124,
    render: ({ pos }) => pos.markPrice != null ? fmtCompactCurrency(pos.markPrice) : '—',
  },
  liq: {
    label: 'Liq. Price',
    numeric: true,
    sortable: true,
    width: 142,
    render: ({ pos }) => (
      <span className="table-inline-value">
        {pos.liquidationPrice != null ? fmtCompactCurrency(pos.liquidationPrice) : '—'}
        {pos.riskSource === 'local_engine' && <span className="risk-chip">est.</span>}
        {pos.riskSource === 'user_input' && <span className="risk-chip">manual</span>}
      </span>
    ),
  },
  tp: {
    label: 'TP',
    numeric: true,
    sortable: true,
    width: 108,
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
    width: 108,
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
    width: 76,
    render: ({ pos }) => `${pos.leverage}×`,
  },
  marginUsed: {
    label: 'Margin Used',
    numeric: true,
    sortable: true,
    width: 132,
    render: ({ pos }) => pos.marginUsed != null ? fmtCurrency(pos.marginUsed) : '—',
  },
  unrealizedPnl: {
    label: 'Unrealized P&L',
    numeric: true,
    sortable: true,
    width: 148,
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
    width: 152,
    render: ({ notional }) => fmtCurrency(notional),
  },
};

function getPositionSortValue(row: PositionRow, key: PositionColumnKey): number | string | null {
  const { pos, tokenSize, notional } = row;
  switch (key) {
    case 'symbol':
      return pos.symbol;
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
  const leftPanelOpen = useAppStore((s) => s.leftPanelOpen);
  const scopeExchange = useAppStore((s) => s.scopeExchange);
  const scopeAccountId = useAppStore((s) => s.scopeAccountId);
  const selectedPositionId = useAppStore((s) => s.selectedPositionId);
  const setSelectedPositionId = useAppStore((s) => s.setSelectedPositionId);
  const positionColumns = useAppStore((s) => s.positionColumns);
  const positionSortKey = useAppStore((s) => s.positionSortKey);
  const positionSortDirection = useAppStore((s) => s.positionSortDirection);
  const positionSearch = useAppStore((s) => s.positionSearch);
  const positionSideFilter = useAppStore((s) => s.positionSideFilter);
  const positionPnlFilter = useAppStore((s) => s.positionPnlFilter);
  const collapsedPositionGroups = useAppStore((s) => s.collapsedPositionGroups);
  const togglePositionSort = useAppStore((s) => s.togglePositionSort);
  const setPositionSearch = useAppStore((s) => s.setPositionSearch);
  const setPositionSideFilter = useAppStore((s) => s.setPositionSideFilter);
  const setPositionPnlFilter = useAppStore((s) => s.setPositionPnlFilter);
  const resetPositionFilters = useAppStore((s) => s.resetPositionFilters);
  const togglePositionGroupCollapsed = useAppStore((s) => s.togglePositionGroupCollapsed);
  const openOverlay = useAppStore((s) => s.openOverlay);
  const fetchBootstrap = useAppStore((s) => s.fetchBootstrap);
  const { show: showCtx } = useContextMenu();
  const { toast } = useToast();
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  const scopedAccounts = useMemo(() => {
    if (!bootstrap) return [];

    let accounts = bootstrap.accounts;
    if (scopeExchange !== 'all') {
      accounts = accounts.filter((account) => account.exchange === scopeExchange);
    }
    if (scopeAccountId) {
      accounts = accounts.filter((account) => account.id === scopeAccountId);
    }

    return accounts;
  }, [bootstrap, scopeAccountId, scopeExchange]);

  const scopedPositions = useMemo(() => {
    if (!bootstrap) return [];

    const accounts = scopedAccounts;
    const accountIds = new Set(accounts.map((account) => account.id));
    return bootstrap.positions.filter((position) => accountIds.has(position.accountId));
  }, [bootstrap, scopedAccounts]);

  const positions = useMemo(() => {
    const search = positionSearch.trim().toLowerCase();

    return scopedPositions.filter((position) => {
      if (positionSideFilter !== 'all' && position.side !== positionSideFilter) return false;
      if (positionPnlFilter === 'winners' && position.unrealizedPnl <= 0) return false;
      if (positionPnlFilter === 'losers' && position.unrealizedPnl >= 0) return false;
      if (!search) return true;

      const searchTarget = [
        position.symbol,
        position.exchangeSymbol ?? '',
        position.accountName,
        position.exchange,
      ].join(' ').toLowerCase();

      return searchTarget.includes(search);
    });
  }, [positionPnlFilter, positionSearch, positionSideFilter, scopedPositions]);

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

  const groupedRows = useMemo<PositionGroup[]>(() => {
    const rowsByAccount = new Map<string, PositionRow[]>();
    for (const row of rows) {
      const accountRows = rowsByAccount.get(row.pos.accountId);
      if (accountRows) {
        accountRows.push(row);
      } else {
        rowsByAccount.set(row.pos.accountId, [row]);
      }
    }

    return scopedAccounts
      .filter((account) => rowsByAccount.has(account.id))
      .map((account) => {
        const accountRows = rowsByAccount.get(account.id) ?? [];
        return {
          accountId: account.id,
          accountName: account.name,
          exchange: account.exchange,
          rowCount: accountRows.length,
          unrealizedPnl: accountRows.reduce((sum, row) => sum + row.pos.unrealizedPnl, 0),
          rows: accountRows,
        };
      });
  }, [rows, scopedAccounts]);

  const visibleColumns = positionColumns.filter((column) => positionColumnDefinitions[column]);
  const showGroupedPositions = groupedRows.length > 1;
  const collapsedGroupSet = new Set(collapsedPositionGroups);
  const tableMinWidth = visibleColumns.reduce(
    (sum, column) => sum + (positionColumnDefinitions[column].width ?? 0),
    0,
  );
  const hasActiveFilters = Boolean(positionSearch.trim()) || positionSideFilter !== 'all' || positionPnlFilter !== 'all';

  useEffect(() => {
    if (!selectedPositionId) return;
    if (rows.some((row) => row.pos.id === selectedPositionId)) return;
    setSelectedPositionId(null);
  }, [rows, selectedPositionId, setSelectedPositionId]);

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

  const renderPositionRow = (row: PositionRow) => (
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
  );

  if (scopedPositions.length === 0) {
    return (
      <div className="empty-state">
        <div>No open positions</div>
        <div>Add a position or sync a live account to get started.</div>
      </div>
    );
  }

  return (
    <div className="positions-pane">
      <div className="positions-filter-bar">
        <div className="positions-filter-row">
          <div className="positions-filter-main">
            <input
              className="tab-control-input positions-search-input"
              type="search"
              value={positionSearch}
              onChange={(event) => setPositionSearch(event.target.value)}
              placeholder="Filter positions"
            />
            <div className="positions-filter-group">
              {SIDE_FILTER_OPTIONS.map((option) => (
                <button
                  key={option.key}
                  type="button"
                  className={`positions-filter-pill${positionSideFilter === option.key ? ' positions-filter-pill--active' : ''}`}
                  onClick={() => setPositionSideFilter(option.key)}
                >
                  {option.label}
                </button>
              ))}
            </div>
            <div className="positions-filter-group">
              {PNL_FILTER_OPTIONS.map((option) => (
                <button
                  key={option.key}
                  type="button"
                  className={`positions-filter-pill${positionPnlFilter === option.key ? ' positions-filter-pill--active' : ''}`}
                  onClick={() => setPositionPnlFilter(option.key)}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </div>
          <div className="positions-filter-actions">
            {hasActiveFilters && (
              <button type="button" className="btn btn--ghost btn--small" onClick={resetPositionFilters}>
                Clear
              </button>
            )}
          </div>
        </div>
      </div>

      {positions.length === 0 ? (
        <div className="empty-state positions-empty-state">
          <div>No positions match the current filters.</div>
          <button type="button" className="btn btn--ghost btn--small" onClick={resetPositionFilters}>
            Clear Filters
          </button>
        </div>
      ) : (
        <table
          className="data-table data-table--positions"
          style={{
            width: `max(100%, ${tableMinWidth}px)`,
            minWidth: `${tableMinWidth}px`,
          }}
        >
          <colgroup>
            {visibleColumns.map((column) => {
              const definition = positionColumnDefinitions[column];
              return <col key={column} style={definition.width ? { width: `${definition.width}px` } : undefined} />;
            })}
          </colgroup>
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
            {showGroupedPositions
              ? groupedRows.map((group) => {
                  const isCollapsed = collapsedGroupSet.has(group.accountId);

                  return (
                    <Fragment key={group.accountId}>
                      <tr className="data-table-group-row">
                        <td colSpan={visibleColumns.length}>
                          <button
                            type="button"
                            className="data-table-group-toggle"
                            aria-expanded={!isCollapsed}
                            onClick={() => togglePositionGroupCollapsed(group.accountId)}
                          >
                            <span className={`data-table-group-caret${isCollapsed ? ' data-table-group-caret--collapsed' : ''}`}>
                              ▾
                            </span>
                            <span className="data-table-group-main">
                              <span className="data-table-group-title">{group.accountName}</span>
                              <span className={exchangeTagClass(group.exchange)}>{group.exchange}</span>
                              <span className="data-table-group-count">
                                {group.rowCount} {group.rowCount === 1 ? 'position' : 'positions'}
                              </span>
                              {!leftPanelOpen && (
                                <>
                                  <span className="data-table-group-kpi-label">UPNL</span>
                                  <span className={`data-table-group-pnl ${fmtPnlClass(group.unrealizedPnl)}`}>
                                    {fmtPnl(group.unrealizedPnl)}
                                  </span>
                                </>
                              )}
                            </span>
                          </button>
                        </td>
                      </tr>
                      {!isCollapsed && group.rows.map(renderPositionRow)}
                    </Fragment>
                  );
                })
              : rows.map(renderPositionRow)}
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
      )}
    </div>
  );
}
