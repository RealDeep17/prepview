import { findExchangeMarket } from './fmt';
import type { ExchangeKind, ExchangeMarket, FundingHistoryEntry, PortfolioPosition, PositionSide } from './types';

export interface FundingRateRow {
  key: string;
  accountId: string;
  accountName: string;
  exchange: ExchangeKind;
  side: PositionSide;
  symbol: string;
  rate: number | null;
}

function fundingHistoryKey(accountId: string, symbol: string): string {
  return `${accountId}::${symbol.trim().toUpperCase()}`;
}

export function buildFundingRateRows(
  positions: PortfolioPosition[],
  markets: ExchangeMarket[],
  recentFundingEntries: FundingHistoryEntry[],
  selectedPosition?: PortfolioPosition | null,
): FundingRateRow[] {
  const scopedPositions = selectedPosition ? [selectedPosition] : positions;
  const recentRatesByAccountSymbol = new Map<string, number>();

  for (const entry of recentFundingEntries) {
    const key = fundingHistoryKey(entry.accountId, entry.symbol);
    if (!recentRatesByAccountSymbol.has(key)) {
      recentRatesByAccountSymbol.set(key, entry.rate);
    }
  }

  return scopedPositions.map((position) => {
    const market = findExchangeMarket(
      markets,
      position.exchange,
      position.symbol,
      position.exchangeSymbol,
    );

    return {
      key: position.id,
      accountId: position.accountId,
      accountName: position.accountName,
      exchange: position.exchange,
      side: position.side,
      symbol: position.symbol,
      rate: market?.fundingRate ?? recentRatesByAccountSymbol.get(fundingHistoryKey(position.accountId, position.symbol)) ?? null,
    };
  });
}
