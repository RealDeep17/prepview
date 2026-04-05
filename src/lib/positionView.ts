export type PositionColumnKey =
  | 'symbol'
  | 'account'
  | 'side'
  | 'margin'
  | 'size'
  | 'entry'
  | 'mark'
  | 'liq'
  | 'tp'
  | 'sl'
  | 'lev'
  | 'marginUsed'
  | 'unrealizedPnl'
  | 'notional';

export type PositionSortDirection = 'asc' | 'desc';

export const POSITION_COLUMN_OPTIONS: Array<{ key: PositionColumnKey; label: string }> = [
  { key: 'symbol', label: 'Symbol' },
  { key: 'account', label: 'Account' },
  { key: 'side', label: 'Side' },
  { key: 'margin', label: 'Margin' },
  { key: 'size', label: 'Size' },
  { key: 'entry', label: 'Entry' },
  { key: 'mark', label: 'Mark' },
  { key: 'liq', label: 'Liq. Price' },
  { key: 'tp', label: 'TP' },
  { key: 'sl', label: 'SL' },
  { key: 'lev', label: 'Lev' },
  { key: 'marginUsed', label: 'Margin Used' },
  { key: 'unrealizedPnl', label: 'Unrealized P&L' },
  { key: 'notional', label: 'Notional' },
];

export const POSITION_COLUMN_KEYS = POSITION_COLUMN_OPTIONS.map((option) => option.key);

export const DEFAULT_POSITION_COLUMNS: PositionColumnKey[] = [
  'symbol',
  'account',
  'side',
  'margin',
  'size',
  'entry',
  'mark',
  'liq',
  'tp',
  'sl',
  'lev',
  'marginUsed',
  'unrealizedPnl',
  'notional',
];
