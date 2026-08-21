/**
 * Class names arrive from Canvas as section labels, not product-ready UI.
 * Keep the full value as the identity; this helper only chooses the short word
 * shown in the class switcher.
 */
export function classSwitchLabel(subject: string): string {
  const name = subject.replace(/\s+/g, ' ').trim() || 'No class';

  // `Per 2 — Emmett` / `El/B/O - Chopra` → `Emmett` / `Chopra`.
  const trailingTeacher = /\s[—–-]\s([A-Za-z][A-Za-z'’.-]{1,39})$/.exec(name);
  if (trailingTeacher) return trailingTeacher[1];

  // Keep supporting raw Canvas names if an older record has not been tidied.
  const leadingTeacher = /^\[([^\]]{1,40})\]\s+/.exec(name);
  if (leadingTeacher) return leadingTeacher[1].trim();

  // A long period prefix is administrative; the course after the colon is
  // the part a student scans for. Nothing is inferred when the shape differs.
  const periodCourse = /^(?:Period|Per)\s[^:]{1,40}:\s*(.+)$/i.exec(name);
  if (periodCourse?.[1]) return periodCourse[1].trim().slice(0, 40);

  return name.slice(0, 40);
}

/**
 * Turn an assignment URL into the class Grades page the student should open.
 * This is navigation only: it never calls Canvas and rejects every other host
 * or path shape.
 */
export function classGradesUrl(url: string | undefined, expectedDomain: string | null): string | null {
  if (!url || !expectedDomain) return null;
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:' || parsed.hostname !== expectedDomain) return null;
    const match = /^\/courses\/(\d+)(?:\/|$)/.exec(parsed.pathname);
    if (!match) return null;
    return `https://${expectedDomain}/courses/${match[1]}/grades`;
  } catch {
    return null;
  }
}
