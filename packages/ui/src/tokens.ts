// Neutral shadcn base, low-variance. Single source for colors, radius, spacing and fonts (ADR: design tokens in packages/ui).
const c = (light: string, dark: string) => ({ light, dark });

export const tokens = {
  color: {
    background: c('oklch(1 0 0)', 'oklch(0.145 0 0)'),
    foreground: c('oklch(0.145 0 0)', 'oklch(0.985 0 0)'),
    card: c('oklch(1 0 0)', 'oklch(0.205 0 0)'),
    'card-foreground': c('oklch(0.145 0 0)', 'oklch(0.985 0 0)'),
    primary: c('oklch(0.205 0 0)', 'oklch(0.922 0 0)'),
    'primary-foreground': c('oklch(0.985 0 0)', 'oklch(0.205 0 0)'),
    secondary: c('oklch(0.97 0 0)', 'oklch(0.269 0 0)'),
    'secondary-foreground': c('oklch(0.205 0 0)', 'oklch(0.985 0 0)'),
    muted: c('oklch(0.97 0 0)', 'oklch(0.269 0 0)'),
    'muted-foreground': c('oklch(0.556 0 0)', 'oklch(0.708 0 0)'),
    accent: c('oklch(0.97 0 0)', 'oklch(0.269 0 0)'),
    'accent-foreground': c('oklch(0.205 0 0)', 'oklch(0.985 0 0)'),
    destructive: c('oklch(0.577 0.245 27.325)', 'oklch(0.704 0.191 22.216)'),
    border: c('oklch(0.922 0 0)', 'oklch(1 0 0 / 10%)'),
    input: c('oklch(0.922 0 0)', 'oklch(1 0 0 / 15%)'),
    ring: c('oklch(0.708 0 0)', 'oklch(0.556 0 0)'),
  },
  radius: '0.625rem',
  spacing: '0.25rem',
  font: {
    sans: "ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif",
    mono: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
  },
} as const;

export type Tokens = typeof tokens;
