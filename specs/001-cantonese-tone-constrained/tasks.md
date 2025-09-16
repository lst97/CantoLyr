# Tasks: Cantonese Tone‑Constrained Lyric Generation (Spec v2)

**Input**: Design documents in `/specs/001-cantonese-tone-constrained/` **Prerequisites**:
`plan.md`, `research.md`, `data-model.md`, `contracts/`, `quickstart.md`

## Execution Flow (main)

(Generated from templates/tasks-template.md rules)

## Phase 3.1: Setup

- [x] T001 Ensure Chroma & Postgres services running (docker compose) – validate connectivity script
      `scripts/test-chroma.ts` and simple Prisma query. File: `scripts/check-task-prerequisites.sh`
      (extend if needed)
- [x] T002 Add feature config scaffold `src/config/lyric-generation-config.ts` (defaults:
      semanticTarget, freqTop, freqRandom, topKSize, mmrLambda, minSemanticThreshold) – no logic
- [x] T003 [P] Add seed-based RNG utility `src/shared/seed-rng.ts` (deterministic PRNG wrapper)
- [x] T004 [P] Add similarity helper `src/shared/text-similarity.ts` (cosine over embedding vectors
      – interface only, implementation later)
- [x] T005 Define warning/error codes enum `src/shared/lyric-codes.ts`

## Phase 3.2: Tests First (TDD) – Contract & Core Pure Functions

### Contract Tests (one per contract) – must FAIL initially

- [x] T006 [P] Contract test segmentation service `tests/contract/segmentation.contract.test.ts`
- [x] T007 [P] Contract test retrieval service `tests/contract/retrieval.contract.test.ts`
- [x] T008 [P] Contract test generation service `tests/contract/generation.contract.test.ts`
- [x] T009 [P] Contract test ranking service `tests/contract/ranking.contract.test.ts`
- [x] T010 [P] Contract test paragraph assembly service
      `tests/contract/paragraph-assembly.contract.test.ts`

### Core Pure Function Unit Tests (models/algorithms before implementation)

- [x] T011 [P] Unit test segmentation pattern determinism `tests/unit/segmentation-patterns.test.ts`
- [x] T012 [P] Unit test tone compliance validator `tests/unit/tone-compliance.test.ts`
- [x] T013 [P] Unit test MMR selection logic `tests/unit/mmr-selection.test.ts`
- [x] T014 [P] Unit test paragraph beam search scoring `tests/unit/paragraph-beam.test.ts`
- [x] T015 [P] Unit test seed RNG reproducibility `tests/unit/seed-rng.test.ts`

### Integration Scenario Tests (from user stories & quickstart)

- [x] T016 Integration test full line pipeline (segmentation→retrieval mock→generation stub→ranking)
      `tests/integration/line-pipeline.test.ts`
- [x] T017 Integration test multi-line session coherence & paragraph assembly
      `tests/integration/session-coherence.test.ts`
- [x] T018 Integration test WARN_LOW_SEMANTIC path (semantic under-yield)
      `tests/integration/warn-low-semantic.test.ts`
- [x] T019 Integration test ERROR_DIGIT_INSUFFICIENT path
      `tests/integration/error-digit-insufficient.test.ts`
- [x] T020 Integration test regeneration of single line with seed change
      `tests/integration/regenerate-line.test.ts`

## Phase 3.3: Core Implementation (Only after related tests exist & fail)

### Models / Entities (in-memory domain representations)

- [x] T021 [P] Implement entity types & factory functions `src/domain/lyric/entities.ts`
      (GenerationSession, ToneSequence, SegmentationPattern, SceneIntent, LexicalCandidate,
      SentenceCandidate, LineResult, ParagraphVariant)
- [x] T022 [P] Implement validation & invariant helpers `src/domain/lyric/validation.ts`
- [x] T023 [P] Implement tone compliance checker `src/domain/lyric/tone-compliance.ts`
- [x] T024 [P] Implement segmentation algorithm (3 deterministic patterns)
      `src/domain/lyric/segmentation.ts`
- [x] T025 [P] Implement MMR & similarity composition `src/domain/lyric/ranking/mmr.ts`
- [x] T026 [P] Implement paragraph beam search scoring `src/domain/lyric/paragraph-assembly.ts`

### Application Services

- [x] T027 Orchestrate segmentation service (calls domain segmentation + builds digit set)
      `src/application/lyric/SegmentationService.ts`
- [x] T028 Retrieval service orchestrator (semantic query builder + frequency enrichment, no
      fallback) `src/application/lyric/RetrievalService.ts`
- [x] T029 Constrained generation service (LLM prompt builder + retry loop)
      `src/application/lyric/GenerationService.ts`
- [x] T030 Ranking service (TopK, cross-encoder interface, MMR)
      `src/application/lyric/RankingService.ts`
- [x] T031 Paragraph assembly service (coherence + emotional arc scoring using domain algorithm)
      `src/application/lyric/ParagraphService.ts`
- [x] T032 Session orchestration service (full pipeline + regeneration)
      `src/application/lyric/SessionService.ts`

