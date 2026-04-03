use std::{collections::HashSet, time::Duration};

use async_trait::async_trait;
use base64::{engine::general_purpose, Engine as _};
use chrono::{DateTime, TimeZone, Utc};
use hmac::{Hmac, Mac};
use reqwest::Client;
use serde::de::DeserializeOwned;
use serde::Deserialize;
use sha2::Sha256;
use tokio::{
    sync::broadcast,
    time::{sleep, timeout},
};
use uuid::Uuid;

use crate::{
    credentials::StoredCredentials,
    domain::{
        AccountSnapshot, BalanceEvent, CreateLiveAccountInput, ExchangeKind, ExchangeMarket,
        ExchangeRiskTier, FundingEntry, LiveAccountValidation, MarginMode, MarkPriceUpdate,
        MarketQuote, PositionRiskSource, PositionSide, RiskTierBasis, SyncedPosition,
    },
    error::{invalid_input, AppError, AppResult},
};

type HmacSha256 = Hmac<Sha256>;

const HYPERLIQUID_INFO_URL: &str = "https://api.hyperliquid.xyz/info";
const BLOFIN_REST_BASE: &str = "https://openapi.blofin.com";

#[async_trait]
pub trait ExchangeConnector: Send + Sync {
    async fn validate_credentials(
        &self,
        credentials: &StoredCredentials,
    ) -> AppResult<LiveAccountValidation>;
    async fn fetch_account_snapshot(
        &self,
        credentials: &StoredCredentials,
    ) -> AppResult<AccountSnapshot>;
    async fn fetch_open_positions(
        &self,
        credentials: &StoredCredentials,
    ) -> AppResult<Vec<SyncedPosition>>;
    #[allow(dead_code)]
    async fn fetch_balance_history(
        &self,
        credentials: &StoredCredentials,
    ) -> AppResult<Vec<BalanceEvent>>;
    async fn fetch_funding_rates(&self, symbols: &[String]) -> AppResult<Vec<FundingEntry>>;
    async fn fetch_markets(&self) -> AppResult<Vec<ExchangeMarket>>;
    async fn fetch_market_quote(&self, exchange_symbol: &str) -> AppResult<MarketQuote>;
    #[allow(dead_code)]
    async fn subscribe_mark_prices(
        &self,
        credentials: &StoredCredentials,
        symbols: &[String],
    ) -> AppResult<broadcast::Receiver<Vec<MarkPriceUpdate>>>;
    fn normalize_symbol(&self, symbol: &str) -> String;
}

pub fn build_external_reference(
    input: &CreateLiveAccountInput,
    credentials: &StoredCredentials,
) -> AppResult<String> {
    if let Some(label) = input
        .connection_label
        .as_ref()
        .map(|value| value.trim())
        .filter(|value| !value.is_empty())
    {
        return Ok(label.to_string());
    }

    match credentials {
        StoredCredentials::Hyperliquid { wallet_address } => Ok(wallet_address.to_lowercase()),
        StoredCredentials::Blofin { api_key, .. } => {
            let tail = api_key
                .chars()
                .rev()
                .take(4)
                .collect::<String>()
                .chars()
                .rev()
                .collect::<String>();
            Ok(format!("BloFin key · {tail}"))
        }
    }
}

pub fn connector_for(
    exchange: ExchangeKind,
    client: Client,
) -> AppResult<Box<dyn ExchangeConnector>> {
    match exchange {
        ExchangeKind::Blofin => Ok(Box::new(BlofinConnector::new(client))),
        ExchangeKind::Hyperliquid => Ok(Box::new(HyperliquidConnector::new(client))),
        _ => Err(invalid_input(
            "live connectors are only available for BloFin and Hyperliquid",
        )),
    }
}

pub async fn fetch_exchange_risk_tiers(
    client: Client,
    exchange: ExchangeKind,
    exchange_symbol: &str,
    margin_mode: Option<MarginMode>,
) -> AppResult<Vec<ExchangeRiskTier>> {
    match exchange {
        ExchangeKind::Blofin => {
            let connector = BlofinConnector::new(client);
            let mut tiers = Vec::new();
            let requested_modes = margin_mode
                .map(|mode| vec![mode])
                .unwrap_or_else(|| vec![MarginMode::Cross, MarginMode::Isolated]);

            for mode in requested_modes {
                let rows = connector
                    .fetch_position_tiers_response(exchange_symbol, mode)
                    .await?;
                tiers.extend(parse_blofin_risk_tiers(
                    exchange_symbol,
                    mode,
                    &rows,
                ));
            }

            Ok(tiers)
        }
        ExchangeKind::Hyperliquid => {
            let connector = HyperliquidConnector::new(client);
            let dex = if let Some((dex_name, _)) = exchange_symbol.split_once(':') {
                Some(dex_name)
            } else {
                None
            };
            let meta = connector.fetch_meta(dex).await?;
            parse_hyperliquid_risk_tiers(exchange_symbol, &meta)
        }
        _ => Err(invalid_input(
            "risk tiers are only available for BloFin and Hyperliquid",
        )),
    }
}

#[derive(Clone)]
struct HyperliquidConnector {
    client: Client,
}

impl HyperliquidConnector {
    fn new(client: Client) -> Self {
        Self { client }
    }

    async fn fetch_clearinghouse_state(
        &self,
        wallet_address: &str,
    ) -> AppResult<HyperliquidClearinghouseState> {
        self.client
            .post(HYPERLIQUID_INFO_URL)
            .json(&serde_json::json!({
                "type": "clearinghouseState",
                "user": wallet_address,
            }))
            .send()
            .await?
            .error_for_status()?
            .json::<HyperliquidClearinghouseState>()
            .await
            .map_err(Into::into)
    }

    async fn fetch_all_mids_map(&self) -> AppResult<serde_json::Map<String, serde_json::Value>> {
        let value = self
            .client
            .post(HYPERLIQUID_INFO_URL)
            .json(&serde_json::json!({
                "type": "allMids",
            }))
            .send()
            .await?
            .error_for_status()?
            .json::<serde_json::Value>()
            .await?;

        value
            .as_object()
            .cloned()
            .ok_or_else(|| AppError::message("Hyperliquid allMids response was not an object"))
    }

