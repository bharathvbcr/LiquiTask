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
        window.electrobunAPI = undefined;
        delete (window as Window & { __electrobun?: unknown }).__electrobun;
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

    it('prefers electron runtime when electronAPI exists', async () => {
        const unsubscribe = vi.fn();
        const electronStorage = {
            get: vi.fn(),
            set: vi.fn(),
            delete: vi.fn(),
            clear: vi.fn(),
            has: vi.fn(),
        };

        window.electronAPI = {
            minimize: vi.fn().mockResolvedValue(undefined),
            maximize: vi.fn().mockResolvedValue(undefined),
            close: vi.fn().mockResolvedValue(undefined),
            isMaximized: vi.fn().mockResolvedValue(true),
            on: vi.fn().mockReturnValue(unsubscribe),
            platform: 'win32',
            versions: {
                node: '22',
                chrome: '130',
                electron: '39',
            },
            showNotification: vi.fn().mockResolvedValue(undefined),
            storage: electronStorage,
        };

        (window as Window & { __electrobun?: unknown }).__electrobun = {};

        expect(getRuntimeKind()).toBe('electron');
        expect(getRuntimeState().hasCustomWindowControls).toBe(true);
        expect(getNativeStorageApi()).toBe(electronStorage);

        const controls = getRuntimeWindowControls();
        expect(controls).not.toBeNull();
        await controls?.minimize();
        await controls?.maximize();
        await controls?.close();
        expect(await controls?.isMaximized()).toBe(true);

        const cleanup = controls?.onWindowStateChange(vi.fn());
        cleanup?.();

        expect(window.electronAPI.minimize).toHaveBeenCalled();
        expect(window.electronAPI.maximize).toHaveBeenCalled();
        expect(window.electronAPI.close).toHaveBeenCalled();
        expect(window.electronAPI.on).toHaveBeenCalledTimes(2);
        expect(unsubscribe).toHaveBeenCalledTimes(2);
    });

    it('uses electrobun runtime when bridge is initialized', async () => {
        const listenerCleanup = vi.fn();
        const electrobunStorage = {
            get: vi.fn(),
            set: vi.fn(),
            delete: vi.fn(),
            clear: vi.fn(),
            has: vi.fn(),
        };

        window.electrobunAPI = {
            minimize: vi.fn().mockResolvedValue(undefined),
            maximize: vi.fn().mockResolvedValue(undefined),
            restore: vi.fn().mockResolvedValue(undefined),
            close: vi.fn().mockResolvedValue(undefined),
            isMaximized: vi.fn().mockResolvedValue(false),
            onWindowStateChange: vi.fn().mockReturnValue(listenerCleanup),
            showNotification: vi.fn().mockResolvedValue(undefined),
            storage: electrobunStorage,
        };
        (window as Window & { __electrobun?: unknown }).__electrobun = {};

        expect(getRuntimeKind()).toBe('electrobun');
        expect(getRuntimeState()).toEqual({
            kind: 'electrobun',
            hasCustomWindowControls: true,
        });
        expect(getNativeStorageApi()).toBe(electrobunStorage);

        const controls = getRuntimeWindowControls();
        expect(controls).not.toBeNull();
        await controls?.minimize();
        await controls?.maximize();
        await controls?.restore();
        await controls?.close();
        expect(await controls?.isMaximized()).toBe(false);

        const cleanup = controls?.onWindowStateChange(vi.fn());
        cleanup?.();

        expect(window.electrobunAPI.minimize).toHaveBeenCalled();
        expect(window.electrobunAPI.maximize).toHaveBeenCalled();
        expect(window.electrobunAPI.restore).toHaveBeenCalled();
        expect(window.electrobunAPI.close).toHaveBeenCalled();
        expect(window.electrobunAPI.onWindowStateChange).toHaveBeenCalled();
        expect(listenerCleanup).toHaveBeenCalled();
    });
});
