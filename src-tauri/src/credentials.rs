use serde::{Deserialize, Serialize};

use crate::{
    domain::{CreateLiveAccountInput, ExchangeKind},
    error::{invalid_input, AppResult},
};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum StoredCredentials {
    Blofin {
        api_key: String,
        api_secret: String,
        api_passphrase: String,
    },
    Hyperliquid {
        wallet_address: String,
    },
}

impl StoredCredentials {
    pub fn exchange(&self) -> ExchangeKind {
        match self {
            Self::Blofin { .. } => ExchangeKind::Blofin,
            Self::Hyperliquid { .. } => ExchangeKind::Hyperliquid,
        }
    }
}

pub fn build_credentials(input: &CreateLiveAccountInput) -> AppResult<StoredCredentials> {
    match input.exchange {
        ExchangeKind::Blofin => Ok(StoredCredentials::Blofin {
            api_key: required_field(input.api_key.clone(), "BloFin API key")?,
            api_secret: required_field(input.api_secret.clone(), "BloFin API secret")?,
            api_passphrase: required_field(input.api_passphrase.clone(), "BloFin API passphrase")?,
        }),
        ExchangeKind::Hyperliquid => Ok(StoredCredentials::Hyperliquid {
            wallet_address: required_field(
                input.wallet_address.clone(),
                "Hyperliquid wallet address",
            )?,
        }),
        _ => Err(invalid_input(
            "live account creation only supports BloFin and Hyperliquid",
        )),
    }
}

fn required_field(value: Option<String>, label: &str) -> AppResult<String> {
    let value = value
        .map(|field| field.trim().to_string())
        .filter(|field| !field.is_empty())
        .ok_or_else(|| invalid_input(format!("{label} is required")))?;
    Ok(value)
}