    async fn fetch_predicted_fundings(&self) -> AppResult<Vec<HyperliquidFundingRow>> {
        self.client
            .post(HYPERLIQUID_INFO_URL)
            .json(&serde_json::json!({
                "type": "predictedFundings",
            }))
            .send()
            .await?
            .error_for_status()?
            .json::<Vec<HyperliquidFundingRow>>()
            .await
            .map_err(Into::into)
    }

    async fn fetch_perp_dexs(&self) -> AppResult<Vec<HyperliquidPerpDex>> {
        self.client
            .post(HYPERLIQUID_INFO_URL)
            .json(&serde_json::json!({
                "type": "perpDexs",
            }))
            .send()
            .await?
            .error_for_status()?
            .json::<Vec<HyperliquidPerpDex>>()
            .await
            .map_err(Into::into)
    }

    async fn fetch_meta_and_asset_contexts(&self, dex: Option<&str>) -> AppResult<HyperliquidMetaAndAssetCtxs> {
        let mut payload = serde_json::json!({
            "type": "metaAndAssetCtxs",
        });
        if let Some(d) = dex {
            if d != "HL" {
                payload.as_object_mut().unwrap().insert("dex".to_string(), serde_json::Value::String(d.to_string()));
            }
        }
        self.client
            .post(HYPERLIQUID_INFO_URL)
            .json(&payload)
            .send()
            .await?
            .error_for_status()?
            .json::<HyperliquidMetaAndAssetCtxs>()
            .await
            .map_err(Into::into)
    }

    async fn fetch_meta(&self, dex: Option<&str>) -> AppResult<HyperliquidMeta> {
        let mut payload = serde_json::json!({
            "type": "meta",
        });
        if let Some(d) = dex {
            if d != "HL" {
                payload.as_object_mut().unwrap().insert("dex".to_string(), serde_json::Value::String(d.to_string()));
            }
        }
        self.client
            .post(HYPERLIQUID_INFO_URL)
            .json(&payload)
            .send()
            .await?
            .error_for_status()?
            .json::<HyperliquidMeta>()
            .await
            .map_err(Into::into)
    }

    #[allow(dead_code)]
    async fn fetch_mark_prices(&self, symbols: &[String]) -> AppResult<Vec<MarkPriceUpdate>> {
        let requested = symbols
            .iter()
            .map(|symbol| symbol.trim().to_uppercase())
            .collect::<HashSet<_>>();
        let mids = self.fetch_all_mids_map().await?;
        let as_of = Utc::now();

        Ok(mids
            .into_iter()
            .filter_map(|(coin, value)| {
                let normalized = self.normalize_symbol(&coin);
                if requested.contains(&coin.to_uppercase()) || requested.contains(&normalized) {
                    Some((normalized, value))
                } else {
                    None
                }
            })
            .filter_map(|(symbol, value)| {
                value
                    .as_str()
                    .and_then(|raw| parse_decimal(Some(raw)))
                    .map(|mark_price| MarkPriceUpdate {
                        symbol,
                        mark_price,
                        as_of,
                    })
            })
            .collect())
    }
}

#[async_trait]
impl ExchangeConnector for HyperliquidConnector {
    async fn validate_credentials(
        &self,
        credentials: &StoredCredentials,
    ) -> AppResult<LiveAccountValidation> {
        let wallet_address = match credentials {
            StoredCredentials::Hyperliquid { wallet_address } => wallet_address,
            _ => {
                return Err(invalid_input(
                    "Hyperliquid validation requires Hyperliquid credentials",
                ));
            }
        };
        validate_wallet_address(wallet_address)?;

        let snapshot = self.fetch_account_snapshot(credentials).await?;
        let positions = self.fetch_open_positions(credentials).await?;

        Ok(LiveAccountValidation {
            exchange: ExchangeKind::Hyperliquid,
            external_reference: wallet_address.to_lowercase(),
            wallet_balance: snapshot.wallet_balance,
            available_balance: snapshot.available_balance,
            snapshot_equity: snapshot.snapshot_equity,
            currency: snapshot.currency,
            open_positions: positions.len(),
        })
    }

    async fn fetch_account_snapshot(
        &self,
        credentials: &StoredCredentials,
    ) -> AppResult<AccountSnapshot> {
        let wallet_address = match credentials {
            StoredCredentials::Hyperliquid { wallet_address } => wallet_address,
            _ => {
                return Err(invalid_input(
                    "Hyperliquid snapshot requires Hyperliquid credentials",
                ));
            }
        };

        let response = self.fetch_clearinghouse_state(wallet_address).await?;
        Ok(parse_hyperliquid_snapshot(&response))
    }

    async fn fetch_open_positions(
        &self,
        credentials: &StoredCredentials,
    ) -> AppResult<Vec<SyncedPosition>> {
        let wallet_address = match credentials {
            StoredCredentials::Hyperliquid { wallet_address } => wallet_address,
            _ => {
                return Err(invalid_input(
                    "Hyperliquid positions require Hyperliquid credentials",
                ));
            }
        };

        let (state, mids) = tokio::try_join!(
            self.fetch_clearinghouse_state(wallet_address),
            self.fetch_all_mids_map()
        )?;

        Ok(parse_hyperliquid_positions(&state, &mids, self))
    }

    async fn fetch_balance_history(
        &self,
        _credentials: &StoredCredentials,
    ) -> AppResult<Vec<BalanceEvent>> {
        Ok(Vec::new())
    }

    async fn fetch_funding_rates(&self, symbols: &[String]) -> AppResult<Vec<FundingEntry>> {
        let requested = symbols
            .iter()
            .map(|symbol| symbol.trim().to_uppercase())
            .collect::<HashSet<_>>();

        Ok(self
            .fetch_predicted_fundings()
            .await?
            .into_iter()
            .filter_map(|row| {
                if !requested.contains(&row.0.to_uppercase())
                    && !requested.contains(&self.normalize_symbol(&row.0))
                {
                    return None;
                }

                row.1
                    .into_iter()
                    .find(|item| item.0 == "HlPerp")
                    .and_then(|(_, details)| {
                        parse_decimal(Some(details.funding_rate.as_str())).map(|rate| {
                            FundingEntry {
                                symbol: self.normalize_symbol(&row.0),
                                rate,
                                funding_time: millis_to_datetime(details.next_funding_time),
                            }
                        })
                    })
            })
            .collect())
    }

