/**
 * Extension-side mirror of `web/src/lib/domains.ts`.
 * The blocking decision must be identical on both sides, so keep them in sync.
 */

export const PROTECTED_DOMAINS = [
  'google.com',
  'docs.google.com',
  'drive.google.com',
  'classroom.google.com',
  'accounts.google.com',
  'localhost',
];

/** Two-part public suffixes common enough to matter here. */
const COMPOUND_SUFFIXES = ['co.uk', 'co.nz', 'com.au', 'co.jp', 'ac.uk', 'sch.uk', 'org.uk'];

const KNOWN_BRANDS = {
  youtube: 'YouTube',
  tiktok: 'TikTok',
  twitch: 'Twitch',
  x: 'X',
  reddit: 'Reddit',
  discord: 'Discord',
  instagram: 'Instagram',
  roblox: 'Roblox',
  netflix: 'Netflix',
};

/**
 * A domain as a person would say it: `www.youtube.com` → "YouTube".
 *
 * Drops the public suffix and takes the label in front of it. The previous
 * version dropped a hard-coded list of suffixes and then took the last
 * remaining label, which displayed `myschool.edu` as "Edu". See the comment on
 * the web mirror in web/src/lib/domains.ts.
 */
export function prettyDomain(domain) {
  const host = String(domain).toLowerCase().replace(/^www\./, '').replace(/\.+$/, '');
  const labels = host.split('.').filter(Boolean);
  if (labels.length === 0) return domain;
  if (labels.length === 1) return capitalise(labels[0]);

  const lastTwo = labels.slice(-2).join('.');
  const suffixLabels = COMPOUND_SUFFIXES.includes(lastTwo) ? 2 : 1;
  const name = labels[labels.length - 1 - suffixLabels] ?? labels[0];
  return KNOWN_BRANDS[name] || capitalise(name);
}

function capitalise(word) {
  return word.charAt(0).toUpperCase() + word.slice(1);
}

export function normalizeDomain(input) {
  if (typeof input !== 'string') return null;
  let value = input.trim().toLowerCase();
  if (!value) return null;
  value = value.replace(/^[a-z][a-z0-9+.-]*:\/\//, '');
  value = value.replace(/^[^/@]*@/, '');
  value = value.split('/')[0].split('?')[0].split('#')[0];
  value = value.split(':')[0];
  value = value.replace(/^www\./, '');
  value = value.replace(/\.+$/, '');
  if (!value || value.length > 253) return null;
  const labels = value.split('.');
  if (labels.length < 2) return null;
  for (const label of labels) {
    if (!label || label.length > 63 || !/^[a-z0-9-]+$/.test(label)) return null;
    if (label.startsWith('-') || label.endsWith('-')) return null;
  }
  if (!/^[a-z]{2,}$/.test(labels[labels.length - 1])) return null;
  return value;
}

export function hostMatches(host, domain) {
  const h = String(host).toLowerCase().replace(/^www\./, '');
  const d = String(domain).toLowerCase().replace(/^www\./, '');
  return h === d || h.endsWith('.' + d);
}

/** Allowlist and protected domains always beat the blocklist. */
export function shouldBlock(host, blocked, allowed) {
  for (const d of PROTECTED_DOMAINS) if (hostMatches(host, d)) return false;
  for (const d of allowed) if (hostMatches(host, d)) return false;
  for (const d of blocked) if (hostMatches(host, d)) return true;
  return false;
}
