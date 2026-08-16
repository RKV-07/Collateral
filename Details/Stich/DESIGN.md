---
name: Obsidian Monetary
colors:
  surface: '#121414'
  surface-dim: '#121414'
  surface-bright: '#37393a'
  surface-container-lowest: '#0c0f0f'
  surface-container-low: '#1a1c1c'
  surface-container: '#1e2020'
  surface-container-high: '#282a2b'
  surface-container-highest: '#333535'
  on-surface: '#e2e2e2'
  on-surface-variant: '#c7c6ca'
  inverse-surface: '#e2e2e2'
  inverse-on-surface: '#2f3131'
  outline: '#919094'
  outline-variant: '#46464a'
  surface-tint: '#c8c6c7'
  primary: '#c8c6c7'
  on-primary: '#313031'
  primary-container: '#0a0a0b'
  on-primary-container: '#7a797a'
  inverse-primary: '#5f5e5f'
  secondary: '#45dfa4'
  on-secondary: '#003825'
  secondary-container: '#00bd85'
  on-secondary-container: '#00452e'
  tertiary: '#ffb2b9'
  on-tertiary: '#67001f'
  tertiary-container: '#1f0005'
  on-tertiary-container: '#cd4e62'
  error: '#ffb4ab'
  on-error: '#690005'
  error-container: '#93000a'
  on-error-container: '#ffdad6'
  primary-fixed: '#e5e2e3'
  primary-fixed-dim: '#c8c6c7'
  on-primary-fixed: '#1c1b1c'
  on-primary-fixed-variant: '#474647'
  secondary-fixed: '#68fcbf'
  secondary-fixed-dim: '#45dfa4'
  on-secondary-fixed: '#002114'
  on-secondary-fixed-variant: '#005137'
  tertiary-fixed: '#ffdadc'
  tertiary-fixed-dim: '#ffb2b9'
  on-tertiary-fixed: '#400010'
  on-tertiary-fixed-variant: '#891933'
  background: '#121414'
  on-background: '#e2e2e2'
  surface-variant: '#333535'
typography:
  display-lg:
    fontFamily: Hanken Grotesk
    fontSize: 48px
    fontWeight: '800'
    lineHeight: '1.1'
    letterSpacing: -0.04em
  headline-lg:
    fontFamily: Hanken Grotesk
    fontSize: 32px
    fontWeight: '700'
    lineHeight: '1.2'
    letterSpacing: -0.02em
  headline-lg-mobile:
    fontFamily: Hanken Grotesk
    fontSize: 24px
    fontWeight: '700'
    lineHeight: '1.2'
    letterSpacing: -0.02em
  body-md:
    fontFamily: Hanken Grotesk
    fontSize: 16px
    fontWeight: '400'
    lineHeight: '1.6'
    letterSpacing: 0em
  data-lg:
    fontFamily: JetBrains Mono
    fontSize: 20px
    fontWeight: '500'
    lineHeight: '1.4'
    letterSpacing: -0.02em
  data-sm:
    fontFamily: JetBrains Mono
    fontSize: 12px
    fontWeight: '400'
    lineHeight: '1.4'
    letterSpacing: 0.02em
  label-caps:
    fontFamily: JetBrains Mono
    fontSize: 10px
    fontWeight: '700'
    lineHeight: '1'
    letterSpacing: 0.1em
rounded:
  sm: 0.25rem
  DEFAULT: 0.5rem
  md: 0.75rem
  lg: 1rem
  xl: 1.5rem
  full: 9999px
spacing:
  unit: 4px
  container-padding: 32px
  gutter: 16px
  stack-sm: 8px
  stack-md: 24px
  stack-lg: 48px
---

## Brand & Style

The design system is centered on an ultra-minimalist, high-utility fintech aesthetic. It targets sophisticated users who value speed, precision, and clarity over decorative flair. The emotional response is one of controlled power and absolute transparency.

