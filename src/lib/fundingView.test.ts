import { describe, expect, it } from 'vitest';
import { buildFundingRateRows } from './fundingView';
import type { ExchangeMarket, FundingHistoryEntry, PortfolioPosition } from './types';

function makePosition(overrides: Partial<PortfolioPosition>): PortfolioPosition {
  return {
    id: 'position-1',
    accountId: 'account-1',
    accountName: 'W1',
    exchange: 'hyperliquid',
    exchangeSymbol: 'ETH',
    marginMode: 'cross',
    symbol: 'ETH-PERP',
    side: 'long',
    quantity: 1,
    entryPrice: 2000,
    markPrice: 2001,
    marginUsed: 100,
    liquidationPrice: 3000,
    maintenanceMargin: 10,
    maintenanceMarginRate: 0.005,
    riskSource: 'live_exchange',
    leverage: 20,
    unrealizedPnl: 10,
    realizedPnl: 0,
    feePaid: 0,
    fundingPaid: 0,
    fundingMode: 'exchange_sync',
    takeProfit: null,
    stopLoss: null,
    openedAt: '2026-04-06T00:00:00.000Z',
    notes: 'test',
    ...overrides,
  };
}

describe('buildFundingRateRows', () => {
  it('returns one row per open position instead of deduplicating by symbol', () => {
    const positions: PortfolioPosition[] = [
      makePosition({
        id: 'position-1',
        accountId: 'account-1',
        accountName: 'W1',
        side: 'short',
      }),
      makePosition({
        id: 'position-2',
        accountId: 'account-2',
        accountName: 'W2',
        side: 'long',
      }),
      makePosition({
        id: 'position-3',
        accountId: 'account-3',
        accountName: 'W3',
        exchangeSymbol: 'SOL',
        symbol: 'SOL-PERP',
      }),
    ];
    const markets: ExchangeMarket[] = [
      {
        exchange: 'hyperliquid',
        exchangeSymbol: 'ETH',
        symbol: 'ETH-PERP',
        baseAsset: 'ETH',
        quoteAsset: 'USDC',
        contractType: 'perpetual',
        fundingRate: 0.00065,
        isActive: true,
      },
      {
        exchange: 'hyperliquid',
        exchangeSymbol: 'SOL',
        symbol: 'SOL-PERP',
        baseAsset: 'SOL',
        quoteAsset: 'USDC',
        contractType: 'perpetual',
        fundingRate: -0.00056,
        isActive: true,
      },
    ];

    const rows = buildFundingRateRows(positions, markets, []);

    expect(rows).toHaveLength(3);
    expect(rows.map((row) => row.key)).toEqual(['position-1', 'position-2', 'position-3']);
    expect(rows.map((row) => row.symbol)).toEqual(['ETH-PERP', 'ETH-PERP', 'SOL-PERP']);
    expect(rows.map((row) => row.rate)).toEqual([0.00065, 0.00065, -0.00056]);
  });

  it('returns only the selected position when one is focused', () => {
    const selected = makePosition({
      id: 'position-2',
      accountId: 'account-2',
      accountName: 'W2',
      exchangeSymbol: 'SOL',
      symbol: 'SOL-PERP',
    });
    const positions: PortfolioPosition[] = [
      makePosition({ id: 'position-1' }),
      selected,
    ];
    const markets: ExchangeMarket[] = [
      {
        exchange: 'hyperliquid',
        exchangeSymbol: 'SOL',
        symbol: 'SOL-PERP',
        baseAsset: 'SOL',
        quoteAsset: 'USDC',
        contractType: 'perpetual',
        fundingRate: -0.00056,
        isActive: true,
      },
    ];

    const rows = buildFundingRateRows(positions, markets, [], selected);

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      key: 'position-2',
      accountName: 'W2',
      symbol: 'SOL-PERP',
      rate: -0.00056,
    });
  });

  it('falls back to the latest recent sync funding entry when market data is missing', () => {
    const position = makePosition({
      id: 'position-1',
      accountId: 'account-1',
      accountName: 'W1',
      exchange: 'blofin',
      exchangeSymbol: 'ETH-USDT',
      symbol: 'ETH-PERP',
    });
    const recentFundingEntries: FundingHistoryEntry[] = [
      {
        id: 'funding-1',
        accountId: 'account-1',
        accountName: 'W1',
        symbol: 'ETH-PERP',
        rate: -0.00042,
        fundingTime: '2026-04-06T00:00:00.000Z',
        recordedAt: '2026-04-06T00:00:10.000Z',
      },
      {
        id: 'funding-2',
        accountId: 'account-1',
        accountName: 'W1',
        symbol: 'ETH-PERP',
        rate: -0.0004,
        fundingTime: '2026-04-05T16:00:00.000Z',
        recordedAt: '2026-04-05T16:00:10.000Z',
      },
    ];

    const rows = buildFundingRateRows([position], [], recentFundingEntries);

    expect(rows).toHaveLength(1);
    expect(rows[0].rate).toBe(-0.00042);
  });
});
