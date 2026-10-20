/** Two initials for an avatar: "Janez Kos" → "JK". */
export function initialsOf(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toLocaleUpperCase() ?? '')
    .join('');
}

/** A stable avatar tone (0–4) per person, so the same worker keeps the same colour on every screen. */
export function avatarTone(name: string): number {
  let h = 0;
  for (const ch of name) h = (h * 31 + (ch.codePointAt(0) ?? 0)) >>> 0;
  return h % 5;
}
