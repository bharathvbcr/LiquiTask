export type ErrorReportContext = Record<string, unknown>;

export type ErrorReporter = (error: Error, context?: ErrorReportContext) => void;

let customReporter: ErrorReporter | null = null;

declare global {
  interface Window {
    __liquitaskReportError?: (error: Error, context?: ErrorReportContext) => void;
  }
}

/** Register a global error reporter (e.g. Sentry) at app startup. */
export function setErrorReporter(reporter: ErrorReporter | null): void {
  customReporter = reporter;
}

/** Report an error to any configured reporter without throwing. */
export function reportError(error: Error, context?: ErrorReportContext): void {
  if (customReporter) {
    try {
      customReporter(error, context);
    } catch (reportErr) {
      console.error("Error reporter failed:", reportErr);
    }
  }

  if (typeof window !== "undefined" && typeof window.__liquitaskReportError === "function") {
    try {
      window.__liquitaskReportError(error, context);
    } catch (reportErr) {
      console.error("window.__liquitaskReportError failed:", reportErr);
    }
  }
}
