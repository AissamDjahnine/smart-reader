import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import FeedbackToast from '../../src/components/FeedbackToast';

describe('FeedbackToast', () => {
  it('renders title/message and triggers action + dismiss', async () => {
    const onDismiss = vi.fn();
    const onAction = vi.fn();
    const user = userEvent.setup();

    render(
      <FeedbackToast
        toast={{ tone: 'success', title: 'Saved', message: 'All good', actionLabel: 'Undo', onAction }}
        onDismiss={onDismiss}
      />
    );

    expect(screen.getByText('Saved')).toBeInTheDocument();
    expect(screen.getByText('All good')).toBeInTheDocument();

    await user.click(screen.getByTestId('feedback-toast-action'));
    expect(onAction).toHaveBeenCalledTimes(1);

    await user.click(screen.getByRole('button', { name: 'Dismiss message' }));
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });
});
