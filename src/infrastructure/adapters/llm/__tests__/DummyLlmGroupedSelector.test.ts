import { describe, it, expect, beforeEach } from 'vitest';
import { DummyLlmGroupedSelector } from '../DummyLlmGroupedSelector.js';
import type { GroupedSelectionInput } from '../../../../application/ports/LlmGroupedSelector.js';
import type { Group } from '../../../../application/services/mvpPrefilter.js';

describe('DummyLlmGroupedSelector', () => {
  let selector: DummyLlmGroupedSelector;

  beforeEach(() => {
    selector = new DummyLlmGroupedSelector();
  });

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

  describe('selectFromGroups', () => {
    it('should successfully select from groups using heuristic scoring', async () => {
      const groups = createTestGroups();
      const input: GroupedSelectionInput = {
        groups,
        theme: 'love',
        mood: 'romantic'
      };

      const result = await selector.selectFromGroups(input);

      expect(result.success).toBe(true);
      expect(result.selections).toHaveLength(2);
      expect(result.selections[0]?.group).toBe(1);
      expect(result.selections[1]?.group).toBe(2);
      expect(result.line).toBe(result.selections.map(s => s.surface).join(''));
      expect(result.model).toBe('dummy-heuristic');
      expect(result.reason).toContain('Heuristic selection');
    });

    it('should select highest frequency options by default', async () => {
      const groups = createTestGroups();
      const input: GroupedSelectionInput = { groups };

      const result = await selector.selectFromGroups(input);

      expect(result.success).toBe(true);
      // Should select option 2 from group 1 (freq: 95) and option 1 from group 2 (freq: 90)
      expect(result.selections[0]?.surface).toBe('我'); // Higher frequency
      expect(result.selections[1]?.surface).toBe('你'); // Higher frequency
    });

    it('should handle empty groups gracefully', async () => {
      const groups: Group[] = [
        {
          groupIndex: 1,
          pattern: '3',
          options: []
        }
      ];
      const input: GroupedSelectionInput = { groups };

      const result = await selector.selectFromGroups(input);

      expect(result.success).toBe(false);
      expect(result.error).toContain('Group 1 has no options');
    });

    it('should handle single option per group', async () => {
      const groups: Group[] = [
        {
          groupIndex: 1,
          pattern: '3',
          options: [
            { option: 1, surface: '愛', readingId: BigInt(1), freq: 85 }
          ]
        }
      ];
      const input: GroupedSelectionInput = { groups };

      const result = await selector.selectFromGroups(input);

      expect(result.success).toBe(true);
      expect(result.selections).toHaveLength(1);
      expect(result.selections[0]?.surface).toBe('愛');
      expect(result.line).toBe('愛');
    });

    it('should apply theme-based scoring adjustments', async () => {
      const groups: Group[] = [
        {
          groupIndex: 1,
          pattern: '3',
          options: [
            { option: 1, surface: '愛', readingId: BigInt(1), freq: 50 }, // Love-related
            { option: 2, surface: '工', readingId: BigInt(2), freq: 80 }  // Work-related, higher freq
          ]
        }
      ];
      const input: GroupedSelectionInput = { 
        groups,
        theme: 'love'
      };

      const result = await selector.selectFromGroups(input);

      expect(result.success).toBe(true);
      // Theme bonus might make '愛' win despite lower frequency
      expect(result.selections[0]?.surface).toBe('愛');
    });

    it('should include context information in reason', async () => {
      const groups = createTestGroups();
      const input: GroupedSelectionInput = {
        groups,
        theme: 'love',
        mood: 'romantic',
        genre: 'pop'
      };

      const result = await selector.selectFromGroups(input);

      expect(result.success).toBe(true);
      expect(result.reason).toContain('theme: love');
      expect(result.reason).toContain('mood: romantic');
      expect(result.reason).toContain('genre: pop');
    });

    it('should be deterministic with same input', async () => {
      const groups = createTestGroups();
      const input: GroupedSelectionInput = { groups };

      const result1 = await selector.selectFromGroups(input);
      const result2 = await selector.selectFromGroups(input);

      expect(result1.selections).toEqual(result2.selections);
      expect(result1.line).toBe(result2.line);
    });
  });

  describe('isAvailable', () => {
    it('should always return true', async () => {
      const available = await selector.isAvailable();
      expect(available).toBe(true);
    });
  });

  describe('getInfo', () => {
    it('should return correct provider information', () => {
      const info = selector.getInfo();
      expect(info.provider).toBe('Dummy Heuristic');
      expect(info.model).toBe('heuristic-grouped-v1');
      expect(info.version).toBe('1.0');
    });
  });

  describe('validateConfig', () => {
    it('should never throw errors', async () => {
      await expect(selector.validateConfig()).resolves.not.toThrow();
    });
  });
});