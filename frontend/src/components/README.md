# React component structure

- **Atoms** (`atoms/`): small visual primitives such as icons and badges.
- **Molecules** (`molecules/`): reusable controls and compact combinations of atoms, including domain widgets.
- **Organisms** (`organisms/`): complete page sections, charts, panels, and application chrome.
- **Templates** (`templates/`): route layouts and application gates.
- **Pages** (`../pages/`): route components that load data, own interactions, and compose the layers above.

`index.ts` is the shared component entrypoint. API clients stay in `../api/`; feature state and configuration stay in `../features/`; non-visual formatters stay in `../utils/`. Existing CSS classes are kept on the same rendered elements.
