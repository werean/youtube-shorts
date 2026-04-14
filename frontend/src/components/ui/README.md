# Production-Ready UI Components

This folder provides reusable, accessible React primitives for production UIs.

## Component Architecture

Layer 1: Foundation

- `VisuallyHidden`: screen-reader-only content.
- `Spinner`, `Skeleton`, `LoadingOverlay`: loading primitives.

Layer 2: Inputs and feedback

- `TextField`: label, hint, validation, counter, loading.
- `InlineMessage`: info/success/warning/error feedback.

Layer 3: Composition

- `Button`: variants, loading states, icon slots.
- `Card`: content container with header/footer/loading.
- `EmptyState`: resilient blank-state messaging and call-to-action.
- `Modal`: accessible dialog with focus trap and keyboard support.

Layer 4: Consumption

- `index.ts`: single import surface with side-effect style import.
- `ComponentShowcase.tsx`: practical examples and edge-case coverage.

## Prop Design (summary)

### `Button`

- `variant`: `primary | secondary | ghost | danger`
- `size`: `sm | md | lg`
- `loading`: disables interaction and shows spinner
- `leftIcon`, `rightIcon`, `fullWidth`
- Native button props supported (`onClick`, `type`, `disabled`, etc.)

### `Card`

- `as`: polymorphic element (`section`, `article`, etc.)
- `title`, `description`, `actions`, `footer`
- `loading` + `loadingLabel`
- `compact` for denser layouts

### `TextField`

- `label`, `hint`, `error`
- `startAdornment`, `endAdornment`
- `showCounter` + `maxLength`
- `loading` state for async validation/fetch
- Native input props supported

### `InlineMessage`

- `tone`: `info | success | warning | error`
- `title`, `children`, `action`
- `onDismiss` + `dismissLabel`

### `Modal`

- `open`, `onClose`, `title`, `description`, `footer`
- `size`: `sm | md | lg | xl`
- `closeOnEscape`, `closeOnOverlayClick`
- `initialFocusRef` for deterministic focus placement

### `EmptyState`

- `title`, `description`, `icon`, `action`, `compact`

### `Spinner` / `Skeleton` / `LoadingOverlay`

- Fine-grained loading rendering with accessibility labels

## Accessibility guarantees

- Focus-visible styles on interactive elements.
- `Modal` uses `role="dialog"`, `aria-modal`, focus trap and Escape handling.
- `InlineMessage` maps severity to `status` or `alert` roles.
- `TextField` wires `label`, `aria-invalid`, and `aria-describedby` for hint/error/counter.
- Loading components expose polite status announcements.

## Responsive behavior

- Components rely on fluid spacing and typography.
- `ui.css` includes media query adjustments for tighter mobile density.

## How to use

```tsx
import { Button, Card, TextField, InlineMessage, Modal } from "./components/ui";
```

Styles are loaded automatically via `components/ui/index.ts`.
