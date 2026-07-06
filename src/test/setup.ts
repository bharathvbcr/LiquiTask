import "@testing-library/jest-dom";
import { beforeEach, vi } from "vitest";

// Default Tauri API mocks so components/hooks that call listen()/invoke() at
// mount time don't throw unhandled rejections in jsdom (no __TAURI_INTERNALS__).
// Individual test files can still override these with their own vi.mock calls.
vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn().mockResolvedValue(() => {}),
  emit: vi.fn().mockResolvedValue(undefined),
}));

// Mock localStorage
const store: Record<string, string> = {};
const localStorageMock = {
  getItem: vi.fn((key: string) => store[key] || null),
  setItem: vi.fn((key: string, value: string) => {
    store[key] = value.toString();
  }),
  removeItem: vi.fn((key: string) => {
    delete store[key];
  }),
  clear: vi.fn(() => {
    Object.keys(store).forEach((key) => {
      delete store[key];
    });
  }),
  get length() {
    return Object.keys(store).length;
  },
  key: vi.fn((index: number) => Object.keys(store)[index] || null),
};

// Apply to all global objects to ensure consistency across environments
Object.defineProperty(window, "localStorage", { value: localStorageMock, writable: true });
Object.defineProperty(global, "localStorage", { value: localStorageMock, writable: true });
Object.defineProperty(globalThis, "localStorage", { value: localStorageMock, writable: true });

// Prevent jsdom from throwing navigation errors when test-rendered links are clicked.
Object.defineProperty(HTMLAnchorElement.prototype, "click", {
  configurable: true,
  value: vi.fn(),
});

// Mock scrollIntoView
HTMLElement.prototype.scrollIntoView = vi.fn();

// Reset mocks between tests
beforeEach(() => {
  vi.clearAllMocks();
  localStorageMock.clear();
});