    async fn fetch_markets(&self) -> AppResult<Vec<ExchangeMarket>> {
        let dexs = self.fetch_perp_dexs().await.unwrap_or_default();
        let mut markets = Vec::new();

        // If fetch_perp_dexs fails or is empty, fallback to main dex
        if dexs.is_empty() {
            if let Ok(payload) = self.fetch_meta_and_asset_contexts(None).await {
                markets.extend(parse_hyperliquid_markets(&payload, self));
            }
        } else {
            let futures = dexs.iter().map(|dex| {
                let dex_name = if dex.name == "HL" { None } else { Some(dex.name.as_str()) };
                self.fetch_meta_and_asset_contexts(dex_name)
            });
            let results = futures_util::future::join_all(futures).await;
            for payload in results.into_iter().flatten() {
                markets.extend(parse_hyperliquid_markets(&payload, self));
            }
        }

        Ok(markets)
    }

    async fn fetch_market_quote(&self, exchange_symbol: &str) -> AppResult<MarketQuote> {
        let lookup_symbol = hyperliquid_exchange_symbol(exchange_symbol);
        // Hyperliquid's API crashes with HTTP 500 if the provided dex name is uppercase
        let dex_name = lookup_symbol.split_once(':').map(|(d, _)| d.to_lowercase());
        let dex = dex_name.as_deref();
        let (payload, predicted_fundings) = tokio::try_join!(
            self.fetch_meta_and_asset_contexts(dex),
            self.fetch_predicted_fundings()
        )?;
        let markets = parse_hyperliquid_markets(&payload, self);
        let market = markets
            .into_iter()
            .find(|item| item.exchange_symbol.eq_ignore_ascii_case(&lookup_symbol))
            .ok_or_else(|| {
                AppError::message(format!(
                    "Hyperliquid market {lookup_symbol} was not found in metadata"
                ))
            })?;

        let predicted = predicted_fundings.into_iter().find_map(|row| {
            if row.0.eq_ignore_ascii_case(&lookup_symbol) {
                row.1.into_iter().find_map(|(venue, details)| {
                    (venue == "HlPerp").then(|| {
                        (
                            parse_decimal(Some(details.funding_rate.as_str())),
                            Some(millis_to_datetime(details.next_funding_time)),
                        )
                    })
                })
            } else {
                None
            }
        });

        Ok(MarketQuote {
            exchange: ExchangeKind::Hyperliquid,
            exchange_symbol: market.exchange_symbol,
            symbol: market.symbol,
            mark_price: market.mark_price,
            oracle_price: market.oracle_price,
            funding_rate: predicted
                .as_ref()
                .and_then(|(rate, _)| *rate)
                .or(market.funding_rate),
            next_funding_time: predicted.and_then(|(_, next_time)| next_time),
            as_of: Utc::now(),
        })
    }

    async fn subscribe_mark_prices(
        &self,
        _credentials: &StoredCredentials,
        symbols: &[String],
    ) -> AppResult<broadcast::Receiver<Vec<MarkPriceUpdate>>> {
        let connector = self.clone();
        let watched_symbols = symbols.to_vec();
        let (sender, receiver) = broadcast::channel(16);

        tokio::spawn(async move {
            loop {
                if sender.receiver_count() == 0 {
                    break;
                }

                match timeout(
                    Duration::from_secs(5),
                    connector.fetch_mark_prices(&watched_symbols),
                )
                .await
                {
                    Ok(Ok(prices)) => {
                        let _ = sender.send(prices);
                    }
                    Ok(Err(error)) => {
                        log::warn!("cassini hyperliquid price poll failed: {error}");
                    }
                    Err(_) => {
                        log::warn!("cassini hyperliquid price poll timed out");
                    }
                }

                sleep(Duration::from_secs(5)).await;
            }
        });

        Ok(receiver)
    }

    fn normalize_symbol(&self, symbol: &str) -> String {
        format!("{}-PERP", symbol.trim().to_uppercase())
    }
}

#[derive(Clone)]
struct BlofinConnector {
    client: Client,
}

impl BlofinConnector {
    fn new(client: Client) -> Self {
        Self { client }
    }

    async fn signed_get<T: DeserializeOwned>(
        &self,
        credentials: &StoredCredentials,
        path: &str,
        query: &[(&str, &str)],
    ) -> AppResult<T> {
        let (api_key, api_secret, api_passphrase) = match credentials {
            StoredCredentials::Blofin {
                api_key,
                api_secret,
                api_passphrase,
            } => (api_key, api_secret, api_passphrase),
            _ => return Err(invalid_input("BloFin request requires BloFin credentials")),
        };

        let request_path = if query.is_empty() {
            path.to_string()
        } else {
            format!("{path}?{}", build_query_string(query))
        };
        let timestamp = Utc::now().timestamp_millis().to_string();
        let nonce = Uuid::new_v4().to_string();
        let prehash = format!("{request_path}GET{timestamp}{nonce}");
        let signature = sign_blofin_payload(api_secret, &prehash)?;

        let response = self
            .client
            .get(format!("{BLOFIN_REST_BASE}{request_path}"))
            .header("ACCESS-KEY", api_key)
            .header("ACCESS-SIGN", signature)
            .header("ACCESS-TIMESTAMP", &timestamp)
            .header("ACCESS-NONCE", &nonce)
            .header("ACCESS-PASSPHRASE", api_passphrase)
            .send()
            .await?
            .error_for_status()?
            .json::<BlofinEnvelope<T>>()
            .await?;

        if response.code != "0" {
            return Err(AppError::message(format!(
                "BloFin API error {}: {}",
                response.code, response.msg
            )));
        }

        Ok(response.data)
    }

    async fn public_get<T: DeserializeOwned>(
        &self,
        path: &str,
        query: &[(&str, &str)],
    ) -> AppResult<T> {
        let request_path = if query.is_empty() {
            path.to_string()
        } else {
            format!("{path}?{}", build_query_string(query))
        };

        let response = self
            .client
            .get(format!("{BLOFIN_REST_BASE}{request_path}"))
            .send()
            .await?
            .error_for_status()?
            .json::<BlofinEnvelope<T>>()
            .await?;

        if response.code != "0" {
            return Err(AppError::message(format!(
                "BloFin API error {}: {}",
                response.code, response.msg
            )));
        }

        Ok(response.data)
    }

