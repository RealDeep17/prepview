import { describe, expect, it, vi, afterEach } from 'vitest';
import {
  exchangeTagClass,
  fmtCurrency,
  fmtPercent,
  fmtPnl,
  fmtRelativeTime,
  heatClass,
} from './fmt';

describe('fmt helpers', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('formats currency and pnl values for USD surfaces', () => {
    expect(fmtCurrency(1234.5)).toBe('$1,234.50');
    expect(fmtCurrency(null)).toBe('—');
    expect(fmtPnl(12.3)).toBe('+$12.30');
    expect(fmtPnl(-12.3)).toBe('−$12.30');
  });

  it('formats percentages and relative time deterministically', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-04T00:00:00Z'));

    expect(fmtPercent(12.3456)).toBe('12.35%');
    expect(fmtRelativeTime('2026-04-03T23:30:00Z')).toBe('30m ago');
    expect(fmtRelativeTime('2026-04-03T00:00:00Z')).toBe('1d ago');
  });

  it('maps visual helper classes to the expected variants', () => {
    expect(exchangeTagClass('blofin')).toBe('exchange-tag exchange-tag--blofin');
    expect(exchangeTagClass('hyperliquid')).toBe('exchange-tag exchange-tag--hyperliquid');
    expect(heatClass(20)).toBe('heat-fill heat-fill--low');
    expect(heatClass(45)).toBe('heat-fill heat-fill--mid');
    expect(heatClass(75)).toBe('heat-fill heat-fill--high');
  });
});
