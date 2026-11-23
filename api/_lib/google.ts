import { createCipheriv, createDecipheriv, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

function tokenKey(): Buffer {
  const encoded = process.env.GOOGLE_TOKEN_ENCRYPTION_KEY;
  if (!encoded) throw new Error("Google token encryption is not configured.");
  const key = Buffer.from(encoded, "base64");
  if (key.length !== 32) throw new Error("Google token encryption key must decode to 32 bytes.");
  return key;
}

export function encryptRefreshToken(token: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", tokenKey(), iv);
  const encrypted = Buffer.concat([cipher.update(token, "utf8"), cipher.final()]);
  return [iv, cipher.getAuthTag(), encrypted].map((part) => part.toString("base64url")).join(".");
}

export function decryptRefreshToken(value: string): string {
  const [encodedIv, encodedTag, encodedData] = value.split(".");
  if (!encodedIv || !encodedTag || !encodedData) throw new Error("Stored Google credentials are invalid.");
  const decipher = createDecipheriv("aes-256-gcm", tokenKey(), Buffer.from(encodedIv, "base64url"));
  decipher.setAuthTag(Buffer.from(encodedTag, "base64url"));
  return Buffer.concat([
    decipher.update(Buffer.from(encodedData, "base64url")),
    decipher.final(),
  ]).toString("utf8");
}

export type OAuthState = {
  workspaceId: string;
  deviceId: string;
  nonce: string;
  expiresAt: number;
};

function stateSecret(): string {
  const secret = process.env.GOOGLE_OAUTH_STATE_SECRET;
  if (!secret || secret.length < 32) throw new Error("Google OAuth state secret must be at least 32 characters.");
  return secret;
}

export function createOAuthState(workspaceId: string, deviceId: string): string {
  const payload = Buffer.from(JSON.stringify({
    workspaceId,
    deviceId,
    nonce: randomBytes(16).toString("base64url"),
    expiresAt: Date.now() + 10 * 60 * 1000,
  } satisfies OAuthState)).toString("base64url");
  const signature = createHmac("sha256", stateSecret()).update(payload).digest("base64url");
  return `${payload}.${signature}`;
}

export function verifyOAuthState(value: string): OAuthState | null {
  const [payload, signature] = value.split(".");
  if (!payload || !signature) return null;
  const expected = createHmac("sha256", stateSecret()).update(payload).digest();
  const received = Buffer.from(signature, "base64url");
  if (received.length !== expected.length || !timingSafeEqual(received, expected)) return null;
  try {
    const state = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as OAuthState;
    if (
      typeof state.workspaceId !== "string" ||
      typeof state.deviceId !== "string" ||
      typeof state.nonce !== "string" ||
      typeof state.expiresAt !== "number" ||
      state.expiresAt < Date.now()
    ) return null;
    return state;
  } catch {
    return null;
  }
}
