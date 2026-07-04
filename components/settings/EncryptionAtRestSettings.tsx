import { AlertTriangle, Eye, EyeOff, Fingerprint, Lock, LockOpen, ShieldCheck } from "lucide-react";
import type React from "react";
import { useCallback, useEffect, useState } from "react";
import { Button } from "../../src/components/common/Button";
import { Input } from "../../src/components/common/Input";
import {
  type EncryptionStatus,
  getEncryptionStatus,
  isEncryptionUnlocked,
  lockEncryption,
  setupWebEncryptionAtRest,
  unlockEncryptionWithPassphrase,
} from "../../src/services/encryptionService";
import { isTauri } from "../../src/runtime/runtimeEnvironment";
import { isWebEncryptionConfigured } from "../../src/services/webEncryptionService";
import type { ToastType } from "../../types";
import { DestructiveConfirm } from "./DestructiveConfirm";

interface EncryptionAtRestSettingsProps {
  addToast: (msg: string, type: ToastType) => void;
  onEnableEncryption: () => Promise<void>;
  onDisableEncryption: () => Promise<void>;
  onEncryptionChanged?: () => void;
}

type DisableConfirmTarget = "desktop" | "web" | null;

function desktopBiometricHint(status: EncryptionStatus): string | null {
  if (!status.biometricAvailable) return null;
  const ua = typeof navigator !== "undefined" ? navigator.userAgent : "";
  if (/Mac/i.test(ua)) {
    return "Keys are stored in Apple Keychain and unlocked with Touch ID or your device passcode.";
  }
  return "Keys are protected by Windows Hello or your device PIN.";
}

