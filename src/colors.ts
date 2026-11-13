const SATURATION = 80;
const LIGHTNESS = 55;

/**
 * Stable pseudo-random color per participant id: every client sees the same
 * color for the same user, and hue changes between users while saturation and
 * lightness stay fixed so all characters share the same tone.
 */
export const characterColor = (id: string): string => {
  // FNV-1a 32-bit hash.
  let hash = 0x811c9dc5;
  for (let i = 0; i < id.length; i += 1) {
    hash ^= id.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }

  const hue = Math.abs(hash) % 360;
  return `hsl(${hue}, ${SATURATION}%, ${LIGHTNESS}%)`;
};
