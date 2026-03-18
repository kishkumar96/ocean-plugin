# ocean-widget-platform

Shared UI shell, hooks, and utilities for ocean widgets.

## Structure
- `src/components/` – shareable UI elements
- `src/hooks/` – reusable hooks and state helpers
- `src/utils/` – platform metadata helpers
- `src/shell/` – lightweight runtime shell/provider

## Scripts
- `npm run build` – outputs tree-shakeable ESM/CJS bundles to `dist/`
- `npm run lint` – lint the package

## Usage
```js
import { PlatformPlaceholder } from 'ocean-widget-platform';

export const Example = () => (
  <PlatformPlaceholder widgetName="Widget 5" />
);
```
