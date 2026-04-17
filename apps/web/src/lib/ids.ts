import { randomBytes } from "node:crypto";

const BASE58_ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

export function generateApiKey(): string {
  return `ck_live_${toBase58(randomBytes(24))}`;
}

export function generateSessionId(): string {
  return randomBytes(32).toString("base64url");
}

export function generateMagicLinkToken(): string {
  return randomBytes(32).toString("base64url");
}

function toBase58(bytes: Uint8Array): string {
  let value = BigInt(0);
  for (const byte of bytes) {
    value = (value << BigInt(8)) + BigInt(byte);
  }

  let out = "";
  while (value > 0) {
    const mod = Number(value % BigInt(58));
    out = BASE58_ALPHABET[mod] + out;
    value /= BigInt(58);
  }

  for (const byte of bytes) {
    if (byte !== 0) break;
    out = BASE58_ALPHABET[0] + out;
  }

  return out || BASE58_ALPHABET[0];
}