    async fn fetch_balance_response(
        &self,
        credentials: &StoredCredentials,
    ) -> AppResult<BlofinBalanceResponse> {
        self.signed_get(
            credentials,
            "/api/v1/account/balance",
            &[("productType", "USDT-FUTURES")],
        )
        .await
    }

    async fn fetch_positions_response(
        &self,
        credentials: &StoredCredentials,
    ) -> AppResult<Vec<BlofinPositionItem>> {
        self.signed_get(credentials, "/api/v1/account/positions", &[])
            .await
    }

    #[allow(dead_code)]
    async fn fetch_mark_prices(&self, symbols: &[String]) -> AppResult<Vec<MarkPriceUpdate>> {
        let mut prices = Vec::new();

        for exchange_symbol in symbols {
            let rows: Vec<BlofinMarkPriceRow> = self
                .public_get(
                    "/api/v1/market/mark-price",
                    &[("instId", exchange_symbol.as_str())],
                )
                .await?;

            prices.extend(rows.into_iter().filter_map(|row| {
                parse_decimal(Some(row.mark_price.as_str())).map(|mark_price| MarkPriceUpdate {
                    symbol: self.normalize_symbol(&row.inst_id),
                    mark_price,
                    as_of: millis_to_datetime(row.ts),
                })
            }));
        }

        Ok(prices)
    }

    async fn fetch_instruments_response(&self) -> AppResult<Vec<BlofinInstrumentRow>> {
        self.public_get("/api/v1/market/instruments", &[("instType", "SWAP")])
            .await
    }

    async fn fetch_position_tiers_response(
        &self,
        exchange_symbol: &str,
        margin_mode: MarginMode,
    ) -> AppResult<Vec<BlofinPositionTierRow>> {
        self.public_get(
            "/api/v1/market/position-tiers",
            &[
                ("instId", exchange_symbol),
                ("marginMode", match margin_mode {
                    MarginMode::Cross => "cross",
                    MarginMode::Isolated => "isolated",
                }),
            ],
        )
        .await
    }
}

#[async_trait]
impl ExchangeConnector for BlofinConnector {
    async fn validate_credentials(
        &self,
        credentials: &StoredCredentials,
    ) -> AppResult<LiveAccountValidation> {
        let snapshot = self.fetch_account_snapshot(credentials).await?;
        let positions = self.fetch_open_positions(credentials).await?;

        Ok(LiveAccountValidation {
            exchange: ExchangeKind::Blofin,
            external_reference: "BloFin API".into(),
            wallet_balance: snapshot.wallet_balance,
            available_balance: snapshot.available_balance,
            snapshot_equity: snapshot.snapshot_equity,
            currency: snapshot.currency,
            open_positions: positions.len(),
        })
    }

    async fn fetch_account_snapshot(
        &self,
        credentials: &StoredCredentials,
    ) -> AppResult<AccountSnapshot> {
        let response = self.fetch_balance_response(credentials).await?;
        parse_blofin_snapshot(&response)
    }

    async fn fetch_open_positions(
        &self,
        credentials: &StoredCredentials,
    ) -> AppResult<Vec<SyncedPosition>> {
        let rows = self.fetch_positions_response(credentials).await?;
        Ok(parse_blofin_positions(&rows, self))
    }

    async fn fetch_balance_history(
        &self,
        _credentials: &StoredCredentials,
    ) -> AppResult<Vec<BalanceEvent>> {
        Ok(Vec::new())
    }

    async fn fetch_funding_rates(&self, symbols: &[String]) -> AppResult<Vec<FundingEntry>> {
        let mut entries = Vec::new();

        for exchange_symbol in symbols {
            let rows: Vec<BlofinFundingRateRow> = self
                .public_get(
                    "/api/v1/market/funding-rate",
                    &[("instId", exchange_symbol.as_str())],
                )
                .await?;

            entries.extend(rows.into_iter().filter_map(|row| {
                parse_decimal(Some(row.funding_rate.as_str())).map(|rate| FundingEntry {
                    symbol: self.normalize_symbol(&row.inst_id),
                    rate,
                    funding_time: millis_to_datetime(row.funding_time),
                })
            }));
        }

        Ok(entries)
    }

    async fn fetch_markets(&self) -> AppResult<Vec<ExchangeMarket>> {
        let rows = self.fetch_instruments_response().await?;
        Ok(parse_blofin_markets(&rows, self))
    }

    async fn fetch_market_quote(&self, exchange_symbol: &str) -> AppResult<MarketQuote> {
        let normalized_exchange_symbol = blofin_exchange_symbol(exchange_symbol);
        let query = [("instId", normalized_exchange_symbol.as_str())];
        let (mark_rows, funding_rows) = tokio::try_join!(
            self.public_get::<Vec<BlofinMarkPriceRow>>("/api/v1/market/mark-price", &query,),
            self.public_get::<Vec<BlofinFundingRateRow>>("/api/v1/market/funding-rate", &query,)
        )?;

        let mark_row = mark_rows
            .into_iter()
            .find(|row| {
                row.inst_id
                    .eq_ignore_ascii_case(&normalized_exchange_symbol)
            })
            .ok_or_else(|| {
                AppError::message(format!(
                    "BloFin mark price for {normalized_exchange_symbol} was not returned"
                ))
            })?;
        let funding_row = funding_rows.into_iter().find(|row| {
            row.inst_id
                .eq_ignore_ascii_case(&normalized_exchange_symbol)
        });

        Ok(MarketQuote {
            exchange: ExchangeKind::Blofin,
            exchange_symbol: mark_row.inst_id.clone(),
            symbol: self.normalize_symbol(&mark_row.inst_id),
            mark_price: parse_decimal(Some(mark_row.mark_price.as_str())),
            oracle_price: parse_decimal(Some(mark_row.index_price.as_str())),
            funding_rate: funding_row
                .as_ref()
                .and_then(|row| parse_decimal(Some(row.funding_rate.as_str()))),
            next_funding_time: funding_row
                .as_ref()
                .map(|row| millis_to_datetime(row.funding_time.as_str())),
            as_of: millis_to_datetime(mark_row.ts),
        })
    }

