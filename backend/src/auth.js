// Wallet sign-in (ed25519 over a server nonce) and HMAC-signed session tokens.

const B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

export function base58Decode(str) {
  const bytes = [0];
  for (const ch of str) {
    const v = B58.indexOf(ch);
    if (v < 0) throw new Error("invalid base58");
    let carry = v;
    for (let i = 0; i < bytes.length; i++) {
      carry += bytes[i] * 58;
      bytes[i] = carry & 0xff;
      carry >>= 8;
    }
    while (carry) {
      bytes.push(carry & 0xff);
      carry >>= 8;
    }
  }
  for (const ch of str) {
    if (ch !== "1") break;
    bytes.push(0);
  }
  return new Uint8Array(bytes.reverse());
}

export function base58Encode(buf) {
  const digits = [0];
  for (const byte of buf) {
    let carry = byte;
    for (let i = 0; i < digits.length; i++) {
      carry += digits[i] << 8;
      digits[i] = carry % 58;
      carry = (carry / 58) | 0;
    }
    while (carry) {
      digits.push(carry % 58);
      carry = (carry / 58) | 0;
    }
  }
  let out = "";
  for (const byte of buf) {
    if (byte !== 0) break;
    out += "1";
  }
  return out + digits.reverse().map((d) => B58[d]).join("");
}

const b64url = (bytes) => btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const fromB64url = (s) => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4)), (c) => c.charCodeAt(0));
const enc = new TextEncoder();

export function isWallet(w) {
  if (typeof w !== "string" || !/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(w)) return false;
  try {
    return base58Decode(w).length === 32;
  } catch {
    return false;
  }
}

export function signInMessage(wallet, nonce, issuedAt) {
  return `World Terminal sign-in\nWallet: ${wallet}\nNonce: ${nonce}\nIssued: ${new Date(issuedAt).toISOString()}\n\nThis only proves you own this wallet. It costs nothing and moves no funds.`;
}

export function randomNonce() {
  return b64url(crypto.getRandomValues(new Uint8Array(18)));
}

// signature: base58 or base64 string of the 64-byte ed25519 signature.
export async function verifyWalletSignature(wallet, message, signature) {
  let sig;
  try {
    sig = /^[1-9A-HJ-NP-Za-km-z]+$/.test(signature) ? base58Decode(signature) : Uint8Array.from(atob(signature), (c) => c.charCodeAt(0));
  } catch {
    return false;
  }
  if (sig.length !== 64) return false;
  const key = await crypto.subtle.importKey("raw", base58Decode(wallet), { name: "Ed25519" }, false, ["verify"]);
  return crypto.subtle.verify("Ed25519", key, sig, enc.encode(message));
}

async function hmacKey(secret) {
  return crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
}

export async function signSession(payload, secret) {
  const head = b64url(enc.encode(JSON.stringify({ alg: "HS256", typ: "JWT" })));
  const body = b64url(enc.encode(JSON.stringify(payload)));
  const sig = await crypto.subtle.sign("HMAC", await hmacKey(secret), enc.encode(`${head}.${body}`));
  return `${head}.${body}.${b64url(sig)}`;
}

export async function readSession(token, secret, now = Date.now()) {
  if (!token || !secret) return null;
  const [head, body, sig] = token.split(".");
  if (!head || !body || !sig) return null;
  const ok = await crypto.subtle.verify("HMAC", await hmacKey(secret), fromB64url(sig), enc.encode(`${head}.${body}`));
  if (!ok) return null;
  try {
    const payload = JSON.parse(new TextDecoder().decode(fromB64url(body)));
    return payload.exp && payload.exp * 1000 > now ? payload : null;
  } catch {
    return null;
  }
}
