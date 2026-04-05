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

pub fn store_lan_passphrase(secrets_dir: &Path, passphrase: &str) -> AppResult<()> {
    ensure_secrets_dir(secrets_dir)?;
    write_secret_file(&lan_passphrase_path(secrets_dir), passphrase.trim())
}

pub fn load_lan_passphrase(secrets_dir: &Path) -> AppResult<String> {
    ensure_secrets_dir(secrets_dir)?;
    read_secret_file(&lan_passphrase_path(secrets_dir))?.ok_or_else(|| {
        crate::error::AppError::message("set a LAN passphrase before enabling LAN projection")
    })
}

pub fn has_lan_passphrase(secrets_dir: &Path) -> AppResult<bool> {
    ensure_secrets_dir(secrets_dir)?;
    Ok(read_secret_file(&lan_passphrase_path(secrets_dir))?.is_some())
}

pub fn clear_runtime_secrets(secrets_dir: &Path) -> AppResult<()> {
    ensure_secrets_dir(secrets_dir)?;
    for entry in fs::read_dir(secrets_dir)? {
        let entry = entry?;
        let path = entry.path();
        if !path.is_file() {
            continue;
        }

        let Some(name) = entry.file_name().to_str().map(str::to_string) else {
            continue;
        };
        let is_live_credentials = name.starts_with("live-account-") && name.ends_with(".json");
        let is_lan_passphrase = name == "lan-passphrase.txt";
        if is_live_credentials || is_lan_passphrase {
            fs::remove_file(path)?;
        }
    }
    Ok(())
}

fn lan_passphrase_path(secrets_dir: &Path) -> PathBuf {
    secrets_dir.join("lan-passphrase.txt")
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn clears_runtime_secrets_without_removing_database_key() {
        let root = std::env::temp_dir().join(format!("prepview-secrets-test-{}", Uuid::new_v4()));
        let secrets_dir = root.join("secrets");

        ensure_secrets_dir(&secrets_dir).expect("secrets directory should exist");
        write_secret_file(&secrets_dir.join("database-key.txt"), "db-key")
            .expect("database key should write");
        write_secret_file(&secrets_dir.join("live-account-a.json"), "{}")
            .expect("live credentials should write");
        write_secret_file(
            &secrets_dir.join("lan-passphrase.txt"),
            "very-secret-passphrase",
        )
        .expect("lan passphrase should write");
        write_secret_file(&secrets_dir.join("notes.txt"), "keep")
            .expect("unrelated file should write");

        clear_runtime_secrets(&secrets_dir).expect("runtime secrets should clear");

        assert!(secrets_dir.join("database-key.txt").exists());
        assert!(!secrets_dir.join("live-account-a.json").exists());
        assert!(!secrets_dir.join("lan-passphrase.txt").exists());
        assert!(secrets_dir.join("notes.txt").exists());

        let _ = fs::remove_dir_all(root);
    }
}
