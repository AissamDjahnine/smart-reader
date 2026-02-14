import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import LibraryGlobalSearchPanel from '../../src/pages/library/LibraryGlobalSearchPanel';

describe('LibraryGlobalSearchPanel', () => {
  it('renders grouped sections and dispatches open handlers', async () => {
    const user = userEvent.setup();
    const onOpenResult = vi.fn();

    render(
      <LibraryGlobalSearchPanel
        showGlobalSearchSplitColumns={false}
        globalSearchTotal={3}
        isContentSearching={false}
        globalMatchedBookPairs={[
          {
            bookId: 'book-1',
            title: 'Dune',
            contentItems: [
              {
                id: 'content-1',
                title: 'Chapter 1',
                subtitle: 'Arrakis',
                snippet: 'A beginning',
                key: 'content'
              }
            ]
          }
        ]}
        globalOtherGroups={[
          {
            key: 'notes',
            label: 'Notes',
            items: [
              { id: 'note-1', title: 'Paul', subtitle: 'Personal note', snippet: 'Fear is the mind-killer' }
            ]
          }
        ]}
        globalMatchedBooks={[]}
        contentPanelHeightClass="h-auto"
        contentScrollHeightClass="max-h-80"
        onOpenResult={onOpenResult}
        renderGlobalSearchBookCard={() => <div data-testid="fake-book-card">Book card</div>}
      />
    );

    expect(screen.getByText('Global Search Results')).toBeInTheDocument();
    expect(screen.getByText('Book content · Dune')).toBeInTheDocument();
    expect(screen.getByText('Notes')).toBeInTheDocument();

    await user.click(screen.getByTestId('global-search-result-content'));
    expect(onOpenResult).toHaveBeenCalledTimes(1);

    await user.click(screen.getByTestId('global-search-result-notes'));
    expect(onOpenResult).toHaveBeenCalledTimes(2);
  });
});
