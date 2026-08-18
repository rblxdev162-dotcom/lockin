/**
 * Domain normalisation + validation.
 *
 * NOTE: `extension/shared/domains.js` is a deliberate plain-JS mirror of this
 * file so the extension needs no build step. Keep the two in sync — the rules
 * here decide what actually gets blocked.
 */

/** Domains the app refuses to block, no matter what the user types. */
export const PROTECTED_DOMAINS = [
  'google.com',
  'docs.google.com',
  'drive.google.com',
  'classroom.google.com',
  'accounts.google.com',
  'localhost',
];

export const DEFAULT_ALLOWLIST = [
  'instructure.com',
  'canvas.instructure.com',
  'edgenuity.com',
  'imaginelearning.com',
  'docs.google.com',
  'drive.google.com',
  'classroom.google.com',
  'google.com',
  'clever.com',
];

export const SUGGESTED_BLOCKLIST = [
  'youtube.com',
  'reddit.com',
  'twitch.tv',
  'discord.com',
  'instagram.com',
  'tiktok.com',
  'roblox.com',
  'netflix.com',
  'x.com',
];

/** A label for the block page / stats: `youtube.com` -> `YouTube`. */
/** Two-part public suffixes common enough to matter here. */
const COMPOUND_SUFFIXES = ['co.uk', 'co.nz', 'com.au', 'co.jp', 'ac.uk', 'sch.uk', 'org.uk'];

const KNOWN_BRANDS: Record<string, string> = {
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
 * This works by dropping the public suffix and taking the label in front of
 * it. The previous version dropped a *hard-coded list* of suffixes and then
 * took the last remaining label, which was right for `.com` and wrong for
 * every suffix not on the list: `myschool.edu` displayed as "Edu",
 * `something.app` as "App", and the block page told a student they had tried
 * to open "Test".
 *
 * Never used where precision matters. The block page shows this *and* the real
 * domain, because "YouTube" is friendlier and `m.youtube.com` is the fact.
 */
export function prettyDomain(domain: string): string {
  const host = String(domain).toLowerCase().replace(/^www\./, '').replace(/\.+$/, '');
  const labels = host.split('.').filter(Boolean);
  if (labels.length === 0) return domain;
  if (labels.length === 1) return capitalise(labels[0]);

  const lastTwo = labels.slice(-2).join('.');
  // `bbc.co.uk` → keep three labels' worth of suffix, so the name is "Bbc".
  const suffixLabels = COMPOUND_SUFFIXES.includes(lastTwo) ? 2 : 1;
  const name = labels[labels.length - 1 - suffixLabels] ?? labels[0];
  return KNOWN_BRANDS[name] ?? capitalise(name);
}

function capitalise(word: string): string {
  return word.charAt(0).toUpperCase() + word.slice(1);
}

export interface NormalizeResult {
  ok: boolean;
  domain?: string;
  error?: string;
}

/**
 * Turns anything a student might paste into a bare registrable host.
 *
 *   https://www.youtube.com/watch?v=test  ->  youtube.com
 *   HTTP://Reddit.com/r/all               ->  reddit.com
 *   m.twitch.tv                           ->  m.twitch.tv  (kept: real subdomain)
 *
 * `www.` is stripped because it is never meaningful; other subdomains are kept
 * because `docs.google.com` and `google.com` must stay distinguishable.
 */
export function normalizeDomain(input: string): NormalizeResult {
  if (typeof input !== 'string') return { ok: false, error: 'Enter a website address.' };

  let value = input.trim().toLowerCase();
  if (!value) return { ok: false, error: 'Enter a website address.' };

  // Strip scheme, credentials, path, query, fragment, port.
  value = value.replace(/^[a-z][a-z0-9+.-]*:\/\//, '');
  value = value.replace(/^[^/@]*@/, '');
  value = value.split('/')[0].split('?')[0].split('#')[0];
  value = value.split(':')[0];
  value = value.replace(/^www\./, '');
  value = value.replace(/\.+$/, '');

  if (!value) return { ok: false, error: 'That doesn’t look like a website address.' };
  if (value.length > 253) return { ok: false, error: 'That address is too long.' };
  if (value === 'localhost') return { ok: false, error: 'localhost is reserved for LockIn.' };

  // Reject bare IPs — blocking by IP is a footgun and DNR handles it poorly.
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(value)) {
    return { ok: false, error: 'IP addresses aren’t supported.' };
  }

  const labels = value.split('.');
  if (labels.length < 2) {
    return { ok: false, error: 'Include the full domain, like youtube.com.' };
  }
  for (const label of labels) {
    if (!label || label.length > 63 || !/^[a-z0-9-]+$/.test(label) ||
        label.startsWith('-') || label.endsWith('-')) {
      return { ok: false, error: 'That doesn’t look like a valid domain.' };
    }
  }
  const tld = labels[labels.length - 1];
  if (!/^[a-z]{2,}$/.test(tld)) {
    return { ok: false, error: 'That doesn’t look like a valid domain.' };
  }

  return { ok: true, domain: value };
}

/** True when `host` is `domain` or a subdomain of it. */
export function hostMatches(host: string, domain: string): boolean {
  const h = host.toLowerCase().replace(/^www\./, '');
  const d = domain.toLowerCase().replace(/^www\./, '');
  return h === d || h.endsWith('.' + d);
}

/**
 * The single source of truth for "should this be blocked".
 * Allowlist always wins; protected domains always win.
 */
export function shouldBlock(
  host: string,
  blocked: string[],
  allowed: string[],
): boolean {
  for (const d of PROTECTED_DOMAINS) if (hostMatches(host, d)) return false;
  for (const d of allowed) if (hostMatches(host, d)) return false;
  for (const d of blocked) if (hostMatches(host, d)) return true;
  return false;
}

/** Domains that are in the blocklist but neutralised by the allowlist. */
export function shadowedDomains(blocked: string[], allowed: string[]): string[] {
  return blocked.filter((b) =>
    PROTECTED_DOMAINS.some((p) => hostMatches(b, p)) ||
    allowed.some((a) => hostMatches(b, a)),
  );
}
