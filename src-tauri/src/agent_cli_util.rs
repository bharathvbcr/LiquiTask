//! Shared CLI resolution helpers for agent and DevCouncil subprocesses.

use std::path::{Path, PathBuf};

/// A directory is a DevCouncil checkout when its pyproject declares the
/// `devcouncil` package (cheap textual probe — no TOML parser needed).
pub(crate) fn is_devcouncil_checkout(dir: &Path) -> bool {
    let pyproject = dir.join("pyproject.toml");
    match std::fs::read_to_string(pyproject) {
        Ok(raw) => raw.contains("name = \"devcouncil\""),
        Err(_) => false,
    }
}

fn dirs_home() -> Option<PathBuf> {
    std::env::var_os("HOME").map(PathBuf::from)
}

fn local_checkout_candidates() -> Vec<PathBuf> {
    let mut out = Vec::new();
    if let Ok(cwd) = std::env::current_dir() {
        out.push(cwd);
    }
    if let Some(home) = dirs_home() {
        out.push(home.join("Code").join("DevCouncil"));
        out.push(home.join("devcouncil"));
    }
    out
}

fn trusted_dev_cli(path: &Path) -> Option<PathBuf> {
    if !path.is_file() {
        return None;
    }
    // Reject world-writable shims — a common local privilege-escalation vector.
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        if let Ok(meta) = std::fs::metadata(path) {
            let mode = meta.permissions().mode();
            if mode & 0o002 != 0 {
                return None;
            }
        }
    }
    Some(path.to_path_buf())
}

/// Resolve the DevCouncil CLI for all spawn sites (plan/verify/council/MCP).
///
/// Order:
/// 1. explicit override (`LIQUITASK_DEV_CLI` env var — settable from the UI),
/// 2. PATH (`dev`, then `devcouncil` console scripts),
/// 3. `~/.local/bin` (uv tool / pipx shims on machines where GUI PATH misses it),
/// 4. a local checkout's `.venv/bin/dev` (developer setups).
pub fn resolve_dev_cli() -> Option<PathBuf> {
    if let Some(overridden) = std::env::var_os("LIQUITASK_DEV_CLI") {
        let p = PathBuf::from(overridden);
        if let Some(found) = trusted_dev_cli(&p) {
            return Some(found);
        }
    }
    for name in ["dev", "devcouncil"] {
        if let Some(found) = find_executable(name).and_then(|p| trusted_dev_cli(&p)) {
            return Some(found);
        }
    }
    if let Some(home) = dirs_home() {
        for name in ["dev", "devcouncil"] {
            let shim = home.join(".local").join("bin").join(name);
            if let Some(found) = trusted_dev_cli(&shim) {
                return Some(found);
            }
        }
    }
    for checkout in local_checkout_candidates() {
        if !is_devcouncil_checkout(&checkout) {
            continue;
        }
        for bin in ["bin", "Scripts"] {
            let venv_cli = checkout.join(".venv").join(bin).join("dev");
            if let Some(found) = trusted_dev_cli(&venv_cli) {
                return Some(found);
            }
        }
    }
    None
}

/// GUI apps on macOS inherit a minimal PATH, so augment it with the common
/// install locations for Homebrew, npm globals and per-user bins.
pub(crate) fn augmented_path() -> String {
    let base = std::env::var("PATH").unwrap_or_default();
    let home = std::env::var("HOME").unwrap_or_default();
    let extras = [
        "/opt/homebrew/bin".to_string(),
        "/usr/local/bin".to_string(),
        format!("{home}/.local/bin"),
        format!("{home}/.claude/local"),
        format!("{home}/.npm-global/bin"),
        format!("{home}/bin"),
    ];
    let mut parts: Vec<String> = base.split(':').map(str::to_string).collect();
    for extra in extras {
        if !extra.is_empty() && !parts.iter().any(|p| p == &extra) {
            parts.push(extra);
        }
    }
    parts.join(":")
}

pub(crate) fn find_executable(name: &str) -> Option<PathBuf> {
    for dir in augmented_path().split(':') {
        if dir.is_empty() {
            continue;
        }
        let candidate = Path::new(dir).join(name);
        if candidate.is_file() {
            return Some(candidate);
        }
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn augmented_path_includes_homebrew() {
        assert!(augmented_path().contains("/opt/homebrew/bin"));
    }

    #[test]
    fn resolve_dev_cli_rejects_missing_override() {
        let prev = std::env::var_os("LIQUITASK_DEV_CLI");
        std::env::set_var("LIQUITASK_DEV_CLI", "/nonexistent/dev-cli-override");
        let found = resolve_dev_cli();
        match prev {
            Some(v) => std::env::set_var("LIQUITASK_DEV_CLI", v),
            None => std::env::remove_var("LIQUITASK_DEV_CLI"),
        }
        // Falls through to PATH / venv — must not return the missing override.
        assert_ne!(found.as_deref().map(|p| p.to_string_lossy().to_string()), Some("/nonexistent/dev-cli-override".to_string()));
    }
}
