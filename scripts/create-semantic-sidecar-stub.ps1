# Creates minimal native stub sidecars for Tauri dev/cargo check on Windows.
$ErrorActionPreference = "Stop"

$Root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
Set-Location $Root

$BinDir = Join-Path $Root "src-tauri\binaries"
New-Item -ItemType Directory -Force -Path $BinDir | Out-Null

$Triple = "x86_64-pc-windows-msvc"
$Output = Join-Path $BinDir "semantic-layer-$Triple.exe"
$StubSource = Join-Path $Root "scripts/semantic-sidecar-stub.rs"

if (Test-Path $Output) {
    $Size = (Get-Item $Output).Length
    if ($Size -gt 1048576) {
        Write-Output "Keeping existing sidecar at $Output"
        exit 0
    }
}

if (-not (Get-Command rustc -ErrorAction SilentlyContinue)) {
    Write-Error "rustc is required to create the Windows sidecar stub. Install Rust or run npm run build:semantic-sidecar."
}

& rustc -O $StubSource -o $Output
Write-Output "Created sidecar stub: $Output"