    async fn subscribe_mark_prices(
        &self,
        _credentials: &StoredCredentials,
        symbols: &[String],
    ) -> AppResult<broadcast::Receiver<Vec<MarkPriceUpdate>>> {
        let connector = self.clone();
        let watched_symbols = symbols.to_vec();
        let (sender, receiver) = broadcast::channel(16);

        tokio::spawn(async move {
            loop {
                if sender.receiver_count() == 0 {
                    break;
                }

                match timeout(
                    Duration::from_secs(5),
                    connector.fetch_mark_prices(&watched_symbols),
                )
                .await
                {
                    Ok(Ok(prices)) => {
                        let _ = sender.send(prices);
                    }
                    Ok(Err(error)) => {
                        log::warn!("cassini blofin mark-price poll failed: {error}");
                    }
                    Err(_) => {
                        log::warn!("cassini blofin mark-price poll timed out");
                    }
                }

                sleep(Duration::from_secs(5)).await;
            }
        });

        Ok(receiver)
    }

    fn normalize_symbol(&self, symbol: &str) -> String {
        let base = symbol
            .split('-')
            .next()
            .unwrap_or(symbol)
            .trim()
            .to_uppercase();
        format!("{base}-PERP")
    }
}

fn validate_wallet_address(wallet_address: &str) -> AppResult<()> {
    let trimmed = wallet_address.trim();
    let looks_like_address = trimmed.starts_with("0x")
        && trimmed.len() == 42
        && trimmed[2..].chars().all(|ch| ch.is_ascii_hexdigit());

    if looks_like_address {
        Ok(())
    } else {
        Err(invalid_input(
            "Hyperliquid wallet address must be a 42-character 0x-prefixed hex address",
        ))
    }
}

fn build_query_string(query: &[(&str, &str)]) -> String {
    query
        .iter()
        .filter(|(_, value)| !value.is_empty())
        .map(|(key, value)| format!("{key}={value}"))
        .collect::<Vec<_>>()
        .join("&")
}

fn sign_blofin_payload(api_secret: &str, prehash: &str) -> AppResult<String> {
    let mut mac = HmacSha256::new_from_slice(api_secret.as_bytes())
        .map_err(|_| AppError::message("BloFin secret could not be used for signing"))?;
    mac.update(prehash.as_bytes());
    let hex_signature = hex::encode(mac.finalize().into_bytes());
    Ok(general_purpose::STANDARD.encode(hex_signature.as_bytes()))
}

fn parse_decimal(raw: Option<&str>) -> Option<f64> {
    raw.and_then(|value| value.parse::<f64>().ok())
}

fn quantity_step_from_decimals(decimals: u32) -> f64 {
    10_f64.powi(-(decimals as i32))
}

fn hyperliquid_exchange_symbol(raw: &str) -> String {
    raw.split('-').next().unwrap_or(raw).trim().to_uppercase()
}

fn blofin_exchange_symbol(raw: &str) -> String {
    raw.trim().to_uppercase()
}

fn millis_to_datetime(raw: impl ToString) -> DateTime<Utc> {
    let millis = raw
        .to_string()
        .parse::<i64>()
        .unwrap_or_else(|_| Utc::now().timestamp_millis());

    Utc.timestamp_millis_opt(millis)
        .single()
        .unwrap_or_else(Utc::now)
}

fn parse_hyperliquid_snapshot(response: &HyperliquidClearinghouseState) -> AccountSnapshot {
    let equity = parse_decimal(Some(response.margin_summary.account_value.as_str())).unwrap_or(0.0);
    let available = parse_decimal(Some(response.withdrawable.as_str())).unwrap_or(0.0);
    AccountSnapshot {
        wallet_balance: equity,
        available_balance: available,
        snapshot_equity: equity,
        currency: "USDC".into(),
    }
}

fn parse_hyperliquid_positions(
    response: &HyperliquidClearinghouseState,
    mids: &serde_json::Map<String, serde_json::Value>,
    connector: &HyperliquidConnector,
) -> Vec<SyncedPosition> {
    response
        .asset_positions
        .iter()
        .filter_map(|entry| {
            let size = parse_decimal(Some(entry.position.szi.as_str()))?;
            if size == 0.0 {
                return None;
            }

            let exchange_symbol = entry.position.coin.to_uppercase();
            let mark_price = mids
                .get(&entry.position.coin)
                .and_then(|value| value.as_str())
                .and_then(|value| parse_decimal(Some(value)));
            let funding_paid = entry
                .position
                .cum_funding
                .as_ref()
                .and_then(|funding| parse_decimal(Some(funding.since_open.as_str())))
                .map(|value| -value)
                .unwrap_or(0.0);

            Some(SyncedPosition {
                exchange_symbol: exchange_symbol.clone(),
                symbol: connector.normalize_symbol(&exchange_symbol),
                margin_mode: decode_margin_mode(entry.position.leverage.kind.as_deref()),
                side: if size >= 0.0 {
                    PositionSide::Long
                } else {
                    PositionSide::Short
                },
                quantity: size.abs(),
                entry_price: parse_decimal(entry.position.entry_px.as_deref()).unwrap_or(0.0),
                mark_price,
                margin_used: parse_decimal(entry.position.margin_used.as_deref()),
                liquidation_price: parse_decimal(entry.position.liquidation_px.as_deref()),
                maintenance_margin: None,
                maintenance_margin_rate: None,
                risk_source: Some(PositionRiskSource::LiveExchange),
                leverage: entry.position.leverage.value.max(1.0),
                unrealized_pnl: parse_decimal(Some(entry.position.unrealized_pnl.as_str()))
                    .unwrap_or(0.0),
                realized_pnl: 0.0,
                fee_paid: 0.0,
                funding_paid,
                opened_at: millis_to_datetime(response.time.to_string()),
            })
        })
        .collect()
}

fn parse_blofin_snapshot(response: &BlofinBalanceResponse) -> AppResult<AccountSnapshot> {
    let detail = response
        .details
        .iter()
        .find(|detail| detail.currency.eq_ignore_ascii_case("USDT"))
        .or_else(|| response.details.first())
        .ok_or_else(|| {
            AppError::message("BloFin balance response did not include asset details")
        })?;

    Ok(AccountSnapshot {
        wallet_balance: parse_decimal(Some(detail.balance.as_str())).unwrap_or(0.0),
        available_balance: parse_decimal(Some(detail.available.as_str())).unwrap_or(0.0),
        snapshot_equity: parse_decimal(Some(response.total_equity.as_str()))
            .or_else(|| parse_decimal(Some(detail.equity_usd.as_str())))
            .unwrap_or(0.0),
        currency: detail.currency.to_uppercase(),
    })
}

