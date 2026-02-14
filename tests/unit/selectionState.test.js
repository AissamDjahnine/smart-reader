import { describe, it, expect } from 'vitest';
import { areAllVisibleIdsSelected, pruneSelectionByAllowedIds } from '../../src/pages/library/selectionState';

describe('selectionState helpers', () => {
  it('checks all visible IDs selected', () => {
    expect(areAllVisibleIdsSelected(['a', 'b'], ['a', 'b', 'c'])).toBe(true);
    expect(areAllVisibleIdsSelected(['a', 'b'], ['a'])).toBe(false);
    expect(areAllVisibleIdsSelected([], ['a'])).toBe(false);
  });

  it('prunes selection IDs to currently allowed IDs', () => {
    expect(pruneSelectionByAllowedIds(['a', 'b', 'z'], ['b', 'c'])).toEqual(['b']);
    expect(pruneSelectionByAllowedIds([], ['b', 'c'])).toEqual([]);
  });
});
