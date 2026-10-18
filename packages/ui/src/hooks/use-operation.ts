import { useCallback, useRef, useState } from 'react';
import { toHandshackError, userMessageFor, type HandshackError, type ProgressEvent } from '@handshack/core';

export type OpStatus = 'idle' | 'running' | 'completed' | 'failed' | 'cancelled';

export interface OperationState {
  status: OpStatus;
  progress: ProgressEvent | null;
  error: HandshackError | null;
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
 * `signal` aborts the underlying operation; callers must still pass it through.
 */
export function useOperation() {
  const [state, setState] = useState<OperationState>({ status: 'idle', progress: null, error: null });
  const abortRef = useRef<AbortController | null>(null);

  const begin = useCallback((): AbortSignal => {
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setState({ status: 'running', progress: { phase: 'preparing', done: 0, total: 0 }, error: null });
    return ctrl.signal;
  }, []);

  const progress = useCallback((e: ProgressEvent) => {
    setState((s) => (s.status === 'running' ? { ...s, progress: e } : s));
  }, []);

  const succeed = useCallback(() => {
    setState((s) => ({ ...s, status: 'completed' }));
    abortRef.current = null;
  }, []);

  const fail = useCallback((err: unknown) => {
    const e = toHandshackError(err);
    setState({ status: e.code === 'cancelled' ? 'cancelled' : 'failed', progress: null, error: e });
    abortRef.current = null;
  }, []);

  const cancel = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  const reset = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setState({ status: 'idle', progress: null, error: null });
  }, []);

  return { state, begin, progress, succeed, fail, cancel, reset, userMessageFor };
}
