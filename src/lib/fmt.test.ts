import { describe, expect, it, vi, afterEach } from 'vitest';
import {
  findExchangeMarket,
  exchangeTagClass,
  fmtCompactNumber,
  fmtCompactCurrency,
  fmtCostClass,
  fmtCurrency,
  fmtPercent,
  fmtPnl,
  fmtRelativeTime,
  heatClass,
} from './fmt';
import type { ExchangeMarket } from './types';

describe('fmt helpers', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('formats currency and pnl values for USD surfaces', () => {
    expect(fmtCurrency(1234.5)).toBe('$1,234.50');
    expect(fmtCompactCurrency(1234.5)).toBe('$1,234.5');
    expect(fmtCompactCurrency(1234)).toBe('$1,234');
    expect(fmtCompactCurrency(28438.118399)).toBe('$28,438');
    expect(fmtCompactCurrency(3060.45269)).toBe('$3,060.5');
    expect(fmtCompactCurrency(9.612039)).toBe('$9.61');
    expect(fmtCurrency(null)).toBe('—');
    expect(fmtPnl(12.3)).toBe('+$12.30');
    expect(fmtPnl(-12.3)).toBe('−$12.30');
  });

  it('formats percentages and relative time deterministically', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-04T00:00:00Z'));

    expect(fmtPercent(12.3456)).toBe('12.35%');
    expect(fmtCompactNumber(3)).toBe('3');
    expect(fmtCompactNumber(3.125, 4)).toBe('3.125');
    expect(fmtCostClass(-1)).toBe('pnl-positive');
    expect(fmtCostClass(1)).toBe('pnl-negative');
    expect(fmtRelativeTime('2026-04-03T23:30:00Z')).toBe('30m ago');
    expect(fmtRelativeTime('2026-04-03T00:00:00Z')).toBe('1d ago');
  });

  it('resolves markets by exchange symbol before falling back to normalized symbol', () => {
    const markets: ExchangeMarket[] = [
      {
        exchange: 'blofin',
        exchangeSymbol: 'ETH-USDT',
        symbol: 'ETH-PERP',
        baseAsset: 'ETH',
        quoteAsset: 'USDT',
        contractType: 'linear',
        contractValue: 0.1,
        isActive: true,
      },
    ];

    expect(findExchangeMarket(markets, 'blofin', 'ETH-PERP', 'ETH-USDT')?.contractValue).toBe(0.1);
    expect(findExchangeMarket(markets, 'blofin', 'ethperp')?.contractValue).toBe(0.1);
  });

  it('maps visual helper classes to the expected variants', () => {
    expect(exchangeTagClass('blofin')).toBe('exchange-tag exchange-tag--blofin');
    expect(exchangeTagClass('hyperliquid')).toBe('exchange-tag exchange-tag--hyperliquid');
    expect(heatClass(20)).toBe('heat-fill heat-fill--low');
    expect(heatClass(45)).toBe('heat-fill heat-fill--mid');
    expect(heatClass(75)).toBe('heat-fill heat-fill--high');
  });
});
