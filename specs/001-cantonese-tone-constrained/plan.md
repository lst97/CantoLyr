# Implementation Plan: Cantonese Tone‑Constrained Lyric Generation (Spec v2)

**Branch**: `001-cantonese-tone-constrained` | **Date**: 2025-09-13 | **Spec**:
`specs/001-cantonese-tone-constrained/spec.md` **Input**: Feature specification (Updated Flow v2)

## Execution Flow (/plan command scope)

```
1. Load feature spec from Input path
   → If not found: ERROR "No feature spec at {path}"
2. Fill Technical Context (scan for NEEDS CLARIFICATION)
   → Detect Project Type from context (web=frontend+backend, mobile=app+api)
   → Set Structure Decision based on project type
3. Evaluate Constitution Check section below
   → If violations exist: Document in Complexity Tracking
   → If no justification possible: ERROR "Simplify approach first"
   → Update Progress Tracking: Initial Constitution Check
4. Execute Phase 0 → research.md
   → If NEEDS CLARIFICATION remain: ERROR "Resolve unknowns"
5. Execute Phase 1 → contracts, data-model.md, quickstart.md, agent-specific template file (e.g., `CLAUDE.md` for Claude Code, `.github/copilot-instructions.md` for GitHub Copilot, or `GEMINI.md` for Gemini CLI).
6. Re-evaluate Constitution Check section
   → If new violations: Refactor design, return to Phase 1
   → Update Progress Tracking: Post-Design Constitution Check
7. Plan Phase 2 → Describe task generation approach (DO NOT create tasks.md)
8. STOP - Ready for /tasks command
```

**IMPORTANT**: The /plan command STOPS at step 7. Phases 2-4 are executed by other commands:

- Phase 2: /tasks command creates tasks.md
- Phase 3-4: Implementation execution (manual or via tools)

## Summary

Implement a deterministic, tone-constrained lyric generation pipeline that:

1. Segments each tone sequence into exactly 3 deterministic patterns.
2. Infers a micro-scene intent per line (light LLM).
3. Builds a candidate pool via semantic retrieval (~200) + frequency enrichment (100 top + 50
   random) without fallback expansion.
4. Generates 15 tone-constrained sentences (3×5) strictly from pool.
5. Reranks (TopK → cross-encoder → MMR) to produce Top 3 sentences per line.
6. Assembles 3 paragraph variants optimizing coherence and emotional arc.
7. Provides warnings (no silent fallback) and supports line regeneration with reproducibility
   (seed).

Artifacts produced so far: `research.md`, `data-model.md`, contracts (`segmentation.md`,
`retrieval.md`, `generation.md`, `ranking.md`, `paragraph-assembly.md`), `quickstart.md`.

## Technical Context

**Language/Version**: TypeScript (Deno runtime) + Prisma (existing)\
**Primary Dependencies**: Chroma DB (semantic retrieval), Gemini (LLM tiers), Prisma client (lexicon
frequency), Transformers.js embedding (already used in `test-chroma.ts`)\
**Storage**: Postgres (lexicon/frequency via Prisma), Chroma vector store, in-memory session objects
(MVP)\
**Testing**: Deno test (unit + integration), contract tests in `tests/contract` mirroring spec
contracts\
**Target Platform**: Local dev / containerized services (docker-compose)\
**Project Type**: Single project (Option 1)\
**Performance Goals**: <6s P95 per line (non-blocking creative latency)\
**Constraints**: Deterministic seed option; no fallback semantic expansion beyond specified layers\
**Scale/Scope**: Dozens of lines per session (≤12 recommended for paragraph assembly complexity)

All NEEDS CLARIFICATION from spec are resolved except: final emotion taxonomy & safety category list
(non-blocking, config placeholders).

## Constitution Check

_GATE: Must pass before Phase 0 research. Re-check after Phase 1 design._

**Simplicity**:

- Projects: 1 (meets <=3)
- Direct use of existing adapters; no new abstraction layers beyond service functions.
- Single logical data model (entities documented in `data-model.md`).
- No added Repository/UoW (reuse existing Prisma adapter only for frequency lookups).

**Architecture**:

- Feature integrated into existing `src` (service layer + CLI entry to be added) treatable as
  internal library.
