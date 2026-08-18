/** Small string helpers. */

export function prettyPlural(count: number, noun: string, plural?: string): string {
  return `${count} ${count === 1 ? noun : (plural ?? noun + 's')}`;
}

export function titleCase(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}
