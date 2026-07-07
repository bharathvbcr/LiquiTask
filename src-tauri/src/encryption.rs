//! AES-256-GCM encryption for on-disk storage with keys held in the OS keychain.

use aes_gcm::{
    aead::{Aead, KeyInit},
    Aes256Gcm, Nonce,
};
use base64::{engine::general_purpose::STANDARD as BASE64, Engine};
use rand::RngCore;
use serde::Serialize;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use crate::secure_key_store::{
    biometric_available, create_and_store_data_key, delete_data_key, keychain_available,
    load_data_key_secure, KEY_LEN,
};

pub const ENCRYPTION_MAGIC: &[u8] = b"LTENC1";
const NONCE_LEN: usize = 12;

const META_FILE_NAME: &str = "encryption.meta.json";

static SESSION_KEY: Mutex<Option<[u8; KEY_LEN]>> = Mutex::new(None);

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EncryptionStatus {
    pub enabled: bool,
    pub keychain_available: bool,
    pub biometric_available: bool,
    pub unlocked: bool,
}

#[derive(serde::Serialize, serde::Deserialize)]
pub struct EncryptionMeta {
    pub enabled: bool,
    version: u32,
}

pub fn meta_path(app_data_dir: &Path) -> PathBuf {
    app_data_dir.join(META_FILE_NAME)
}

pub fn read_meta(app_data_dir: &Path) -> Option<EncryptionMeta> {
    let raw = fs::read_to_string(meta_path(app_data_dir)).ok()?;
    serde_json::from_str(&raw).ok()
}

pub fn write_meta(app_data_dir: &Path, enabled: bool) -> Result<(), String> {
    if let Some(parent) = app_data_dir.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("Failed to create app data dir: {e}"))?;
    }
    fs::create_dir_all(app_data_dir).map_err(|e| format!("Failed to create app data dir: {e}"))?;
    let meta = EncryptionMeta {
        enabled,
        version: 1,
    };
    let serialised =
        serde_json::to_string_pretty(&meta).map_err(|e| format!("Failed to serialise meta: {e}"))?;
    fs::write(meta_path(app_data_dir), serialised)
        .map_err(|e| format!("Failed to write encryption meta: {e}"))
}

pub fn encryption_status(app_data_dir: &Path, storage_bytes: Option<&[u8]>) -> EncryptionStatus {
    let enabled = read_meta(app_data_dir)
        .map(|m| m.enabled)
        .unwrap_or(false)
        || storage_bytes
            .map(|bytes| bytes.starts_with(ENCRYPTION_MAGIC))
            .unwrap_or(false);

    EncryptionStatus {
        enabled,
        keychain_available: keychain_available(),
        biometric_available: biometric_available(),
        unlocked: is_unlocked(),
    }
}

pub fn is_unlocked() -> bool {
    SESSION_KEY
        .lock()
        .map(|guard| guard.is_some())
        .unwrap_or(false)
}

pub fn unlock_encryption() -> Result<(), String> {
    let key = load_data_key_secure()?;
    if let Ok(mut guard) = SESSION_KEY.lock() {
        *guard = Some(key);
    }
    Ok(())
}

pub fn lock_encryption() {
    if let Ok(mut guard) = SESSION_KEY.lock() {
        *guard = None;
    }
}

pub fn is_encrypted_payload(bytes: &[u8]) -> bool {
    bytes.starts_with(ENCRYPTION_MAGIC)
}

pub fn encrypt_bytes(plaintext: &[u8]) -> Result<Vec<u8>, String> {
    let key = load_data_key()?;
    let cipher = Aes256Gcm::new_from_slice(&key).map_err(|e| format!("Invalid key: {e}"))?;

    let mut nonce_bytes = [0u8; NONCE_LEN];
    rand::thread_rng().fill_bytes(&mut nonce_bytes);
    let nonce = Nonce::from_slice(&nonce_bytes);

    let ciphertext = cipher
        .encrypt(nonce, plaintext)
        .map_err(|e| format!("Encryption failed: {e}"))?;

    let mut out = Vec::with_capacity(ENCRYPTION_MAGIC.len() + NONCE_LEN + ciphertext.len());
    out.extend_from_slice(ENCRYPTION_MAGIC);
    out.extend_from_slice(&nonce_bytes);
    out.extend_from_slice(&ciphertext);
    Ok(out)
}