- Planned CLI command: `lyrics:generate` (per quickstart) with `--json` input.
- Documentation present (`quickstart.md`, contracts/*). llms context file optional later.

**Testing (NON-NEGOTIABLE)**:

- Will add contract tests first for each service (segmentation, retrieval, generation, ranking,
  paragraph assembly).
- Integration tests will spin against local Chroma + seeded Postgres subset (fixture script) for
  retrieval validity.
- Tone compliance & segmentation pure functions unit-tested.
- No mocks for DB—real Postgres & Chroma in compose (fast subset dataset).

**Observability**:

- Structured log events per stage: {stage, lineIndex, durationMs, counts}.
- Warning events emitted with distinct codes (WARN_LOW_SEMANTIC, ERROR_DIGIT_INSUFFICIENT).

**Versioning**:

- Internal feature; semantic versioning not yet formalized. Will tag initial release as 0.1.0 when
  CLI added.

## Project Structure

### Documentation (this feature)

```
specs/[###-feature]/
├── plan.md              # This file (/plan command output)
├── research.md          # Phase 0 output (/plan command)
├── data-model.md        # Phase 1 output (/plan command)
├── quickstart.md        # Phase 1 output (/plan command)
├── contracts/           # Phase 1 output (/plan command)
└── tasks.md             # Phase 2 output (/tasks command - NOT created by /plan)
```

### Source Code (repository root)

```
# Option 1: Single project (DEFAULT)
src/
├── models/
├── services/
├── cli/
└── lib/

tests/
├── contract/
├── integration/
└── unit/

# Option 2: Web application (when "frontend" + "backend" detected)
backend/
├── src/
│   ├── models/
│   ├── services/
│   └── api/
└── tests/

frontend/
├── src/
│   ├── components/
│   ├── pages/
│   └── services/
└── tests/

# Option 3: Mobile + API (when "iOS/Android" detected)
api/
└── [same as backend above]

ios/ or android/
└── [platform-specific structure]
```

**Structure Decision**: Option 1 (single project) confirmed.

## Phase 0: Outline & Research

1. **Extract unknowns from Technical Context** above:
   - For each NEEDS CLARIFICATION → research task
   - For each dependency → best practices task
   - For each integration → patterns task

2. **Generate and dispatch research agents**:
   ```
   For each unknown in Technical Context:
     Task: "Research {unknown} for {feature context}"
   For each technology choice:
     Task: "Find best practices for {tech} in {domain}"
   ```

3. **Consolidate findings** in `research.md` using format:
   - Decision: [what was chosen]
   - Rationale: [why chosen]
   - Alternatives considered: [what else evaluated]

**Output**: `research.md` (completed — spec v2 alignment, remaining non-blocking items documented)

## Phase 1: Design & Contracts

_Prerequisites: research.md complete_

1. **Extract entities from feature spec** → `data-model.md`:
   - Entity name, fields, relationships
   - Validation rules from requirements
   - State transitions if applicable

2. **Generate API contracts** from functional requirements:
   - For each user action → endpoint
   - Use standard REST/GraphQL patterns
   - Output OpenAPI/GraphQL schema to `/contracts/`

3. **Generate contract tests** from contracts:
   - One test file per endpoint
   - Assert request/response schemas
   - Tests must fail (no implementation yet)

4. **Extract test scenarios** from user stories:
   - Each story → integration test scenario
   - Quickstart test = story validation steps

5. **Update agent file incrementally** (O(1) operation):
   - Run `/scripts/update-agent-context.sh [claude|gemini|copilot]` for your AI assistant
   - If exists: Add only NEW tech from current plan
   - Preserve manual additions between markers
   - Update recent changes (keep last 3)
   - Keep under 150 lines for token efficiency
   - Output to repository root

**Output**: `data-model.md`, contracts/*, `quickstart.md` created. Contract tests to be generated in
/tasks phase (not yet present).

## Phase 2: Task Planning Approach

_This section describes what the /tasks command will do - DO NOT execute during /plan_

**Task Generation Strategy**:

- Load `/templates/tasks-template.md` as base
- Generate tasks from Phase 1 design docs (contracts, data model, quickstart)
- Each contract → contract test task [P]
- Each entity → model creation task [P]
- Each user story → integration test task
- Implementation tasks to make tests pass

**Ordering Strategy**:

- TDD order: Tests before implementation
- Dependency order: Models before services before UI
- Mark [P] for parallel execution (independent files)

**Estimated Output**: 28–34 tasks (segmentation, retrieval, generation, ranking, assembly, metrics,
CLI, tests). Parallelizable items flagged [P].

**IMPORTANT**: This phase is executed by the /tasks command, NOT by /plan

## Phase 3+: Future Implementation

_These phases are beyond the scope of the /plan command_

**Phase 3**: Task execution (/tasks command creates tasks.md)\
**Phase 4**: Implementation (execute tasks.md following constitutional principles)\
**Phase 5**: Validation (run tests, execute quickstart.md, performance validation)

## Complexity Tracking

_Fill ONLY if Constitution Check has violations that must be justified_

| Violation                  | Why Needed         | Simpler Alternative Rejected Because |
| -------------------------- | ------------------ | ------------------------------------ |
| [e.g., 4th project]        | [current need]     | [why 3 projects insufficient]        |
| [e.g., Repository pattern] | [specific problem] | [why direct DB access insufficient]  |

## Progress Tracking

_This checklist is updated during execution flow_

**Phase Status**:

- [x] Phase 0: Research complete (/plan command)
- [x] Phase 1: Design complete (/plan command)
- [x] Phase 2: Task planning complete (/plan command - approach described)
- [ ] Phase 3: Tasks generated (/tasks command)
- [ ] Phase 4: Implementation complete
- [ ] Phase 5: Validation passed

**Gate Status**:

- [x] Initial Constitution Check: PASS
- [x] Post-Design Constitution Check: PASS
- [x] All NEEDS CLARIFICATION resolved (non-blocking items documented)
- [ ] Complexity deviations documented (none required yet)

---

_Based on Constitution v2.1.1 - See `/memory/constitution.md`_
