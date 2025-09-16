# Feature Specification: Cantonese Tone‑Constrained Lyric Generation & Storyline Retrieval (Updated Flow v2)

**Feature Branch**: `001-cantonese-tone-constrained`\
**Created**: 2025-09-12\
**Status**: Draft\
**Input**: User description: "Cantonese tone-constrained hybrid retrieval & lyric generation
pipeline: storyline expansion, probabilistic tone segmentation, hybrid vector+BM25 retrieval,
candidate assembly (~250 per line), constrained LLM generation (5 variants per segment pattern),
cross-encoder re-rank + MMR diversity, context carryover across lines."

## Execution Flow (main)

```
1. Parse user description from Input
   → If empty: ERROR "No feature description provided"
2. Extract key concepts from description
   → Identify: actors, actions, data, constraints
3. For each unclear aspect:
   → Mark with [NEEDS CLARIFICATION: specific question]
4. Fill User Scenarios & Testing section
   → If no clear user flow: ERROR "Cannot determine user scenarios"
5. Generate Functional Requirements
   → Each requirement must be testable
   → Mark ambiguous requirements
6. Identify Key Entities (if data involved)
7. Run Review Checklist
   → If any [NEEDS CLARIFICATION]: WARN "Spec has uncertainties"
   → If implementation details found: ERROR "Remove tech details"
8. Return: SUCCESS (spec ready for planning)
```

---

## ⚡ Quick Guidelines

- ✅ Focus on WHAT users need and WHY
- ❌ Avoid HOW to implement (no tech stack, APIs, code structure)
- 👥 Written for business stakeholders, not developers

### Section Requirements

- **Mandatory sections**: Must be completed for every feature
- **Optional sections**: Include only when relevant to the feature
- When a section doesn't apply, remove it entirely (don't leave as "N/A")

### For AI Generation

When creating this spec from a user prompt:

1. **Mark all ambiguities**: Use [NEEDS CLARIFICATION: specific question] for any assumption you'd
   need to make
2. **Don't guess**: If the prompt doesn't specify something (e.g., "login system" without auth
   method), mark it
3. **Think like a tester**: Every vague requirement should fail the "testable and unambiguous"
   checklist item
4. **Common underspecified areas**:
   - User types and permissions
   - Data retention/deletion policies
   - Performance targets and scale
   - Error handling behaviors
   - Integration requirements
   - Security/compliance needs

---

## User Scenarios & Testing _(mandatory)_

### Primary User Story

An aspiring lyricist supplies (a) a thematic prompt (e.g., "two people just met at an event and hope
to see each other again"), and (b) one or more numeric tone sequences (one per desired lyric line,
e.g., `2253394259`). For each tone sequence the system:

1. Produces exactly 3 deterministic segmentation patterns (e.g., `"22 5 33 9 4 25 9"`,
   `"22 5 3 39 42 59"`, `"2 25 33 9 42 59"`).
2. Forms a unique tone digit SET for the line (e.g., `{33,2,3,4,5,39,9,42,22,25,59}`) for retrieval
   scope.
3. Uses a lightweight LLM ("scene inference" tier) to derive a per-line micro-scene / intent label
   (e.g., "meet a friend", "playing game", etc.) constrained by user prompt narrative.
4. Generates refined semantic queries (potentially multiple) against Chroma using the tone digit
   set + scene theme to pull ~200 semantically relevant lexical candidates (tone-aligned
   words/phrases) with pronunciation metadata.
5. Augments the pool with: top 100 highest-frequency words for the tone digits (non-semantic
   enrichment) + 50 randomly sampled words from the 200–500 frequency rank slice per digit
   (frequency diversity slice). No other fallback retrieval is attempted.
6. Deduplicates & annotates candidates by provenance (semantic / high-frequency / random-frequency)
   creating a normalized candidate pool.
7. Invokes a higher‑capacity LLM ("generation" tier) to produce 5 candidate sentences per
   segmentation pattern (15 total per line) – every sentence must:
   - Respect the exact tone order & segmentation grouping.
   - Use only words from the candidate pool.
   - Express the assigned micro-scene intent and remain coherent Cantonese.
8. Applies ranking pipeline: initial lexical / intent compliance filter → TopK shortlist →
   cross‑encoder style semantic rerank (query + candidate pair scoring) → Maximal Marginal Relevance
   (MMR) for diversity.
