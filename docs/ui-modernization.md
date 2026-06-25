# Storyteller UI Modernization

## Overview

The Storyteller UI has been modernized with a sleek, professional dark theme inspired by modern video editing tools. The redesign focuses on improved visual hierarchy, better contrast, and a more polished user experience.

## Design System

### Color Palette

#### Background Colors
| Variable | Value | Usage |
|----------|-------|-------|
| `--bg-primary` | `#0a0b0f` | Main application background |
| `--bg-secondary` | `#111318` | Panel backgrounds |
| `--bg-tertiary` | `#1a1d24` | Elevated surfaces |
| `--bg-elevated` | `#22262e` | Cards and modals |
| `--bg-card` | `#16181e` | Card backgrounds |

#### Surface Colors (Depth Layers)
| Variable | Value | Usage |
|----------|-------|-------|
| `--surface-1` | `#0d0e12` | Deepest surface |
| `--surface-2` | `#14161c` | Secondary surface |
| `--surface-3` | `#1c1f27` | Tertiary surface |
| `--surface-4` | `#252a33` | Lightest surface |

#### Accent Colors
| Variable | Value | Usage |
|----------|-------|-------|
| `--accent-primary` | `#00d4ff` | Primary cyan accent |
| `--accent-secondary` | `#00a8cc` | Secondary cyan |
| `--accent-tertiary` | `#007a99` | Tertiary cyan |
| `--accent-purple` | `#a855f7` | Purple accent for variety |
| `--accent-glow` | `rgba(0, 212, 255, 0.3)` | Glow effects |

#### Text Colors
| Variable | Value | Usage |
|----------|-------|-------|
| `--text-primary` | `#ffffff` | Primary text |
| `--text-secondary` | `#a1a7b3` | Secondary text |
| `--text-tertiary` | `#6b7280` | Muted text |
| `--text-muted` | `#4b5563` | Disabled/hint text |

#### Status Colors
| Variable | Value | Usage |
|----------|-------|-------|
| `--success` | `#10b981` | Success states |
| `--warning` | `#f59e0b` | Warning states |
| `--danger` | `#ef4444` | Error/danger states |
| `--info` | `#3b82f6` | Info states |

### Typography

- **Font Family**: `Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif`
- **Monospace**: `JetBrains Mono, 'Fira Code', 'SF Mono', monospace`

### Spacing Scale

```
--space-1: 4px
--space-2: 8px
--space-3: 12px
--space-4: 16px
--space-5: 20px
--space-6: 24px
--space-8: 32px
--space-10: 40px
--space-12: 48px
```

### Border Radius Scale

```
--radius-sm: 6px
--radius-md: 8px
--radius-lg: 12px
--radius-xl: 16px
--radius-2xl: 20px
--radius-full: 9999px
```

## Components

### ModernLayout

A 3-panel layout system for the main workspace:
- **Left Sidebar**: Resources panel (280px) - assets, media, project files
- **Center**: Main workspace - preview, timeline, editor
- **Right Sidebar**: AI Suggestions panel (320px) - intelligent recommendations

```tsx
<ModernLayout
  leftSidebar={<ResourcePanel />}
  rightSidebar={<AISuggestionsPanel />}
  header={<StepNavigation />}
  footer={<Timeline />}
>
  <MainContent />
</ModernLayout>
```

### StepNavigation

Modern step indicator with:
- Circular step indicators with numbers/checkmarks
- Active step highlighting with glow effect
- Connector lines between steps
- Hover and click interactions

### AISuggestionsPanel

Right sidebar panel featuring:
- Confidence scoring for suggestions
- Type badges (B-roll, Text, Audio, Style)
- Card-based layout with hover effects
- Loading skeleton states

### ResourcePanel

Left sidebar for managing:
- Project assets
- Media files
- Import/upload functionality

### ModernCard

Versatile card component with variants:
- `default`: Standard surface background
- `elevated`: With shadow for emphasis
- `outlined`: Transparent with border

## Updated Pages

### DashboardPage

Complete redesign featuring:
- Fixed sidebar navigation with logo and user info
- Modern project cards with mode icons
- Gradient-accented mode selection cards
- Improved project list with better visual hierarchy
- Quick action buttons with glow effects

### ProjectWorkspacePage

Enhanced with:
- Modern 3-panel layout support
- Updated step navigation
- New AI suggestions panel integration
- Improved timeline visual design

## CSS Features

### Custom Scrollbar

```css
::-webkit-scrollbar {
  width: 8px;
  height: 8px;
}

::-webkit-scrollbar-track {
  background: var(--surface-1);
  border-radius: var(--radius-full);
}

::-webkit-scrollbar-thumb {
  background: var(--surface-4);
  border-radius: var(--radius-full);
}
```

### Glass Morphism

```css
.glass-panel {
  background: rgba(17, 19, 24, 0.8);
  backdrop-filter: blur(12px);
  border: 1px solid var(--border-default);
}
```

### Glow Effects

```css
--shadow-glow: 0 0 20px var(--accent-glow);
--shadow-glow-sm: 0 0 10px var(--accent-glow);
```

### Gradient Text

```css
.gradient-text {
  background: linear-gradient(135deg, var(--accent-primary) 0%, var(--accent-purple) 100%);
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
}
```

## Button Styles

### Primary Button
- Gradient background (cyan)
- Glow shadow
- Hover lift effect

### Secondary Button
- Surface background
- Border
- Hover background change

### Ghost Button
- Transparent background
- Text color only
- Hover background

## Animations

- `overlay-enter`: Fade in with slide up
- `glow-pulse`: Pulsing glow effect
- `slide-in`: Horizontal slide animation
- `fade-in`: Opacity transition

## Migration Guide

### Updating Existing Components

1. **Replace old color variables**:
   ```diff
   - background: 'var(--bg-panel)'
   + background: 'var(--surface-2)'
   ```

2. **Update border colors**:
   ```diff
   - border: '1px solid var(--border)'
   + border: '1px solid var(--border-default)'
   ```

3. **Use new accent colors**:
   ```diff
   - color: 'var(--accent)'
   + color: 'var(--accent-primary)'
   ```

4. **Apply modern card styles**:
   ```diff
   - style={card}
   + style={{ ...card, borderRadius: '16px' }}
   ```

### Adding New Components

Use the modern component library:

```tsx
import { ModernCard, ResourcePanel } from '@renderer/components'

function MyComponent() {
  return (
    <ModernCard
      title="Card Title"
      subtitle="Card description"
      variant="elevated"
    >
      Content here
    </ModernCard>
  )
}
```

## Files Modified

1. `apps/desktop/src/renderer/src/index.css` - Complete theme overhaul
2. `apps/desktop/src/renderer/src/pages/DashboardPage.tsx` - Modernized dashboard
3. `apps/desktop/src/renderer/src/components/ModernLayout.tsx` - New layout system
4. `apps/desktop/src/renderer/src/components/index.ts` - Component exports

## Files Created

1. `apps/desktop/src/renderer/src/components/ModernLayout.tsx`
2. `apps/desktop/src/renderer/src/components/QueryProvider.tsx`
3. `apps/desktop/src/renderer/src/hooks/useProjects.ts`
4. `apps/desktop/src/renderer/src/hooks/index.ts`

## Future Enhancements

1. **Animation Library**: Consider adding Framer Motion for smoother transitions
2. **Icon System**: Implement Lucide icons consistently
3. **Dark/Light Mode**: Add theme switching capability
4. **Responsive Design**: Improve mobile/tablet layouts
5. **Accessibility**: Enhance ARIA labels and keyboard navigation
