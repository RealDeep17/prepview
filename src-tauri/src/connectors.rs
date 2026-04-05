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
        MarketQuote, PositionFundingEstimate, PositionRiskSource, PositionSide, RiskTierBasis,
        SyncedPosition,
    },
    error::{invalid_input, AppError, AppResult},
};

type HmacSha256 = Hmac<Sha256>;

const HYPERLIQUID_INFO_URL: &str = "https://api.hyperliquid.xyz/info";
const BLOFIN_REST_BASE: &str = "https://openapi.blofin.com";
const SUPPORTED_HYPERLIQUID_HIP3_DEXS: [&str; 1] = ["xyz"];

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
                tiers.extend(parse_blofin_risk_tiers(exchange_symbol, mode, &rows));
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

pub async fn estimate_public_position_funding(
    client: Client,
    exchange: ExchangeKind,
    exchange_symbol: &str,
    side: PositionSide,
    quantity: f64,
    contract_value: Option<f64>,
    opened_at: DateTime<Utc>,
    as_of: DateTime<Utc>,
) -> AppResult<PositionFundingEstimate> {
    match exchange {
        ExchangeKind::Blofin => {
            let connector = BlofinConnector::new(client);
            connector
                .estimate_public_position_funding(
                    exchange_symbol,
                    side,
                    quantity,
                    contract_value.unwrap_or(1.0),
                    opened_at,
                    as_of,
                )
                .await
        }
        ExchangeKind::Hyperliquid => {
            let connector = HyperliquidConnector::new(client);
            connector
                .estimate_public_position_funding(
                    exchange_symbol,
                    side,
                    quantity,
                    contract_value.unwrap_or(1.0),
                    opened_at,
                    as_of,
                )
                .await
        }
        _ => Err(invalid_input(
            "automatic funding is only available for BloFin and Hyperliquid positions",
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
        dex: Option<&str>,
    ) -> AppResult<HyperliquidClearinghouseState> {
        let mut payload = serde_json::json!({
            "type": "clearinghouseState",
            "user": wallet_address,
        });
        insert_hyperliquid_dex(&mut payload, dex);
        self.client
            .post(HYPERLIQUID_INFO_URL)
            .json(&payload)
            .send()
            .await?
            .error_for_status()?
            .json::<HyperliquidClearinghouseState>()
            .await
            .map_err(Into::into)
    }

    async fn fetch_all_mids_map(
        &self,
        dex: Option<&str>,
    ) -> AppResult<serde_json::Map<String, serde_json::Value>> {
        let mut payload = serde_json::json!({
            "type": "allMids",
        });
        insert_hyperliquid_dex(&mut payload, dex);
        let value = self
            .client
            .post(HYPERLIQUID_INFO_URL)
            .json(&payload)
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

    async fn fetch_supported_hip3_dexes(&self) -> Vec<String> {
        let discovered = self
            .fetch_perp_dexs()
            .await
            .unwrap_or_default()
            .into_iter()
            .filter_map(|dex| normalized_hyperliquid_dex(dex.name.as_str()))
            .collect::<HashSet<_>>();

        SUPPORTED_HYPERLIQUID_HIP3_DEXS
            .iter()
            .filter(|dex| discovered.is_empty() || discovered.contains(**dex))
            .map(|dex| (*dex).to_string())
            .collect()
    }

    async fn fetch_supported_clearinghouse_states(
        &self,
        wallet_address: &str,
    ) -> AppResult<Vec<HyperliquidClearinghouseState>> {
        let mut dexs = Vec::with_capacity(1 + SUPPORTED_HYPERLIQUID_HIP3_DEXS.len());
        dexs.push(None);
        dexs.extend(
            self.fetch_supported_hip3_dexes()
                .await
                .into_iter()
                .map(Some),
        );

        futures_util::future::try_join_all(
            dexs.iter()
                .map(|dex| self.fetch_clearinghouse_state(wallet_address, dex.as_deref())),
        )
        .await
    }

    async fn fetch_supported_position_contexts(
        &self,
        wallet_address: &str,
    ) -> AppResult<
        Vec<(
            HyperliquidClearinghouseState,
            serde_json::Map<String, serde_json::Value>,
        )>,
    > {
        let mut dexs = Vec::with_capacity(1 + SUPPORTED_HYPERLIQUID_HIP3_DEXS.len());
        dexs.push(None);
        dexs.extend(
            self.fetch_supported_hip3_dexes()
                .await
                .into_iter()
                .map(Some),
        );

        let states = futures_util::future::try_join_all(
            dexs.iter()
                .map(|dex| self.fetch_clearinghouse_state(wallet_address, dex.as_deref())),
        )
        .await?;
        let mids = futures_util::future::try_join_all(
            dexs.iter()
                .map(|dex| self.fetch_all_mids_map(dex.as_deref())),
        )
        .await?;

        Ok(states.into_iter().zip(mids).collect())
    }

    async fn fetch_predicted_fundings(
        &self,
        dex: Option<&str>,
    ) -> AppResult<Vec<HyperliquidFundingRow>> {
        let mut payload = serde_json::json!({ "type": "predictedFundings" });
        insert_hyperliquid_dex(&mut payload, dex);
        self.client
            .post(HYPERLIQUID_INFO_URL)
            .json(&payload)
            .send()
            .await?
            .error_for_status()?
            .json::<Vec<HyperliquidFundingRow>>()
            .await
            .map_err(Into::into)
    }

    async fn fetch_perp_dexs(&self) -> AppResult<Vec<HyperliquidPerpDex>> {
        let raw = self
            .client
            .post(HYPERLIQUID_INFO_URL)
            .json(&serde_json::json!({
                "type": "perpDexs",
            }))
            .send()
            .await?
            .error_for_status()?
            .json::<Vec<Option<HyperliquidPerpDex>>>()
            .await?;
        Ok(raw.into_iter().flatten().collect())
    }

    async fn fetch_meta_and_asset_contexts(
        &self,
        dex: Option<&str>,
    ) -> AppResult<HyperliquidMetaAndAssetCtxs> {
        let mut payload = serde_json::json!({
            "type": "metaAndAssetCtxs",
        });
        insert_hyperliquid_dex(&mut payload, dex);
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
        insert_hyperliquid_dex(&mut payload, dex);
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

    async fn fetch_spot_clearinghouse_state(
        &self,
        wallet_address: &str,
    ) -> AppResult<HyperliquidSpotClearinghouseState> {
        self.client
            .post(HYPERLIQUID_INFO_URL)
            .json(&serde_json::json!({
                "type": "spotClearinghouseState",
                "user": wallet_address,
            }))
            .send()
            .await?
            .error_for_status()?
            .json::<HyperliquidSpotClearinghouseState>()
            .await
            .map_err(Into::into)
    }

    async fn fetch_funding_history(
        &self,
        exchange_symbol: &str,
        start_time: DateTime<Utc>,
    ) -> AppResult<Vec<HyperliquidFundingHistoryPoint>> {
        let coin = hyperliquid_api_coin_symbol(exchange_symbol);
        self.client
            .post(HYPERLIQUID_INFO_URL)
            .json(&serde_json::json!({
                "type": "fundingHistory",
                "coin": coin,
                "startTime": start_time.timestamp_millis(),
            }))
            .send()
            .await?
            .error_for_status()?
            .json::<Vec<HyperliquidFundingHistoryPoint>>()
            .await
            .map_err(Into::into)
    }

    async fn fetch_candle_snapshot(
        &self,
        exchange_symbol: &str,
        interval: &str,
        start_time: DateTime<Utc>,
        end_time: DateTime<Utc>,
    ) -> AppResult<Vec<HyperliquidCandle>> {
        let coin = hyperliquid_api_coin_symbol(exchange_symbol);
        self.client
            .post(HYPERLIQUID_INFO_URL)
            .json(&serde_json::json!({
                "type": "candleSnapshot",
                "req": {
                    "coin": coin,
                    "interval": interval,
                    "startTime": start_time.timestamp_millis(),
                    "endTime": end_time.timestamp_millis(),
                }
            }))
            .send()
            .await?
            .error_for_status()?
            .json::<Vec<HyperliquidCandle>>()
            .await
            .map_err(Into::into)
    }

    async fn estimate_public_position_funding(
        &self,
        exchange_symbol: &str,
        side: PositionSide,
        quantity: f64,
        contract_value: f64,
        opened_at: DateTime<Utc>,
        as_of: DateTime<Utc>,
    ) -> AppResult<PositionFundingEstimate> {
        let funding_rows = self
            .fetch_funding_history(exchange_symbol, opened_at)
            .await?;
        let funding_rows = funding_rows
            .into_iter()
            .filter(|row| {
                row.time >= opened_at.timestamp_millis() && row.time <= as_of.timestamp_millis()
            })
            .collect::<Vec<_>>();
        if funding_rows.is_empty() {
            return Ok(PositionFundingEstimate {
                funding_paid: 0.0,
                settlements: 0,
                estimated: true,
                as_of,
            });
        }

        let candle_end = as_of + chrono::Duration::hours(1);
        let candles = self
            .fetch_candle_snapshot(exchange_symbol, "1h", opened_at, candle_end)
            .await?;
        let funding_paid = compute_funding_paid_from_samples(
            side,
            quantity,
            contract_value,
            funding_rows.iter().map(|row| FundingSample {
                funding_time: row.time,
                funding_rate: parse_decimal(Some(row.funding_rate.as_str())).unwrap_or(0.0),
            }),
            |sample_time| {
                resolve_candle_price(
                    candles.iter().map(|candle| CandleSample {
                        start_time: candle.t,
                        end_time: candle.t_end,
                        open_price: parse_decimal(Some(candle.open.as_str())).unwrap_or(0.0),
                        close_price: parse_decimal(Some(candle.close.as_str())).unwrap_or(0.0),
                    }),
                    sample_time,
                )
            },
        );

        Ok(PositionFundingEstimate {
            funding_paid,
            settlements: funding_rows.len(),
            estimated: true,
            as_of,
        })
    }

    #[allow(dead_code)]
    async fn fetch_mark_prices(&self, symbols: &[String]) -> AppResult<Vec<MarkPriceUpdate>> {
        let requested_dexes = requested_hyperliquid_dexes(symbols);
        if requested_dexes.is_empty() {
            return Ok(Vec::new());
        }

        let requested = symbols
            .iter()
            .map(|symbol| symbol.trim().to_uppercase())
            .collect::<HashSet<_>>();
        let as_of = Utc::now();
        let mids_maps = futures_util::future::try_join_all(
            requested_dexes
                .iter()
                .map(|dex| self.fetch_all_mids_map(dex.as_deref())),
        )
        .await?;

        Ok(mids_maps
            .into_iter()
            .flat_map(|mids| mids.into_iter())
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

        let spot_state = match self.fetch_spot_clearinghouse_state(wallet_address).await {
            Ok(state) => Some(state),
            Err(error) => {
                log::warn!(
                    "prepview hyperliquid spotClearinghouseState fetch failed; falling back to perp clearinghouseState: {error}"
                );
                None
            }
        };
        let responses = self
            .fetch_supported_clearinghouse_states(wallet_address)
            .await?;
        Ok(parse_hyperliquid_snapshot(spot_state.as_ref(), &responses))
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

        let contexts = self
            .fetch_supported_position_contexts(wallet_address)
            .await?;

        Ok(contexts
            .iter()
            .flat_map(|(state, mids)| parse_hyperliquid_positions(state, mids, self))
            .collect())
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
            .fetch_predicted_fundings(None)
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
                    .and_then(|(_, details_opt)| details_opt)
                    .and_then(|details| {
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
        let mut markets = Vec::new();

        // Always fetch the main DEX ("HL") because perpDexs might only contain HIP3 dexes.
        if let Ok(payload) = self.fetch_meta_and_asset_contexts(None).await {
            markets.extend(parse_hyperliquid_markets(&payload, self));
        }

        // Fetch additional HIP3 DEXs
        let supported_hip3_dexes = self.fetch_supported_hip3_dexes().await;
        if !supported_hip3_dexes.is_empty() {
            let futures = supported_hip3_dexes
                .iter()
                .map(|dex| self.fetch_meta_and_asset_contexts(Some(dex.as_str())));
            let results = futures_util::future::join_all(futures).await;
            for payload in results.into_iter().flatten() {
                markets.extend(parse_hyperliquid_markets(&payload, self));
            }
        }

        Ok(markets)
    }

    async fn fetch_market_quote(&self, exchange_symbol: &str) -> AppResult<MarketQuote> {
        let lookup_symbol = hyperliquid_exchange_symbol(exchange_symbol);
        let dex_name = lookup_symbol.split_once(':').map(|(d, _)| d.to_lowercase());
        let dex = dex_name.as_deref();

        let (payload, predicted_fundings) = tokio::try_join!(
            self.fetch_meta_and_asset_contexts(dex),
            self.fetch_predicted_fundings(dex)
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
                    if venue == "HlPerp" {
                        details.map(|d| {
                            (
                                parse_decimal(Some(d.funding_rate.as_str())),
                                Some(millis_to_datetime(d.next_funding_time)),
                            )
                        })
                    } else {
                        None
                    }
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
                        log::warn!("prepview hyperliquid price poll failed: {error}");
                    }
                    Err(_) => {
                        log::warn!("prepview hyperliquid price poll timed out");
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
                (
                    "marginMode",
                    match margin_mode {
                        MarginMode::Cross => "cross",
                        MarginMode::Isolated => "isolated",
                    },
                ),
            ],
        )
        .await
    }

    async fn fetch_funding_rate_history(
        &self,
        exchange_symbol: &str,
        start_time: DateTime<Utc>,
    ) -> AppResult<Vec<BlofinFundingRateRow>> {
        const PAGE_LIMIT: usize = 100;
        let limit = PAGE_LIMIT.to_string();
        let mut cursor = None::<String>;
        let mut rows = Vec::new();

        loop {
            let mut query = vec![("instId", exchange_symbol), ("limit", limit.as_str())];
            if let Some(after) = cursor.as_deref() {
                query.push(("after", after));
            }

            let page: Vec<BlofinFundingRateRow> = self
                .public_get("/api/v1/market/funding-rate-history", &query)
                .await?;
            if page.is_empty() {
                break;
            }

            let oldest_time = page
                .last()
                .map(|row| row.funding_time.clone())
                .unwrap_or_default();

            rows.extend(page.iter().filter_map(|row| {
                let funding_time = row.funding_time.parse::<i64>().ok()?;
                (funding_time >= start_time.timestamp_millis()).then(|| row.clone())
            }));

            let reached_start = oldest_time
                .parse::<i64>()
                .ok()
                .map(|value| value <= start_time.timestamp_millis())
                .unwrap_or(true);
            if reached_start || page.len() < PAGE_LIMIT {
                break;
            }

            cursor = Some(oldest_time);
        }

        Ok(rows)
    }

    async fn fetch_mark_price_candles(
        &self,
        exchange_symbol: &str,
        bar: &str,
        start_time: DateTime<Utc>,
    ) -> AppResult<Vec<BlofinCandle>> {
        const PAGE_LIMIT: usize = 500;
        let limit = PAGE_LIMIT.to_string();
        let mut cursor = None::<String>;
        let mut rows = Vec::new();

        loop {
            let mut query = vec![
                ("instId", exchange_symbol),
                ("bar", bar),
                ("limit", limit.as_str()),
            ];
            if let Some(after) = cursor.as_deref() {
                query.push(("after", after));
            }

            let page: Vec<Vec<String>> = self
                .public_get("/api/v1/market/mark-price-candles", &query)
                .await?;
            if page.is_empty() {
                break;
            }

            let parsed_page = page
                .into_iter()
                .filter_map(|row| parse_blofin_candle_row(&row))
                .collect::<Vec<_>>();
            if parsed_page.is_empty() {
                break;
            }

            let oldest_time = parsed_page.last().map(|row| row.ts).unwrap_or_default();
            rows.extend(
                parsed_page
                    .iter()
                    .filter(|row| row.ts >= start_time.timestamp_millis())
                    .cloned(),
            );

            if oldest_time <= start_time.timestamp_millis() || parsed_page.len() < PAGE_LIMIT {
                break;
            }

            cursor = Some(oldest_time.to_string());
        }

        Ok(rows)
    }

    async fn estimate_public_position_funding(
        &self,
        exchange_symbol: &str,
        side: PositionSide,
        quantity: f64,
        contract_value: f64,
        opened_at: DateTime<Utc>,
        as_of: DateTime<Utc>,
    ) -> AppResult<PositionFundingEstimate> {
        let funding_rows = self
            .fetch_funding_rate_history(exchange_symbol, opened_at)
            .await?
            .into_iter()
            .filter(|row| {
                row.funding_time
                    .parse::<i64>()
                    .ok()
                    .map(|value| {
                        value >= opened_at.timestamp_millis() && value <= as_of.timestamp_millis()
                    })
                    .unwrap_or(false)
            })
            .collect::<Vec<_>>();
        if funding_rows.is_empty() {
            return Ok(PositionFundingEstimate {
                funding_paid: 0.0,
                settlements: 0,
                estimated: false,
                as_of,
            });
        }

        let funding_interval_ms = infer_funding_interval_ms(
            funding_rows
                .iter()
                .filter_map(|row| row.funding_time.parse::<i64>().ok()),
        )
        .unwrap_or(8 * 60 * 60 * 1000);
        let bar = blofin_bar_for_interval_ms(funding_interval_ms);
        let candles = self
            .fetch_mark_price_candles(exchange_symbol, bar, opened_at)
            .await?;
        let funding_paid = compute_funding_paid_from_samples(
            side,
            quantity,
            contract_value,
            funding_rows.iter().filter_map(|row| {
                Some(FundingSample {
                    funding_time: row.funding_time.parse::<i64>().ok()?,
                    funding_rate: parse_decimal(Some(row.funding_rate.as_str())).unwrap_or(0.0),
                })
            }),
            |sample_time| {
                resolve_candle_price(
                    candles.iter().map(|candle| CandleSample {
                        start_time: candle.ts,
                        end_time: candle.ts + funding_interval_ms - 1,
                        open_price: candle.open,
                        close_price: candle.close,
                    }),
                    sample_time,
                )
            },
        );

        Ok(PositionFundingEstimate {
            funding_paid,
            settlements: funding_rows.len(),
            estimated: false,
            as_of,
        })
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
                        log::warn!("prepview blofin mark-price poll failed: {error}");
                    }
                    Err(_) => {
                        log::warn!("prepview blofin mark-price poll timed out");
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

fn parse_blofin_candle_row(row: &[String]) -> Option<BlofinCandle> {
    let ts = row.first()?.parse::<i64>().ok()?;
    let open = parse_decimal(row.get(1).map(String::as_str))?;
    let close = parse_decimal(row.get(4).map(String::as_str))?;
    Some(BlofinCandle { ts, open, close })
}

fn quantity_step_from_decimals(decimals: u32) -> f64 {
    10_f64.powi(-(decimals as i32))
}

fn normalized_hyperliquid_dex(dex: &str) -> Option<String> {
    let normalized = dex.trim().to_lowercase();
    if normalized.is_empty() || normalized == "hl" {
        None
    } else {
        Some(normalized)
    }
}

fn requested_hyperliquid_dexes(symbols: &[String]) -> Vec<Option<String>> {
    let mut include_main = false;
    let mut requested = HashSet::<String>::new();

    for symbol in symbols {
        let exchange_symbol = hyperliquid_exchange_symbol(symbol);
        if let Some((dex, _)) = exchange_symbol.split_once(':') {
            if let Some(normalized) = normalized_hyperliquid_dex(dex) {
                requested.insert(normalized);
            } else {
                include_main = true;
            }
        } else if !exchange_symbol.is_empty() {
            include_main = true;
        }
    }

    let mut requested = requested.into_iter().collect::<Vec<_>>();
    requested.sort();

    let mut dexs = Vec::with_capacity(requested.len() + usize::from(include_main));
    if include_main {
        dexs.push(None);
    }
    dexs.extend(requested.into_iter().map(Some));
    dexs
}

#[derive(Clone, Copy)]
struct FundingSample {
    funding_time: i64,
    funding_rate: f64,
}

#[derive(Clone, Copy)]
struct CandleSample {
    start_time: i64,
    end_time: i64,
    open_price: f64,
    close_price: f64,
}

fn compute_funding_paid_from_samples<I, F>(
    side: PositionSide,
    quantity: f64,
    contract_value: f64,
    samples: I,
    price_at: F,
) -> f64
where
    I: IntoIterator<Item = FundingSample>,
    F: Fn(i64) -> Option<f64>,
{
    let side_multiplier = match side {
        PositionSide::Long => 1.0,
        PositionSide::Short => -1.0,
    };
    let token_size = quantity.abs() * contract_value.abs();

    samples.into_iter().fold(0.0, |total, sample| {
        let Some(price) = price_at(sample.funding_time).filter(|price| *price > 0.0) else {
            return total;
        };
        total + (side_multiplier * token_size * price.abs() * sample.funding_rate)
    })
}

fn resolve_candle_price<I>(candles: I, sample_time: i64) -> Option<f64>
where
    I: IntoIterator<Item = CandleSample>,
{
    let mut latest_before = None::<(i64, f64)>;

    for candle in candles {
        if candle.start_time <= sample_time && sample_time <= candle.end_time {
            if candle.open_price > 0.0 {
                return Some(candle.open_price);
            }
            if candle.close_price > 0.0 {
                return Some(candle.close_price);
            }
        }

        let candidate_price = if candle.close_price > 0.0 {
            Some(candle.close_price)
        } else if candle.open_price > 0.0 {
            Some(candle.open_price)
        } else {
            None
        };
        if candle.start_time <= sample_time {
            if let Some(price) = candidate_price {
                if latest_before
                    .as_ref()
                    .map(|(timestamp, _)| candle.start_time > *timestamp)
                    .unwrap_or(true)
                {
                    latest_before = Some((candle.start_time, price));
                }
            }
        }
    }

    latest_before.map(|(_, price)| price)
}

fn infer_funding_interval_ms<I>(times: I) -> Option<i64>
where
    I: IntoIterator<Item = i64>,
{
    let mut times = times.into_iter().collect::<Vec<_>>();
    times.sort_unstable();
    times.dedup();

    times
        .windows(2)
        .filter_map(|window| {
            let delta = window[1] - window[0];
            (delta > 0).then_some(delta)
        })
        .min()
}

fn blofin_bar_for_interval_ms(interval_ms: i64) -> &'static str {
    const HOUR_MS: i64 = 60 * 60 * 1000;
    if interval_ms <= HOUR_MS {
        "1H"
    } else if interval_ms <= 2 * HOUR_MS {
        "2H"
    } else if interval_ms <= 4 * HOUR_MS {
        "4H"
    } else if interval_ms <= 6 * HOUR_MS {
        "6H"
    } else if interval_ms <= 8 * HOUR_MS {
        "8H"
    } else if interval_ms <= 12 * HOUR_MS {
        "12H"
    } else {
        "1D"
    }
}

fn hyperliquid_spot_usdc_total(spot_state: &HyperliquidSpotClearinghouseState) -> Option<f64> {
    spot_state
        .balances
        .iter()
        .find(|balance| balance.token == 0 || balance.coin.eq_ignore_ascii_case("USDC"))
        .and_then(|balance| parse_decimal(Some(balance.total.as_str())))
}

fn hyperliquid_spot_usdc_available_after_maintenance(
    spot_state: &HyperliquidSpotClearinghouseState,
) -> Option<f64> {
    spot_state
        .token_to_available_after_maintenance
        .iter()
        .find(|(token, _)| *token == 0)
        .and_then(|(_, value)| parse_decimal(Some(value.as_str())))
}

fn insert_hyperliquid_dex(payload: &mut serde_json::Value, dex: Option<&str>) {
    if let Some(normalized) = dex.and_then(normalized_hyperliquid_dex) {
        payload
            .as_object_mut()
            .expect("hyperliquid payload should be an object")
            .insert("dex".to_string(), serde_json::Value::String(normalized));
    }
}

fn hyperliquid_exchange_symbol(raw: &str) -> String {
    raw.split('-').next().unwrap_or(raw).trim().to_uppercase()
}

fn hyperliquid_api_coin_symbol(raw: &str) -> String {
    let normalized = hyperliquid_exchange_symbol(raw);
    if let Some((dex, coin)) = normalized.split_once(':') {
        format!("{}:{}", dex.to_lowercase(), coin.to_uppercase())
    } else {
        normalized
    }
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

fn parse_hyperliquid_snapshot(
    spot_state: Option<&HyperliquidSpotClearinghouseState>,
    responses: &[HyperliquidClearinghouseState],
) -> AccountSnapshot {
    let equity = responses
        .iter()
        .map(|response| {
            parse_decimal(Some(response.margin_summary.account_value.as_str())).unwrap_or(0.0)
        })
        .sum();
    let available = responses
        .iter()
        .map(|response| parse_decimal(Some(response.withdrawable.as_str())).unwrap_or(0.0))
        .sum();

    if let Some(spot_state) = spot_state {
        let spot_total = hyperliquid_spot_usdc_total(spot_state);
        let spot_available = hyperliquid_spot_usdc_available_after_maintenance(spot_state);
        if let Some(total) = spot_total {
            return AccountSnapshot {
                wallet_balance: total,
                available_balance: spot_available.unwrap_or(available),
                snapshot_equity: total,
                currency: "USDC".into(),
            };
        }
    }

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
    let parsed = if let Some((_, table)) = asset.margin_table_id.and_then(|margin_table_id| {
        meta.margin_tables.as_ref().and_then(|margin_tables| {
            margin_tables
                .iter()
                .find(|(table_id, _)| *table_id == margin_table_id)
        })
    }) {
        parse_hyperliquid_margin_tiers(&table.margin_tiers)
    } else {
        // HIP-3 DEX metadata can expose per-asset max leverage while returning an incomplete
        // marginTables set. Fall back to a single explicit tier from the asset's live max leverage
        // instead of blocking manual portfolio entry.
        vec![(0, 0.0, 1.0 / (asset.max_leverage * 2.0), asset.max_leverage)]
    };
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

fn parse_hyperliquid_margin_tiers(tiers: &[HyperliquidMarginTier]) -> Vec<(usize, f64, f64, f64)> {
    tiers
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
        .collect()
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

#[derive(Debug, Deserialize)]
struct HyperliquidFundingHistoryPoint {
    #[allow(dead_code)]
    coin: String,
    #[serde(rename = "fundingRate")]
    funding_rate: String,
    time: i64,
}

#[derive(Debug, Deserialize)]
struct HyperliquidCandle {
    #[serde(rename = "t")]
    t: i64,
    #[serde(rename = "T")]
    t_end: i64,
    #[serde(rename = "o")]
    open: String,
    #[serde(rename = "c")]
    close: String,
}

#[derive(Debug, Deserialize)]
struct HyperliquidSpotClearinghouseState {
    balances: Vec<HyperliquidSpotBalance>,
    #[serde(rename = "tokenToAvailableAfterMaintenance", default)]
    token_to_available_after_maintenance: Vec<(u64, String)>,
}

#[derive(Debug, Deserialize)]
struct HyperliquidSpotBalance {
    coin: String,
    token: u64,
    total: String,
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

type HyperliquidFundingVenue = (String, Option<HyperliquidFundingDetails>);
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

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct BlofinFundingRateRow {
    inst_id: String,
    funding_rate: String,
    funding_time: String,
}

#[derive(Debug, Clone)]
struct BlofinCandle {
    ts: i64,
    open: f64,
    close: f64,
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

        let snapshot = parse_hyperliquid_snapshot(None, std::slice::from_ref(&state));
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
    fn computes_public_funding_paid_with_correct_long_short_signs() {
        let samples = [
            FundingSample {
                funding_time: 1,
                funding_rate: 0.01,
            },
            FundingSample {
                funding_time: 2,
                funding_rate: -0.02,
            },
        ];
        let candles = [
            CandleSample {
                start_time: 0,
                end_time: 1,
                open_price: 100.0,
                close_price: 101.0,
            },
            CandleSample {
                start_time: 2,
                end_time: 3,
                open_price: 110.0,
                close_price: 111.0,
            },
        ];

        let long_paid = compute_funding_paid_from_samples(
            PositionSide::Long,
            2.0,
            1.0,
            samples,
            |sample_time| resolve_candle_price(candles, sample_time),
        );
        let short_paid = compute_funding_paid_from_samples(
            PositionSide::Short,
            2.0,
            1.0,
            samples,
            |sample_time| resolve_candle_price(candles, sample_time),
        );

        assert_close(long_paid, -2.4);
        assert_close(short_paid, 2.4);
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

    #[test]
    fn normalizes_hyperliquid_hip3_dex_names_for_info_requests() {
        assert_eq!(normalized_hyperliquid_dex("XYZ").as_deref(), Some("xyz"));
        assert_eq!(normalized_hyperliquid_dex(" xyz ").as_deref(), Some("xyz"));
        assert_eq!(normalized_hyperliquid_dex("HL"), None);
    }

    #[test]
    fn falls_back_to_aggregated_perp_equity_when_spot_state_is_missing() {
        let main_state = serde_json::from_str::<HyperliquidClearinghouseState>(include_str!(
            "fixtures/hyperliquid_clearinghouse_state.json"
        ))
        .expect("state fixture should parse");
        let xyz_state =
            serde_json::from_value::<HyperliquidClearinghouseState>(serde_json::json!({
                "marginSummary": {
                    "accountValue": "3000.0",
                    "totalNtlPos": "0.0",
                    "totalRawUsd": "3000.0",
                    "totalMarginUsed": "0.0"
                },
                "withdrawable": "2500.0",
                "assetPositions": [],
            "time": 1775147868632_i64
            }))
            .expect("xyz state should parse");

        let snapshot = parse_hyperliquid_snapshot(None, &[main_state, xyz_state]);

        assert_close(snapshot.wallet_balance, 4956.393779);
        assert_close(snapshot.available_balance, 2965.260446);
        assert_close(snapshot.snapshot_equity, 4956.393779);
        assert_eq!(snapshot.currency, "USDC");
    }

    #[test]
    fn prefers_spot_collateral_totals_for_hyperliquid_snapshot() {
        let perp_state = serde_json::from_str::<HyperliquidClearinghouseState>(include_str!(
            "fixtures/hyperliquid_clearinghouse_state.json"
        ))
        .expect("state fixture should parse");
        let xyz_state =
            serde_json::from_value::<HyperliquidClearinghouseState>(serde_json::json!({
                "marginSummary": {
                    "accountValue": "433.287301",
                    "totalNtlPos": "10823.25",
                    "totalRawUsd": "-10389.962699",
                    "totalMarginUsed": "541.1625"
                },
                "withdrawable": "0.0",
                "assetPositions": [],
                "time": 1775147868632_i64
            }))
            .expect("xyz state should parse");
        let spot_state =
            serde_json::from_value::<HyperliquidSpotClearinghouseState>(serde_json::json!({
                "balances": [
                    {
                        "coin": "USDC",
                        "token": 0,
                        "total": "5607.074967"
                    }
                ],
                "tokenToAvailableAfterMaintenance": [
                    [0, "4867.689967"]
                ]
            }))
            .expect("spot state should parse");

        let snapshot = parse_hyperliquid_snapshot(Some(&spot_state), &[perp_state, xyz_state]);

        assert_close(snapshot.wallet_balance, 5607.074967);
        assert_close(snapshot.available_balance, 4867.689967);
        assert_close(snapshot.snapshot_equity, 5607.074967);
        assert_eq!(snapshot.currency, "USDC");
    }

    #[test]
    fn includes_xyz_positions_when_hyperliquid_states_are_merged() {
        let main_state = serde_json::from_str::<HyperliquidClearinghouseState>(include_str!(
            "fixtures/hyperliquid_clearinghouse_state.json"
        ))
        .expect("state fixture should parse");
        let main_mids = serde_json::from_str::<serde_json::Map<String, serde_json::Value>>(
            include_str!("fixtures/hyperliquid_all_mids.json"),
        )
        .expect("mids fixture should parse");
        let xyz_state =
            serde_json::from_value::<HyperliquidClearinghouseState>(serde_json::json!({
                "marginSummary": {
                    "accountValue": "3000.0",
                    "totalNtlPos": "6950.325",
                    "totalRawUsd": "3000.0",
                    "totalMarginUsed": "695.0325"
                },
                "withdrawable": "2500.0",
                "assetPositions": [
                    {
                        "position": {
                            "coin": "xyz:GOLD",
                            "szi": "1.5",
                            "entryPx": "4600.0",
                            "liquidationPx": "3900.0",
                            "marginUsed": "695.0325",
                            "leverage": {
                                "type": "cross",
                                "value": 10
                            },
                            "unrealizedPnl": "50.325",
                            "cumFunding": {
                                "sinceOpen": "-2.5"
                            }
                        }
                    }
                ],
            "time": 1775147868632_i64
            }))
            .expect("xyz state should parse");
        let xyz_mids = serde_json::from_value::<serde_json::Map<String, serde_json::Value>>(
            serde_json::json!({
                "xyz:GOLD": "4633.55"
            }),
        )
        .expect("xyz mids should parse");
        let connector = HyperliquidConnector::new(test_client());

        let positions = [
            parse_hyperliquid_positions(&main_state, &main_mids, &connector),
            parse_hyperliquid_positions(&xyz_state, &xyz_mids, &connector),
        ]
        .concat();

        assert_eq!(positions.len(), 2);
        assert_eq!(positions[1].exchange_symbol, "XYZ:GOLD");
        assert_eq!(positions[1].symbol, "XYZ:GOLD-PERP");
        assert_eq!(positions[1].side, PositionSide::Long);
        assert_eq!(positions[1].margin_mode, Some(MarginMode::Cross));
        assert_close(
            positions[1].mark_price.expect("mark price should exist"),
            4633.55,
        );
    }

    #[test]
    fn falls_back_to_asset_max_leverage_when_hip3_margin_table_is_missing() {
        let meta = serde_json::from_value::<HyperliquidMeta>(serde_json::json!({
            "universe": [
                {
                    "szDecimals": 4,
                    "name": "xyz:GOLD",
                    "maxLeverage": 25,
                    "marginTableId": 25
                }
            ],
            "marginTables": [
                [
                    50,
                    {
                        "description": "",
                        "marginTiers": [
                            {
                                "lowerBound": "0.0",
                                "maxLeverage": 50
                            }
                        ]
                    }
                ]
            ]
        }))
        .expect("meta fixture should parse");

        let tiers = parse_hyperliquid_risk_tiers("XYZ:GOLD", &meta)
            .expect("risk tiers should fall back to asset max leverage");

        assert_eq!(tiers.len(), 1);
        assert_eq!(tiers[0].exchange_symbol, "XYZ:GOLD");
        assert_close(tiers[0].maintenance_margin_rate, 0.02);
        assert_close(tiers[0].max_leverage, 25.0);
    }
}
