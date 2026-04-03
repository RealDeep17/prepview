/**
 * CSVImporter.js — Teralyn v2.0
 *
 * Trade history CSV importer with multi-exchange format support:
 *   • Binance Futures export format
 *   • Bybit trade history format
 *   • Generic/custom column mapping
 *   • Data validation and sanitization
 *   • Duplicate detection
 *   • P&L reconstruction from raw fills
 *   • Summary statistics generation
 */

const BINANCE_COLUMNS = ['Date(UTC)', 'Symbol', 'Side', 'Price', 'Quantity', 'Fee', 'Realized Profit'];
const BYBIT_COLUMNS = ['Create Time', 'Contract', 'Direction', 'Average Fill Price', 'Qty', 'Trading Fee', 'Closed P&L'];

export class CSVImporter {
    /**
     * Parse CSV text into array of row objects
     */
    static parseCSV(text) {
        const lines = text.trim().split('\n');
        if (lines.length < 2) throw new Error('CSV must have header + at least 1 data row');

        const headers = lines[0].split(',').map(h => h.trim().replace(/^"/, '').replace(/"$/, ''));
        const rows = [];

        for (let i = 1; i < lines.length; i++) {
            const values = this.parseCSVLine(lines[i]);
            if (values.length === 0) continue;

            const row = {};
            for (let j = 0; j < headers.length; j++) {
                row[headers[j]] = values[j]?.trim() || '';
            }
            rows.push(row);
        }

        return { headers, rows };
    }

    /**
     * Handle quoted CSV fields with commas inside
     */
    static parseCSVLine(line) {
        const result = [];
        let current = '';
        let inQuotes = false;

        for (let i = 0; i < line.length; i++) {
            const char = line[i];
            if (char === '"') {
                inQuotes = !inQuotes;
            } else if (char === ',' && !inQuotes) {
                result.push(current);
                current = '';
            } else {
                current += char;
            }
        }
        result.push(current);
        return result;
    }

    /**
     * Auto-detect exchange format from headers
     */
    static detectFormat(headers) {
        const headerSet = new Set(headers.map(h => h.toLowerCase()));

        if (headerSet.has('date(utc)') || headerSet.has('realized profit')) return 'binance';
        if (headerSet.has('create time') || headerSet.has('contract') || headerSet.has('closed p&l')) return 'bybit';
        if (headerSet.has('symbol') && headerSet.has('side') && headerSet.has('price')) return 'generic';

        return 'unknown';
    }

    /**
     * Normalize rows from any exchange format to standard format
     * Standard format: { date, symbol, side, price, quantity, fee, realizedPnl }
     */
    static normalizeRows(rows, format) {
        const columnMap = this.getColumnMap(format);
        const normalized = [];

        for (const row of rows) {
            try {
                const entry = {
                    date: this.parseDate(row[columnMap.date]),
                    symbol: this.normalizeSymbol(row[columnMap.symbol]),
                    side: this.normalizeSide(row[columnMap.side]),
                    price: this.parseNumber(row[columnMap.price]),
                    quantity: Math.abs(this.parseNumber(row[columnMap.quantity])),
                    fee: Math.abs(this.parseNumber(row[columnMap.fee] || '0')),
                    realizedPnl: this.parseNumber(row[columnMap.realizedPnl] || '0'),
                    raw: row,
                };

                // Validate required fields
                if (!entry.date || !entry.symbol || !entry.price || !entry.quantity) {
                    entry._invalid = true;
                    entry._reason = 'Missing required field';
                }

                normalized.push(entry);
            } catch (err) {
                normalized.push({ _invalid: true, _reason: err.message, raw: row });
            }
        }

        return normalized;
    }

    static getColumnMap(format) {
        switch (format) {
            case 'binance':
                return { date: 'Date(UTC)', symbol: 'Symbol', side: 'Side', price: 'Price', quantity: 'Quantity', fee: 'Fee', realizedPnl: 'Realized Profit' };
            case 'bybit':
                return { date: 'Create Time', symbol: 'Contract', side: 'Direction', price: 'Average Fill Price', quantity: 'Qty', fee: 'Trading Fee', realizedPnl: 'Closed P&L' };
            case 'generic':
            default:
                return { date: 'date', symbol: 'symbol', side: 'side', price: 'price', quantity: 'quantity', fee: 'fee', realizedPnl: 'realizedPnl' };
        }
    }

    /**
     * Custom column mapping for unknown formats
     */
    static normalizeWithCustomMap(rows, columnMap) {
        return rows.map(row => {
            try {
                return {
                    date: this.parseDate(row[columnMap.date]),
                    symbol: this.normalizeSymbol(row[columnMap.symbol]),
                    side: this.normalizeSide(row[columnMap.side]),
                    price: this.parseNumber(row[columnMap.price]),
                    quantity: Math.abs(this.parseNumber(row[columnMap.quantity])),
                    fee: Math.abs(this.parseNumber(row[columnMap.fee] || '0')),
                    realizedPnl: this.parseNumber(row[columnMap.realizedPnl] || '0'),
                    raw: row,
                };
            } catch (err) {
                return { _invalid: true, _reason: err.message, raw: row };
            }
        });
    }