fn parse_blofin_positions(
    rows: &[BlofinPositionItem],
    connector: &BlofinConnector,
) -> Vec<SyncedPosition> {
    rows.iter()
        .filter_map(|row| {
            let size = parse_decimal(Some(row.positions.as_str()))?;
            if size == 0.0 {
                return None;
            }

            Some(SyncedPosition {
                exchange_symbol: row.inst_id.clone(),
                symbol: connector.normalize_symbol(&row.inst_id),
                margin_mode: decode_margin_mode(Some(row.margin_mode.as_str())),
                side: if size >= 0.0 {
                    PositionSide::Long
                } else {
                    PositionSide::Short
                },
                quantity: size.abs(),
                entry_price: parse_decimal(Some(row.average_price.as_str())).unwrap_or(0.0),
                mark_price: parse_decimal(Some(row.mark_price.as_str())),
                margin_used: parse_decimal(Some(row.margin.as_str())),
                liquidation_price: parse_decimal(Some(row.liquidation_price.as_str())),
                maintenance_margin: parse_decimal(Some(row.maintenance_margin.as_str())),
                maintenance_margin_rate: None,
                risk_source: Some(PositionRiskSource::LiveExchange),
                leverage: parse_decimal(Some(row.leverage.as_str()))
                    .unwrap_or(1.0)
                    .max(1.0),
                unrealized_pnl: parse_decimal(Some(row.unrealized_pnl.as_str())).unwrap_or(0.0),
                realized_pnl: 0.0,
                fee_paid: 0.0,
                funding_paid: 0.0,
                opened_at: millis_to_datetime(&row.create_time),
            })
        })
        .collect()
}

fn parse_hyperliquid_markets(
    payload: &HyperliquidMetaAndAssetCtxs,
    connector: &HyperliquidConnector,
) -> Vec<ExchangeMarket> {
    payload
        .0
        .universe
        .iter()
        .enumerate()
        .map(|(index, market)| {
            let asset_ctx = payload.1.get(index);
            ExchangeMarket {
                exchange: ExchangeKind::Hyperliquid,
                exchange_symbol: market.name.to_uppercase(),
                symbol: connector.normalize_symbol(&market.name),
                base_asset: market.name.to_uppercase(),
                quote_asset: "USDC".into(),
                settle_asset: Some("USDC".into()),
                contract_type: "perpetual".into(),
                contract_value: Some(1.0),
                price_tick_size: None,
                quantity_step: Some(quantity_step_from_decimals(market.sz_decimals)),
                min_quantity: Some(quantity_step_from_decimals(market.sz_decimals)),
                max_leverage: Some(market.max_leverage),
                mark_price: asset_ctx.and_then(|ctx| parse_decimal(ctx.mark_px.as_deref())),
                oracle_price: asset_ctx.and_then(|ctx| parse_decimal(ctx.oracle_px.as_deref())),
                funding_rate: asset_ctx.and_then(|ctx| parse_decimal(ctx.funding.as_deref())),
                next_funding_time: None,
                is_active: !market.is_delisted.unwrap_or(false),
            }
        })
        .collect()
}

fn parse_blofin_markets(
    rows: &[BlofinInstrumentRow],
    connector: &BlofinConnector,
) -> Vec<ExchangeMarket> {
    rows.iter()
        .map(|row| ExchangeMarket {
            exchange: ExchangeKind::Blofin,
            exchange_symbol: row.inst_id.clone(),
            symbol: connector.normalize_symbol(&row.inst_id),
            base_asset: row.base_currency.to_uppercase(),
            quote_asset: row.quote_currency.to_uppercase(),
            settle_asset: Some(row.settle_currency.to_uppercase()),
            contract_type: row.contract_type.clone(),
            contract_value: parse_decimal(Some(row.contract_value.as_str())),
            price_tick_size: parse_decimal(Some(row.tick_size.as_str())),
            quantity_step: parse_decimal(Some(row.lot_size.as_str())),
            min_quantity: parse_decimal(Some(row.min_size.as_str())),
            max_leverage: parse_decimal(Some(row.max_leverage.as_str())),
            mark_price: None,
            oracle_price: None,
            funding_rate: None,
            next_funding_time: None,
            is_active: row.state.eq_ignore_ascii_case("live"),
        })
        .collect()
}

fn parse_hyperliquid_risk_tiers(
    exchange_symbol: &str,
    meta: &HyperliquidMeta,
) -> AppResult<Vec<ExchangeRiskTier>> {
    let lookup = hyperliquid_exchange_symbol(exchange_symbol);
    let asset = meta
        .universe
        .iter()
        .find(|asset| asset.name.eq_ignore_ascii_case(&lookup))
        .ok_or_else(|| {
            AppError::message(format!(
                "Hyperliquid market {lookup} was not found in metadata"
            ))
        })?;
    let margin_table_id = asset.margin_table_id.ok_or_else(|| {
        AppError::message(format!(
            "Hyperliquid market {lookup} did not include a margin table id"
        ))
    })?;
    let margin_tables = meta.margin_tables.as_ref().ok_or_else(|| {
        AppError::message("Hyperliquid meta response did not include margin tables")
    })?;
    let (_, table) = margin_tables
        .iter()
        .find(|(table_id, _)| *table_id == margin_table_id)
        .ok_or_else(|| {
            AppError::message(format!(
                "Hyperliquid margin table {margin_table_id} was not found"
            ))
        })?;

    let parsed = table
        .margin_tiers
        .iter()
        .enumerate()
        .map(|(index, tier)| {
            (
                index,
                parse_decimal(Some(tier.lower_bound.as_str())).unwrap_or(0.0),
                1.0 / (tier.max_leverage * 2.0),
                tier.max_leverage,
            )
        })
        .collect::<Vec<_>>();
    let mut tiers = Vec::new();

    for (index, lower_bound, maintenance_margin_rate, max_leverage) in &parsed {
        let upper_bound = parsed.get(index + 1).map(|(_, lower, _, _)| *lower);
        let maintenance_amount_deduction = parsed
            .iter()
            .take(*index)
            .enumerate()
            .map(|(previous_index, (_, previous_lower, previous_rate, _))| {
                let previous_upper = parsed
                    .get(previous_index + 1)
                    .map(|(_, next_lower, _, _)| *next_lower)
                    .unwrap_or(*lower_bound);
                (previous_upper - previous_lower) * (maintenance_margin_rate - previous_rate)
            })
            .sum::<f64>();

        tiers.push(ExchangeRiskTier {
            exchange: ExchangeKind::Hyperliquid,
            exchange_symbol: lookup.clone(),
            margin_mode: None,
            tier_basis: RiskTierBasis::NotionalUsd,
            lower_bound: *lower_bound,
            upper_bound,
            maintenance_margin_rate: *maintenance_margin_rate,
            maintenance_amount_deduction,
            max_leverage: *max_leverage,
        });
    }

    Ok(tiers)
}

