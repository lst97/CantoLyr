# Repository Guidelines

## Project Structure & Modules

- `src/domain`: Core entities, value objects, pure domain services.
- `src/application`: Use cases and service orchestration (no IO logic).
- `src/infrastructure`: Adapters for HTTP (Fastify), DB (Prisma), LLM, cache; `config/` and DI `container/`.
- `src/shared`: Reusable utils and types.
- `tests/`: `unit/`, `integration/`, `e2e/` suites. Some adapter tests live near code under `__tests__/`.
- `prisma/`: Schema and migrations; `scripts/`: data normalization/seed helpers.
- `data/`: Sample datasets used by seed scripts; `docs/`: configuration and LLM notes.

## Build, Test, Run

- Install: `pnpm install`
- Dev server: `pnpm dev` (hot reload, reads `.env`).
- Build: `pnpm build` (emits to `dist/`).
- Start prod: `pnpm start`
- Tests: `pnpm test` | watch `pnpm run test:watch` | coverage `pnpm run test:coverage`
- Lint: `pnpm lint` | fix `pnpm run lint:fix`
- DB: `docker compose up db -d` → `pnpm run db:generate` → `pnpm run db:migrate` → seed `pnpm exec tsx scripts/seed-sample-data.ts`

## Coding Style & Naming

- Language: TypeScript (strict). Path aliases: `@/domain`, `@/application`, `@/infrastructure`, `@/shared`.
- Linting: ESLint with `@typescript-eslint` (no unused vars, prefer optional chaining/nullish coalescing, no floating promises).
- Indentation: 2 spaces; semicolons required; `camelCase` for variables/functions, `PascalCase` for classes/use cases, constants `UPPER_SNAKE_CASE`.
- Filenames: class-based modules often `PascalCase.ts`; utilities/scripts use kebab-case (e.g., `normalize-wordslist.ts`).

## Testing Guidelines

- Framework: Vitest (node env, v8 coverage). Place specs as `*.test.ts` under `tests/` or co-located `__tests__/` for adapters.
- Integration DB: set `TEST_DATABASE_URL` when hitting Postgres. Example: `TEST_DATABASE_URL="postgresql://user:pass@localhost:5432/cantolyr_test" pnpm test`.
- Aim for meaningful coverage on domain and application layers; mock external adapters.

## Commit & PR Guidelines

- Commits: Conventional Commits (e.g., `feat: ...`, `fix: ...`, `chore: ...`).
- PRs: clear description, rationale, and scope; link issues; include before/after for API or schema changes; update `docs/` when configs/LLM behavior change.
- Pre-submit: run `pnpm lint` and `pnpm test` locally.

## Security & Configuration

- Never commit secrets; copy `.env.example` → `.env`. See `docs/CONFIGURATION.md`.
- LLM provider and API keys configured via env; prefer adapter interfaces (`application/ports`) over direct SDK usage.

## Architecture Notes (for agents)

- Preserve boundaries: domain is pure; application orchestrates; infrastructure implements ports. When adding IO, create/extend a port under `application/ports` and supply an adapter in `infrastructure` with DI wiring in `Container`.
