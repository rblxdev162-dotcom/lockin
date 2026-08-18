/**
 * chrome.storage.local is the extension's source of truth.
 *
 * Manifest V3 service workers are killed aggressively, so nothing important
 * lives in module scope: every handler reads state back out of storage. That's
 * also what makes blocking survive a Chrome restart.
 */
import { emptyBridgeState, validateBridgeState } from '../shared/protocol.js';

const STATE_KEY = 'lockin_state';
const STATS_KEY = 'lockin_block_stats';

export async function getState() {
  try {
    const stored = await chrome.storage.local.get(STATE_KEY);
    return validateBridgeState(stored[STATE_KEY]) || emptyBridgeState();
  } catch {
    return emptyBridgeState();
  }
}

export async function setState(state) {
  const clean = validateBridgeState(state);
  if (!clean) return null;
  await chrome.storage.local.set({ [STATE_KEY]: clean });
  return clean;
}

/** Aggregate counts only. Deliberately never a list of visited URLs. */
export async function getStats() {
  try {
    const stored = await chrome.storage.local.get(STATS_KEY);
    const raw = stored[STATS_KEY];
    return Array.isArray(raw) ? raw : [];
  } catch {
    return [];
  }
}

export async function recordBlock(domain) {
  if (typeof domain !== 'string' || !domain) return;
  const stats = await getStats();
  const existing = stats.find((s) => s.domain === domain);
  const now = new Date().toISOString();
  if (existing) {
    existing.count += 1;
    existing.lastBlockedAt = now;
  } else {
    stats.push({ domain, count: 1, lastBlockedAt: now });
  }
  // Bound the list so storage can't grow without limit.
  const trimmed = stats.sort((a, b) => b.count - a.count).slice(0, 100);
  await chrome.storage.local.set({ [STATS_KEY]: trimmed });
  return trimmed;
}

export async function clearStats() {
  await chrome.storage.local.set({ [STATS_KEY]: [] });
}