fn parse_blofin_risk_tiers(
    exchange_symbol: &str,
    margin_mode: MarginMode,
    rows: &[BlofinPositionTierRow],
) -> Vec<ExchangeRiskTier> {
    rows.iter()
        .map(|row| ExchangeRiskTier {
            exchange: ExchangeKind::Blofin,
            exchange_symbol: exchange_symbol.trim().to_uppercase(),
            margin_mode: Some(margin_mode),
            tier_basis: RiskTierBasis::ExchangeQuantity,
            lower_bound: parse_decimal(Some(row.min_size.as_str())).unwrap_or(0.0),
            upper_bound: parse_decimal(Some(row.max_size.as_str())),
            maintenance_margin_rate: parse_decimal(Some(row.maintenance_margin_rate.as_str()))
                .unwrap_or(0.0),
            maintenance_amount_deduction: 0.0,
            max_leverage: parse_decimal(Some(row.max_leverage.as_str())).unwrap_or(1.0),
        })
        .collect()
}

fn decode_margin_mode(raw: Option<&str>) -> Option<MarginMode> {
    match raw.map(|value| value.trim().to_lowercase()) {
        Some(value) if value == "cross" => Some(MarginMode::Cross),
        Some(value) if value == "isolated" || value == "isolate" => Some(MarginMode::Isolated),
        _ => None,
    }
}

#[derive(Debug, Deserialize)]
struct HyperliquidClearinghouseState {
    #[serde(rename = "marginSummary")]
    margin_summary: HyperliquidMarginSummary,
    withdrawable: String,
    #[serde(rename = "assetPositions")]
    asset_positions: Vec<HyperliquidAssetPosition>,
    time: i64,
}

#[derive(Debug, Deserialize)]
struct HyperliquidMarginSummary {
    #[serde(rename = "accountValue")]
    account_value: String,
}

#[derive(Debug, Deserialize)]
struct HyperliquidAssetPosition {
    position: HyperliquidPosition,
}

#[derive(Debug, Deserialize)]
struct HyperliquidPosition {
    coin: String,
    szi: String,
    #[serde(rename = "entryPx")]
    entry_px: Option<String>,
    #[serde(rename = "liquidationPx")]
    liquidation_px: Option<String>,
    #[serde(rename = "marginUsed")]
    margin_used: Option<String>,
    leverage: HyperliquidLeverage,
    #[serde(rename = "unrealizedPnl")]
    unrealized_pnl: String,
    #[serde(rename = "cumFunding")]
    cum_funding: Option<HyperliquidCumFunding>,
}

#[derive(Debug, Deserialize)]
struct HyperliquidLeverage {
    #[serde(rename = "type")]
    kind: Option<String>,
    value: f64,
}

#[derive(Debug, Deserialize)]
struct HyperliquidCumFunding {
    #[serde(rename = "sinceOpen")]
    since_open: String,
}

#[derive(Debug, Deserialize)]
struct HyperliquidFundingDetails {
    #[serde(rename = "fundingRate")]
    funding_rate: String,
    #[serde(rename = "nextFundingTime")]
    next_funding_time: i64,
}

type HyperliquidMetaAndAssetCtxs = (HyperliquidMeta, Vec<HyperliquidAssetContext>);

#[derive(Debug, Deserialize)]
struct HyperliquidPerpDex {
    name: String,
}

#[derive(Debug, Deserialize)]
struct HyperliquidMeta {
    universe: Vec<HyperliquidUniverseAsset>,
    #[serde(rename = "marginTables")]
    margin_tables: Option<Vec<HyperliquidMarginTableEntry>>,
}

#[derive(Debug, Deserialize)]
struct HyperliquidUniverseAsset {
    #[serde(rename = "szDecimals")]
    sz_decimals: u32,
    name: String,
    #[serde(rename = "maxLeverage")]
    max_leverage: f64,
    #[serde(rename = "marginTableId")]
    margin_table_id: Option<u32>,
    #[serde(rename = "isDelisted")]
    is_delisted: Option<bool>,
}

