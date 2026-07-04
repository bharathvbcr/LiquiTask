//! OS-backed encryption key storage with biometric gating where supported.
//!
//! - macOS: Apple Keychain with Touch ID / device passcode access control
//! - Windows: Windows Hello verification before reading from Credential Manager
//! - Linux / fallback: standard keyring entry

use base64::{engine::general_purpose::STANDARD as BASE64, Engine};
use rand::RngCore;

const KEYCHAIN_SERVICE: &str = "LiquiTask";
const KEYCHAIN_USER: &str = "data-encryption-v1";
pub const KEY_LEN: usize = 32;

pub fn keychain_available() -> bool {
    keyring_entry().is_ok()
}

pub fn biometric_available() -> bool {
    #[cfg(target_os = "macos")]
    {
        return true;
    }
    #[cfg(target_os = "windows")]
    {
        return windows_biometric_available();
    }
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    {
        false
    }
}

pub fn create_and_store_data_key() -> Result<[u8; KEY_LEN], String> {
    let mut key = [0u8; KEY_LEN];
    rand::thread_rng().fill_bytes(&mut key);
    store_data_key(&key)?;
    Ok(key)
}

pub fn store_data_key(key: &[u8; KEY_LEN]) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        return macos_store_key(key);
    }
    #[cfg(not(target_os = "macos"))]
    {
        legacy_keyring_store(key)
    }
}

/// Load the data key, prompting for biometrics when required by the platform.
pub fn load_data_key_secure() -> Result<[u8; KEY_LEN], String> {
    #[cfg(target_os = "macos")]
    {
        match macos_load_key() {
            Ok(key) => return Ok(key),
            Err(e) if is_not_found(&e) => {}
            Err(e) => return Err(e),
        }
    }

    #[cfg(target_os = "windows")]
    {
        if windows_biometric_available() {
            windows_verify_user()?;
        }
    }

    match legacy_keyring_load() {
        Ok(key) => {
            // Upgrade legacy keyring entries to biometric-protected storage on macOS.
            #[cfg(target_os = "macos")]
            {
                let _ = macos_store_key(&key);
            }
            Ok(key)
        }
        Err(e) => Err(e),
    }
}

pub fn delete_data_key() -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        let _ = macos_delete_key();
    }
    legacy_keyring_delete()
}

fn decode_key(encoded: &[u8]) -> Result<[u8; KEY_LEN], String> {
    if encoded.len() == KEY_LEN {
        let mut key = [0u8; KEY_LEN];
        key.copy_from_slice(encoded);
        return Ok(key);
    }

    let bytes = BASE64
        .decode(String::from_utf8_lossy(encoded).trim())
        .map_err(|e| format!("Invalid stored encryption key: {e}"))?;
    if bytes.len() != KEY_LEN {
        return Err("Stored encryption key has invalid length".to_string());
    }
    let mut key = [0u8; KEY_LEN];
    key.copy_from_slice(&bytes);
    Ok(key)
}

fn keyring_entry() -> Result<keyring::Entry, String> {
    keyring::Entry::new(KEYCHAIN_SERVICE, KEYCHAIN_USER).map_err(|e| e.to_string())
}

fn legacy_keyring_store(key: &[u8; KEY_LEN]) -> Result<(), String> {
    let entry = keyring_entry()?;
    entry
        .set_password(&BASE64.encode(key))
        .map_err(|e| format!("Failed to store encryption key: {e}"))
}

fn legacy_keyring_load() -> Result<[u8; KEY_LEN], String> {
    let entry = keyring_entry()?;
    let encoded = entry
        .get_password()
        .map_err(|e| format!("Encryption key not found: {e}"))?;
    decode_key(encoded.as_bytes())
}

fn legacy_keyring_delete() -> Result<(), String> {
    match keyring_entry()?.delete_credential() {
        Ok(()) => Ok(()),
        Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(format!("Failed to delete encryption key: {e}")),
    }
}

fn is_not_found(message: &str) -> bool {
    message.contains("not found") || message.contains("errSecItemNotFound")
}

#[cfg(target_os = "macos")]
mod macos {
    use super::*;
    use security_framework::passwords::{
        delete_generic_password_options, generic_password, set_generic_password_options,
        PasswordOptions,
    };
    use security_framework::passwords_options::AccessControlOptions;

    pub fn store_key(key: &[u8; KEY_LEN]) -> Result<(), String> {
        let mut options = PasswordOptions::new_generic_password(KEYCHAIN_SERVICE, KEYCHAIN_USER);
        options.set_access_control_options(
            AccessControlOptions::BIOMETRY_CURRENT_SET | AccessControlOptions::USER_PRESENCE,
        );
        set_generic_password_options(key, options).map_err(|e| format!("Failed to store key in Keychain: {e}"))
    }

    pub fn load_key() -> Result<[u8; KEY_LEN], String> {
        let options = PasswordOptions::new_generic_password(KEYCHAIN_SERVICE, KEYCHAIN_USER);
        let bytes = generic_password(options)
            .map_err(|e| format!("Encryption key not found: {e}"))?;
        decode_key(&bytes)
    }

    pub fn delete_key() -> Result<(), String> {
        let options = PasswordOptions::new_generic_password(KEYCHAIN_SERVICE, KEYCHAIN_USER);
        delete_generic_password_options(options)
            .map_err(|e| format!("Failed to delete key from Keychain: {e}"))
    }
}

#[cfg(target_os = "macos")]
use macos::{delete_key as macos_delete_key, load_key as macos_load_key, store_key as macos_store_key};

#[cfg(target_os = "windows")]
mod windows {
    use super::*;
    use ::windows::core::HSTRING;
    use ::windows::Security::Credentials::UI::{
        UserConsentVerificationResult, UserConsentVerifier, UserConsentVerifierAvailability,
    };

    pub fn biometric_available() -> bool {
        match UserConsentVerifier::CheckAvailabilityAsync() {
            Ok(op) => matches!(
                op.get(),
                Ok(UserConsentVerifierAvailability::Available)
                    | Ok(UserConsentVerifierAvailability::DeviceBusy)
            ),
            Err(_) => false,
        }
    }

    pub fn verify_user() -> Result<(), String> {
        let message = HSTRING::from("Unlock LiquiTask encrypted data");
        let op = UserConsentVerifier::RequestVerificationAsync(&message)
            .map_err(|e| format!("Windows Hello unavailable: {e}"))?;
        match op.get().map_err(|e| format!("Windows Hello failed: {e}"))? {
            UserConsentVerificationResult::Verified => Ok(()),
            _ => Err("Windows Hello verification was cancelled or failed".to_string()),
        }
    }
}

#[cfg(target_os = "windows")]
use windows::{biometric_available as windows_biometric_available, verify_user as windows_verify_user};

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn decode_raw_key_bytes() {
        let raw = [7u8; KEY_LEN];
        assert_eq!(decode_key(&raw).unwrap(), raw);
    }
}
