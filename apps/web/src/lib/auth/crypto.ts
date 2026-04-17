import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";

function deriveKey(secret: string): Buffer {
  return createHash("sha256").update(secret).digest();
}

export function signValue(value: string, secret: string): string {
  const sig = createHmac("sha256", deriveKey(secret)).update(value).digest("base64url");
  return `${value}.${sig}`;
}

export function verifySignedValue(signedValue: string, secret: string): string | null {
  const idx = signedValue.lastIndexOf(".");
  if (idx === -1) return null;

  const value = signedValue.slice(0, idx);
  const signature = signedValue.slice(idx + 1);
  const expected = createHmac("sha256", deriveKey(secret)).update(value).digest();
  const actual = Buffer.from(signature, "base64url");

  if (actual.length !== expected.length) return null;
  return timingSafeEqual(actual, expected) ? value : null;
}

export function encryptValue(plaintext: string, secret: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", deriveKey(secret), iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString("base64url")}.${tag.toString("base64url")}.${encrypted.toString("base64url")}`;
}

export function decryptValue(payload: string, secret: string): string | null {
  const [ivRaw, tagRaw, dataRaw] = payload.split(".");
  if (!ivRaw || !tagRaw || !dataRaw) return null;

  try {
    const decipher = createDecipheriv(
      "aes-256-gcm",
      deriveKey(secret),
      Buffer.from(ivRaw, "base64url"),
    );
    decipher.setAuthTag(Buffer.from(tagRaw, "base64url"));
    const decrypted = Buffer.concat([
      decipher.update(Buffer.from(dataRaw, "base64url")),
      decipher.final(),
    ]);
    return decrypted.toString("utf8");
  } catch {
    return null;
  }
}
