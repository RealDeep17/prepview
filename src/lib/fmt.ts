import type { ExchangeKind, SyncHealthState } from './types';

export function fmtCurrency(n: number | null | undefined): string {
  if (n == null) return '—';
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
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
