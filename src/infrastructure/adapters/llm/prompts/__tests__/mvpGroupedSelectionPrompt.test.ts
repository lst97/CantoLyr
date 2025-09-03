import { describe, it, expect } from 'vitest';
import { buildMvpGroupedSelectionPrompt } from '../mvpGroupedSelectionPrompt.js';
import type { Group } from '../../../../../application/services/mvpPrefilter.js';

describe('buildMvpGroupedSelectionPrompt', () => {
  const createTestGroups = (): Group[] => [
    {
      groupIndex: 1,
      pattern: '3',
      options: [
        { option: 1, surface: '愛', readingId: BigInt(1), freq: 85 },
        { option: 2, surface: '我', readingId: BigInt(2), freq: 95 }
      ]
    },
    {
      groupIndex: 2,
      pattern: '4',
      options: [
        { option: 1, surface: '你', readingId: BigInt(3), freq: 90 },
        { option: 2, surface: '他', readingId: BigInt(4), freq: 75 }
      ]
    }
  ];

  it('should build basic prompt with groups', () => {
    const groups = createTestGroups();
    const prompt = buildMvpGroupedSelectionPrompt(groups);

    expect(prompt).toContain('Task: Select exactly one option from each group');
    expect(prompt).toContain('Group 1 (3): [1] 愛, [2] 我');
    expect(prompt).toContain('Group 2 (4): [1] 你, [2] 他');
    expect(prompt).toContain('Output JSON only');
    expect(prompt).toContain('"selections"');
    expect(prompt).toContain('"line"');
    expect(prompt).toContain('"reason"');
  });

  it('should include theme when provided', () => {
    const groups = createTestGroups();
    const prompt = buildMvpGroupedSelectionPrompt(groups, { theme: 'love' });

    expect(prompt).toContain('- Theme: love');
  });

  it('should include mood when provided', () => {
    const groups = createTestGroups();
    const prompt = buildMvpGroupedSelectionPrompt(groups, { mood: 'romantic' });

    expect(prompt).toContain('- Mood: romantic');
  });

  it('should include genre when provided', () => {
    const groups = createTestGroups();
    const prompt = buildMvpGroupedSelectionPrompt(groups, { genre: 'pop' });

    expect(prompt).toContain('- Genre: pop');
  });

  it('should include language when provided', () => {
    const groups = createTestGroups();
    const prompt = buildMvpGroupedSelectionPrompt(groups, { language: 'zh-HK' });

    expect(prompt).toContain('- Language: zh-HK');
  });

  it('should include all context options when provided', () => {
    const groups = createTestGroups();
    const prompt = buildMvpGroupedSelectionPrompt(groups, {
      theme: 'love',
      mood: 'romantic',
      genre: 'ballad',
      language: 'zh-HK'
    });

    expect(prompt).toContain('- Language: zh-HK');
    expect(prompt).toContain('- Theme: love');
    expect(prompt).toContain('- Mood: romantic');
    expect(prompt).toContain('- Genre: ballad');
  });

  it('should handle single group', () => {
    const groups: Group[] = [
      {
        groupIndex: 1,
        pattern: '3',
        options: [
          { option: 1, surface: '愛', readingId: BigInt(1), freq: 85 }
        ]
      }
    ];

    const prompt = buildMvpGroupedSelectionPrompt(groups);

    expect(prompt).toContain('Group 1 (3): [1] 愛');
    expect(prompt).not.toContain('Group 2');
  });

  it('should handle multiple options in a group', () => {
    const groups: Group[] = [
      {
        groupIndex: 1,
        pattern: '34',
        options: [
          { option: 1, surface: '愛情', readingId: BigInt(1), freq: 85 },
          { option: 2, surface: '感情', readingId: BigInt(2), freq: 75 },
          { option: 3, surface: '友情', readingId: BigInt(3), freq: 65 }
        ]
      }
    ];

    const prompt = buildMvpGroupedSelectionPrompt(groups);

    expect(prompt).toContain('Group 1 (34): [1] 愛情, [2] 感情, [3] 友情');
  });

  it('should contain proper JSON structure example', () => {
    const groups = createTestGroups();
    const prompt = buildMvpGroupedSelectionPrompt(groups);

    expect(prompt).toContain('{"group": 1, "option": <number>}');
    expect(prompt).toContain('{"group": 2, "option": <number>}');
    expect(prompt).toContain('"line": "<concatenation of chosen options in order>"');
    expect(prompt).toContain('"reason": "<brief rationale>"');
  });

  it('should emphasize constraints clearly', () => {
    const groups = createTestGroups();
    const prompt = buildMvpGroupedSelectionPrompt(groups);

    expect(prompt).toContain('Use ONLY the chosen options, concatenated in the same group order');
    expect(prompt).toContain('Do NOT add, remove, or change any characters');
    expect(prompt).toContain('Pick the most fitting options to express feeling and grammaticality');
  });

  it('should handle empty options gracefully', () => {
    const groups: Group[] = [
      {
        groupIndex: 1,
        pattern: '3',
        options: []
      }
    ];

    const prompt = buildMvpGroupedSelectionPrompt(groups);

    expect(prompt).toContain('Group 1 (3): ');
    expect(prompt).not.toContain('[1]');
  });

  it('should maintain consistent formatting', () => {
    const groups = createTestGroups();
    const prompt = buildMvpGroupedSelectionPrompt(groups);

    // Check that the prompt has proper structure
    expect(prompt).toMatch(/Task: Select exactly one option/);
    expect(prompt).toMatch(/Constraints:/);
    expect(prompt).toMatch(/Group \d+ \([^)]+\):/);
    expect(prompt).toMatch(/Output JSON only/);
  });
});