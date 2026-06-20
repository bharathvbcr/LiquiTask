import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  getDesktopApi,
  getNativeStorageApi,
  getRuntimeKind,
  getRuntimeState,
  getRuntimeWindowControls,
  initializeDesktopBridge,
  isDesktop,
  isElectron,
  isTauri,
  isWeb,
  showRuntimeWindow,
} from "../runtimeEnvironment";

describe("runtimeEnvironment", () => {
  beforeEach(() => {
    window.desktopAPI = undefined;
    window.electronAPI = undefined;
    delete (window as Window & { __electronAPI?: unknown }).__electronAPI;
    delete (globalThis as typeof globalThis & { isTauri?: boolean }).isTauri;
  });

  it("detects web runtime by default", () => {
    expect(getRuntimeKind()).toBe("web");
    expect(getRuntimeState()).toEqual({
      kind: "web",
      hasCustomWindowControls: false,
    });
    expect(getDesktopApi()).toBeUndefined();
    expect(getRuntimeWindowControls()).toBeNull();
    expect(getNativeStorageApi()).toBeUndefined();
  });
  it("uses electron runtime when bridge is initialized", async () => {
    const electronStorage = {
      get: vi.fn(),
      set: vi.fn(),
      delete: vi.fn(),
      clear: vi.fn(),
      has: vi.fn(),
    };

    const listenerCleanup = vi.fn();

    const bridge: DesktopAPI = {
      minimize: vi.fn().mockResolvedValue(undefined),
      maximize: vi.fn().mockResolvedValue(undefined),
      restore: vi.fn().mockResolvedValue(undefined),
      close: vi.fn().mockResolvedValue(undefined),
      isMaximized: vi.fn().mockResolvedValue(false),
      onWindowStateChange: vi.fn().mockReturnValue(listenerCleanup),
      showNotification: vi.fn().mockResolvedValue(undefined),
      storage: electronStorage,
      workspace: {
        selectDirectory: vi.fn().mockResolvedValue(null),
        getPaths: vi.fn().mockResolvedValue([]),
        setPaths: vi.fn().mockResolvedValue(undefined),
        readFile: vi.fn().mockResolvedValue(""),
        writeFile: vi.fn().mockResolvedValue(undefined),
        searchFiles: vi.fn().mockResolvedValue([]),
      },
    };
    window.electronAPI = bridge;
    (window as Window & { __electronAPI?: unknown }).__electronAPI = {};
    initializeDesktopBridge();

    expect(getRuntimeKind()).toBe("electron");
    expect(getRuntimeState()).toEqual({
      kind: "electron",
      hasCustomWindowControls: true,
    });
    expect(window.desktopAPI).toBe(bridge);
    expect(getDesktopApi()).toBe(bridge);
    expect(getNativeStorageApi()).toBe(electronStorage);

    const controls = getRuntimeWindowControls();
    expect(controls).not.toBeNull();
    await controls?.minimize();
    await controls?.maximize();
    await controls?.restore();
    await controls?.close();
    expect(await controls?.isMaximized()).toBe(false);

    const cleanup = controls?.onWindowStateChange(vi.fn());
    cleanup?.();

    expect(window.electronAPI.minimize).toHaveBeenCalled();
    expect(window.electronAPI.maximize).toHaveBeenCalled();
    expect(window.electronAPI.restore).toHaveBeenCalled();
    expect(window.electronAPI.close).toHaveBeenCalled();
    expect(window.electronAPI.onWindowStateChange).toHaveBeenCalled();
    expect(listenerCleanup).toHaveBeenCalled();
  });

  it("isWeb returns true and isElectron/isDesktop/isTauri return false in web mode", () => {
    expect(isWeb()).toBe(true);
    expect(isElectron()).toBe(false);
    expect(isDesktop()).toBe(false);
    expect(isTauri()).toBe(false);
  });

  it("isElectron and isDesktop return true when bridge is present", () => {
    window.electronAPI = {} as DesktopAPI;
    expect(isElectron()).toBe(true);
    expect(isDesktop()).toBe(true);
    expect(isWeb()).toBe(false);
  });

  it("showRuntimeWindow does not throw and returns undefined", () => {
    expect(() => showRuntimeWindow()).not.toThrow();
    expect(showRuntimeWindow()).toBeUndefined();
  });
});
