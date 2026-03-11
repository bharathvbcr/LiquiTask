import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
    getNativeStorageApi,
    getRuntimeKind,
    getRuntimeState,
    getRuntimeWindowControls,
} from '../runtimeEnvironment';

describe('runtimeEnvironment', () => {
    beforeEach(() => {
        window.electronAPI = undefined;
        delete (window as Window & { __electronAPI?: unknown }).__electronAPI;
    });

    it('detects web runtime by default', () => {
        expect(getRuntimeKind()).toBe('web');
        expect(getRuntimeState()).toEqual({
            kind: 'web',
            hasCustomWindowControls: false,
        });
        expect(getRuntimeWindowControls()).toBeNull();
        expect(getNativeStorageApi()).toBeUndefined();
    });
it('uses electron runtime when bridge is initialized', async () => {
    const electronStorage = {
        get: vi.fn(),
        set: vi.fn(),
        delete: vi.fn(),
        clear: vi.fn(),
        has: vi.fn(),
    };

    const listenerCleanup = vi.fn();

    window.electronAPI = {
        minimize: vi.fn().mockResolvedValue(undefined),
        maximize: vi.fn().mockResolvedValue(undefined),
        restore: vi.fn().mockResolvedValue(undefined),
        close: vi.fn().mockResolvedValue(undefined),
        isMaximized: vi.fn().mockResolvedValue(false),
        onWindowStateChange: vi.fn().mockReturnValue(listenerCleanup),
        showNotification: vi.fn().mockResolvedValue(undefined),
        storage: electronStorage,
    };
    (window as Window & { __electronAPI?: unknown }).__electronAPI = {};

    expect(getRuntimeKind()).toBe('electron');
    expect(getRuntimeState()).toEqual({
        kind: 'electron',
        hasCustomWindowControls: true,
    });
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
});
