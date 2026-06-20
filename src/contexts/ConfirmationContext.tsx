import { AlertTriangle, Info, Trash2 } from "lucide-react";
import type React from "react";
import { createContext, type ReactNode, useCallback, useContext, useEffect, useRef, useState } from "react";
import { Button } from "../components/common/Button";
import { Modal } from "../components/common/Modal";

export interface ConfirmationOptions {
  title: string;
  message: string;
  confirmText?: string;
  cancelText?: string;
  variant?: "danger" | "warning" | "info";
}

interface ConfirmationContextType {
  confirm: (options: ConfirmationOptions) => Promise<boolean>;
}

const ConfirmationContext = createContext<ConfirmationContextType | undefined>(undefined);

export const useConfirmation = () => {
  const context = useContext(ConfirmationContext);
  if (!context) {
    throw new Error("useConfirmation must be used within a ConfirmationProvider");
  }
  return context;
};

export const ConfirmationProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [isOpen, setIsOpen] = useState(false);
  const [options, setOptions] = useState<ConfirmationOptions>({
    title: "",
    message: "",
  });
  const resolveRef = useRef<((value: boolean) => void) | null>(null);

  useEffect(() => {
    return () => {
      if (resolveRef.current) {
        resolveRef.current(false);
        resolveRef.current = null;
      }
    };
  }, []);

  const confirm = useCallback((opts: ConfirmationOptions) => {
    setOptions(opts);
    setIsOpen(true);
    return new Promise<boolean>((resolve) => {
      resolveRef.current = resolve;
    });
  }, []);

  const handleConfirm = useCallback(() => {
    setIsOpen(false);
    if (resolveRef.current) {
      resolveRef.current(true);
      resolveRef.current = null;
    }
  }, []);

  const handleCancel = useCallback(() => {
    setIsOpen(false);
    if (resolveRef.current) {
      resolveRef.current(false);
      resolveRef.current = null;
    }
  }, []);

  const getIcon = () => {
    switch (options.variant) {
      case "danger":
        return <Trash2 size={24} className="text-red-400" />;
      case "warning":
        return <AlertTriangle size={24} className="text-amber-400" />;
      default:
        return <Info size={24} className="text-blue-400" />;
    }
  };

  return (
    <ConfirmationContext.Provider value={{ confirm }}>
      {children}
      <Modal
        isOpen={isOpen}
        onClose={handleCancel}
        title={options.title}
        size="sm"
        showCloseButton={false}
      >
        <div className="flex items-start gap-4 mb-6">
          <div className="p-3 rounded-full bg-white/5 border border-white/10">{getIcon()}</div>
          <div className="flex-1">
            <p className="text-slate-300 text-sm leading-relaxed">{options.message}</p>
          </div>
        </div>

        <div className="flex gap-3 justify-end">
          <Button variant="ghost" onClick={handleCancel}>
            {options.cancelText || "Cancel"}
          </Button>
          <Button
            variant={
              options.variant === "warning"
                ? "secondary"
                : options.variant === "info"
                  ? "primary"
                  : "danger"
            } // Default to danger for safety if undefined, or specific mapping
            onClick={handleConfirm}
            autoFocus
          >
            {options.confirmText || "Confirm"}
          </Button>
        </div>
      </Modal>
    </ConfirmationContext.Provider>
  );
};
