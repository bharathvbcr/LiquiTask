//! Opt-in OS sandbox wrapper for council/direct Rust spawns (sandbox-exec / bwrap).

use std::io::Write;
use std::path::{Path, PathBuf};

#[derive(Debug)]
pub struct SandboxAssembledCommand {
    pub program: PathBuf,
    pub args: Vec<String>,
    /// macOS sandbox-exec profile temp dir; must outlive the child process.
    pub profile_dir: Option<tempfile::TempDir>,
}

/// When `sandbox_mode` is `"os"`, wrap the assembled command with the platform
/// OS sandbox helper. Fails closed when the helper is unavailable.
pub fn maybe_wrap_os_sandbox(
    program: PathBuf,
    args: Vec<String>,
    cwd: &Path,
    sandbox_mode: Option<&str>,
    extra_writable_roots: &[String],
) -> Result<SandboxAssembledCommand, String> {
    let assembled = SandboxAssembledCommand {
        program,
        args,
        profile_dir: None,
    };
    match sandbox_mode.map(str::trim) {
        Some("os") => wrap_os_sandbox(assembled, cwd, extra_writable_roots),
        _ => Ok(assembled),
    }
}

fn wrap_os_sandbox(
    assembled: SandboxAssembledCommand,
    cwd: &Path,
    extra_writable_roots: &[String],
) -> Result<SandboxAssembledCommand, String> {
    let roots = collect_writable_roots(cwd, extra_writable_roots);
    #[cfg(target_os = "macos")]
    {
        return wrap_darwin_sandbox(assembled, &roots);
    }
    #[cfg(target_os = "linux")]
    {
        return wrap_linux_sandbox(assembled, cwd, &roots);
    }
    #[cfg(not(any(target_os = "macos", target_os = "linux")))]
    {
        let _ = (assembled, cwd, roots);
        Err("OS sandbox (sandboxMode=os) is not supported on this platform".to_string())
    }
}

fn collect_writable_roots(cwd: &Path, extra: &[String]) -> Vec<PathBuf> {
    let mut seen = std::collections::HashSet::new();
    let mut out = Vec::new();
    let mut add = |p: PathBuf| {
        let clean = dunce::canonicalize(&p).unwrap_or(p);
        if seen.insert(clean.clone()) {
            out.push(clean);
        }
    };
    add(cwd.to_path_buf());
    if let Some(git) = find_git_dir(cwd) {
        add(git);
    }
    for root in extra {
        let trimmed = root.trim();
        if !trimmed.is_empty() {
            add(PathBuf::from(trimmed));
        }
    }
    if let Ok(home) = std::env::var("HOME") {
        let home = PathBuf::from(home);
        for rel in [
            ".claude",
            ".codex",
            ".cursor",
            ".config/cursor",
            ".npm",
            ".cache/npm",
            ".liquitask/agentd",
        ] {
            add(home.join(rel));
        }
    }
    if let Ok(tmp) = std::env::var("TMPDIR") {
        add(PathBuf::from(tmp));
    } else {
        add(PathBuf::from("/tmp"));
    }
    out
}

fn find_git_dir(start: &Path) -> Option<PathBuf> {
    let mut dir = start.to_path_buf();
    loop {
        let git = dir.join(".git");
        if git.exists() {
            return Some(if git.is_dir() { git } else { dir });
        }
        if !dir.pop() {
            return None;
        }
    }
}

#[cfg(target_os = "macos")]
fn wrap_darwin_sandbox(
    assembled: SandboxAssembledCommand,
    roots: &[PathBuf],
) -> Result<SandboxAssembledCommand, String> {
    let sandbox_exec = ["/usr/bin/sandbox-exec", "/usr/sbin/sandbox-exec"]
        .iter()
        .map(PathBuf::from)
        .find(|p| p.is_file())
        .ok_or_else(|| "sandbox-exec not found (OS sandbox requires macOS)".to_string())?;

    let dir = tempfile::tempdir().map_err(|e| format!("create sandbox profile dir: {e}"))?;
    let profile_path = dir.path().join("profile.sb");
    {
        let mut file = std::fs::File::create(&profile_path)
            .map_err(|e| format!("write sandbox profile: {e}"))?;
        writeln!(file, "(version 1)").ok();
        writeln!(file, "(deny default)").ok();
        writeln!(file, "(allow network*)").ok();
        writeln!(file, "(allow process*)").ok();
        writeln!(file, "(allow mach-lookup)").ok();
        writeln!(file, "(allow sysctl-read)").ok();
        writeln!(file, "(allow file-read*)").ok();
        for root in roots {
            writeln!(
                file,
                "(allow file-write* (subpath \"{}\"))",
                root.display()
            )
            .ok();
        }
    }

    let mut args = vec![
        "-f".to_string(),
        profile_path.to_string_lossy().to_string(),
        "--".to_string(),
        assembled.program.to_string_lossy().to_string(),
    ];
    args.extend(assembled.args);

    Ok(SandboxAssembledCommand {
        program: sandbox_exec,
        args,
        profile_dir: Some(dir),
    })
}

#[cfg(target_os = "linux")]
fn wrap_linux_sandbox(
    assembled: SandboxAssembledCommand,
    cwd: &Path,
    roots: &[PathBuf],
) -> Result<SandboxAssembledCommand, String> {
    let bwrap = which_bwrap().ok_or_else(|| {
        "bwrap not found (OS sandbox requires bubblewrap on Linux)".to_string()
    })?;

    let mut args = vec![
        "--die-with-parent".to_string(),
        "--proc".to_string(),
        "/proc".to_string(),
        "--dev".to_string(),
        "/dev".to_string(),
        "--tmpfs".to_string(),
        "/tmp".to_string(),
    ];
    for bind in [
        "/usr", "/bin", "/sbin", "/lib", "/lib64", "/etc/resolv.conf", "/etc/ssl",
        "/etc/nsswitch.conf", "/etc/hosts",
    ] {
        let p = Path::new(bind);
        if p.exists() {
            args.push("--ro-bind".to_string());
            args.push(bind.to_string());
            args.push(bind.to_string());
        }
    }
    for root in roots {
        let s = root.to_string_lossy().to_string();
        args.push("--bind".to_string());
        args.push(s.clone());
        args.push(s);
    }
    args.push("--chdir".to_string());
    args.push(cwd.to_string_lossy().to_string());
    args.push("--".to_string());
    args.push(assembled.program.to_string_lossy().to_string());
    args.extend(assembled.args);

    Ok(SandboxAssembledCommand {
        program: bwrap,
        args,
        profile_dir: None,
    })
}

#[cfg(target_os = "linux")]
fn which_bwrap() -> Option<PathBuf> {
    std::process::Command::new("which")
        .arg("bwrap")
        .output()
        .ok()
        .filter(|o| o.status.success())
        .and_then(|o| {
            let s = String::from_utf8_lossy(&o.stdout).trim().to_string();
            if s.is_empty() {
                None
            } else {
                Some(PathBuf::from(s))
            }
        })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn none_mode_passes_through() {
        let out = maybe_wrap_os_sandbox(
            PathBuf::from("/bin/echo"),
            vec!["hi".to_string()],
            Path::new("/tmp"),
            None,
            &[],
        )
        .expect("pass through");
        assert_eq!(out.program, PathBuf::from("/bin/echo"));
        assert!(out.profile_dir.is_none());
    }
}
