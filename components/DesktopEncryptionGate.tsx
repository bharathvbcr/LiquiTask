import { Fingerprint, Lock } from "lucide-react";
import type React from "react";
import { useEffect, useState } from "react";
import logo from "../src/assets/logo.png";
import { Button } from "../src/components/common/Button";
import { completeEncryptionUnlock } from "../src/services/encryptionSetup";
import { getEncryptionStatus } from "../src/services/encryptionService";

interface DesktopEncryptionGateProps {
  onUnlocked: () => void;
}

function biometricLabel(biometricAvailable: boolean): { title: string; action: string; hint: string } {
  const ua = typeof navigator !== "undefined" ? navigator.userAgent : "";
  const isMac = /Mac/i.test(ua);

  if (biometricAvailable && isMac) {
    return {
      title: "Unlock encrypted data",
      action: "Unlock with Touch ID",
      hint: "Your encryption key is stored in Apple Keychain and protected by Touch ID or your device passcode.",
    };
  }

  if (biometricAvailable) {
    return {
      title: "Unlock encrypted data",
      action: "Unlock with Windows Hello",
      hint: "Your encryption key is stored securely and protected by Windows Hello or your device PIN.",
    };
  }

  return {
    title: "Unlock encrypted data",
    action: "Unlock encryption",
    hint: "Use your system keychain credentials when prompted to access encrypted data.",
  };
}

export const DesktopEncryptionGate: React.FC<DesktopEncryptionGateProps> = ({ onUnlocked }) => {
  const [error, setError] = useState("");
  const [isWorking, setIsWorking] = useState(false);
  const [labels, setLabels] = useState(biometricLabel(false));

  useEffect(() => {
    void getEncryptionStatus().then((status) => {
      setLabels(biometricLabel(status.biometricAvailable));
    });
  }, []);

  const handleUnlock = async () => {
    setError("");
    setIsWorking(true);
    try {
      await completeEncryptionUnlock();
      onUnlocked();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsWorking(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#030000] flex items-center justify-center p-6">
      <div className="w-full max-w-md liquid-glass rounded-3xl border border-white/10 p-8 space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
        <div className="flex flex-col items-center text-center gap-4">
          <img src={logo} alt="LiquiTask" className="w-14 h-14 object-contain" />
          <div className="p-3 rounded-2xl bg-red-500/20 text-red-300">
            <Lock size={24} />
          </div>
          <div>
            <h1 className="text-xl font-bold text-white">{labels.title}</h1>
            <p className="text-sm text-slate-400 mt-2 leading-relaxed max-w-xs mx-auto">{labels.hint}</p>
          </div>
        </div>

        {error && (
          <p
            role="alert"
            className="text-sm text-red-400 bg-red-500/10 border border-red-500/20 rounded-xl px-3 py-2"
          >
            {error}
          </p>
        )}

        <Button
          onClick={handleUnlock}
          isLoading={isWorking}
          fullWidth
          color="red"
          icon={<Fingerprint size={16} />}
        >
          {labels.action}
        </Button>

        <p className="text-xs text-slate-600 text-center leading-relaxed">
          Encryption keys never leave your device. Enable or disable encryption anytime in Settings →
          Security.
        </p>
      </div>
    </div>
  );
};
