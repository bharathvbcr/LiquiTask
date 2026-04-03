const ALLOWED_URL_PROTOCOLS = new Set(["http:", "https:"]);

export const getSafeExternalUrl = (value: string): string | null => {
  const trimmed = value.trim();
  if (!trimmed) return null;

  try {
    const parsed = new URL(trimmed);
    return ALLOWED_URL_PROTOCOLS.has(parsed.protocol) ? parsed.toString() : null;
  } catch {
    return null;
  }
};
