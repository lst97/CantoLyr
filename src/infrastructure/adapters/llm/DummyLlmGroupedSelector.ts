import type {
  LlmGroupedSelector,
  GroupedSelectionInput,
  GroupedSelectionResult,
  LlmConfig,
  GroupSelection,
} from '../../../application/ports/LlmGroupedSelector.js';

/**
 * Dummy implementation of LlmGroupedSelector for testing and fallback scenarios
 * Provides deterministic, heuristic-based selection without external API calls
 */
export class DummyLlmGroupedSelector implements LlmGroupedSelector {
  constructor(_config?: LlmConfig) {}

  async selectFromGroups(input: GroupedSelectionInput): Promise<GroupedSelectionResult> {
    const startTime = Date.now();

    try {
      const selections = this.generateHeuristicSelections(input);
      const line = selections.map(s => s.surface).join('');
      const processingTimeMs = Date.now() - startTime;

      return {
        selections,
        line,
        reason: this.generateReason(input, selections),
        success: true,
        model: 'dummy-heuristic',
        processingTimeMs
      };

    } catch (error) {
      const processingTimeMs = Date.now() - startTime;
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';

      return {
        selections: [],
        line: '',
        success: false,
        error: errorMessage,
        model: 'dummy-heuristic',
        processingTimeMs
      };
    }
  }

  async isAvailable(): Promise<boolean> {
    return true; // Dummy is always available
  }

  getInfo() {
    return {
      provider: 'Dummy Heuristic',
      model: 'heuristic-grouped-v1',
      version: '1.0'
    };
  }

  async validateConfig(): Promise<void> {
    // Dummy implementation has no configuration requirements
    return;
  }

  /**
   * Generate deterministic selections based on heuristic scoring
   * For each group, selects the option with the highest combined score
   */
  private generateHeuristicSelections(input: GroupedSelectionInput): GroupSelection[] {
    const selections: GroupSelection[] = [];

    for (const group of input.groups) {
      if (group.options.length === 0) {
        throw new Error(`Group ${group.groupIndex} has no options`);
      }

      // Score each option in the group
      const scoredOptions = group.options.map((option, index) => ({
        option,
        index,
        score: this.calculateOptionScore(option, input)
      }));

      // Sort by score descending and pick the best
      scoredOptions.sort((a, b) => b.score - a.score);
      const bestOption = scoredOptions[0];

      if (!bestOption) {
        throw new Error(`No valid option found for group ${group.groupIndex}`);
      }

      selections.push({
        group: group.groupIndex,
        option: bestOption.index + 1, // Convert to 1-based
        surface: bestOption.option.surface,
        readingId: bestOption.option.readingId,
      });
    }

    return selections;
  }

  /**
   * Calculate heuristic score for an option based on context and frequency
   */
  private calculateOptionScore(option: any, input: GroupedSelectionInput): number {
    let score = 0;

    // Base frequency score (0-0.6)
    if (option.freq !== undefined) {
      const normalizedFreq = Math.min(option.freq / 100, 1);
      score += normalizedFreq * 0.6;
    } else {
      score += 0.3; // Default score if no frequency
    }

    // Context-based adjustments (0-0.4)
    score += this.getContextScore(option, input) * 0.4;

    // Ensure score is between 0 and 1
    return Math.max(0, Math.min(1, score));
  }

  /**
   * Calculate context-based score adjustments
   */
  private getContextScore(option: any, input: GroupedSelectionInput): number {
    let contextScore = 0.5; // Base context score

    // Theme-based adjustments
    if (input.theme) {
      contextScore += this.getThemeScore(option, input.theme);
    }

    // Mood-based adjustments
    if (input.mood) {
      contextScore += this.getMoodScore(option, input.mood);
    }

    // Genre-based adjustments
    if (input.genre) {
      contextScore += this.getGenreScore(option, input.genre);
    }

    return Math.max(0, Math.min(1, contextScore));
  }

  private getThemeScore(option: any, theme: string): number {
    const surface = option.surface.toLowerCase();
    const themeKeywords = this.getThemeKeywords(theme.toLowerCase());
    
    // Simple keyword matching - in a real implementation, this could use embeddings
    for (const keyword of themeKeywords) {
      if (surface.includes(keyword)) {
        return 0.2;
      }
    }
    
    return 0;
  }

  private getMoodScore(option: any, mood: string): number {
    // Simple mood-based scoring
    switch (mood.toLowerCase()) {
      case 'happy':
      case 'joyful':
      case 'upbeat':
        return option.surface.length <= 2 ? 0.1 : 0; // Prefer shorter, punchier words
      case 'sad':
      case 'melancholy':
      case 'emotional':
        return option.surface.length > 2 ? 0.1 : 0; // Prefer longer, more expressive words
      case 'romantic':
      case 'love':
        return 0.05; // Neutral adjustment
      default:
        return 0;
    }
  }

  private getGenreScore(option: any, genre: string): number {
    switch (genre.toLowerCase()) {
      case 'pop':
      case 'contemporary':
        return option.freq && option.freq > 20 ? 0.1 : 0; // Prefer common words
      case 'traditional':
      case 'classical':
        return option.freq && option.freq < 50 ? 0.1 : 0; // Prefer less common, more poetic words
      case 'rap':
      case 'hip-hop':
        return option.surface.length === 1 ? 0.1 : 0; // Prefer single characters for rhythm
      default:
        return 0;
    }
  }

  private getThemeKeywords(theme: string): string[] {
    const themeMap: Record<string, string[]> = {
      'love': ['愛', '情', '心', '戀'],
      'nature': ['山', '水', '花', '樹', '天', '地'],
      'time': ['時', '日', '年', '月', '夜', '晨'],
      'emotion': ['喜', '怒', '哀', '樂', '感', '情'],
      'family': ['家', '母', '父', '子', '女', '親'],
      'friendship': ['友', '朋', '伴', '同', '共'],
      'journey': ['路', '行', '走', '遠', '近', '來'],
      'dreams': ['夢', '想', '望', '希', '願'],
    };

    return themeMap[theme] || [];
  }

  private generateReason(input: GroupedSelectionInput, selections: GroupSelection[]): string {
    const reasons: string[] = [];

    if (input.theme) {
      reasons.push(`theme: ${input.theme}`);
    }
    if (input.mood) {
      reasons.push(`mood: ${input.mood}`);
    }
    if (input.genre) {
      reasons.push(`genre: ${input.genre}`);
    }

    const contextText = reasons.length > 0 ? ` considering ${reasons.join(', ')}` : '';
    
    return `Heuristic selection based on frequency and surface characteristics${contextText}. Selected ${selections.length} words to form: "${selections.map(s => s.surface).join('')}"`;
  }
}