pub fn decrypt_bytes(payload: &[u8]) -> Result<Vec<u8>, String> {
    if !payload.starts_with(ENCRYPTION_MAGIC) {
        return Err("Payload is not encrypted".to_string());
    }

    let rest = &payload[ENCRYPTION_MAGIC.len()..];
    if rest.len() < NONCE_LEN + 16 {
        return Err("Encrypted payload is too short".to_string());
    }

    let (nonce_bytes, ciphertext) = rest.split_at(NONCE_LEN);
    let key = load_data_key()?;
    let cipher = Aes256Gcm::new_from_slice(&key).map_err(|e| format!("Invalid key: {e}"))?;
    let nonce = Nonce::from_slice(nonce_bytes);

    cipher
        .decrypt(nonce, ciphertext)
        .map_err(|e| format!("Decryption failed: {e}"))
}

pub fn enable_encryption(app_data_dir: &Path, plaintext_storage: &[u8]) -> Result<Vec<u8>, String> {
    let _ = get_or_create_data_key()?;
    write_meta(app_data_dir, true)?;
    encrypt_bytes(plaintext_storage)
}

pub fn disable_encryption_key() -> Result<(), String> {
    lock_encryption();
    delete_data_key()
}

pub fn encrypt_to_envelope(plaintext: &[u8]) -> Result<String, String> {
    let encrypted = encrypt_bytes(plaintext)?;
    Ok(format!("LTENC1:{}", BASE64.encode(encrypted)))
}

pub fn decrypt_from_envelope(envelope: &str) -> Result<Vec<u8>, String> {
    let encoded = envelope
        .strip_prefix("LTENC1:")
        .ok_or_else(|| "Value is not an encrypted envelope".to_string())?;
    let bytes = BASE64
        .decode(encoded.trim())
        .map_err(|e| format!("Invalid encrypted envelope: {e}"))?;
    decrypt_bytes(&bytes)
}

pub fn storage_opaque_key(store_name: &str, logical_id: &str) -> Result<String, String> {
    use hmac::{Hmac, Mac};
    use sha2::Sha256;

    let key = load_data_key()?;
    let mut mac = <Hmac<Sha256> as Mac>::new_from_slice(&key)
        .map_err(|e| format!("Invalid HMAC key: {e}"))?;
    mac.update(b"liquitask-id-v1");
    mac.update(&[0]);
    mac.update(store_name.as_bytes());
    mac.update(&[0]);
    mac.update(logical_id.as_bytes());
    Ok(BASE64.encode(mac.finalize().into_bytes()))
}

fn get_or_create_data_key() -> Result<[u8; KEY_LEN], String> {
    if let Ok(guard) = SESSION_KEY.lock() {
        if let Some(key) = *guard {
            return Ok(key);
        }
    }

    match load_data_key_secure() {
        Ok(key) => {
            if let Ok(mut guard) = SESSION_KEY.lock() {
                *guard = Some(key);
            }
            Ok(key)
        }
        Err(_) => create_and_store_data_key().map(|key| {
            if let Ok(mut guard) = SESSION_KEY.lock() {
                *guard = Some(key);
            }
            key
        }),
    }
}

fn load_data_key() -> Result<[u8; KEY_LEN], String> {
    if let Ok(guard) = SESSION_KEY.lock() {
        if let Some(key) = *guard {
            return Ok(key);
        }
    }
    Err("Encryption is locked. Unlock with Touch ID, Windows Hello, or your device passcode.".to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn detects_magic_prefix() {
        assert!(is_encrypted_payload(b"LTENC1abc"));
        assert!(!is_encrypted_payload(b"{\"plain\":true}"));
    }

    #[test]
    fn round_trip_crypto_primitive() {
        let key = [7u8; KEY_LEN];
        let plaintext = br#"{"hello":"world"}"#;

        let cipher = Aes256Gcm::new_from_slice(&key).unwrap();
        let mut nonce_bytes = [0u8; NONCE_LEN];
        nonce_bytes.fill(3);
        let nonce = Nonce::from_slice(&nonce_bytes);
        let ciphertext = cipher.encrypt(nonce, plaintext.as_ref()).unwrap();
        let decrypted = cipher.decrypt(nonce, ciphertext.as_ref()).unwrap();
        assert_eq!(decrypted, plaintext);
    }
}
