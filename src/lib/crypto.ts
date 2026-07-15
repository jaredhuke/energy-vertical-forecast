// ---------------------------------------------------------------------------
// Password-based encryption for the shared dataset.
//
// The shared data is published as an ENCRYPTED blob (public/data/dataset.enc).
// Real pipeline data is AES-GCM ciphertext at rest, so the public file is
// gibberish without the team password — there is NO GitHub token in the app.
// Sign-in = enter the password → derive a key (PBKDF2) → decrypt the blob.
// A wrong password fails the GCM auth check, so it simply can't decrypt.
// ---------------------------------------------------------------------------

export interface EncBlob {
  v: 1
  kdf: 'PBKDF2-SHA256'
  iter: number
  salt: string // base64
  iv: string // base64
  ct: string // base64 (AES-GCM ciphertext incl. tag)
}

const ITER = 250_000

function b64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64)
  return Uint8Array.from(bin, (c) => c.charCodeAt(0))
}
function bytesToB64(bytes: ArrayBuffer | Uint8Array): string {
  const arr = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)
  let bin = ''
  arr.forEach((b) => (bin += String.fromCharCode(b)))
  return btoa(bin)
}

async function deriveKey(passphrase: string, salt: Uint8Array, iter: number): Promise<CryptoKey> {
  const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(passphrase), 'PBKDF2', false, ['deriveKey'])
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: salt as BufferSource, iterations: iter, hash: 'SHA-256' },
    base,
    { name: 'AES-GCM', length: 256 },
    false,
    ['decrypt', 'encrypt'],
  )
}

/** Decrypt an EncBlob with the password. Throws if the password is wrong
 *  (GCM auth failure) or the blob is malformed. Returns the parsed JSON. */
export async function decryptJson<T = unknown>(blob: EncBlob, passphrase: string): Promise<T> {
  if (!blob || blob.v !== 1) throw new Error('Unrecognised encrypted data.')
  const key = await deriveKey(passphrase, b64ToBytes(blob.salt), blob.iter || ITER)
  const plain = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: b64ToBytes(blob.iv) as BufferSource },
    key,
    b64ToBytes(blob.ct) as BufferSource,
  )
  return JSON.parse(new TextDecoder().decode(plain)) as T
}

/** Encrypt a JSON-serialisable value under the password → EncBlob. Used by
 *  Save so an owner can re-publish the encrypted shared dataset. */
export async function encryptJson(value: unknown, passphrase: string): Promise<EncBlob> {
  const salt = crypto.getRandomValues(new Uint8Array(16))
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const key = await deriveKey(passphrase, salt, ITER)
  const ct = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: iv as BufferSource },
    key,
    new TextEncoder().encode(JSON.stringify(value)),
  )
  return { v: 1, kdf: 'PBKDF2-SHA256', iter: ITER, salt: bytesToB64(salt), iv: bytesToB64(iv), ct: bytesToB64(ct) }
}
