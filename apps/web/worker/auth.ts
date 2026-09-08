export type AuthenticatedUser = {
  userId: string;
  sessionId?: string;
};

type JwtHeader = {
  alg?: string;
  kid?: string;
};

type JwtPayload = {
  sub?: string;
  sid?: string;
  iss?: string;
  exp?: number;
  nbf?: number;
};

type JwkWithKid = JsonWebKey & {
  kid?: string;
  alg?: string;
};

type JwksResponse = {
  keys?: JwkWithKid[];
};

const keyCache = new Map<string, CryptoKey>();

function decodeBase64Url(value: string): Uint8Array {
  const base64 = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, "=");
  const decoded = atob(padded);
  return Uint8Array.from(decoded, (char) => char.charCodeAt(0));
}

function decodeJsonPart<T>(value: string): T {
  return JSON.parse(new TextDecoder().decode(decodeBase64Url(value))) as T;
}

async function getVerificationKey(issuer: string, kid: string): Promise<CryptoKey> {
  const cacheKey = `${issuer}|${kid}`;
  const cached = keyCache.get(cacheKey);
  if (cached) return cached;

  const jwksUrl = `${issuer.replace(/\/$/, "")}/.well-known/jwks.json`;
  const response = await fetch(jwksUrl, {
    headers: { accept: "application/json" }
  });
  if (!response.ok) throw new Error("auth_jwks_unavailable");

  const jwks = (await response.json()) as JwksResponse;
  const jwk = jwks.keys?.find((candidate) => candidate.kid === kid);
  if (!jwk) throw new Error("auth_key_not_found");

  const key = await crypto.subtle.importKey(
    "jwk",
    jwk,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["verify"]
  );
  keyCache.set(cacheKey, key);
  return key;
}

export async function authenticateBearer(
  request: Request,
  issuer: string | undefined
): Promise<AuthenticatedUser> {
  if (!issuer) throw new Error("auth_not_configured");

  const authorization = request.headers.get("authorization") ?? "";
  if (!authorization.startsWith("Bearer ")) throw new Error("auth_missing_bearer");

  const token = authorization.slice("Bearer ".length).trim();
  const parts = token.split(".");
  if (parts.length !== 3) throw new Error("auth_invalid_token");

  const [encodedHeader, encodedPayload, encodedSignature] = parts;
  const header = decodeJsonPart<JwtHeader>(encodedHeader);
  const payload = decodeJsonPart<JwtPayload>(encodedPayload);

  if (header.alg !== "RS256" || !header.kid) throw new Error("auth_invalid_algorithm");
  if (!payload.sub || payload.iss !== issuer) throw new Error("auth_invalid_claims");

  const now = Math.floor(Date.now() / 1000);
  if (typeof payload.exp !== "number" || payload.exp <= now) throw new Error("auth_expired");
  if (typeof payload.nbf === "number" && payload.nbf > now + 30) throw new Error("auth_not_yet_valid");

  const key = await getVerificationKey(issuer, header.kid);
  const signedData = new TextEncoder().encode(`${encodedHeader}.${encodedPayload}`);
  const signature = decodeBase64Url(encodedSignature);
  const valid = await crypto.subtle.verify(
    { name: "RSASSA-PKCS1-v1_5" },
    key,
    signature,
    signedData
  );

  if (!valid) throw new Error("auth_invalid_signature");

  return { userId: payload.sub, sessionId: payload.sid };
}
