# Repository Guidelines

## Project Structure & Module Organization

This is a Vite React and TypeScript single-page application. Entry points are `src/main.tsx` and `src/App.tsx`. Reusable UI lives in `src/components/`, viewport behavior in `src/features/viewport/`, and orchestration hooks in `src/hooks/`. BrowserOS JSON-RPC code is under `src/lib/browseros/`; input mapping and scheduling utilities are under `src/lib/interaction/`. Global styles are in `src/styles.css`.

Tests are colocated with source files as `*.test.ts` or `*.test.tsx`. Playwright scenarios and the mock MCP server live in `e2e/`. Do not commit generated `dist/` output. Pages deployment is defined in `.github/workflows/deploy-pages.yml`.

## Build, Test, and Development Commands

- `npm ci`: install the exact dependency versions from `package-lock.json`.
- `npm run dev`: start Vite at the local development origin.
- `npm run typecheck`: run strict TypeScript checks without emitting files.
- `npm test`: run the Vitest suite once.
- `npm run test:watch`: rerun affected Vitest tests during development.
- `npm run test:e2e`: run Playwright against the cross-origin mock MCP service.
- `npm run build`: type-check and create the production bundle.

Use Node.js 20.19+ or 22.12+. Install Chromium once with `npx playwright install chromium`.

## Coding Style & Naming Conventions

Match existing TypeScript: two-space indentation, single quotes, no semicolons, trailing commas in multiline structures, and ES modules. Use `PascalCase` for React components and exported types, `camelCase` for functions and variables, and `UPPER_SNAKE_CASE` for constants. Keep transport, interaction, and presentation concerns in their existing modules. There is no configured formatter or linter; `npm run typecheck` is the mandatory static check.

## Testing Guidelines

Use Vitest, React Testing Library, and `jest-dom` for unit/component behavior; use Playwright for complete browser flows. Name tests after the source unit and cover success, validation, timeout, and stale-response paths. No numeric coverage threshold is enforced, but every behavioral change should add or update focused tests. Real BrowserOS integration tests require `BROWSEROS_MCP_URL` and should remain optional.

## Commit & Pull Request Guidelines

Follow the existing Conventional Commit form, for example `feat: add viewport controls` or `fix: discard stale frames`. Keep commits focused. Pull requests should explain behavior and verification commands, link relevant issues, and include screenshots for UI changes. Call out BrowserOS protocol or deployment-origin changes explicitly.

## Security & Configuration

Never persist the MCP URL or add credentials to source. BrowserOS must trust the exact frontend origin through `BROWSEROS_TRUSTED_ORIGINS`. Do not expose an unauthenticated MCP endpoint publicly, and remember that an HTTPS frontend requires an HTTPS MCP endpoint.
