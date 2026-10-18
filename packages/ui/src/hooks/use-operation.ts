import { useCallback, useRef, useState } from 'react';
import { toHandshackError, userMessageFor, type HandshackError, type ProgressEvent } from '@handshack/core';

export type OpStatus = 'idle' | 'running' | 'completed' | 'failed' | 'cancelled';

export interface OperationState {
  status: OpStatus;
  progress: ProgressEvent | null;
  error: HandshackError | null;
}

export interface OperationHandle {
  signal: AbortSignal;
  progress: (event: ProgressEvent) => void;
  succeed: () => void;
  fail: (error: unknown) => void;
}

const PHASE_LABELS: Record<string, string> = {
  preparing: 'Preparing…',
  validating: 'Validating package…',
  hashing: 'Hashing file…',
  'deriving-key': 'Deriving encryption key…',
  encrypting: 'Encrypting…',
  writing: 'Writing output…',
  verifying: 'Verifying output…',
  reassembling: 'Reassembling parts…',
  decrypting: 'Decrypting…',
  completed: 'Finishing…',
};

export function phaseLabel(phase: string): string {
  return PHASE_LABELS[phase] ?? phase;
}

/**
 * Shared workflow state machine: idle → running → completed | failed | cancelled.
 * Each handle is generation-bound, so late callbacks from a cancelled or
 * superseded operation cannot overwrite the state of a newer one.
 */
export function useOperation() {
  const [state, setState] = useState<OperationState>({ status: 'idle', progress: null, error: null });
  const abortRef = useRef<AbortController | null>(null);
  const genRef = useRef(0);

  const begin = useCallback((): OperationHandle => {
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    const generation = ++genRef.current;
    setState({ status: 'running', progress: { phase: 'preparing', done: 0, total: 0 }, error: null });
    return {
      signal: ctrl.signal,
      progress: (event) => {
        if (genRef.current === generation) {
          setState((s) => (s.status === 'running' ? { ...s, progress: event } : s));
        }
      },
      succeed: () => {
        if (genRef.current !== generation) return;
        setState((s) => (s.status === 'running' ? { ...s, status: 'completed' } : s));
        if (abortRef.current === ctrl) abortRef.current = null;
      },
      fail: (err) => {
        if (genRef.current !== generation) return;
        const e = toHandshackError(err);
        setState((s) =>
          s.status === 'running'
            ? { status: e.code === 'cancelled' ? 'cancelled' : 'failed', progress: null, error: e }
            : s,
        );
        if (abortRef.current === ctrl) abortRef.current = null;
      },
    };
  }, []);

  const cancel = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  const reset = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    genRef.current++;
    setState({ status: 'idle', progress: null, error: null });
  }, []);

  return { state, begin, cancel, reset, userMessageFor };
}
