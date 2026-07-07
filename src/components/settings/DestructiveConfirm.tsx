import type React from "react";
import { useState } from "react";
import { Button } from "../common/Button";
import { Input } from "../common/Input";

interface DestructiveConfirmProps {
  message: React.ReactNode;
  confirmWord: string;
  confirmLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
  isLoading?: boolean;
}

export const DestructiveConfirm: React.FC<DestructiveConfirmProps> = ({
  message,
  confirmWord,
  confirmLabel,
  onConfirm,
  onCancel,
  isLoading = false,
}) => {
  const [typed, setTyped] = useState("");

  return (
    <div className="p-4 rounded-xl border border-red-500/20 bg-red-500/5 space-y-3 animate-in fade-in slide-in-from-top-2">
      <p className="text-sm text-red-300">{message}</p>
      <Input
        label="Confirmation"
        value={typed}
        onChange={(e) => setTyped(e.target.value)}
        placeholder={`Type ${confirmWord}`}
        size="sm"
        autoFocus
      />
      <div className="flex gap-2">
        <Button variant="ghost" size="sm" onClick={onCancel} className="flex-1">
          Cancel
        </Button>
        <Button
          variant="danger"
          size="sm"
          onClick={onConfirm}
          isLoading={isLoading}
          disabled={typed !== confirmWord}
          className="flex-1"
        >
          {confirmLabel}
        </Button>
      </div>
    </div>
  );
};
