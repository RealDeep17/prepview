use std::{fmt::Display, io};

use thiserror::Error;

#[derive(Debug, Error)]
pub enum AppError {
    #[error("{0}")]
    Message(String),
    #[error("io error: {0}")]
    Io(#[from] io::Error),
    #[error("sqlite error: {0}")]
    Sqlite(#[from] rusqlite::Error),
    #[error("serde error: {0}")]
    Serde(#[from] serde_json::Error),
    #[error("request error: {0}")]
    Request(#[from] reqwest::Error),
    #[error("tauri error: {0}")]
    Tauri(#[from] tauri::Error),
    #[error("state poisoned: {0}")]
    StatePoisoned(&'static str),
}

impl AppError {
    pub fn message(message: impl Into<String>) -> Self {
        Self::Message(message.into())
    }
}

pub type AppResult<T> = Result<T, AppError>;

pub fn command_result<T>(result: AppResult<T>) -> Result<T, String> {
    result.map_err(|error| error.to_string())
}

pub fn invalid_input(message: impl Display) -> AppError {
    AppError::message(message.to_string())
}
