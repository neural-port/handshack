import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ErrorBoundary } from '../src/components/error-boundary.js';

function Explode(): never {
  throw new Error('boom');
}

describe('ErrorBoundary', () => {
  it('renders a recovery screen instead of a blank window', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    render(
      <ErrorBoundary>
        <Explode />
      </ErrorBoundary>,
    );
    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /reload handshack/i })).toBeInTheDocument();
    expect(screen.getByText(/nothing left this device/i)).toBeInTheDocument();
    spy.mockRestore();
  });

  it('does not leak error details into the fallback', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    render(
      <ErrorBoundary>
        <Explode />
      </ErrorBoundary>,
    );
    expect(screen.queryByText(/boom/)).not.toBeInTheDocument();
    spy.mockRestore();
  });
});