    /**
     * Parse various date formats
     */
    static parseDate(str) {
        if (!str) return null;
        const d = new Date(str);
        if (!isNaN(d.getTime())) return d.toISOString();

        // Try common formats: DD/MM/YYYY, YYYY-MM-DD HH:mm:ss
        const parts = str.split(/[/\-. ]/);
        if (parts.length >= 3) {
            const [a, b, c] = parts;
            if (a.length === 4) return new Date(`${a}-${b}-${c}`).toISOString();
            if (c.length === 4) return new Date(`${c}-${b.padStart(2, '0')}-${a.padStart(2, '0')}`).toISOString();
        }
        return null;
    }

    static normalizeSymbol(sym) {
        if (!sym) return '';
        return sym.replace(/[-_ ]/g, '').replace(/USD$/, 'USDT').toUpperCase();
    }

    static normalizeSide(side) {
        if (!side) return 'UNKNOWN';
        const s = side.toUpperCase().trim();
        if (s === 'BUY' || s === 'LONG' || s === 'B') return 'LONG';
        if (s === 'SELL' || s === 'SHORT' || s === 'S') return 'SHORT';
        return 'UNKNOWN';
    }

    static parseNumber(str) {
        if (typeof str === 'number') return str;
        if (!str) return 0;
        return parseFloat(str.replace(/[,$]/g, '')) || 0;
    }

    /**
     * Detect duplicate entries based on timestamp + symbol + price + quantity
     */
    static detectDuplicates(trades) {
        const seen = new Set();
        const duplicates = [];

        for (let i = 0; i < trades.length; i++) {
            const t = trades[i];
            const key = `${t.date}|${t.symbol}|${t.price}|${t.quantity}|${t.side}`;
            if (seen.has(key)) {
                duplicates.push(i);
            } else {
                seen.add(key);
            }
        }

        return duplicates;
    }

    /**
     * Reconstruct positions from raw fills
     * Groups fills by symbol and pairs entries with exits
     */
    static reconstructPositions(trades) {
        const bySymbol = {};
        for (const t of trades.filter(t => !t._invalid)) {
            (bySymbol[t.symbol] = bySymbol[t.symbol] || []).push(t);
        }

        const positions = [];
        for (const [symbol, fills] of Object.entries(bySymbol)) {
            fills.sort((a, b) => new Date(a.date) - new Date(b.date));

            let openQty = 0;
            let openSide = null;
            let avgEntry = 0;
            let entryDate = null;

            for (const fill of fills) {
                if (openQty === 0 || openSide !== fill.side) {
                    // New position or direction change
                    if (openQty > 0) {
                        // Close previous position
                        positions.push({
                            symbol, side: openSide, entryPrice: avgEntry, quantity: openQty,
                            entryDate, status: 'closed',
                            realizedPnl: fill.realizedPnl || 0,
                        });
                    }
                    openSide = fill.side;
                    avgEntry = fill.price;
                    openQty = fill.quantity;
                    entryDate = fill.date;
                } else {
                    // Add to existing position
                    const totalCost = avgEntry * openQty + fill.price * fill.quantity;
                    openQty += fill.quantity;
                    avgEntry = totalCost / openQty;
                }
            }

            // Remaining open position
            if (openQty > 0) {
                positions.push({
                    symbol, side: openSide, entryPrice: avgEntry, quantity: openQty,
                    entryDate, status: 'open',
                });
            }
        }

        return positions;
    }

    /**
     * Generate import summary statistics
     */
    static generateSummary(trades) {
        const valid = trades.filter(t => !t._invalid);
        const invalid = trades.filter(t => t._invalid);
        const symbols = [...new Set(valid.map(t => t.symbol))];
        const totalFees = valid.reduce((s, t) => s + (t.fee || 0), 0);
        const totalPnl = valid.reduce((s, t) => s + (t.realizedPnl || 0), 0);
        const dateRange = valid.length > 0
            ? { from: valid.reduce((min, t) => t.date < min ? t.date : min, valid[0].date),
                to: valid.reduce((max, t) => t.date > max ? t.date : max, valid[0].date) }
            : { from: null, to: null };

        return {
            totalRows: trades.length,
            validRows: valid.length,
            invalidRows: invalid.length,
            uniqueSymbols: symbols.length,
            symbols,
            totalFees: Math.round(totalFees * 100) / 100,
            totalPnl: Math.round(totalPnl * 100) / 100,
            dateRange,
            trades: valid,
            errors: invalid.map(t => t._reason),
        };
    }

    /**
     * Full import pipeline: parse → detect format → normalize → deduplicate → validate → summarize
     */
    static fullImport(csvText, customColumnMap = null) {
        const { headers, rows } = this.parseCSV(csvText);
        const format = this.detectFormat(headers);

        let normalized;
        if (customColumnMap) {
            normalized = this.normalizeWithCustomMap(rows, customColumnMap);
        } else if (format === 'unknown') {
            return { success: false, error: `Unknown CSV format. Headers: ${headers.join(', ')}`, headers, suggestMapping: true };
        } else {
            normalized = this.normalizeRows(rows, format);
        }

        const duplicates = this.detectDuplicates(normalized);
        const deduped = normalized.filter((_, i) => !duplicates.includes(i));
        const summary = this.generateSummary(deduped);
        const positions = this.reconstructPositions(deduped);

        return {
            success: true,
            format,
            duplicatesRemoved: duplicates.length,
            summary,
            positions,
            headers,
        };
    }
}

export default CSVImporter;
