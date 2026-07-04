import { STORAGE_KEYS } from "../constants";

export const ENCRYPTED_ENVELOPE_PREFIX = "LTENC1:";
const PBKDF2_ITERATIONS = 310_000;
const VERIFIER_PLAINTEXT = "liquitask-verifier-v1";
const OPAQUE_ID_INFO = "liquitask-id-v1";

let aesCryptoKey: CryptoKey | null = null;
let hmacCryptoKey: CryptoKey | null = null;

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
}

function base64ToBytes(encoded: string): Uint8Array {
  const binary = atob(encoded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

async function deriveWebKeyMaterial(
  passphrase: string,
  salt: Uint8Array,
): Promise<{ aesKey: CryptoKey; hmacKey: CryptoKey }> {
  const passphraseKey = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(passphrase),
    "PBKDF2",
    false,
    ["deriveBits"],
  );

  const bits = await crypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      salt: new Uint8Array(salt),
      iterations: PBKDF2_ITERATIONS,
      hash: "SHA-256",
    },
    passphraseKey,
    512,
  );

  const material = new Uint8Array(bits);
  const aesRaw = material.slice(0, 32);
  const hmacRaw = material.slice(32, 64);

  const aesKey = await crypto.subtle.importKey(
    "raw",
    aesRaw,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );

  const hmacKey = await crypto.subtle.importKey(
    "raw",
    hmacRaw,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );

  return { aesKey, hmacKey };
}

async function encryptWithKeys(value: unknown): Promise<string> {
  if (!aesCryptoKey) {
    throw new Error("Web encryption is locked");
  }

  const plaintext = JSON.stringify(value);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: new Uint8Array(iv) },
    aesCryptoKey,
    new TextEncoder().encode(plaintext),
  );

  const combined = new Uint8Array(iv.length + ciphertext.byteLength);
  combined.set(iv, 0);
  combined.set(new Uint8Array(ciphertext), iv.length);
  return `${ENCRYPTED_ENVELOPE_PREFIX}${bytesToBase64(combined)}`;
}

async function decryptWithKeys<T>(envelope: string): Promise<T> {
  if (!aesCryptoKey) {
    throw new Error("Web encryption is locked");
  }

  if (!envelope.startsWith(ENCRYPTED_ENVELOPE_PREFIX)) {
    throw new Error("Value is not an encrypted envelope");
  }

  const combined = base64ToBytes(envelope.slice(ENCRYPTED_ENVELOPE_PREFIX.length));
  const iv = combined.slice(0, 12);
  const ciphertext = combined.slice(12);
  const plaintext = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: new Uint8Array(iv) },
    aesCryptoKey,
    new Uint8Array(ciphertext),
  );
  return JSON.parse(new TextDecoder().decode(plaintext)) as T;
}

export function isWebEncryptionConfigured(): boolean {
  return (
    localStorage.getItem(STORAGE_KEYS.WEB_ENCRYPTION_SALT) !== null &&
    localStorage.getItem(STORAGE_KEYS.WEB_ENCRYPTION_VERIFIER) !== null
  );
}

export function isWebEncryptionUnlocked(): boolean {
  return aesCryptoKey !== null && hmacCryptoKey !== null;
}

export async function setupWebEncryption(passphrase: string): Promise<void> {
  if (passphrase.length < 8) {
    throw new Error("Passphrase must be at least 8 characters");
  }

  const salt = crypto.getRandomValues(new Uint8Array(16));
  const { aesKey, hmacKey } = await deriveWebKeyMaterial(passphrase, salt);
  aesCryptoKey = aesKey;
  hmacCryptoKey = hmacKey;

  const verifier = await encryptWithKeys(VERIFIER_PLAINTEXT);
  localStorage.setItem(STORAGE_KEYS.WEB_ENCRYPTION_SALT, bytesToBase64(salt));
  localStorage.setItem(STORAGE_KEYS.WEB_ENCRYPTION_VERIFIER, verifier);
  localStorage.setItem(STORAGE_KEYS.ENCRYPTION_AT_REST, "true");
}

export async function unlockWebEncryption(passphrase: string): Promise<boolean> {
  const saltB64 = localStorage.getItem(STORAGE_KEYS.WEB_ENCRYPTION_SALT);
  const verifier = localStorage.getItem(STORAGE_KEYS.WEB_ENCRYPTION_VERIFIER);
  if (!saltB64 || !verifier) return false;

  const { aesKey, hmacKey } = await deriveWebKeyMaterial(passphrase, base64ToBytes(saltB64));
  aesCryptoKey = aesKey;
  hmacCryptoKey = hmacKey;

  try {
    const plain = await decryptWithKeys<string>(verifier);
    if (plain !== VERIFIER_PLAINTEXT) {
      lockWebEncryption();
      return false;
    }
    return true;
  } catch {
    lockWebEncryption();
    return false;
  }
}

export function lockWebEncryption(): void {
  aesCryptoKey = null;
  hmacCryptoKey = null;
}

export async function webEncryptPayload(value: unknown): Promise<string> {
  return encryptWithKeys(value);
}

export async function webDecryptPayload<T>(envelope: string): Promise<T> {
  return decryptWithKeys<T>(envelope);
}

export async function webOpaqueStorageKey(
  storeName: string,
  logicalId: string,
): Promise<string> {
  if (!hmacCryptoKey) {
    throw new Error("Web encryption is locked");
  }

  const payload = new TextEncoder().encode(
    `${OPAQUE_ID_INFO}\0${storeName}\0${logicalId}`,
  );
  const signature = await crypto.subtle.sign("HMAC", hmacCryptoKey, payload);
  return bytesToBase64(new Uint8Array(signature));
}

export function resetWebEncryptionForTests(): void {
  lockWebEncryption();
}
