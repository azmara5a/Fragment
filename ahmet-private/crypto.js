/**
 * AHMET PRIVATE — browser-side cryptography primitives.
 *
 * The server must only receive the returned encrypted envelope.
 * Never send passphrases, recovery keys, DEKs, or plaintext backups to the API.
 *
 * Format v1: AES-256-GCM payload encryption; DEK wrapped independently
 * by PBKDF2-SHA-256-derived passphrase and recovery keys.
 */

const VERSION = 1;
const PBKDF2_ITERATIONS = 600_000;
const encoder = new TextEncoder();
const decoder = new TextDecoder();

function toBase64Url(bytes) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function fromBase64Url(value) {
  if (typeof value !== "string" || !/^[A-Za-z0-9_-]+$/.test(value)) {
    throw new Error("Geçersiz şifreli veri biçimi.");
  }
  const base64 = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = base64 + "=".repeat((4 - (base64.length % 4)) % 4);
  return Uint8Array.from(atob(padded), (char) => char.charCodeAt(0));
}

function randomBytes(length) {
  return crypto.getRandomValues(new Uint8Array(length));
}

async function deriveWrappingKey(secret, salt) {
  if (typeof secret !== "string" || secret.length < 12) {
    throw new Error("Parola/kurtarma anahtarı en az 12 karakter olmalı.");
  }
  const material = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret.normalize("NFKC")),
    "PBKDF2",
    false,
    ["deriveKey"]
  );
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", salt, iterations: PBKDF2_ITERATIONS, hash: "SHA-256" },
    material,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  );
}

async function wrapDek(dek, secret, purpose) {
  const salt = randomBytes(16);
  const iv = randomBytes(12);
  const key = await deriveWrappingKey(secret, salt);
  const rawDek = await crypto.subtle.exportKey("raw", dek);
  const aad = encoder.encode(`AHMET-PRIVATE:DEK:v${VERSION}:${purpose}`);
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv, additionalData: aad, tagLength: 128 },
    key,
    rawDek
  );
  return {
    algorithm: "PBKDF2-SHA256+A256GCM",
    iterations: PBKDF2_ITERATIONS,
    salt: toBase64Url(salt),
    iv: toBase64Url(iv),
    ciphertext: toBase64Url(new Uint8Array(ciphertext))
  };
}

async function unwrapDek(wrapped, secret, purpose) {
  if (!wrapped || wrapped.algorithm !== "PBKDF2-SHA256+A256GCM" ||
      wrapped.iterations !== PBKDF2_ITERATIONS) {
    throw new Error("Desteklenmeyen anahtar zarfı.");
  }
  const salt = fromBase64Url(wrapped.salt);
  const iv = fromBase64Url(wrapped.iv);
  const ciphertext = fromBase64Url(wrapped.ciphertext);
  const key = await deriveWrappingKey(secret, salt);
  const aad = encoder.encode(`AHMET-PRIVATE:DEK:v${VERSION}:${purpose}`);
  const rawDek = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv, additionalData: aad, tagLength: 128 },
    key,
    ciphertext
  );
  return crypto.subtle.importKey("raw", rawDek, { name: "AES-GCM" }, false, [
    "encrypt",
    "decrypt"
  ]);
}

/** Generate a printable 256-bit recovery secret. Show it once and ask the owner to store it safely. */
export function generateRecoveryKey() {
  return toBase64Url(randomBytes(32));
}

/** Create a new vault key and independent passphrase/recovery wraps. */
export async function createVaultKeys(passphrase, recoveryKey) {
  const dek = await crypto.subtle.generateKey(
    { name: "AES-GCM", length: 256 },
    true,
    ["encrypt", "decrypt"]
  );
  const [passphraseWrap, recoveryWrap] = await Promise.all([
    wrapDek(dek, passphrase, "passphrase"),
    wrapDek(dek, recoveryKey, "recovery")
  ]);
  return {
    version: VERSION,
    keyAlgorithm: "AES-256-GCM",
    passphraseWrap,
    recoveryWrap,
    dek
  };
}

/** Encrypt a JSON-compatible archive locally. Only this envelope should be uploaded. */
export async function encryptBackup(archive, dek) {
  const iv = randomBytes(12);
  const aad = encoder.encode(`AHMET-PRIVATE:BACKUP:v${VERSION}`);
  const plaintext = encoder.encode(JSON.stringify(archive));
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv, additionalData: aad, tagLength: 128 },
    dek,
    plaintext
  );
  return {
    version: VERSION,
    algorithm: "AES-256-GCM",
    iv: toBase64Url(iv),
    ciphertext: toBase64Url(new Uint8Array(ciphertext)),
    createdAt: new Date().toISOString()
  };
}

/** Decrypt an authenticated backup envelope after the DEK has been unlocked. */
export async function decryptBackup(envelope, dek) {
  if (!envelope || envelope.version !== VERSION || envelope.algorithm !== "AES-256-GCM") {
    throw new Error("Desteklenmeyen yedek biçimi.");
  }
  const iv = fromBase64Url(envelope.iv);
  const ciphertext = fromBase64Url(envelope.ciphertext);
  const aad = encoder.encode(`AHMET-PRIVATE:BACKUP:v${VERSION}`);
  const plaintext = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv, additionalData: aad, tagLength: 128 },
    dek,
    ciphertext
  );
  return JSON.parse(decoder.decode(plaintext));
}

/** Unlock the same DEK using either the passphrase or the recovery secret. */
export async function unlockWithPassphrase(keyRecord, passphrase) {
  return unwrapDek(keyRecord.passphraseWrap, passphrase, "passphrase");
}

export async function unlockWithRecoveryKey(keyRecord, recoveryKey) {
  return unwrapDek(keyRecord.recoveryWrap, recoveryKey, "recovery");
}

/** Rotate the passphrase without re-encrypting archive backups. */
export async function rotatePassphrase(dek, newPassphrase) {
  return wrapDek(dek, newPassphrase, "passphrase");
}

/** Rotate the independent recovery-key wrap without changing the vault DEK. */
export async function rotateRecoveryKey(dek, newRecoveryKey) {
  return wrapDek(dek, newRecoveryKey, "recovery");
}