export const EncryptionAtRestSettings: React.FC<EncryptionAtRestSettingsProps> = ({
  addToast,
  onEnableEncryption,
  onDisableEncryption,
  onEncryptionChanged,
}) => {
  const [status, setStatus] = useState<EncryptionStatus | null>(null);
  const [isWorking, setIsWorking] = useState(false);
  const [webPassphrase, setWebPassphrase] = useState("");
  const [webConfirm, setWebConfirm] = useState("");
  const [showPassphrase, setShowPassphrase] = useState(false);
  const [disableConfirm, setDisableConfirm] = useState<DisableConfirmTarget>(null);

  const refreshStatus = useCallback(async () => {
    setStatus(await getEncryptionStatus());
  }, []);

  useEffect(() => {
    void refreshStatus();
  }, [refreshStatus]);

  const desktop = isTauri();
  const enabled = status?.enabled ?? false;
  const unlocked = isEncryptionUnlocked();
  const biometricHint = status ? desktopBiometricHint(status) : null;

  const statusBadge = (() => {
    if (!enabled) return { label: "Off", className: "bg-slate-500/20 text-slate-400" };
    if (unlocked) return { label: "Active", className: "bg-emerald-500/20 text-emerald-400" };
    return { label: "Locked", className: "bg-amber-500/20 text-amber-400" };
  })();

  const resetDisableConfirm = () => {
    setDisableConfirm(null);
  };

  const handleDesktopEnable = async () => {
    if (!status?.keychainAvailable) {
      addToast("OS keychain is unavailable on this system", "error");
      return;
    }
    setIsWorking(true);
    try {
      await onEnableEncryption();
      addToast("Encryption at rest enabled", "success");
      await refreshStatus();
      onEncryptionChanged?.();
    } catch (error) {
      addToast(error instanceof Error ? error.message : String(error), "error");
    } finally {
      setIsWorking(false);
    }
  };

  const handleDesktopDisable = async () => {
    setIsWorking(true);
    try {
      await onDisableEncryption();
      addToast("Encryption at rest disabled", "info");
      resetDisableConfirm();
      await refreshStatus();
      onEncryptionChanged?.();
    } finally {
      setIsWorking(false);
    }
  };

  const handleDesktopLock = () => {
    lockEncryption();
    addToast("Encryption locked for this session", "info");
    void refreshStatus();
    onEncryptionChanged?.();
  };

  const handleWebSetup = async () => {
    if (webPassphrase.length < 8) {
      addToast("Passphrase must be at least 8 characters", "error");
      return;
    }
    if (webPassphrase !== webConfirm) {
      addToast("Passphrases do not match", "error");
      return;
    }
    setIsWorking(true);
    try {
      await setupWebEncryptionAtRest(webPassphrase);
      await onEnableEncryption();
      addToast("Browser encryption enabled", "success");
      setWebPassphrase("");
      setWebConfirm("");
      await refreshStatus();
      onEncryptionChanged?.();
    } catch (error) {
      addToast(error instanceof Error ? error.message : String(error), "error");
    } finally {
      setIsWorking(false);
    }
  };

  const handleWebUnlock = async () => {
    setIsWorking(true);
    try {
      const ok = await unlockEncryptionWithPassphrase(webPassphrase);
      if (!ok) {
        addToast("Incorrect passphrase", "error");
        return;
      }
      addToast("Encryption unlocked", "success");
      setWebPassphrase("");
      await refreshStatus();
      onEncryptionChanged?.();
    } finally {
      setIsWorking(false);
    }
  };

  const handleWebLock = () => {
    lockEncryption();
    addToast("Encryption locked for this session", "info");
    void refreshStatus();
    onEncryptionChanged?.();
  };

  const handleWebDisable = async () => {
    setIsWorking(true);
    try {
      await onDisableEncryption();
      addToast("Browser encryption removed", "info");
      resetDisableConfirm();
      await refreshStatus();
      onEncryptionChanged?.();
    } finally {
      setIsWorking(false);
    }
  };

  const passphraseToggle = (
    <button
      type="button"
      onClick={() => setShowPassphrase((v) => !v)}
      className="text-slate-500 hover:text-slate-300 transition-colors"
      aria-label={showPassphrase ? "Hide passphrase" : "Show passphrase"}
      tabIndex={-1}
    >
      {showPassphrase ? <EyeOff size={16} /> : <Eye size={16} />}
    </button>
  );

  return (
    <div className="space-y-4 pt-4 border-t border-white/5 animate-in fade-in slide-in-from-bottom-2">
      <h4 className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Security</h4>

      <div className="flex items-start gap-3 p-4 rounded-xl bg-white/5 border border-white/5">
        <div
          className={`p-2.5 rounded-xl shrink-0 ${enabled && unlocked ? "bg-emerald-500/20 text-emerald-400" : "bg-amber-500/20 text-amber-400"}`}
        >
          {enabled && unlocked ? <Lock size={20} /> : <LockOpen size={20} />}
        </div>
        <div className="flex-1 space-y-2 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h4 className="text-sm font-medium text-white">Encryption at rest</h4>
            <span className={`text-[10px] font-semibold uppercase tracking-wider px-2 py-0.5 rounded-full ${statusBadge.className}`}>
              {statusBadge.label}
            </span>
          </div>
          {desktop ? (
            <p className="text-xs text-slate-500 leading-relaxed">
              {enabled
                ? unlocked
                  ? "storage.json and IndexedDB are encrypted with AES-256-GCM. Keys stay in the OS keychain and never enter the webview."
                  : "Encryption is enabled but locked. Unlock to access your data."
                : "Optional. Encrypt local storage and IndexedDB with AES-256-GCM. Keys are stored in the OS keychain."}
            </p>
          ) : (
            <p className="text-xs text-slate-500 leading-relaxed">
              {enabled
                ? unlocked
                  ? "Browser localStorage and IndexedDB are encrypted with your passphrase (PBKDF2 + AES-256-GCM)."
                  : "Encryption is configured but locked. Unlock to access your data."
                : "Optional. Set a passphrase to encrypt data stored in this browser. Nothing is sent to a server."}
            </p>
          )}
          {biometricHint && enabled && (
            <p className="text-xs text-emerald-400/90 flex items-center gap-1.5">
              <Fingerprint size={12} />
              {biometricHint}
            </p>
          )}
          {status && desktop && !status.keychainAvailable && (
            <p className="text-xs text-amber-400 flex items-center gap-1.5">
              <AlertTriangle size={12} />
              OS keychain is unavailable on this system.
            </p>
          )}
        </div>
      </div>

      {desktop ? (
        <div className="space-y-3">
          {!enabled && status?.keychainAvailable && (
            <Button
              onClick={handleDesktopEnable}
              isLoading={isWorking}
              fullWidth
              size="sm"
              color="red"
              icon={<ShieldCheck size={14} />}
            >
              Enable encryption at rest
            </Button>
          )}
          {enabled && unlocked && (
            <Button
              variant="secondary"
              onClick={handleDesktopLock}
              fullWidth
              size="sm"
              icon={<LockOpen size={14} />}
            >
              Lock encryption
            </Button>
          )}
          {enabled &&
            (disableConfirm === "desktop" ? (
              <DestructiveConfirm
                message={
                  <>
                    This will decrypt all stored data. Type <strong>DISABLE</strong> to confirm.
                  </>
                }
                confirmWord="DISABLE"
                confirmLabel="Disable encryption"
                onConfirm={handleDesktopDisable}
                onCancel={resetDisableConfirm}
                isLoading={isWorking}
              />
            ) : (
              <button
                type="button"
                onClick={() => setDisableConfirm("desktop")}
                className="w-full p-3 rounded-xl border border-red-500/20 text-red-300 hover:bg-red-500/10 text-sm transition-colors"
              >
                Disable encryption…
              </button>
            ))}
        </div>
      ) : (
        <div className="space-y-3 p-4 rounded-xl bg-white/5 border border-white/5">
          {!isWebEncryptionConfigured() ? (
            <>
              <Input
                label="New passphrase"
                type={showPassphrase ? "text" : "password"}
                value={webPassphrase}
                onChange={(e) => setWebPassphrase(e.target.value)}
                placeholder="8+ characters"
                size="sm"
                rightElement={passphraseToggle}
              />
              <Input
                label="Confirm passphrase"
                type={showPassphrase ? "text" : "password"}
                value={webConfirm}
                onChange={(e) => setWebConfirm(e.target.value)}
                size="sm"
                error={
                  webConfirm && webPassphrase !== webConfirm
                    ? "Passphrases do not match"
                    : undefined
                }
              />
              <Button
                onClick={handleWebSetup}
                isLoading={isWorking}
                fullWidth
                size="sm"
                color="red"
                icon={<ShieldCheck size={14} />}
              >
                Enable browser encryption
              </Button>
            </>
          ) : (
            <>
              {!unlocked && (
                <>
                  <Input
                    label="Passphrase"
                    type={showPassphrase ? "text" : "password"}
                    value={webPassphrase}
                    onChange={(e) => setWebPassphrase(e.target.value)}
                    size="sm"
                    rightElement={passphraseToggle}
                  />
                  <Button
                    onClick={handleWebUnlock}
                    isLoading={isWorking}
                    fullWidth
                    size="sm"
                    color="red"
                    icon={<Lock size={14} />}
                    disabled={!webPassphrase}
                  >
                    Unlock
                  </Button>
                </>
              )}
              {unlocked && (
                <Button
                  variant="secondary"
                  onClick={handleWebLock}
                  fullWidth
                  size="sm"
                  icon={<LockOpen size={14} />}
                >
                  Lock encryption
                </Button>
              )}
              {disableConfirm === "web" ? (
                <DestructiveConfirm
                  message={
                    <>
                      This will decrypt all browser data. Type <strong>DISABLE</strong> to confirm.
                    </>
                  }
                  confirmWord="DISABLE"
                  confirmLabel="Remove encryption"
                  onConfirm={handleWebDisable}
                  onCancel={resetDisableConfirm}
                  isLoading={isWorking}
                />
              ) : (
                <button
                  type="button"
                  onClick={() => setDisableConfirm("web")}
                  className="w-full p-3 border border-red-500/20 text-red-300 rounded-xl text-sm hover:bg-red-500/10 transition-colors"
                >
                  Remove browser encryption…
                </button>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
};
