use std::{
    net::{IpAddr, Ipv4Addr, SocketAddr, UdpSocket},
    sync::Arc,
};

use axum::{
    extract::{
        ws::{Message, WebSocket, WebSocketUpgrade},
        Query, State,
    },
    http::{header, HeaderMap, StatusCode},
    response::IntoResponse,
    routing::get,
    Json, Router,
};
use chrono::{DateTime, Utc};
use futures_util::StreamExt;
use serde::Deserialize;
use tokio::{
    net::TcpListener,
    sync::{broadcast, oneshot},
};
use crate::{
    domain::{
        ClosedTradeQueryInput, ExchangeKind, LanStatus, PositionEventKind,
        PositionEventQueryInput,
    },
    error::AppResult,
    AppServices,
};

const DEFAULT_PORT: u16 = 46666;

#[derive(Default)]
pub struct LanProjectionManager {
    status: LanStatus,
    shutdown: Option<oneshot::Sender<()>>,
}

#[derive(Clone)]
struct LanServerState {
    services: Arc<AppServices>,
    passphrase: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PositionEventQuery {
    account_id: Option<String>,
    exchange: Option<ExchangeKind>,
    event_kind: Option<PositionEventKind>,
    symbol: Option<String>,
    started_at: Option<String>,
    ended_at: Option<String>,
    limit: Option<usize>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ClosedTradeQuery {
    account_id: Option<String>,
    exchange: Option<ExchangeKind>,
    symbol: Option<String>,
    started_at: Option<String>,
    ended_at: Option<String>,
    limit: Option<usize>,
}

impl LanProjectionManager {
    pub fn status(&self) -> LanStatus {
        self.status.clone()
    }

    pub async fn start_server(
        services: Arc<AppServices>,
        expose_to_lan: bool,
        passphrase: String,
    ) -> AppResult<(LanStatus, oneshot::Sender<()>)> {
        let bind_address = projection_bind_address(expose_to_lan);
        let listener = TcpListener::bind(bind_address).await?;
        let public_host = projection_public_host(expose_to_lan);
        let public_url = build_public_url(public_host);
        let server_state = LanServerState {
            services,
            passphrase,
        };

        let router = Router::new()
            .route("/api/health", get(api_health))
            .route("/api/portfolio/summary", get(api_summary))
            .route("/api/accounts", get(api_accounts))
            .route("/api/positions", get(api_positions))
            .route("/api/position-events", get(api_position_events))
            .route("/api/closed-trades", get(api_closed_trades))
            .route("/api/exposure", get(api_exposure))
            .route("/api/performance", get(api_performance))
            .route("/ws", get(ws_feed))
            .with_state(server_state);

        let (shutdown, shutdown_rx) = oneshot::channel::<()>();
        tokio::spawn(async move {
            let server = axum::serve(listener, router).with_graceful_shutdown(async move {
                let _ = shutdown_rx.await;
            });
            if let Err(error) = server.await {
                log::error!("prepview lan projection failed: {error}");
            }
        });

        let status = LanStatus {
            enabled: true,
            expose_to_lan,
            bind_address: Some(bind_address.to_string()),
            public_url: Some(public_url),
            passphrase_configured: true,
        };
        Ok((status, shutdown))
    }

    pub fn enable_with(&mut self, status: LanStatus, shutdown: oneshot::Sender<()>) -> LanStatus {
        self.shutdown = Some(shutdown);
        self.status = status;
        self.status.clone()
    }

    pub fn disable(&mut self) -> LanStatus {
        if let Some(shutdown) = self.shutdown.take() {
            let _ = shutdown.send(());
        }
        self.status = LanStatus::default();
        self.status.clone()
    }
}

fn detect_lan_ip() -> Option<IpAddr> {
    let socket = UdpSocket::bind("0.0.0.0:0").ok()?;
    socket.connect("8.8.8.8:80").ok()?;
    socket.local_addr().ok().map(|address| address.ip())
}

fn projection_bind_address(expose_to_lan: bool) -> SocketAddr {
    let ip = if expose_to_lan {
        IpAddr::V4(Ipv4Addr::UNSPECIFIED)
    } else {
        IpAddr::V4(Ipv4Addr::LOCALHOST)
    };
    SocketAddr::new(ip, DEFAULT_PORT)
}

fn projection_public_host(expose_to_lan: bool) -> IpAddr {
    if expose_to_lan {
        detect_lan_ip().unwrap_or(IpAddr::V4(Ipv4Addr::LOCALHOST))
    } else {
        IpAddr::V4(Ipv4Addr::LOCALHOST)
    }
}

fn build_public_url(host: IpAddr) -> String {
    format!("http://{}:{}", host, DEFAULT_PORT)
}

async fn api_health() -> Json<serde_json::Value> {
    Json(serde_json::json!({
        "status": "ok",
        "product": "prepview",
    }))
}

async fn api_summary(
    State(state): State<LanServerState>,
    headers: HeaderMap,
) -> Result<Json<serde_json::Value>, StatusCode> {
    validate_authorization(&state, &headers)?;
    let snapshot = state
        .services
        .snapshot()
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    Ok(Json(
        serde_json::to_value(snapshot.summary).map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?,
    ))
}

async fn api_accounts(
    State(state): State<LanServerState>,
    headers: HeaderMap,
) -> Result<Json<serde_json::Value>, StatusCode> {
    validate_authorization(&state, &headers)?;
    let snapshot = state
        .services
        .snapshot()
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    Ok(Json(
        serde_json::to_value(snapshot.accounts).map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?,
    ))
}

async fn api_positions(
    State(state): State<LanServerState>,
    headers: HeaderMap,
) -> Result<Json<serde_json::Value>, StatusCode> {
    validate_authorization(&state, &headers)?;
    let snapshot = state
        .services
        .snapshot()
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    Ok(Json(
        serde_json::to_value(snapshot.positions).map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?,
    ))
}

async fn api_position_events(
    State(state): State<LanServerState>,
    headers: HeaderMap,
    Query(query): Query<PositionEventQuery>,
) -> Result<Json<serde_json::Value>, StatusCode> {
    validate_authorization(&state, &headers)?;
    let started_at = parse_optional_timestamp(query.started_at)?;
    let ended_at = parse_optional_timestamp(query.ended_at)?;
    if let (Some(started_at), Some(ended_at)) = (started_at.as_ref(), ended_at.as_ref()) {
        if ended_at < started_at {
            return Err(StatusCode::BAD_REQUEST);
        }
    }
    let repository = state
        .services
        .repository
        .lock()
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    let rows = repository
        .query_position_events(PositionEventQueryInput {
            account_id: query.account_id,
            exchange: query.exchange,
            event_kind: query.event_kind,
            symbol: query.symbol,
            started_at,
            ended_at,
            limit: Some(query.limit.unwrap_or(128).min(512)),
        })
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    Ok(Json(
        serde_json::to_value(rows).map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?,
    ))
}

async fn api_exposure(
    State(state): State<LanServerState>,
    headers: HeaderMap,
) -> Result<Json<serde_json::Value>, StatusCode> {
    validate_authorization(&state, &headers)?;
    let snapshot = state
        .services
        .snapshot()
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    Ok(Json(
        serde_json::to_value(snapshot.exposure).map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?,
    ))
}

async fn api_closed_trades(
    State(state): State<LanServerState>,
    headers: HeaderMap,
    Query(query): Query<ClosedTradeQuery>,
) -> Result<Json<serde_json::Value>, StatusCode> {
    validate_authorization(&state, &headers)?;
    let started_at = parse_optional_timestamp(query.started_at)?;
    let ended_at = parse_optional_timestamp(query.ended_at)?;
    if let (Some(started_at), Some(ended_at)) = (started_at.as_ref(), ended_at.as_ref()) {
        if ended_at < started_at {
            return Err(StatusCode::BAD_REQUEST);
        }
    }
    let repository = state
        .services
        .repository
        .lock()
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    let rows = repository
        .query_closed_trades(ClosedTradeQueryInput {
            account_id: query.account_id,
            exchange: query.exchange,
            symbol: query.symbol,
            started_at,
            ended_at,
            limit: Some(query.limit.unwrap_or(128).min(512)),
        })
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    Ok(Json(
        serde_json::to_value(rows).map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?,
    ))
}

async fn api_performance(
    State(state): State<LanServerState>,
    headers: HeaderMap,
) -> Result<Json<serde_json::Value>, StatusCode> {
    validate_authorization(&state, &headers)?;
    let snapshot = state
        .services
        .snapshot()
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    Ok(Json(
        serde_json::to_value(snapshot.performance)
            .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?,
    ))
}

async fn ws_feed(
    State(state): State<LanServerState>,
    headers: HeaderMap,
    ws: WebSocketUpgrade,
) -> Result<impl IntoResponse, StatusCode> {
    validate_authorization(&state, &headers)?;
    Ok(ws.on_upgrade(move |socket| ws_client(socket, state.services.clone())))
}

async fn ws_client(mut socket: WebSocket, services: Arc<AppServices>) {
    if let Ok(snapshot) = services.snapshot() {
        let _ = socket
            .send(Message::Text(
                serde_json::to_string(&snapshot)
                    .unwrap_or_else(|_| "{}".into())
                    .into(),
            ))
            .await;
    }

    let mut receiver = services.broadcaster.subscribe();

    loop {
        tokio::select! {
            maybe_message = receiver.recv() => {
                match maybe_message {
                    Ok(payload) => {
                        if socket.send(Message::Text(payload.into())).await.is_err() {
                            break;
                        }
                    }
                    Err(broadcast::error::RecvError::Closed) => break,
                    Err(broadcast::error::RecvError::Lagged(_)) => continue,
                }
            }
            inbound = socket.next() => {
                match inbound {
                    Some(Ok(Message::Close(_))) | None => break,
                    Some(Ok(_)) => continue,
                    Some(Err(_)) => break,
                }
            }
        }
    }
}

fn validate_authorization(state: &LanServerState, headers: &HeaderMap) -> Result<(), StatusCode> {
    let value = headers
        .get(header::AUTHORIZATION)
        .and_then(|header_value| header_value.to_str().ok())
        .ok_or(StatusCode::UNAUTHORIZED)?;
    let (scheme, credentials) = value.split_once(' ').ok_or(StatusCode::UNAUTHORIZED)?;
    if !scheme.eq_ignore_ascii_case("bearer") {
        return Err(StatusCode::UNAUTHORIZED);
    }
    if credentials.trim() == state.passphrase {
        Ok(())
    } else {
        Err(StatusCode::UNAUTHORIZED)
    }
}

fn parse_optional_timestamp(raw: Option<String>) -> Result<Option<DateTime<Utc>>, StatusCode> {
    let Some(raw) = raw.map(|value| value.trim().to_string()) else {
        return Ok(None);
    };
    if raw.is_empty() {
        return Ok(None);
    }

    DateTime::parse_from_rfc3339(&raw)
        .map(|value| Some(value.with_timezone(&Utc)))
        .map_err(|_| StatusCode::BAD_REQUEST)
}

#[cfg(test)]
mod tests {
    use super::{build_public_url, projection_bind_address, projection_public_host, DEFAULT_PORT};
    use std::net::{IpAddr, Ipv4Addr, SocketAddr};

    #[test]
    fn localhost_projection_binds_to_loopback() {
        assert_eq!(
            projection_bind_address(false),
            SocketAddr::new(IpAddr::V4(Ipv4Addr::LOCALHOST), DEFAULT_PORT)
        );
        assert_eq!(
            projection_public_host(false),
            IpAddr::V4(Ipv4Addr::LOCALHOST)
        );
    }

    #[test]
    fn public_url_uses_requested_host() {
        assert_eq!(
            build_public_url(IpAddr::V4(Ipv4Addr::LOCALHOST)),
            format!("http://127.0.0.1:{DEFAULT_PORT}")
        );
    }
}
