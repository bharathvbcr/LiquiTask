import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { reportError, setErrorReporter } from "../errorReporting";

describe("errorReporting", () => {
  beforeEach(() => {
    setErrorReporter(null);
    delete window.__liquitaskReportError;
  });

  afterEach(() => {
    setErrorReporter(null);
    delete window.__liquitaskReportError;
  });

  it("invokes a registered custom reporter", () => {
    const reporter = vi.fn();
    setErrorReporter(reporter);

    const error = new Error("boom");
    reportError(error, { source: "test" });

    expect(reporter).toHaveBeenCalledWith(error, { source: "test" });
  });

  it("invokes window.__liquitaskReportError when present", () => {
    const reporter = vi.fn();
    window.__liquitaskReportError = reporter;

    const error = new Error("window hook");
    reportError(error);

    expect(reporter).toHaveBeenCalledWith(error, undefined);
  });

  it("does not throw when reporters fail", () => {
    setErrorReporter(() => {
      throw new Error("reporter failed");
    });
    window.__liquitaskReportError = () => {
      throw new Error("window reporter failed");
    };

    expect(() => reportError(new Error("safe"))).not.toThrow();
  });
});
