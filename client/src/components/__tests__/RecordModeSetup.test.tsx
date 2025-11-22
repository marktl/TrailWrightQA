import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { RecordModeSetup } from '../RecordModeSetup';

describe('RecordModeSetup', () => {
  it('should render form fields', () => {
    render(<RecordModeSetup onStart={vi.fn()} />);

    expect(screen.getByLabelText(/test name/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/starting url/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /start recording/i })).toBeInTheDocument();
  });

  it('should call onStart with form data', async () => {
    const onStart = vi.fn();
    render(<RecordModeSetup onStart={onStart} />);

    fireEvent.change(screen.getByLabelText(/test name/i), {
      target: { value: 'My Test' },
    });
    fireEvent.change(screen.getByLabelText(/starting url/i), {
      target: { value: 'https://example.com' },
    });

    fireEvent.click(screen.getByRole('button', { name: /start recording/i }));

    expect(onStart).toHaveBeenCalledWith({
      name: 'My Test',
      startUrl: 'https://example.com',
      description: '',
    });
  });
});