9. Emits the Top 3 globally best, diverse sentences (not "one per pattern"; any pattern may have 0–3
   survivors). After all lines are processed, the system synthesizes 3 full paragraph variants (each
   paragraph selects one of the Top 3 per line via coherence scoring across lines) and returns them
   (e.g., 3 paragraphs × 4 lines = 12 total lines if 4 tone sequences supplied). User picks a
   paragraph or requests regeneration of specific lines. No silent fallback substitutions
   occur—insufficient candidates produce explicit warnings.

### Acceptance Scenarios

1. **Given** a valid thematic prompt and N tone sequences, **When** submission occurs, **Then** the
   system derives N ordered micro-scene intents (no fixed scene count assumption) each with title +
   intent summary + emotion tags.
2. **Given** a tone sequence (e.g., `2253394259`), **When** segmentation runs, **Then** exactly 3
   segmentation patterns are produced deterministically (business rule: only 1–2 digit groups; any
   original longer pattern is split) matching documented examples.
3. **Given** the 3 patterns, **When** the tone digit set is computed, **Then** it equals the union
   of digits present and is exposed in the line output payload.
4. **Given** a line's tone digit set and micro-scene, **When** semantic retrieval executes, **Then**
   ~200 semantically relevant tone-aligned lexical candidates are returned (±15%) with pronunciation
   metadata; fewer than 150 triggers a warning status (not silent fallback).
5. **Given** semantic results, **When** frequency enrichment runs, **Then** the pool is augmented by
   exactly 100 highest-frequency words per digit (if available) plus 50 randomly sampled from rank
   slice 200–500 producing annotated provenance categories.
6. **Given** an assembled pool, **When** generation runs, **Then** 15 sentences (3 patterns × 5
   variants) are produced using only in-pool words and respecting tone group segmentation order.
7. **Given** the 15 sentences, **When** ranking executes, **Then** TopK prefilter + cross-encoder
   rerank + MMR produces exactly 3 final distinct sentences with (a) tone compliance score == 100%,
   (b) scene alignment above threshold (defined), (c) diversity (no pair semantic similarity >
   configured max).
8. **Given** final per-line Top 3 sets across all lines, **When** paragraph synthesis runs, **Then**
   exactly 3 paragraph variants are produced optimizing cross-line narrative coherence and emotional
   progression.
9. **Given** any shortage (e.g., < 150 semantic candidates), **When** output is returned, **Then**
   the line status includes a WARN flag and descriptive message; no automatic alternative retrieval
   path executed.
10. **Given** user requests regeneration of a single line, **When** the process reruns for that
    line, **Then** previously locked lines remain unchanged and context still informs coherence
    scoring.

### Edge Cases

- Tone sequence contains digit outside allowed set {0,2,3,4,5,9,22,25,33,39,42,59} (example
  composite digits) → system rejects that sequence with explicit error; processing continues for
  valid sequences.
- Fewer than 150 semantic candidates returned → WARN flagged, generation still proceeds with
  available pool (no hidden expansion query).
- Any tone digit lacks ≥3 total candidates after enrichment → line marked INCOMPLETE and no
  sentences generated (user must adjust prompt or tone sequence).
- Excessively repetitive digit pattern (e.g., >70% identical digit) → diversity check enforces
  semantic variety (frequency random slice still included).
- Tone sequence length > 20 → sequence rejected with guidance (limit configurable but default 20).

## Requirements _(mandatory)_

### Functional Requirements

- **FR-001**: System MUST accept a thematic prompt (string) plus 1–N tone sequences (numeric
  strings) in a single request.
- **FR-002**: System MUST derive one micro-scene intent object per tone sequence (title,
  emotions[≥3], micro-intent description, continuity notes field).
- **FR-003**: System MUST produce exactly 3 segmentation patterns per tone sequence composed only of
  1–2 digit groups.
- **FR-004**: System MUST compute & expose the unique tone digit set (union) for each line before
  retrieval.
- **FR-005**: System MUST retrieve ~200 semantic lexical candidates (±15%) across the tone digit set
  using refined LLM-generated queries to Chroma.
- **FR-006**: System MUST enrich the pool with 100 highest-frequency words per tone digit (if
  available) + 50 randomly sampled words from frequency rank slice 200–500 (global or per digit
  strategy defined) without semantic filtering.
- **FR-007**: System MUST annotate each candidate with: surface, toneDigit, provenanceCategory
  (semantic|freq-top|freq-random), frequencyRank, and sceneRelevanceScore (null for purely frequency
  sourced items).