#[derive(Debug, Deserialize)]
struct HyperliquidMarginTableDetails {
    #[serde(rename = "marginTiers")]
    margin_tiers: Vec<HyperliquidMarginTier>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct HyperliquidMarginTier {
    lower_bound: String,
    max_leverage: f64,
}

type HyperliquidMarginTableEntry = (u32, HyperliquidMarginTableDetails);

#[derive(Debug, Deserialize)]
struct HyperliquidAssetContext {
    funding: Option<String>,
    #[serde(rename = "oraclePx")]
    oracle_px: Option<String>,
    #[serde(rename = "markPx")]
    mark_px: Option<String>,
}

type HyperliquidFundingVenue = (String, HyperliquidFundingDetails);
type HyperliquidFundingRow = (String, Vec<HyperliquidFundingVenue>);

#[derive(Debug, Deserialize)]
struct BlofinEnvelope<T> {
    code: String,
    msg: String,
    data: T,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct BlofinBalanceResponse {
    total_equity: String,
    details: Vec<BlofinBalanceDetail>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct BlofinBalanceDetail {
    currency: String,
    balance: String,
    available: String,
    equity_usd: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct BlofinPositionItem {
    inst_id: String,
    margin_mode: String,
    positions: String,
    average_price: String,
    margin: String,
    mark_price: String,
    liquidation_price: String,
    unrealized_pnl: String,
    maintenance_margin: String,
    create_time: String,
    leverage: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct BlofinFundingRateRow {
    inst_id: String,
    funding_rate: String,
    funding_time: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct BlofinPositionTierRow {
    min_size: String,
    max_size: String,
    maintenance_margin_rate: String,
    max_leverage: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct BlofinInstrumentRow {
    inst_id: String,
    base_currency: String,
    quote_currency: String,
    contract_value: String,
    max_leverage: String,
    min_size: String,
    lot_size: String,
    tick_size: String,
    contract_type: String,
    state: String,
    settle_currency: String,
}

#[allow(dead_code)]
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct BlofinMarkPriceRow {
    inst_id: String,
    index_price: String,
    mark_price: String,
    ts: String,
}

#[cfg(test)]
mod tests {
    use super::*;

    fn test_client() -> Client {
        Client::builder().build().expect("client should build")
    }

    fn assert_close(actual: f64, expected: f64) {
        assert!(
            (actual - expected).abs() < 1e-9,
            "expected {expected}, got {actual}"
        );
    }

    #[test]
    fn parses_hyperliquid_snapshot_and_positions_from_fixture() {
        let state = serde_json::from_str::<HyperliquidClearinghouseState>(include_str!(
            "fixtures/hyperliquid_clearinghouse_state.json"
        ))
        .expect("state fixture should parse");
        let mids = serde_json::from_str::<serde_json::Map<String, serde_json::Value>>(
            include_str!("fixtures/hyperliquid_all_mids.json"),
        )
        .expect("mids fixture should parse");
        let connector = HyperliquidConnector::new(test_client());

        let snapshot = parse_hyperliquid_snapshot(&state);
        let positions = parse_hyperliquid_positions(&state, &mids, &connector);

        assert_eq!(snapshot.currency, "USDC");
        assert_eq!(positions.len(), 1);
        assert_eq!(positions[0].symbol, "HYPE-PERP");
        assert_eq!(positions[0].side, PositionSide::Short);
        assert_eq!(positions[0].margin_mode, Some(MarginMode::Cross));
        assert_close(
            positions[0].margin_used.expect("margin used should exist"),
            702.8,
        );
        assert_close(
            positions[0]
                .liquidation_price
                .expect("liquidation price should exist"),
            55.5216572667,
        );
        assert!(positions[0].funding_paid > 0.0);
    }

    #[test]
    fn parses_blofin_snapshot_and_positions_from_doc_fixture() {
        let balance = serde_json::from_str::<BlofinBalanceResponse>(include_str!(
            "fixtures/blofin_balance_doc.json"
        ))
        .expect("balance fixture should parse");
        let positions = serde_json::from_str::<Vec<BlofinPositionItem>>(include_str!(
            "fixtures/blofin_positions_doc.json"
        ))
        .expect("positions fixture should parse");
        let connector = BlofinConnector::new(test_client());

        let snapshot = parse_blofin_snapshot(&balance).expect("snapshot should parse");
        let parsed_positions = parse_blofin_positions(&positions, &connector);

        assert_eq!(snapshot.currency, "USDT");
        assert_eq!(parsed_positions.len(), 2);
        assert_eq!(parsed_positions[0].symbol, "ETH-PERP");
        assert_eq!(parsed_positions[0].margin_mode, Some(MarginMode::Isolated));
        assert_close(
            parsed_positions[0]
                .margin_used
                .expect("margin used should exist"),
            53.06,
        );
        assert_close(
            parsed_positions[0]
                .liquidation_price
                .expect("liquidation price should exist"),
            1066.1040787623066,
        );
        assert_close(
            parsed_positions[0]
                .maintenance_margin
                .expect("maintenance margin should exist"),
            0.636676,
        );
        assert_eq!(parsed_positions[1].side, PositionSide::Short);
        assert_eq!(parsed_positions[1].margin_mode, Some(MarginMode::Cross));
        assert_close(
            parsed_positions[1]
                .margin_used
                .expect("margin used should exist"),
            1266.72,
        );
        assert_close(
            parsed_positions[1]
                .liquidation_price
                .expect("liquidation price should exist"),
            252.0,
        );
        assert_close(
            parsed_positions[1]
                .maintenance_margin
                .expect("maintenance margin should exist"),
            17.5,
        );
    }

    #[test]
    fn parses_live_public_funding_fixtures() {
        let hyperliquid_rows = serde_json::from_str::<Vec<HyperliquidFundingRow>>(include_str!(
            "fixtures/hyperliquid_predicted_fundings.json"
        ))
        .expect("hyperliquid funding fixture should parse");
        let blofin_rows = serde_json::from_str::<Vec<BlofinFundingRateRow>>(include_str!(
            "fixtures/blofin_funding_rate_live.json"
        ))
        .expect("blofin funding fixture should parse");

        assert!(!hyperliquid_rows.is_empty());
        assert_eq!(blofin_rows[0].inst_id, "BTC-USDT");
    }

    #[test]
    fn parses_hyperliquid_market_catalog_from_live_fixture() {
        let payload = serde_json::from_str::<HyperliquidMetaAndAssetCtxs>(include_str!(
            "fixtures/hyperliquid_meta_and_asset_ctxs_live.json"
        ))
        .expect("hyperliquid market catalog fixture should parse");
        let connector = HyperliquidConnector::new(test_client());

        let markets = parse_hyperliquid_markets(&payload, &connector);

        assert_eq!(markets.len(), 2);
        assert_eq!(markets[0].exchange_symbol, "BTC");
        assert_eq!(markets[0].symbol, "BTC-PERP");
        assert!(markets[0].mark_price.is_some());
    }

    #[test]
    fn parses_blofin_market_catalog_from_live_fixture() {
        let rows = serde_json::from_str::<Vec<BlofinInstrumentRow>>(include_str!(
            "fixtures/blofin_instruments_live.json"
        ))
        .expect("blofin instruments fixture should parse");
        let connector = BlofinConnector::new(test_client());

        let markets = parse_blofin_markets(&rows, &connector);

        assert_eq!(markets.len(), 2);
        assert_eq!(markets[0].exchange_symbol, "BTC-USDT");
        assert_eq!(markets[0].symbol, "BTC-PERP");
        assert_eq!(markets[0].max_leverage, Some(150.0));
    }
}
