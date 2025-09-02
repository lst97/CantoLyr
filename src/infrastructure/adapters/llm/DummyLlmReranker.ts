import type {
  LlmReranker,
  RerankInput,
  RerankResult,
  LlmConfig,
  RankingItem,
} from '../../../application/ports/LlmReranker.js';

/**
 * Dummy implementation of LlmReranker for testing and fallback scenarios
 * Provides deterministic, heuristic-based ranking without external API calls
 */
export class DummyLlmReranker implements LlmReranker {
  constructor(_config?: LlmConfig) {}

  async rerank(input: RerankInput): Promise<RerankResult> {
    const startTime = Date.now();

    try {
      const rankings = this.generateHeuristicRankings(input);
      const processingTimeMs = Date.now() - startTime;

      return {
        rankings,
        success: true,
        model: 'dummy-heuristic',
        processingTimeMs
      };

    } catch (error) {
      const processingTimeMs = Date.now() - startTime;
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';

      return {
        rankings: [],
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
      model: 'heuristic-v1',
      version: '1.0'
    };
  }

  async validateConfig(): Promise<void> {
    // Dummy implementation has no configuration requirements
    return;
  }

  /**
   * Generate deterministic rankings based on heuristic scoring
   * Considers frequency, register, part of speech, and syllable count
   */
  private generateHeuristicRankings(input: RerankInput): RankingItem[] {
    const scoredCandidates = input.candidates.map(candidate => {
      const score = this.calculateHeuristicScore(candidate, input.tonePattern);
      return {
        readingId: candidate.id,
        score,
        reason: this.generateReason(candidate, score)
      };
    });

    // Sort by score descending and limit results
    const sorted = scoredCandidates.sort((a, b) => b.score - a.score);
    const topK = input.topK || input.candidates.length;
    
    return sorted.slice(0, topK);
  }

  /**
   * Calculate heuristic score based on multiple factors
   */
  private calculateHeuristicScore(candidate: any, tonePattern: string): number {
    let score = 0;

    // Frequency score (normalized to 0-0.3)
    const freqScore = Math.min(candidate.freq / 100, 1) * 0.3;
    score += freqScore;

    // Register preference (0-0.2)
    const registerScore = this.getRegisterScore(candidate.register) * 0.2;
    score += registerScore;

    // Part of speech preference (0-0.2)
    const posScore = this.getPosScore(candidate.pos) * 0.2;
    score += posScore;

    // Syllable count preference (0-0.15)
    const syllableScore = this.getSyllableScore(candidate.syllables, tonePattern.length) * 0.15;
    score += syllableScore;

    // Entry type preference (0-0.1)
    const typeScore = this.getTypeScore(candidate.type) * 0.1;
    score += typeScore;

    // Language preference (0-0.05)
    const langScore = this.getLangScore(candidate.lang) * 0.05;
    score += langScore;

    // Ensure score is between 0 and 1
    return Math.max(0, Math.min(1, score));
  }

  private getRegisterScore(register: string): number {
    switch (register.toLowerCase()) {
      case 'neutral': return 1.0;
      case 'formal': return 0.8;
      case 'colloquial': return 0.9;
      default: return 0.5;
    }
  }

  private getPosScore(pos: string): number {
    switch (pos.toUpperCase()) {
      case 'NOUN': return 1.0;
      case 'VERB': return 0.95;
      case 'ADJ': return 0.9;
      case 'ADV': return 0.7;
      case 'NUM': return 0.6;
      case 'LETTER': return 0.3;
      default: return 0.5;
    }
  }

  private getSyllableScore(syllables: number, targetLength: number): number {
    if (syllables === targetLength) return 1.0;
    const diff = Math.abs(syllables - targetLength);
    return Math.max(0, 1 - (diff * 0.2));
  }

  private getTypeScore(type: string): number {
    switch (type) {
      case 'vocab': return 1.0;
      case 'char': return 0.8;
      default: return 0.5;
    }
  }

  private getLangScore(lang: string): number {
    switch (lang) {
      case 'zh-HK': return 1.0;
      case 'zh-CN': return 0.8;
      default: return 0.6;
    }
  }

  private generateReason(candidate: any, score: number): string {
    const reasons: string[] = [];

    if (candidate.freq > 50) {
      reasons.push('high frequency');
    } else if (candidate.freq > 10) {
      reasons.push('moderate frequency');
    }

    if (candidate.register === 'neutral') {
      reasons.push('neutral register');
    } else if (candidate.register === 'formal') {
      reasons.push('formal register');
    }

    if (['NOUN', 'VERB', 'ADJ'].includes(candidate.pos.toUpperCase())) {
      reasons.push('good POS for lyrics');
    }

    if (candidate.type === 'vocab') {
      reasons.push('vocabulary word');
    }

    if (score > 0.8) {
      return `Excellent choice: ${reasons.join(', ')}`;
    } else if (score > 0.6) {
      return `Good option: ${reasons.join(', ')}`;
    } else if (score > 0.4) {
      return `Acceptable: ${reasons.join(', ')}`;
    } else {
      return `Lower priority: ${reasons.join(', ')}`;
    }
  }
}