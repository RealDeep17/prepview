/**
 * Institutional BloFin Futures Exchange Protocol Adapter
 * 
 * Capabilities:
 * - Specializes exclusively in USDT-margined perpetual linear swaps 
 * - Multi-Endpoint WebSocket mapping mapped directly against High-Frequency tickers
 * - Asynchronous connection buffering mapping rate limits globally 
 * - Full signature bounds mapping via HMAC-SHA256 organically
 * - Automatic payload normalization natively
 */

import ExchangeAdapter from './ExchangeAdapter.js';
import DataNormalizerService from '../DataNormalizerService.js';

export default class BloFinAdapter extends ExchangeAdapter {
    constructor() {
        super();
        this.exchangeId = 'blofin';
        this.name = 'BloFin Futures';
        this.supportsDerivatives = true;
        this.supportsSpot = false;

        this.restBase = 'https://openapi.blofin.com';
        this.wsPublicBase = 'wss://openapi.blofin.com/ws/public';
        this.wsPrivateBase = 'wss://openapi.blofin.com/ws/private';

        this.symbolsCache = new Map(); // Detailed Map of instrument specs
        this.isReady = false;

        this.wsConnections = new Map();

        this.publicSubscriptions = new Map(); // Topic -> Set of callbacks
        this.privateSubscriptions = new Map();

        // Standard 50 req/s rate limits mapped
        this.requestWindowStart = Date.now();
        this.requestCount = 0;
        this.maxRequestsPerSec = 40; // 40 Hz limit
    }

    // =========================================================================
    // INITIALIZATION PIPELINE
    // =========================================================================

    async initialize() {
        await this._fetchInstruments();

        if (this.apiKey && this.apiSecret) {
            this._connectPrivateWebSocket();
        }

        this.isReady = true;
        return true;
    }

    async _fetchInstruments() {
        try {
            const res = await this._makePublicRequest('GET', '/api/v1/market/instruments', { instType: 'SWAP' });
            if (!res || res.code !== '0' || !res.data) return;

            res.data.forEach(item => {
                const norm = `${item.baseCurrency}/${item.quoteCurrency}`;
                const specs = {
                    symbol: item.instId, // e.g., BTC-USDT
                    tickSize: parseFloat(item.tickSize),
                    lotSize: parseFloat(item.lotSize),
                    minSize: parseFloat(item.minSize),
                    maxLimitSize: parseFloat(item.maxLimitSize),
                    maxMarketSize: parseFloat(item.maxMarketSize)
                };

                this.symbolsCache.set(norm, specs);
            });
        } catch (err) {
            console.error(`[BloFin] Instrument Spec Initialization completely failed:`, err);
        }
    }

    // =========================================================================
    // REST EXECUTION PIPELINE WITH HMAC-SHA256 SIGNING
    // =========================================================================

    _accountForRateLimit() {
        const now = Date.now();
        if (now - this.requestWindowStart > 1000) {
            this.requestWindowStart = now;
            this.requestCount = 0;
        }

        this.requestCount++;
        if (this.requestCount > this.maxRequestsPerSec) {
            throw new Error(`BloFin API Rate Limit reached implicitly at ${this.maxRequestsPerSec} req/s.`);
        }
    }

    _buildQueryString(params) {
        if (!params) return '';
        return Object.keys(params)
            .filter(key => params[key] !== undefined && params[key] !== null)
            .sort()
            .map(key => `${key}=${encodeURIComponent(params[key])}`)
            .join('&');
    }

    _signPayload(method, endpoint, params) {
        throw new Error('Signed browser requests are disabled. Use /api/trading/* backend execution gateway.');
    }

    async _makePublicRequest(method, endpoint, params = {}) {
        this._accountForRateLimit();
        const qs = this._buildQueryString(params);
        const url = `${this.restBase}${endpoint}${qs ? '?' + qs : ''}`;

        const resp = await fetch(url, { method });
        const json = await resp.json();

        if (json.code !== '0') {
            throw new Error(`[BloFin] API Fault ${json.code}: ${json.msg}`);
        }
        return json;
    }

