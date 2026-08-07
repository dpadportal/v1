export async function sha256(text: string): Promise<string> {
  const data = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export function randomDigits(length: number): string {
  let out = "";
  while (out.length < length) {
    const bytes = crypto.getRandomValues(new Uint8Array(length * 2));
    for (let i = 0; i < bytes.length && out.length < length; i++) {
      if (bytes[i] < 250) out += String(bytes[i] % 10);
    }
  }
  return out;
}

export function randomInt(maxExclusive: number): number {
  if (maxExclusive <= 0) throw new Error("maxExclusive must be greater than 0");
  const limit = 0x100000000 - (0x100000000 % maxExclusive);
  while (true) {
    const value = crypto.getRandomValues(new Uint32Array(1))[0];
    if (value < limit) return value % maxExclusive;
  }
}
