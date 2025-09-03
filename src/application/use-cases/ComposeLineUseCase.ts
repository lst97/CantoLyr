import type { ReadingRepo } from '../ports/ReadingRepo.js';
import type { Cache } from '../ports/Cache.js';
import type { LlmGroupedSelector, GroupedSelectionInput } from '../ports/LlmGroupedSelector.js';
import { prefilterGroupsByTone, type Group, type FetchByTone } from '../services/mvpPrefilter.js';

/**
 * Input for compose line use case
 */
export interface ComposeLineInput {
  /** Tone pattern for the line (space-separated groups) */
  tonePattern: string;
  /** Maximum candidates per tone group (default 100) */
  maxPerGroup?: number;
  /** Optional theme for creative selection */
  theme?: string;
  /** Optional mood for creative selection */
  mood?: string;
  /** Optional genre for creative selection */
  genre?: string;
  /** Optional language specification */
  language?: string;
  /** Optional seed for reproducible randomness */
  seed?: number;
}

/**
 * Output from compose line use case
 */
export interface ComposeLineOutput {
  /** The composed line from selected words */
  line: string;
  /** Individual selections from each group */
  selections: Array<{
    group: number;
    option: number;
    surface: string;
    readingId: bigint;
    freq?: number;
  }>;
  /** Optional reasoning from LLM */
  reason?: string;
  /** Whether LLM was used successfully */
  usedLlm: boolean;
  /** Processing time in milliseconds */
  processingTimeMs: number;
  /** Number of candidates before prefiltering */
  totalCandidates: number;
  /** Number of candidates after prefiltering */
  filteredCandidates: number;
}

/**
 * Use case for composing lyrical lines with MVP prefilter and LLM grouped selection
 * Implements requirements 2.1-2.6 and 8.5 for contextual composition assistance
 */
export class ComposeLineUseCase {
  private static readonly CACHE_TTL_SECONDS = 180; // 3 minutes (shorter than search)
  private static readonly DEFAULT_MAX_PER_GROUP = 100;
  private static readonly PREFILTER_POOL_MULTIPLIER = 4;

  constructor(
    private readonly readingRepo: ReadingRepo,
    private readonly cache: Cache,
    private readonly llmGroupedSelector: LlmGroupedSelector
  ) {}

  /**
   * Execute compose line workflow:
   * 1. Prefilter candidates using MVP strategy
   * 2. Group by tone pattern
   * 3. LLM creative selection (with fallback)
   */
  async execute(input: ComposeLineInput): Promise<ComposeLineOutput> {
    const startTime = Date.now();
    
    // Validate and normalize input
    const normalizedInput = this.validateAndNormalizeInput(input);
    
    // Generate cache key
    const cacheKey = this.generateCacheKey(normalizedInput);
    
    // Try to get from cache first
    const cachedResult = await this.cache.get<ComposeLineOutput>(cacheKey);
    if (cachedResult) {
      return {
        ...cachedResult,
        processingTimeMs: Date.now() - startTime
      };
    }

    // Create fetch function for prefilter
    const fetchByTone: FetchByTone = async (toneMapped: string, limit: number) => {
      return await this.readingRepo.searchByToneMapped({
        toneMapped,
        limit
      });
    };

    // Execute MVP prefiltering
    const groups = await prefilterGroupsByTone(
      normalizedInput.tonePattern,
      fetchByTone,
      normalizedInput.maxPerGroup,
      normalizedInput.seed
    );

    // Calculate statistics
    const totalCandidates = groups.reduce((sum, group) => {
      // Estimate total before filtering (this is approximate)
      return sum + (group.options.length * ComposeLineUseCase.PREFILTER_POOL_MULTIPLIER);
    }, 0);
    const filteredCandidates = groups.reduce((sum, group) => sum + group.options.length, 0);

    // Attempt LLM grouped selection
    let result: ComposeLineOutput;

    try {
      if (await this.llmGroupedSelector.isAvailable()) {
        const llmInput: GroupedSelectionInput = {
          groups,
          language: normalizedInput.language,
          ...(normalizedInput.theme && { theme: normalizedInput.theme }),
          ...(normalizedInput.mood && { mood: normalizedInput.mood }),
          ...(normalizedInput.genre && { genre: normalizedInput.genre })
        };

        const llmResult = await this.llmGroupedSelector.selectFromGroups(llmInput);

        console.log('LLM result:', llmResult);
        
        if (llmResult.success) {
          result = {
            line: llmResult.line,
            selections: llmResult.selections.map(sel => {
              const freq = this.findFreqForSelection(groups, sel.group, sel.option);
              return {
                group: sel.group,
                option: sel.option,
                surface: sel.surface,
                readingId: sel.readingId,
                ...(freq !== undefined && { freq })
              };
            }),
            usedLlm: true,
            processingTimeMs: Date.now() - startTime,
            totalCandidates,
            filteredCandidates,
            ...(llmResult.reason && { reason: llmResult.reason })
          };
        } else {
          // LLM failed, fall back to heuristic selection
          result = this.fallbackToHeuristicSelection(groups, startTime, totalCandidates, filteredCandidates);
        }
      } else {
        // LLM not available, use heuristic selection
        result = this.fallbackToHeuristicSelection(groups, startTime, totalCandidates, filteredCandidates);
      }
    } catch (error) {
      // LLM error, fall back to heuristic selection
      result = this.fallbackToHeuristicSelection(groups, startTime, totalCandidates, filteredCandidates);
    }

    // Cache the result
    await this.cache.set(cacheKey, result, ComposeLineUseCase.CACHE_TTL_SECONDS);

    return result;
  }