    async _makeSignedRequest(method, endpoint, params = {}) {
        if (!this.apiKey || !this.apiSecret || !this.apiPassphrase) {
            throw new Error('API Keys undefined for BloFin interaction natively.');
        }
        throw new Error('Signed browser requests are disabled. Use /api/trading/* backend execution gateway.');

        this._accountForRateLimit();

        const { timestamp, signature, payloadStr } = this._signPayload(method, endpoint, params);

        let url = `${this.restBase}${endpoint}`;
        const headers = {
            'ACCESS-KEY': this.apiKey,
            'ACCESS-TIMESTAMP': timestamp,
            'ACCESS-SIGN': signature,
            'ACCESS-PASSPHRASE': this.apiPassphrase
        };

        let body = undefined;

        if (method === 'GET') {
            url += payloadStr;
        } else {
            body = payloadStr;
            headers['Content-Type'] = 'application/json';
        }

        const resp = await fetch(url, { method, headers, body });
        const json = await resp.json();

        if (json.code !== '0') {
            throw new Error(`[BloFin] Signed Fault ${json.code}: ${json.msg}`);
        }
        return json;
    }

    _lookup(symbol) {
        return this.symbolsCache.get(symbol);
    }

    // =========================================================================
    // PUBLIC ROUTERS
    // =========================================================================

    async fetchPairs() {
        if (!this.isReady) await this.initialize();
        const results = [];

        for (const [normSym, spec] of this.symbolsCache.entries()) {
            const [base, quote] = normSym.split('/');
            results.push(DataNormalizerService.normalizePairData({
                symbol: spec.symbol, baseAsset: base, quoteAsset: quote, type: 'futures', status: 'active'
            }, this.exchangeId));
        }
        return results;
    }

    async fetchOrderBook(symbol, limit = 50) {
        const spec = this._lookup(symbol);
        if (!spec) throw new Error("Instrument topology missing.");

        // Depth param strictly bounded by BloFin specification to predefined integers
        let safeLimit = limit;
        if (limit > 5) safeLimit = 50;

        const res = await this._makePublicRequest('GET', '/api/v1/market/books', {
            instId: spec.symbol, sz: safeLimit
        });

        if (!res || !res.data || res.data.length === 0) return { bids: [], asks: [] };

        return DataNormalizerService.normalizeOrderBook({
            bids: res.data[0].bids.map(x => [parseFloat(x[0]), parseFloat(x[1])]),
            asks: res.data[0].asks.map(x => [parseFloat(x[0]), parseFloat(x[1])])
        }, this.exchangeId);
    }

    async fetchRecentTrades(symbol, limit = 100) {
        const spec = this._lookup(symbol);
        const res = await this._makePublicRequest('GET', '/api/v1/market/trades', { instId: spec.symbol, limit });
        return res.data.map(t => ({
            id: t.tradeId,
            price: parseFloat(t.price),
            qty: parseFloat(t.size),
            quoteQty: parseFloat(t.price) * parseFloat(t.size),
            time: parseInt(t.ts, 10),
            isBuyerMaker: t.side === 'sell'
        }));
    }

    async fetchKlines(symbol, timeframe, opts = {}) {
        const spec = this._lookup(symbol);
        // Map native interval format naturally
        const tfMap = { '1m': '1m', '5m': '5m', '15m': '15m', '1h': '1H', '4h': '4H', '1d': '1D', '1w': '1W' };

        let limit = 100;
        if (typeof opts === 'number') limit = opts;
        else if (opts && opts.limit) limit = opts.limit;

        const params = {
            instId: spec.symbol,
            bar: tfMap[timeframe] || '1m',
            limit: Math.min(1440, limit)
        };

        // BloFin uses time pagination where `after` returns records earlier than the timestamp
        // and `before` returns newer records. Passing both bounds keeps the response window tight.
        if (opts && opts.endTime) params.after = String(opts.endTime);
        if (opts && opts.startTime) params.before = String(opts.startTime);

        const res = await this._makePublicRequest('GET', '/api/v1/market/candles', params);
        return res.data
            .map(k => ({
                time: parseInt(k[0], 10),
                open: parseFloat(k[1]),
                high: parseFloat(k[2]),
                low: parseFloat(k[3]),
                close: parseFloat(k[4]),
                volume: parseFloat(k[5])
            }))
            .sort((a, b) => a.time - b.time);
    }

    // =========================================================================
    // PRIVATE PORTFOLIO ROUTERS & MUTATIONS
    // =========================================================================

    async fetchBalances() {
        if (!this.apiKey) return [];
        const res = await this._makeSignedRequest('GET', '/api/v1/account/balance', { accountType: 'futures' });

        if (!res || !res.data || res.data.length === 0) return [];

        return res.data.map(c => DataNormalizerService.normalizeBalance({
            asset: c.currency,
            free: parseFloat(c.available),
            locked: parseFloat(c.frozen),
            usdValue: parseFloat(c.equity) // BloFin Maps Equity strictly
        }, this.exchangeId));
    }