- **FR-008**: System MUST prevent fallback retrieval beyond the specified semantic + frequency
  enrichment; shortages surface as WARN/ERROR states, not silent expansion.
- **FR-009**: System MUST generate exactly 15 sentences per line (3 patterns × 5 variants) using
  only in-pool candidates and respecting segmentation boundaries and tone order.
- **FR-010**: System MUST validate each generated sentence for full tone compliance (digit-by-digit)
  and reject / regenerate any violating candidate until quota or max attempts reached.
- **FR-011**: System MUST apply ranking pipeline: (a) compliance filter, (b) TopK preselect
  (configurable K), (c) cross-encoder style semantic relevance scoring, (d) MMR diversity selection.
- **FR-012**: System MUST output exactly the Top 3 distinct ranked sentences per line (global best;
  patterns are not guaranteed representation) with scores (relevance, diversity-adjusted, tone
  compliance) and provenance distribution snapshot.
- **FR-013**: System MUST assemble exactly 3 full paragraph variants (one sentence per line)
  optimizing cross-line narrative coherence and emotional progression using a scoring or beam
  strategy.
- **FR-014**: System MUST allow targeted regeneration of a single line without altering locked
  previous selections.
- **FR-015**: System MUST expose structured warnings when candidate pool < minimum semantic
  threshold (150) or any tone digit < 3 candidates (line marked INCOMPLETE, no generation
  attempted).
- **FR-016**: System MUST log every tone compliance failure and excluded lexical surface for audit.
- **FR-017**: System MUST enforce content safety filter categories (list to be defined) blocking
  disallowed outputs.
- **FR-018**: System SHOULD allow configurable numeric parameters: semanticTargetCount,
  freqTopCount, freqRandomCount, topKSize, mmrLambda.
- **FR-019**: System SHOULD capture latency metrics per stage (segmentation, retrieval, generation,
  ranking, assembly).
- **FR-020**: System SHOULD provide deterministic reproducibility option via seed for segmentation
  pattern generation and candidate sampling.
- **FR-021**: System SHOULD allow export of final paragraphs plus per-line Top 3 set as structured
  JSON for external editing.
- **FR-022**: Bilingual / English gloss support out of scope for v1 (explicit exclusion).

_Ambiguity & Clarification Markers Updated; removed resolved items (scene count, candidate count,
max length, bilingual scope)._

### Key Entities _(include if feature involves data)_

- **ToneSequence**: raw string, digits[], uniqueDigitSet, segmentationPatterns[3].
- **SegmentationPattern**: id, groups[] (each 1–2 digits), patternString, deterministicRuleNote.
- **SceneIntent**: lineIndex, title, emotions[], microIntent, continuityNotes.
- **LexicalCandidate**: surface, toneDigit, provenanceCategory, sceneRelevanceScore?,
  frequencyRank?, semanticVectorRef?, excludedFlags[].
- **SentenceCandidate**: text, patternId, usedSurfaces[], toneComplianceScore, sceneAlignmentScore,
  continuityScore, diversityPenalty, rawRelevanceScore, finalRank.
- **LineResult**: lineIndex, toneSequenceRef, digitSet, candidatePoolStats, topSentences[≤3],
  warnings[].
- **ParagraphVariant**: id, sentences[], coherenceScore, emotionalArcScore, diversityScore,
  finalRank.
- **GenerationSession**: prompt, toneSequences[], sceneIntents[], lines[LineResult],
  paragraphVariants[3], config, metrics.

---

## Review & Acceptance Checklist

_GATE: Automated checks run during main() execution_

### Content Quality

- [ ] No implementation details (languages, frameworks, APIs) (Note: high-level model tier
      references kept intentionally minimal)
- [ ] Focused on user value and business needs
- [ ] Written for non-technical stakeholders
- [ ] All mandatory sections completed

### Requirement Completeness

- [ ] No [NEEDS CLARIFICATION] markers remain
- [ ] Requirements are testable and unambiguous
- [ ] Success criteria are measurable
- [ ] Scope is clearly bounded
- [ ] Dependencies and assumptions identified

---

## Execution Status

_Updated by main() during processing_

- [ ] User description parsed
- [ ] Key concepts extracted
- [ ] Ambiguities marked
- [ ] User scenarios defined
- [ ] Requirements generated
- [ ] Entities identified
- [ ] Review checklist passed

---
