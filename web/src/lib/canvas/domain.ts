/**
 * Canvas domain normalisation for the web app.
 *
 * Mirrors `extension/canvas/urls.js` (which the extension uses at its own trust
 * boundary) but returns a friendly error message for the setup form.
 *
 * Canvas is explicitly NOT assumed to be canvas.instructure.com — schools run
 * it at `district.instructure.com`, `canvas.district.org`, and anything else.
 */
export interface CanvasDomainResult {
  ok: boolean;
  domain?: string;
  error?: string;
}

export function normalizeCanvasDomainWeb(input: string): CanvasDomainResult {
  if (typeof input !== 'string') return { ok: false, error: 'Enter your Canvas address.' };

  let value = input.trim().toLowerCase();
  if (!value) return { ok: false, error: 'Enter your Canvas address.' };

  value = value.replace(/^[a-z][a-z0-9+.-]*:\/\//, '');
  value = value.replace(/^[^/@]*@/, '');
  value = value.split('/')[0].split('?')[0].split('#')[0];
  value = value.split(':')[0];
  value = value.replace(/\.+$/, '');

  if (!value) return { ok: false, error: 'That doesn’t look like a website address.' };
  if (value.length > 253) return { ok: false, error: 'That address is too long.' };
  if (value === 'localhost') return { ok: false, error: 'That’s not a Canvas address.' };
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(value)) {
    return { ok: false, error: 'Enter the Canvas web address, not an IP.' };
  }

  const labels = value.split('.');
  if (labels.length < 2) {
    return { ok: false, error: 'Include the full address, like myschool.instructure.com.' };
  }
  for (const label of labels) {
    if (!label || label.length > 63 || !/^[a-z0-9-]+$/.test(label)) {
      return { ok: false, error: 'That doesn’t look like a valid web address.' };
    }
    if (label.startsWith('-') || label.endsWith('-')) {
      return { ok: false, error: 'That doesn’t look like a valid web address.' };
    }
  }
  if (!/^[a-z]{2,}$/.test(labels[labels.length - 1])) {
    return { ok: false, error: 'That doesn’t look like a valid web address.' };
  }

  return { ok: true, domain: value };
}