  /**
   * Fallback to deterministic heuristic selection when LLM fails
   */
  private fallbackToHeuristicSelection(
    groups: Group[],
    startTime: number,
    totalCandidates: number,
    filteredCandidates: number
  ): ComposeLineOutput {
    const selections = groups.map(group => {
      // Select highest frequency option from each group as fallback
      const bestOption = group.options.reduce((best, current) => {
        return (current.freq ?? 0) > (best.freq ?? 0) ? current : best;
      }, group.options[0]!);

      return {
        group: group.groupIndex,
        option: bestOption.option,
        surface: bestOption.surface,
        readingId: bestOption.readingId,
        ...(bestOption.freq !== undefined && { freq: bestOption.freq })
      };
    });

    const line = selections.map(sel => sel.surface).join('');

    return {
      line,
      selections,
      reason: 'Fallback to highest frequency selection per group',
      usedLlm: false,
      processingTimeMs: Date.now() - startTime,
      totalCandidates,
      filteredCandidates
    };
  }

  /**
   * Find frequency for a specific selection
   */
  private findFreqForSelection(groups: Group[], groupIndex: number, optionIndex: number): number | undefined {
    const group = groups.find(g => g.groupIndex === groupIndex);
    if (!group) return undefined;
    
    const option = group.options.find(o => o.option === optionIndex);
    return option?.freq;
  }

  /**
   * Validate and normalize compose input
   */
  private validateAndNormalizeInput(
    input: ComposeLineInput
  ): ComposeLineInput & { maxPerGroup: number; language: string } {
    if (!input.tonePattern) {
      throw new Error('Tone pattern is required');
    }

    // Validate tone pattern format (mapped tones: 0,3,9,4,5,2)
    const cleanPattern = input.tonePattern.trim();
    if (!/^[039452\s]+$/.test(cleanPattern)) {
      throw new Error('Invalid tone pattern. Must contain only mapped tone digits (0,3,9,4,5,2) and spaces');
    }

    // Ensure we have at least one group
    const groups = cleanPattern.split(/\s+/).filter(Boolean);
    if (groups.length === 0) {
      throw new Error('Tone pattern must contain at least one tone group');
    }

    return {
      ...input,
      tonePattern: cleanPattern,
      maxPerGroup: input.maxPerGroup ?? ComposeLineUseCase.DEFAULT_MAX_PER_GROUP,
      language: input.language ?? 'zh-HK'
    };
  }

  /**
   * Generate cache key for compose parameters
   */
  private generateCacheKey(input: ComposeLineInput & { maxPerGroup: number; language: string; }): string {
    const parts = [
      'compose',
      input.tonePattern.replace(/\s+/g, '_'),
      input.maxPerGroup.toString(),
      input.theme ?? 'none',
      input.mood ?? 'none',
      input.genre ?? 'none',
      input.language,
      input.seed?.toString() ?? 'random'
    ];
    return parts.join(':');
  }
}