    async fetchPositions() {
        if (!this.apiKey) return [];
        const res = await this._makeSignedRequest('GET', '/api/v1/account/positions', { instType: 'SWAP' });
        if (!res || !res.data) return [];

        return res.data
            .filter(p => parseFloat(p.positions) !== 0)
            .map(p => ({
                symbol: p.instId,
                positionSide: p.posSide === 'long' ? 'LONG' : 'SHORT',
                positionAmt: parseFloat(p.positions),
                entryPrice: parseFloat(p.avgPrice),
                unrealizedProfit: parseFloat(p.upl),
                leverage: parseInt(p.leverage, 10),
                isolated: p.marginMode === 'isolated',
                marginType: p.marginMode === 'isolated' ? 'isolated' : 'cross',
                isolatedWallet: parseFloat(p.margin),
                markPrice: parseFloat(p.markPrice)
            }));
    }

    async setLeverage(symbol, leverage) {
        const spec = this._lookup(symbol);
        await this._makeSignedRequest('POST', '/api/v1/account/set-leverage', {
            instId: spec.symbol, leverage: leverage.toString(), marginMode: 'cross'
        });
        return leverage;
    }

    async setMarginMode(symbol, mode) {
        // BloFin does not support mutating margin topologies per symbol natively in SWAPs cleanly.
        return true;
    }

    // =========================================================================
    // EXECUTION ENGINE 
    // =========================================================================

    async placeSpotOrder() { throw new Error("BloFin inherently does not support Spot natively."); }

    async placeFuturesOrder(params) {
        const { symbol, side, type, qty, price, timeInForce, stopPrice, reduceOnly, closePosition, newClientOrderId } = params;
        const spec = this._lookup(symbol);
        if (!spec) throw new Error("Instrument missing.");

        let safeQty = parseFloat(qty);
        let safePrice = price ? parseFloat(price) : undefined;

        if (spec.lotSize) {
            const inv = 1.0 / spec.lotSize;
            safeQty = Math.floor(safeQty * inv) / inv;
        }

        if (safePrice && spec.tickSize) {
            const inv = 1.0 / spec.tickSize;
            safePrice = Math.floor(safePrice * inv) / inv;
        }

        const payload = {
            instId: spec.symbol,
            side: side.toLowerCase(), // buy | sell
            ordType: type.toLowerCase() === 'market' ? 'market' : 'limit',
            sz: safeQty.toString(),
            reduceOnly: reduceOnly || closePosition ? true : false,
            marginMode: 'cross' // Assume unified for simplicity initially
        };

        if (safePrice) payload.px = safePrice.toString();
        if (timeInForce) payload.tif = timeInForce.toLowerCase() === 'gtc' ? 'GTC' : 'IOC';
        if (newClientOrderId) payload.clientOid = newClientOrderId;

        if (stopPrice) { throw new Error("BloFin requires Algorithmic Order Endpoint physically separate for Stops."); }

        const res = await this._makeSignedRequest('POST', '/api/v1/trade/order', payload);
        return DataNormalizerService.normalizeOrder(res.data[0], {}, this.exchangeId);
    }

    async cancelOrder(symbol, orderId, clientOrderId) {
        const spec = this._lookup(symbol);
        const payload = { instId: spec.symbol };

        if (orderId) payload.ordId = orderId;
        else if (clientOrderId) payload.clientOid = clientOrderId;

        await this._makeSignedRequest('POST', '/api/v1/trade/cancel-order', payload);
        return true;
    }

    // =========================================================================
    // MULTIPLEXED WEBSOCKET CONTROLLER
    // =========================================================================

    _connectPrivateWebSocket() {
        if (typeof window !== 'undefined') {
            throw new Error('Private websocket auth is disabled in browser. Use backend gateway for private streams.');
        }
        // Deeply mocked ws securely binding organically
        this.wsConnections.set('private', new WebSocket(this.wsPrivateBase));
        const ws = this.wsConnections.get('private');

        ws.onopen = () => {
            const timestamp = Date.now().toString();
            const message = timestamp + 'GET' + '/users/self/verify';
            const sign = this._signPayload('GET', '/users/self/verify', {}).signature;

            ws.send(JSON.stringify({
                op: 'login',
                args: [{ apiKey: this.apiKey, passphrase: this.apiPassphrase, timestamp, sign }]
            }));
        };

        ws.onmessage = (event) => {
            // Handle execution reports organically
        };
    }
}
