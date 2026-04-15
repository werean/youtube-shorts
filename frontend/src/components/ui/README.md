# Monochromatic Design System

This folder contains a zinc-based design system focused on workflow clarity for video clip generation.

## Core primitives

- `Button.tsx`: `primary | ghost | destructive`, fixed heights (`h-7`, `h-8`, `h-9`), leading icon slot, loading state.
- `Card.tsx`: `default | flat`, 10px radius, 0.5px border, slot props (`header`, `body`, `footer`).
- `Badge.tsx`: `default | success | warning | danger | outline`, caption-scale labels.
- `Progress.tsx`: 4px track, 2px radius, 400ms fill transition, mandatory label and percentage row.
- `StatusRow.tsx`: status dot + message + right-aligned tag.
- `Tabs.tsx`: compact pill tabs for category switching.
- `UploadZone.tsx`: drag/drop with visible idle, drag-over, uploading, success, error states.
- `ClipCard.tsx`: horizontal clip row with score badge, metadata, and icon actions.
- `AIBubble.tsx`: model metadata chip and highlighted analysis terms.
- `TranscriptViewer.tsx`: timestamp-seekable transcript list with empty state CTA.

## Style system

- Token source: `src/lib/tokens.css`
- Utility helper: `src/lib/utils.ts` (`cn` = `clsx` + `tailwind-merge`)
- Tailwind extension: `tailwind.config.ts` with zinc token mapping and typography scale.

## Rules baked into components

- Visible workflow states (`idle`, `loading`, `success`, `error`) in upload and async hooks.
- Score explanation on clip cards through `title` tooltip text.
- Sort controls in clip list (`score`, `duration`, `timestamp`).
- Confirmation step for destructive actions (`delete clip`, `clear session`).
- Sidebar stage indicators to reflect workflow progression.

## Consumption

```tsx
import { Button, Card, UploadZone, ClipCard, AIBubble, TranscriptViewer } from "./components/ui";
```

Feature wrappers live under `src/components/features/*` and layout shell components under `src/components/layout/*`.