### Infrastructure Adapters

- [x] T033 Add Chroma client wrapper (query embeddings + semantic multi-query)
      `src/infrastructure/adapters/chroma/ChromaSemanticClient.ts`
- [x] T034 Extend Prisma lexicon repo for frequency top & random sampling
      `src/infrastructure/adapters/database/lexicon/FrequencyLexiconRepository.ts`
- [x] T035 Implement embedding provider (reusing transformers pipeline)
      `src/infrastructure/adapters/embedding/EmbeddingProvider.ts`
- [x] T036 Implement Gemini lightweight intent inference adapter
      `src/infrastructure/adapters/llm/SceneIntentLLM.ts`
- [x] T037 Implement Gemini generation adapter (constrained output format enforcement)
      `src/infrastructure/adapters/llm/ConstrainedGenerationLLM.ts`
- [x] T038 Implement cross-encoder scoring adapter (LLM pairwise scoring)
      `src/infrastructure/adapters/llm/CrossEncoderScorer.ts`
- [x] T039 Logging & metrics middleware utilities `src/infrastructure/metrics/metrics.ts`

### CLI / Interface

- [x] T040 CLI command `lyrics:generate` entry `src/cli/lyrics-generate.ts` (accept prompt, tones,
      seed, output file)
- [x] T041 CLI sub-command for regeneration `src/cli/lyrics-regenerate-line.ts`
- [x] T042 JSON export utility for session state `src/infrastructure/serialization/session-io.ts`

## Phase 3.4: Integration Implementation

- [ ] T043 Wire dependency injection container entries for new services
      `src/infrastructure/container/lyric.ts`
- [ ] T044 Integration: retrieval + Chroma real vector call test (update existing integration tests)
      `tests/integration/retrieval-chroma.test.ts`
- [ ] T045 Integration: frequency repository using Prisma with sample dataset
      `tests/integration/frequency-repo.test.ts`
- [ ] T046 Integration: generation end-to-end (LLM mocked)
      `tests/integration/generation-e2e.test.ts`
- [ ] T047 Integration: ranking correctness with real embeddings
      `tests/integration/ranking-e2e.test.ts`
- [ ] T048 Integration: paragraph assembly with 4 lines `tests/integration/paragraph-e2e.test.ts`

## Phase 3.5: Polish & Hardening

- [ ] T049 [P] Add content safety placeholder filter & test
      `src/application/lyric/filters/ContentSafetyFilter.ts` +
      `tests/unit/content-safety-filter.test.ts`
- [ ] T050 [P] Add metrics instrumentation across services (timing wrappers)
      `src/infrastructure/metrics/instrumentation.ts`
- [ ] T051 [P] Add reproducibility seed injection tests `tests/unit/seed-reproducibility.test.ts`
- [ ] T052 Performance smoke test for single line (<6s P95 simulated)
      `tests/integration/perf-single-line.test.ts`
- [ ] T053 Documentation update: append new CLI usage to `README.md`
- [ ] T054 Generate sample session artifact & commit under `examples/`
      `examples/sample-session.json`
- [ ] T055 Refactor pass to remove duplication & ensure invariant asserts `src/domain/lyric/*`
- [ ] T056 Final verification script `scripts/verify-lyric-feature.sh` (run all relevant tests +
      lint)

## Dependencies & Ordering

| Task      | Depends On                                          |
| --------- | --------------------------------------------------- |
| T006-T010 | T001-T005                                           |
| T011-T015 | T001-T005                                           |
| T021-T026 | Contract & unit tests (T006-T015) present & failing |
| T027-T032 | T021-T026                                           |
| T033-T039 | T027-T030 (service contracts defined)               |
| T040-T042 | T032 (session service)                              |
| T043      | T027-T039                                           |
| T044-T048 | Core + adapters (T027-T039, T043)                   |
| T049-T056 | All prior core & integration tasks                  |

Parallel rule: All tasks marked [P] touch distinct new files and have no upstream unmet
dependencies.

## Parallel Execution Examples

Initial contract & unit tests batch (after setup):

```
T006, T007, T008, T009, T010, T011, T012, T013, T014, T015 (run in parallel)
```

Model/entity & pure algorithm implementation batch:

```
T021, T022, T023, T024, T025, T026 (after tests failing)
```

Polish parallel batch:

```
T049, T050, T051 (can execute together)
```

## Validation Checklist

- [ ] All contract files mapped to a contract test (segmentation, retrieval, generation, ranking,
      paragraph-assembly)
- [ ] Each entity has at least one implementation task (entities.ts & validation)
- [ ] Tests precede implementation steps (segmentation, retrieval, ranking, generation, assembly)
- [ ] No [P] tasks share a target file
- [ ] Integration tasks cover each major pipeline stage
- [ ] Performance & safety considerations included (T049, T052)
- [ ] Documentation & examples included (T053, T054)
- [ ] Final verification script included (T056)

---

Tasks file generated; proceed with Phase 3 execution following TDD.