The style is **Matte Minimalism**: 
- **Monochrome Base**: A near-black canvas that allows financial data to command attention.
- **Precision Engineering**: Sharp corners and 1px borders evoke the feel of high-end hardware or professional trading terminals.
- **High-Utility Contrast**: Color is used strictly as a data signal (gain/loss/action), never for decoration.
- **Negative Space**: Generous whitespace is used as a functional tool to reduce cognitive load in complex data environments.

## Colors

The palette is strictly functional. The background is a matte near-black (#0A0A0B), providing a void-like depth that makes white text highly legible.

- **Primary**: The foundation. Used for backgrounds and primary containers.
- **Accent (Positive)**: Emerald (#34D399) represents growth, profit, and successful validation. Use it sparingly for trend lines and "Buy" actions.
- **Accent (Negative)**: Rose (#FB7185) represents decline, loss, or critical errors. Used for "Sell" actions and downward volatility.
- **Neutral**: Pure white (#FFFFFF) for primary text and high-priority icons. Mid-greys (#737373) are reserved for secondary metadata.
- **Dividers**: A subtle charcoal (#262626) is used for 1px hairline borders.

## Typography

This design system utilizes a dual-font strategy to separate narrative from data.

- **Headlines & Body (Hanken Grotesk)**: Chosen for its sharp, contemporary geometry. Headlines should be set with tight letter-spacing and heavy weights to create a sense of structural permanence.
- **Financial Data (JetBrains Mono)**: All numerical values, timestamps, and technical metadata must use this monospaced face. This ensures tabular data aligns perfectly and remains readable at small sizes.
- **Hierarchy**: Use `label-caps` for table headers and section overviews to differentiate from interactive body text.

## Layout & Spacing

The layout follows a rigorous 4px grid system. 

- **Grid**: A 12-column fixed grid for desktop (max-width 1440px) and a fluid 4-column grid for mobile.
- **Margins**: Generous 32px external margins create a "frame" around the data, reinforcing the premium aesthetic.
- **Dividers**: Use 1px solid lines (#262626) instead of shadows to separate logical sections.
- **Negative Space**: Elements should be spaced aggressively; when in doubt, increase padding to maintain the "Matte" feel.

## Elevation & Depth

This design system rejects traditional shadows and blurs. Depth is communicated through color value and containment:

- **Level 0 (Background)**: #0A0A0B. The base canvas.
- **Level 1 (Platters/Cards)**: #141416. Subtle lift for primary content areas. No shadow.
- **Interaction**: Active states are indicated by a 1px white border or a shift in background to #1C1C1E.
- **Depth via Lines**: Layers are "stacked" using 1px stroke offsets rather than Z-axis shadows. This maintains a flat, technical appearance.

## Shapes

The design system uses "2xl" rounding (defined here as Level 2) to provide a sophisticated contrast against the sharp 1px grid lines.

- **Primary Elements**: Buttons and Input fields use a 0.5rem (8px) radius.
- **Containers**: Large dashboard cards or modal overlays use a 1.5rem (24px) radius.
- **Data Points**: Small indicators (chips, tags) use a 4px radius to maintain technical precision.

## Components

### Buttons
- **Primary**: Solid white background with near-black text. Sharp Hanken Grotesk Bold.
- **Secondary**: Transparent background with a 1px #262626 border. White text.
- **Tertiary**: Ghost style. JetBrains Mono text with an underline on hover.

### Input Fields
- Background is #141416 with a 1px bottom-border only (#262626). 
- On focus, the border becomes white.
- Labels use `label-caps` typography, positioned 8px above the input.

### Cards & Containers
- Flat #141416 background. 
- 1px border (#262626) is mandatory. 
- No shadows.

### Data Visualizations
- Trend lines: 2px stroke width. 
- Colors: #34D399 (Positive) and #FB7185 (Negative) only. 
- Use a subtle #141416 fill below the line for area charts, with no transparency blurs.

### Chips & Tags
- Monospace font (JetBrains Mono).
- Background-less with a 1px border. 
- Used for status indicators (e.g., "PENDING", "COMPLETED").