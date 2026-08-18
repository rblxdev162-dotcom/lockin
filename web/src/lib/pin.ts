/**
 * Parent PIN hashing + verification.
 *
 * Kept completely free of React so the rules can be tested and reused. The raw
 * PIN is never persisted: we store a random salt and the hex SHA-256 of
 * `salt + pin` (WebCrypto, available in every browser that runs this app).
 *
 * A 4–6 digit PIN is low-entropy by nature — this protects against a sibling
 * reading localStorage, not against an attacker with the file and a GPU. That
 * is the honest threat model for a local-first study tool.
 */
import type { ParentPin } from '../types';

export const PIN_MIN = 4;
export const PIN_MAX = 6;

export interface PinValidation {
  ok: boolean;
  error?: string;
}

export function validatePinFormat(pin: string): PinValidation {
  if (!/^\d+$/.test(pin)) return { ok: false, error: 'PIN must be digits only.' };
  if (pin.length < PIN_MIN || pin.length > PIN_MAX) {
    return { ok: false, error: `PIN must be ${PIN_MIN}–${PIN_MAX} digits.` };
  }
  return { ok: true };
}

function randomSalt(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

async function sha256Hex(text: string): Promise<string> {
  const data = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

export async function createPin(pin: string): Promise<ParentPin> {
  const check = validatePinFormat(pin);
  if (!check.ok) throw new Error(check.error);
  const salt = randomSalt();
  return { hash: await sha256Hex(salt + pin), salt, createdAt: new Date().toISOString() };
}

export async function verifyPin(pin: string, stored: ParentPin | null): Promise<boolean> {
  if (!stored) return false;
  if (!/^\d+$/.test(pin)) return false;
  const candidate = await sha256Hex(stored.salt + pin);
  // Length-constant compare. Both are fixed-length hex so this is exact.
  if (candidate.length !== stored.hash.length) return false;
  let diff = 0;
  for (let i = 0; i < candidate.length; i++) {
    diff |= candidate.charCodeAt(i) ^ stored.hash.charCodeAt(i);
  }
  return diff === 0;
}
