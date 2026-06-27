# Code Signing & Notarization

LiquiTask's CI builds are **signing-ready**: the macOS and Windows signing steps
are no-ops until the corresponding secrets exist, and activate automatically the
moment they do. No workflow edits are needed to turn signing on — only repository
secrets.

| State | macOS `.dmg` | Windows `.exe` |
| --- | --- | --- |
| No secrets (today) | Ad-hoc signed (`signingIdentity: "-"`) + hardened-runtime entitlements. Still warns on download. | Unsigned. SmartScreen warns. |
| Secrets configured | Developer ID signed **and notarized** — no Gatekeeper warning. | Authenticode signed — SmartScreen clears (instantly for EV, with reputation for OV). |

Set secrets under **GitHub → repo → Settings → Secrets and variables → Actions**.

---

## macOS — Apple Developer ID + notarization

Removes *"LiquiTask can't be opened because Apple cannot check it…"*.

### 1. Prerequisites
- Apple Developer Program membership ($99/yr).
- A **Developer ID Application** certificate (Xcode → Settings → Accounts →
  Manage Certificates → +, or the Apple Developer portal).

### 2. Export the certificate to base64
In Keychain Access, export the Developer ID Application cert **and its private
key** as `certificate.p12` (set an export password), then:

```bash
base64 -i certificate.p12 | pbcopy   # now in your clipboard for APPLE_CERTIFICATE
```

### 3. Create an app-specific password
At <https://appleid.apple.com> → Sign-In and Security → App-Specific Passwords →
generate one for "LiquiTask notarization".

### 4. Set these 6 repository secrets

| Secret | Value |
| --- | --- |
| `APPLE_CERTIFICATE` | base64 of the `.p12` (step 2) |
| `APPLE_CERTIFICATE_PASSWORD` | the `.p12` export password |
| `APPLE_SIGNING_IDENTITY` | e.g. `Developer ID Application: Your Name (TEAMID)` |
| `APPLE_ID` | your Apple ID email |
| `APPLE_PASSWORD` | the app-specific password (step 3) |
| `APPLE_TEAM_ID` | your 10-char Team ID |

Find the exact identity string with:

```bash
security find-identity -v -p codesigning
```

The next build signs with the Developer ID and notarizes the `.dmg`. Verify a
downloaded build with `spctl -a -vvv -t install LiquiTask.app` (expect
`accepted` / `source=Notarized Developer ID`).

---

## Windows — Authenticode

Removes Chrome's *"this file isn't commonly downloaded"* and the SmartScreen
prompt.

### Option A — Traditional OV/EV certificate (`.pfx`)
1. Buy an OV or EV code-signing certificate (DigiCert, Sectigo, etc.). EV clears
   SmartScreen immediately; OV clears once the file accrues download reputation.
2. Export it as a password-protected `.pfx`, then base64-encode it:
   ```bash
   base64 -i certificate.pfx        # macOS/Linux
   ```
3. Set two repository secrets:

   | Secret | Value |
   | --- | --- |
   | `WINDOWS_CERTIFICATE` | base64 of the `.pfx` |
   | `WINDOWS_CERTIFICATE_PASSWORD` | the `.pfx` password |

The `Configure Windows signing` step imports the PFX, derives its thumbprint, and
writes an auto-merged `src-tauri/tauri.windows.conf.json` so Tauri signs the NSIS
installer with a SHA-256 digest and an RFC-3161 timestamp.

> EV certificates are often bound to a hardware token (FIPS HSM) and cannot be
> exported as a `.pfx`. For those, use Option B.

### Option B — Azure Trusted Signing (recommended, ~$10/mo)
A cloud signing service with no hardware token. Replace the `Configure Windows
signing` step with `azure/trusted-signing-action`, authenticate via an Azure
service principal, and point Tauri's `bundle.windows.signCommand` at the signed
output. See <https://learn.microsoft.com/azure/trusted-signing/>.

---

## How the CI wiring works

- **`.github/workflows/build.yml`** — every push to `main`; builds the macOS
  Universal `.dmg` and Windows `.exe` artifacts.
- **`.github/workflows/release.yml`** — on a `vX.Y.Z` tag; same build, then
  publishes a GitHub Release with both installers attached.
- Both gate signing on secret presence, so absent secrets never break the build —
  they simply fall back to ad-hoc (macOS) / unsigned (Windows).
