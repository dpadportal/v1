const ITERATIONS = 100_000;

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

function fromBase64(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

async function derive(password: string, salt: Uint8Array): Promise<ArrayBuffer> {
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    "PBKDF2",
    false,
    ["deriveBits"]
  );
  return crypto.subtle.deriveBits(
    { name: "PBKDF2", salt, iterations: ITERATIONS, hash: "SHA-256" },
    keyMaterial,
    256
  );
}

export async function hashPassword(
  password: string
): Promise<{ salt: string; hash: string }> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const key = await derive(password, salt);
  return { salt: toBase64(salt), hash: toBase64(new Uint8Array(key)) };
}

export async function verifyPassword(
  password: string,
  saltB64: string,
  hashB64: string
): Promise<boolean> {
  try {
    const key = await derive(password, fromBase64(saltB64));
    const expected = fromBase64(hashB64);
    const actual = new Uint8Array(key);
    if (actual.length !== expected.length) return false;
    return crypto.subtle.timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}
