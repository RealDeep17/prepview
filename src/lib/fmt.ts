import type { ExchangeKind, ExchangeMarket, SyncHealthState } from './types';

export function fmtCurrency(n: number | null | undefined): string {
  if (n == null) return '—';
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(n);
}

export function fmtCompactCurrency(
  n: number | null | undefined,
): string {
  if (n == null) return '—';
  const absolute = Math.abs(n);
  const integerDigits = absolute >= 1 ? Math.floor(absolute).toString().length : 1;
  const maximumFractionDigits = Math.min(2, Math.max(0, 5 - integerDigits));
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 0,
    maximumFractionDigits,
  }).format(n);
}

export function fmtPnl(n: number | null | undefined): string {
  if (n == null) return '—';
  const formatted = fmtCurrency(Math.abs(n));
  return n >= 0 ? `+${formatted}` : `−${formatted}`;
}

export function fmtPnlClass(n: number): string {
  return n >= 0 ? 'pnl-positive' : 'pnl-negative';
}

export function fmtCostClass(n: number): string {
  if (n < 0) return 'pnl-positive';
  if (n > 0) return 'pnl-negative';
  return '';
}

export function fmtPercent(n: number | null | undefined): string {
  if (n == null) return '—';
  return `${n.toFixed(2)}%`;
}

export function fmtNumber(n: number | null | undefined, decimals = 2): string {
  if (n == null) return '—';
  return new Intl.NumberFormat('en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(n);
}

export function fmtCompactNumber(n: number | null | undefined, decimals = 4): string {
  if (n == null) return '—';
  return new Intl.NumberFormat('en-US', {
    minimumFractionDigits: 0,
    maximumFractionDigits: decimals,
  }).format(n);
}

function normalizeMarketId(value: string | null | undefined): string | null {
  if (!value) return null;
  const normalized = value.trim().toUpperCase();
  if (!normalized) return null;
  return normalized.replace(/[^A-Z0-9]/g, '');
}

export function findExchangeMarket(
  markets: ExchangeMarket[],
  exchange: ExchangeKind,
  symbol: string | null | undefined,
  exchangeSymbol?: string | null,
): ExchangeMarket | undefined {
  const scopedMarkets = markets.filter((market) => market.exchange === exchange);
  const directExchangeSymbol = exchangeSymbol?.trim();
  if (directExchangeSymbol) {
    const match = scopedMarkets.find((market) => market.exchangeSymbol.localeCompare(directExchangeSymbol, undefined, { sensitivity: 'accent' }) === 0);
    if (match) return match;
  }

  const directSymbol = symbol?.trim();
  if (directSymbol) {
    const match = scopedMarkets.find((market) => market.symbol.localeCompare(directSymbol, undefined, { sensitivity: 'accent' }) === 0);
    if (match) return match;
  }

  const candidates = [normalizeMarketId(exchangeSymbol), normalizeMarketId(symbol)].filter((value): value is string => Boolean(value));
  return scopedMarkets.find((market) => {
    const aliases = [normalizeMarketId(market.exchangeSymbol), normalizeMarketId(market.symbol)];
    return candidates.some((candidate) => aliases.includes(candidate));
  });
}

export function fmtRelativeTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  const diff = Date.now() - new Date(iso).getTime();
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

export function fmtTimestamp(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  const day = d.getDate().toString().padStart(2, '0');
  const month = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][d.getMonth()];
  const hours = d.getHours().toString().padStart(2, '0');
  const mins = d.getMinutes().toString().padStart(2, '0');
  return `${day} ${month} ${hours}:${mins}`;
}

export function exchangeTagClass(exchange: ExchangeKind): string {
  switch (exchange) {
    case 'blofin':
      return 'exchange-tag exchange-tag--blofin';
    case 'hyperliquid':
      return 'exchange-tag exchange-tag--hyperliquid';
    case 'manual':
      return 'exchange-tag exchange-tag--manual';
    case 'import':
      return 'exchange-tag exchange-tag--import';
    default:
      return 'exchange-tag exchange-tag--manual';
  }
}

export function syncDotClass(state: SyncHealthState): string {
  return `sync-dot sync-dot--${state}`;
}

export function heatClass(percent: number): string {
  if (percent < 30) return 'heat-fill heat-fill--low';
  if (percent < 60) return 'heat-fill heat-fill--mid';
  return 'heat-fill heat-fill--high';
}
