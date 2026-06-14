/**
 * palettes.ts — the renderer-side ambient palette table. gen stores only
 * ambient.paletteId (category hash % PALETTE_COUNT, generate.ts); what each
 * id LOOKS like is display data and lives here, so palette tuning never
 * touches goldens.
 *
 * Index-aligned with gen/lore.ts MOODS (the `mood` field is that table's
 * id) — palette 3 systems read funereal and look funereal. A test pins
 * both alignments.
 */

export interface Palette {
  /** Primary nebula cloud color. */
  nebulaA: string;
  /** Secondary cloud color (mixed by noise). */
  nebulaB: string;
  /** Bright wisp highlight. */
  nebulaC: string;
  /** gen/lore.ts MOODS id at the same index. */
  mood: string;
}

export const PALETTES: readonly Palette[] = [
  { mood: 'serene', nebulaA: '#0e3a4a', nebulaB: '#10565e', nebulaC: '#7fd4ff' },
  { mood: 'desolate', nebulaA: '#2a2620', nebulaB: '#3a3328', nebulaC: '#8a8070' },
  { mood: 'feverish', nebulaA: '#4a1a10', nebulaB: '#6e2a0e', nebulaC: '#ffb35e' },
  { mood: 'funereal', nebulaA: '#221a33', nebulaB: '#332244', nebulaC: '#9a86c8' },
  { mood: 'verdant', nebulaA: '#10331e', nebulaB: '#1a4a28', nebulaC: '#9ee887' },
  { mood: 'industrial', nebulaA: '#33240f', nebulaB: '#4a3312', nebulaC: '#d8a86a' },
  { mood: 'haunted', nebulaA: '#13242e', nebulaB: '#1d3340', nebulaC: '#aee6ff' },
  { mood: 'radiant', nebulaA: '#3c2e10', nebulaB: '#564214', nebulaC: '#ffe8b0' },
  { mood: 'brackish', nebulaA: '#1e2a1a', nebulaB: '#2c3a24', nebulaC: '#a8b88a' },
  { mood: 'austere', nebulaA: '#1a2230', nebulaB: '#242e42', nebulaC: '#b8c8e8' },
  { mood: 'opaline', nebulaA: '#33202e', nebulaB: '#442e40', nebulaC: '#e8a8d8' },
  { mood: 'ashen', nebulaA: '#26181a', nebulaB: '#382224', nebulaC: '#c87a6a' },
] as const;

/** '#rrggbb' -> [r, g, b] in 0..1, for shader uniforms. */
export function hexToRgb01(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [((n >> 16) & 0xff) / 255, ((n >> 8) & 0xff) / 255, (n & 0xff) / 255];
}

/** Linear mix of two '#rrggbb' colors; t=0 -> a, t=1 -> b. */
export function mixHex(a: string, b: string, t: number): string {
  const na = parseInt(a.slice(1), 16);
  const nb = parseInt(b.slice(1), 16);
  const lerp = (shift: number) => {
    const ca = (na >> shift) & 0xff;
    const cb = (nb >> shift) & 0xff;
    return Math.round(ca + (cb - ca) * t) & 0xff;
  };
  return `#${((lerp(16) << 16) | (lerp(8) << 8) | lerp(0)).toString(16).padStart(6, '0')}`;
}

/**
 * §13.2 — the nebula colors for a system, with the controlling faction's tint
 * blended in so a region reads as "theirs". Pure display helper (faction tint
 * is render data, passed in from gen/factions' archetype). null = unaligned
 * frontier → the untinted ambient palette. The highlight wisp (C) takes the
 * strongest tint; the base clouds stay mostly the category palette so the
 * mood↔palette alignment (lore.ts) survives.
 */
export function nebulaColorsFor(
  palette: Palette,
  factionTint: string | null,
): { a: string; b: string; c: string } {
  if (!factionTint) return { a: palette.nebulaA, b: palette.nebulaB, c: palette.nebulaC };
  return {
    a: mixHex(palette.nebulaA, factionTint, 0.16),
    b: mixHex(palette.nebulaB, factionTint, 0.16),
    c: mixHex(palette.nebulaC, factionTint, 0.3),
  };
}
