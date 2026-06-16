# Viewframe

Viewframe is a dependency-free MVP of the PRD in `Viewframe PRD.pdf`: a visual review board for live websites across tablet, laptop, desktop, and custom responsive breakpoints.

## Run

```bash
npm run dev
```

Open `http://localhost:3000`.

## Deploy to Vercel

This project is ready for Vercel as a static app with one Node.js function:

- `index.html`, `styles.css`, and `app.js` are served as static assets.
- Live previews are proxied through `/api/proxy`.
- `npm run build` emits explicit Vercel Build Output API files in `.vercel/output`.
- The local development proxy runs through `server.js`.

Deploy from the Vercel dashboard or CLI:

```bash
vercel
```

Use the default project settings. The repository's `vercel.json` sets the build command.

## Implemented

- URL input with same-origin preview proxy
- Tablet, laptop, desktop, and custom device presets
- Portrait and landscape orientation switching
- Figma-like pan and zoom canvas
- Draggable frames, selection, grouping, duplication, and removal
- Fullscreen review mode for one mockup
- Fullscreen review persists while navigating links inside the live website
- Fullscreen pauses the board behind it so only one live iframe runs at a time
- Realistic, minimal, and wireframe mockup modes
- Fit-to-canvas and actual-viewport scaling modes
- Linked navigation via injected preview bridge
- Optional linked scroll for proxied pages
- PNG export for board or selected frames
- Lightweight rendering: only the selected, on-screen mockup runs a live iframe
- Inactive mockups use static snapshot previews, and offscreen mockups stay lazy
- Live previews reload only when URL, viewport size, or orientation changes

## Notes

The local proxy removes iframe-blocking headers and injects navigation and scroll hooks into HTML pages. Some production websites can still break when proxied because of strict scripts, authentication, bot protection, or asset policies. Full-fidelity screenshot fallback would require a browser automation runtime such as Playwright.
