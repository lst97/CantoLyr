# Phase 0 Research (Updated for Spec v2): Cantonese Tone‑Constrained Lyric Generation

## Scope

Align implementation approach with updated spec v2: deterministic 3-pattern segmentation, two-layer
retrieval (semantic + frequency enrichment only), generation of 15 sentences (3×5), cross-encoder +
MMR ranking to Top 3, paragraph synthesis of 3 variants, no fallback expansion.

## Resolved Questions

| Topic                     | Decision                                                 | Rationale                                   | Alternatives (Rejected)                          |
| ------------------------- | -------------------------------------------------------- | ------------------------------------------- | ------------------------------------------------ |
| Tone Digit Set            | Union across 3 patterns                                  | Maximizes lexical coverage                  | Intersection (too sparse)                        |
| Segmentation              | Exactly 3 deterministic patterns (1–2 digit groups only) | Predictable, spec mandate                   | Probabilistic w/ 3-digit groups (adds variance)  |
| Semantic Retrieval Target | ~200 candidates (±15%)                                   | Balances diversity vs token load            | Higher (>300) increases prompt size              |
| Frequency Enrichment      | +100 top +50 random (200–500 slice)                      | Injects familiar & exploratory vocab        | Larger random sample (noise inflation)           |
| Generation Count          | 5 per pattern (15 total)                                 | Enough diversity for rerank                 | 3 (too few), 10 (cost)                           |
| Ranking                   | Compliance → TopK → Cross-encoder → MMR                  | Standard high-quality pipeline              | Single similarity pass (lower precision)         |
| Final Per-Line Output     | Top 3 global sentences (pattern-agnostic)                | Encourages best quality over quota fairness | Forcing one per pattern (lowers average quality) |
| Paragraph Assembly        | 3 global paragraph variants                              | Provides user choice                        | Single best only (less creative freedom)         |
| Fallback Behavior         | None; warnings only                                      | Deterministic transparency                  | Silent broadening (spec prohibits)               |
| Determinism               | Optional seed influences sampling & ordering             | QA reproducibility                          | Fully stochastic (harder diffing)                |

## Updated Decisions & Rationale

### Segmentation

Deterministic algorithm (e.g., left-to-right preference for 2-digit grouping unless last digit would
isolate invalid length) producing 3 curated patterns (baseline, alternate start shift, maximal
pairing). Ensures reproducibility and predictable digit set extraction.

### Retrieval

Only semantic Chroma queries (LLM-refined) plus frequency enrichment. No BM25, rhyme, or extra
fallbacks. Semantic queries may iterate internally (up to N=3 phrasings) but still count toward the
single semantic layer. Candidates labeled provenance: semantic | freq-top | freq-random.

### Candidate Pool Normalization

Merge by surface; annotate provenanceCategories[]; if both semantic & frequency, semantic primary.
Deduplicate, then enforce per-digit minimum (warn if <3, block generation if <3 after enrichment).

### Generation Constraints

Each of 15 sentences must:

1. Align pattern group count (one lexical item per group).
2. Exact tone digit sequence reproduction.
3. Use only in-pool surfaces.
4. Express micro-scene intent & emotions.

Retries: Up to 2 per failed slot maintaining total 15 attempts cap (failures reduce diversity; log).

### Ranking & Diversity

TopK size (default 10) chosen by highest preliminary relevance (scene + continuity heuristic).
Cross-encoder scoring prompt builds pair (intent JSON + candidate). Embedding-based similarity for
MMR uses same embedding model as semantic retrieval for consistency. λ default 0.7 (tunable).
Diversity threshold ensures no pair similarity >0.9 among final 3.

### Paragraph Synthesis

Search space 3^L combinations; for L <= 12 feasible (531,441 worst-case). Use beam search (beam
width 12) scoring cumulative coherence (emotion progression + narrative references) and diversity of
imagery. Select top 3 unique paragraphs.

### Warnings & Error States

- WARN_LOW_SEMANTIC (<150 semantic).
- WARN_DIGIT_COVERAGE (digit with 3–4 candidates only).
- ERROR_DIGIT_INSUFFICIENT (<3 candidates → line skipped INCOMPLETE).

### Metrics

Capture per line: segmentation_time, retrieval_time, generation_time, ranking_time, paragraph_time,
semantic_candidate_count, freq_top_added, freq_random_added.

## Risks & Mitigations (Updated)

| Risk                                       | Impact                  | Mitigation                                                         |
| ------------------------------------------ | ----------------------- | ------------------------------------------------------------------ |
| Semantic under-yield                       | Reduced diversity       | Multiple refined queries (cap 3) + transparent WARN                |
| Overuse of high-frequency words            | Bland tone              | Weight provenance in generation guidance; encourage semantic picks |
| Pattern bias (one pattern dominates Top 3) | Lost structural variety | MMR encourages diversity, though quality prioritized               |
| Large paragraph combination cost (L>12)    | Performance             | Hard cap L=12 (align user guidance)                                |
| Seed misuse (user expects novelty)         | Repetition              | Document seed semantics in quickstart                              |

## Constitution Alignment

Simplicity maintained (no extra subprojects). Test-first feasible via isolating segmentation, tone
compliance, MMR, paragraph assembly into pure functions. Logging/metrics planned. No repository
pattern expansion beyond existing data adapters.

## Outstanding (Non-Blocking) Items

Content safety taxonomy (placeholder gating list). Emotional tag enumeration baseline (will define
default set). These become configuration tasks in Phase 1.

---

Phase 0 complete (spec v2 aligned). Ready for Phase 1.
