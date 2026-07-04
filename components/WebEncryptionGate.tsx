import { Eye, EyeOff, KeyRound, Lock, ShieldCheck } from "lucide-react";
import type React from "react";
import { useRef, useState } from "react";
import logo from "../src/assets/logo.png";
import { Button } from "../src/components/common/Button";
import { Input } from "../src/components/common/Input";
import { completeEncryptionUnlock } from "../src/services/encryptionSetup";
import {
  setupWebEncryptionAtRest,
  unlockEncryptionWithPassphrase,
} from "../src/services/encryptionService";
import { isWebEncryptionConfigured } from "../src/services/webEncryptionService";

interface WebEncryptionGateProps {
  onUnlocked: () => void;
  onSkip?: () => void;
}

function getPassphraseStrength(passphrase: string): { score: number; label: string; color: string } {
  if (!passphrase) return { score: 0, label: "", color: "" };
  let score = 0;
  if (passphrase.length >= 8) score++;
  if (passphrase.length >= 12) score++;
  if (/[A-Z]/.test(passphrase) && /[a-z]/.test(passphrase)) score++;
  if (/\d/.test(passphrase)) score++;
  if (/[^A-Za-z0-9]/.test(passphrase)) score++;

  if (score <= 1) return { score: 1, label: "Weak", color: "bg-red-500" };
  if (score <= 3) return { score: 2, label: "Fair", color: "bg-amber-500" };
  return { score: 3, label: "Strong", color: "bg-emerald-500" };
}

export const WebEncryptionGate: React.FC<WebEncryptionGateProps> = ({ onUnlocked, onSkip }) => {
  const setupMode = !isWebEncryptionConfigured();
  const [passphrase, setPassphrase] = useState("");
  const [confirmPassphrase, setConfirmPassphrase] = useState("");
  const [showPassphrase, setShowPassphrase] = useState(false);
  const [error, setError] = useState("");
  const [isWorking, setIsWorking] = useState(false);
  const passphraseRef = useRef<HTMLInputElement>(null);

  const strength = setupMode ? getPassphraseStrength(passphrase) : null;

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError("");
    setIsWorking(true);

    try {
      if (setupMode) {
        if (passphrase.length < 8) {
          setError("Passphrase must be at least 8 characters.");
          return;
        }
        if (passphrase !== confirmPassphrase) {
          setError("Passphrases do not match.");
          return;
        }
        await setupWebEncryptionAtRest(passphrase);
        await completeEncryptionUnlock();
      } else {
        const unlocked = await unlockEncryptionWithPassphrase(passphrase);
        if (!unlocked) {
          setError("Incorrect passphrase. Please try again.");
          return;
        }
        await completeEncryptionUnlock();
      }

      onUnlocked();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsWorking(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#030000] flex items-center justify-center p-6">
      <form
        onSubmit={handleSubmit}
        className="w-full max-w-md liquid-glass rounded-3xl border border-white/10 p-8 space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500"
      >
        <div className="flex flex-col items-center text-center gap-4">
          <img src={logo} alt="LiquiTask" className="w-14 h-14 object-contain" />
          <div className="p-3 rounded-2xl bg-red-500/20 text-red-300">
            {setupMode ? <KeyRound size={24} /> : <Lock size={24} />}
          </div>
          <div>
            <h1 className="text-xl font-bold text-white">
              {setupMode ? "Set up encryption" : "Unlock your data"}
            </h1>
            <p className="text-sm text-slate-400 mt-2 leading-relaxed max-w-xs mx-auto">
              {setupMode
                ? "Create a passphrase to encrypt localStorage and IndexedDB in this browser."
                : "Enter your passphrase to decrypt tasks and settings stored in this browser."}
            </p>
          </div>
        </div>

        <div className="space-y-4">
          <Input
            ref={passphraseRef}
            label="Passphrase"
            type={showPassphrase ? "text" : "password"}
            value={passphrase}
            onChange={(e) => setPassphrase(e.target.value)}
            autoComplete={setupMode ? "new-password" : "current-password"}
            autoFocus
            required
            rightElement={
              <button
                type="button"
                onClick={() => setShowPassphrase((v) => !v)}
                className="text-slate-500 hover:text-slate-300 transition-colors"
                aria-label={showPassphrase ? "Hide passphrase" : "Show passphrase"}
                tabIndex={-1}
              >
                {showPassphrase ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            }
          />

          {setupMode && strength && passphrase.length > 0 && (
            <div className="space-y-1.5 px-1">
              <div className="flex gap-1">
                {[1, 2, 3].map((level) => (
                  <div
                    key={level}
                    className={`h-1 flex-1 rounded-full transition-colors duration-300 ${
                      level <= strength.score ? strength.color : "bg-white/10"
                    }`}
                  />
                ))}
              </div>
              <p className="text-xs text-slate-500">
                Strength: <span className="text-slate-400">{strength.label}</span>
              </p>
            </div>
          )}

          {setupMode && (
            <Input
              label="Confirm passphrase"
              type={showPassphrase ? "text" : "password"}
              value={confirmPassphrase}
              onChange={(e) => setConfirmPassphrase(e.target.value)}
              autoComplete="new-password"
              required
              error={
                confirmPassphrase && passphrase !== confirmPassphrase
                  ? "Passphrases do not match"
                  : undefined
              }
            />
          )}

          {error && (
            <p role="alert" className="text-sm text-red-400 bg-red-500/10 border border-red-500/20 rounded-xl px-3 py-2">
              {error}
            </p>
          )}
        </div>

        <Button
          type="submit"
          isLoading={isWorking}
          fullWidth
          color="red"
          icon={setupMode ? <ShieldCheck size={16} /> : <Lock size={16} />}
        >
          {setupMode ? "Enable browser encryption" : "Unlock"}
        </Button>

        {setupMode && onSkip && (
          <Button type="button" variant="secondary" onClick={onSkip} fullWidth>
            Continue without encryption
          </Button>
        )}

        <p className="text-xs text-slate-600 text-center leading-relaxed">
          Passphrases are never sent to a server. If you forget yours, encrypted browser data cannot
          be recovered.
        </p>
      </form>
    </div>
  );
};
