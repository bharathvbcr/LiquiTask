//! Ollama URL allowlist — loopback plus explicitly configured hosts.

use std::collections::HashSet;

pub const MAX_PROMPT_CHARS: usize = 96_000;
pub const MAX_SYSTEM_PROMPT_CHARS: usize = 16_384;
pub const MAX_RAG_DOCUMENTS: usize = 64;
pub const MAX_RAG_DOC_CONTENT_CHARS: usize = 32_768;
pub const MAX_MAX_TOKENS: u32 = 8_192;
pub const MAX_CACHE_MAX_ENTRIES: usize = 50_000;

const LOOPBACK_HOSTS: &[&str] = &["127.0.0.1", "localhost", "::1"];

fn normalize_host(host: &str) -> String {
    host.trim_matches(['[', ']']).to_lowercase()
}

pub fn is_loopback_host(host: &str) -> bool {
    let normalized = normalize_host(host);
    LOOPBACK_HOSTS.iter().any(|allowed| normalized == *allowed)
}

fn parse_http_host(url: &str) -> Option<String> {
    let trimmed = url.trim();
    let (scheme, rest) = trimmed.split_once("://")?;
    if scheme != "http" && scheme != "https" {
        return None;
    }
    let authority = rest.split('/').next()?.trim();
    if authority.is_empty() {
        return None;
    }
    // Reject userinfo (@) — http://127.0.0.1:11434@evil.example/ must not parse as loopback.
    if authority.contains('@') {
        return None;
    }
    // Bracketed IPv6: [::1]:11434
    if authority.starts_with('[') {
        let end = authority.find(']')?;
        let host = &authority[1..end];
        return Some(normalize_host(host));
    }
    let host = authority.split(':').next()?.trim();
    if host.is_empty() {
        return None;
    }
    Some(normalize_host(host))
}

pub fn host_from_url(url: &str) -> Option<String> {
    parse_http_host(url)
}

pub fn is_allowed_ollama_url(url: &str, extra_hosts: &HashSet<String>) -> bool {
    let Some(host) = parse_http_host(url) else {
        return false;
    };
    is_loopback_host(&host) || extra_hosts.contains(&host)
}

pub fn validate_ollama_url(url: &str, extra_hosts: &HashSet<String>) -> Result<String, String> {
    let cleaned = url.trim_end_matches('/').to_string();
    if is_allowed_ollama_url(&cleaned, extra_hosts) {
        Ok(cleaned)
    } else {
        Err(format!("ollama_base_url not allowed: {url}"))
    }
}

pub fn register_configured_host(extra_hosts: &mut HashSet<String>, url: &str) {
    if let Some(host) = host_from_url(url) {
        extra_hosts.insert(host);
    }
}

#[cfg(unix)]
pub fn secure_cache_dir(path: &std::path::Path) -> Result<(), String> {
    use std::fs;
    use std::os::unix::fs::PermissionsExt;

    fs::create_dir_all(path).map_err(|e| e.to_string())?;
    let dir_mode = fs::Permissions::from_mode(0o700);
    let _ = fs::set_permissions(path, dir_mode);

    for name in ["cache.meta.json", "ood.json"] {
        let file = path.join(name);
        if file.is_file() {
            let file_mode = fs::Permissions::from_mode(0o600);
            let _ = fs::set_permissions(&file, file_mode);
        }
    }
    Ok(())
}

#[cfg(windows)]
pub fn secure_cache_dir(path: &std::path::Path) -> Result<(), String> {
    std::fs::create_dir_all(path).map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn loopback_urls_allowed() {
        let extra = HashSet::new();
        assert!(is_allowed_ollama_url("http://127.0.0.1:11434", &extra));
        assert!(is_allowed_ollama_url("http://localhost:11434", &extra));
    }

    #[test]
    fn remote_url_rejected_without_config() {
        let extra = HashSet::new();
        assert!(!is_allowed_ollama_url("http://192.168.1.5:11434", &extra));
    }

    #[test]
    fn configured_host_allowed() {
        let mut extra = HashSet::new();
        extra.insert("192.168.1.5".to_string());
        assert!(is_allowed_ollama_url("http://192.168.1.5:11434", &extra));
    }

    #[test]
    fn file_scheme_rejected() {
        let extra = HashSet::new();
        assert!(!is_allowed_ollama_url("file:///etc/passwd", &extra));
    }

    #[test]
    fn userinfo_ssrf_rejected() {
        let extra = HashSet::new();
        assert!(!is_allowed_ollama_url(
            "http://127.0.0.1:11434@evil.example/",
            &extra
        ));
    }
}
