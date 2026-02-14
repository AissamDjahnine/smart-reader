import { describe, it, expect } from 'vitest';
import {
  stripDuplicateTitleSuffix,
  isDuplicateTitleBook,
  buildDuplicateTitle,
  buildDuplicateIndex
} from '../../src/pages/library/duplicateBooks';

describe('duplicateBooks', () => {
  it('detects and strips duplicate suffix', () => {
    expect(isDuplicateTitleBook({ title: 'Dune (Duplicate 2)' })).toBe(true);
    expect(stripDuplicateTitleSuffix('Dune (Duplicate 2)')).toBe('Dune');
  });

  it('builds next duplicate title with index', () => {
    const books = [{ title: 'Dune' }, { title: 'Dune (Duplicate 1)' }, { title: 'Dune (Duplicate 2)' }];
    const index = buildDuplicateIndex(books);
    expect(buildDuplicateTitle('Dune', books, index)).toBe('Dune (Duplicate 3)');
  });
});
