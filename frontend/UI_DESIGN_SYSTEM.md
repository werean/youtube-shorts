# Frontend UI Design System Reference

## Purpose

This document defines the UI standards for dialogs and shared components in the frontend.

## Design System In Use

The frontend follows a component-first design system with:

- Tokenized colors and spacing from `src/styles/variables.css` and `src/lib/tokens.css`
- Shared style layers from `src/styles/index.css`
- Reusable UI primitives in `src/components/ui/`
- Dialog-level consistency rules in `src/styles/dialogs.css`

## Standard Components

Use these primitives before creating any custom UI:

- Modal: `src/components/ui/Modal.tsx`
- Button: `src/components/ui/actions/Button/Button.tsx`
- Text input: `src/components/ui/forms/TextField/TextField.tsx`
- Card, badges, feedback, loader and others: `src/components/ui/`

## Dialog Standard

All dialogs should follow this structure:

1. Use `Modal` as the container
2. Put primary content in modal body
3. Put actions in modal footer
4. Use shared button variants (`primary`, `secondary`, `ghost`, `danger`)
5. Use shared input components (`TextField`) for user-entered fields

### Header Rules

- Let `Modal` render title and close button
- Keep title short and action-oriented
- Use description only when additional context is needed

### Body Rules

- Use stack spacing patterns (`ds-dialog-stack`) for vertical rhythm
- Keep labels and fields grouped with consistent gaps
- Use reusable utility classes from `src/styles/dialogs.css` for grids/lists/cards

### Footer Rules

- Use `ds-dialog-actions` for aligned action rows
- Default order: secondary action first, primary/danger action last
- Keep button copy consistent and verb-based

## Spacing and Layout Rules

- Default dialog content spacing is managed by `Modal` and shared dialog classes
- Preferred gaps:
  - Section stacking: 16px
  - Related field groups: 12px
  - Action buttons: 10px
- Use responsive grid collapse at mobile widths for multi-column dialog layouts

## Reusability and Componentization Principles

- Apply visual fixes in shared components or shared CSS utility classes
- Avoid inline one-off styling when an existing shared class/component can be reused
- Do not duplicate dialog structure in page components
- Keep behavior in feature components, visual structure in shared primitives
- Prefer composition: feature dialog + shared modal + shared controls

## Practical Rules for New Work

- If a new dialog is needed, start from existing refactored dialogs (Timestamp, Batch Pipeline, Transcription dialogs)
- If a field style is inconsistent, update shared field component or dialog utility class, not just one screen
- If button behavior or style is inconsistent, update/use shared Button component

## Scope Notes

- The `3. Selected Video` card is treated as the reference baseline for in-screen (non-dialog) interaction patterns
- Dialog consistency should align with that baseline while still using modal-specific structure and spacing
