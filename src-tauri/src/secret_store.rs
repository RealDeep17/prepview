use std::{
    fs,
    path::{Path, PathBuf},
};

#[cfg(unix)]
use std::os::unix::fs::PermissionsExt;

use uuid::Uuid;

use crate::{credentials::StoredCredentials, error::AppResult};

pub fn ensure_secrets_dir(path: &Path) -> AppResult<()> {
    fs::create_dir_all(path)?;
    set_secret_dir_permissions(path)?;
    Ok(())
}

pub fn database_key(secrets_dir: &Path, database_path: &Path) -> AppResult<String> {
    ensure_secrets_dir(secrets_dir)?;
    let key_path = secrets_dir.join("database-key.txt");

    if let Some(existing) = read_secret_file(&key_path)? {
        return Ok(existing);
    }

    if database_path.exists() {
        backup_legacy_database(database_path)?;
    }

    let key = format!("prepview-{}", Uuid::new_v4());
    write_secret_file(&key_path, &key)?;
    Ok(key)
}

pub fn store_live_credentials(
    secrets_dir: &Path,
    account_id: &str,
    credentials: &StoredCredentials,
) -> AppResult<()> {
    ensure_secrets_dir(secrets_dir)?;
    let payload = serde_json::to_string(credentials)?;
    write_secret_file(&live_credentials_path(secrets_dir, account_id), &payload)
}

pub fn load_live_credentials(secrets_dir: &Path, account_id: &str) -> AppResult<StoredCredentials> {
    ensure_secrets_dir(secrets_dir)?;
    let path = live_credentials_path(secrets_dir, account_id);
    let raw = read_secret_file(&path)?.ok_or_else(|| {
        crate::error::AppError::message("live credentials were not found locally")
    })?;
    Ok(serde_json::from_str(&raw)?)
}

pub fn delete_live_credentials(secrets_dir: &Path, account_id: &str) -> AppResult<()> {
    ensure_secrets_dir(secrets_dir)?;
    let path = live_credentials_path(secrets_dir, account_id);
    if path.exists() {
        fs::remove_file(path)?;
    }
    Ok(())
}

fn live_credentials_path(secrets_dir: &Path, account_id: &str) -> PathBuf {
    secrets_dir.join(format!("live-account-{account_id}.json"))
}

fn read_secret_file(path: &Path) -> AppResult<Option<String>> {
    if !path.exists() {
        return Ok(None);
    }

    let raw = fs::read_to_string(path)?;
    let trimmed = raw.trim().to_string();
    if trimmed.is_empty() {
        return Ok(None);
    }

    Ok(Some(trimmed))
}

fn write_secret_file(path: &Path, contents: &str) -> AppResult<()> {
    fs::write(path, contents)?;
    set_secret_permissions(path)?;
    Ok(())
}

fn set_secret_permissions(path: &Path) -> AppResult<()> {
    #[cfg(unix)]
    {
        let permissions = fs::Permissions::from_mode(0o600);
        fs::set_permissions(path, permissions)?;
    }

    Ok(())
}

fn set_secret_dir_permissions(path: &Path) -> AppResult<()> {
    #[cfg(unix)]
    {
        let permissions = fs::Permissions::from_mode(0o700);
        fs::set_permissions(path, permissions)?;
    }

    Ok(())
}

fn backup_legacy_database(database_path: &Path) -> AppResult<()> {
    let backup_path = database_path.with_extension(format!(
        "legacy-backup-{}",
        chrono::Utc::now().format("%Y%m%d%H%M%S")
    ));
    fs::rename(database_path, backup_path)?;
    Ok(())
}
