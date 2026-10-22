import { Component, type ErrorInfo, type ReactNode } from 'react';

interface Props {
  children: ReactNode;
}

interface State {
  failed: boolean;
}

/**
 * Last-resort guard: a render error must not leave a blank window.
 * The fallback never shows file names, passwords, or package details.
 */
export class ErrorBoundary extends Component<Props, State> {
  override state: State = { failed: false };

  static getDerivedStateFromError(): State {
    return { failed: true };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    // Console only: no file names, no passwords, no package identifiers.
    console.error('render failed', error.name, info.componentStack);
  }

  override render(): ReactNode {
    if (!this.state.failed) return this.props.children;
    return (
      <div className="main" role="alert">
        <div className="page-head">
          <p className="eyebrow">Application error</p>
          <h1>Something broke on this screen</h1>
        </div>
        <p className="field-hint">
          No file was modified and nothing left this device. Reload to start again; any package you already
          downloaded is unaffected.
        </p>
        <button type="button" className="btn btn-primary" onClick={() => window.location.reload()}>
          Reload HandShack
        </button>
      </div>
    );
  }
}
