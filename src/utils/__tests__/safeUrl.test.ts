import { describe, expect, it } from 'vitest';
import { getSafeExternalUrl } from '../safeUrl';

describe('getSafeExternalUrl', () => {
    it('allows https URLs', () => {
        expect(getSafeExternalUrl('https://example.com')).toBe('https://example.com/');
    });

    it('allows http URLs', () => {
        expect(getSafeExternalUrl('http://example.com/path')).toBe('http://example.com/path');
    });

    it('rejects javascript URLs', () => {
        expect(getSafeExternalUrl('javascript:alert(1)')).toBeNull();
    });

    it('rejects invalid URLs', () => {
        expect(getSafeExternalUrl('google.com')).toBeNull();
    });
});
