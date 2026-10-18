import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { useOperation } from '../src/hooks/use-operation.js';

describe('useOperation', () => {
  it('ignores completion from a superseded operation', () => {
    const { result } = renderHook(() => useOperation());
    let first!: ReturnType<typeof result.current.begin>;
    let second!: ReturnType<typeof result.current.begin>;

    act(() => {
      first = result.current.begin();
      second = result.current.begin();
    });
    act(() => first.succeed());
    expect(result.current.state.status).toBe('running');

    act(() => second.succeed());
    expect(result.current.state.status).toBe('completed');
  });

  it('ignores progress and failure after reset', () => {
    const { result } = renderHook(() => useOperation());
    let operation!: ReturnType<typeof result.current.begin>;
    act(() => {
      operation = result.current.begin();
      result.current.reset();
    });
    act(() => {
      operation.progress({ phase: 'encrypting', done: 10, total: 100 });
      operation.fail(new Error('stale failure'));
    });
    expect(result.current.state.status).toBe('idle');
    expect(result.current.state.progress).toBeNull();
  });
});
