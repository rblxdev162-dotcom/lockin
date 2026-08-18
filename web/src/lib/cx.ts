/** Tiny className joiner — avoids pulling in clsx for six characters of logic. */
export function cx(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(' ');
}
