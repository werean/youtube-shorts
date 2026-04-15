Follow the UI architecture guidelines defined below. Do not ignore them.

Issue to fix:

In the “Application Configuration” section, the download resolution select is missing the dropdown arrow icon. Restore the arrow and ensure it matches the styling and positioning used in all other select inputs.

There are multiple inconsistencies across the UI:
- Different implementations for the same types of elements (buttons, selects, inputs, cards, etc.)
- Inconsistent spacing, padding, and layout between similar components
- UI elements changing appearance depending on where they are used (e.g., the “Upload” button differs between “YouTube URL” and “Local File”)

Required changes:

- Refactor the entire UI to ensure ALL elements follow a single, unified standard
- Create reusable components for all recurring UI elements (buttons, selects, inputs, cards, etc.)
- Ensure each component controls its own styling and structure
- All variations must be handled via props, not separate implementations
- Remove any duplicated styles or isolated implementations
- Do not create new styles if an equivalent already exists

Important:

This is not limited to specific components.  
ALL UI elements must strictly follow the same design system.

Any inconsistency must be fixed at the component level, not locally.

---

# UI Architecture & Component Standards

## Core Principle

All UI elements must follow a single source of truth.  
No duplicated styles. No isolated implementations.

---

## Reusability Requirement

Any UI element that is used more than once, or has the potential to be reused, MUST be implemented as a reusable component.

- No duplicated implementations of the same element are allowed
- All shared elements (buttons, inputs, selects, cards, layouts, etc.) must be centralized into reusable components
- Components must encapsulate their styling and structure
- Variations in behavior must be handled via props, not by creating new components

All changes to UI behavior or styling must be made at the component level.

- Modifying a component must automatically propagate changes across the entire application
- It must never be necessary to update the same UI element in multiple places

---

## Componentization Rules

### Global Rule

- Any repeated UI pattern MUST be a reusable component
- No element should have multiple implementations with different styles
- Components must be generic and reusable

### Buttons

- All buttons MUST use a shared component (e.g., `AppButton`)
- Direct use of `<button>` with custom styling is NOT allowed
- Styling must be centralized

### Select Inputs

- All select inputs MUST use a shared component (e.g., `AppSelect`)
- The dropdown arrow MUST always be present
- The arrow position must be consistent across all selects
- Styling must be centralized
- No custom select implementations are allowed

### Inputs

- All inputs MUST follow a shared pattern or component
- Padding, borders, and spacing must be consistent

### Cards / Containers

- All cards MUST follow the same layout and spacing structure
- Internal spacing must be standardized

---

## Styling Rules

- Never create isolated CSS
- Always reuse shared styles or tokens
- Maintain consistent spacing, alignment, and typography
- UI must look identical regardless of where components are used

---

## Forbidden Practices

- Duplicated styles
- Inline styling for layout
- Multiple implementations of the same UI element
- Removing expected UI elements (e.g., select arrow)
- One-off styling exceptions

---

## Expected Behavior

- A change in a component reflects everywhere
- New UI is built only by composing existing components
- The UI remains consistent and predictable across the entire application

---

## Philosophy

Scalability over speed  
Consistency over convenience  
Reusability over quick fixes