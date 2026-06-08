// SPDX-License-Identifier: GPL-3.0-or-later
// @paritytech

import { Component, type ErrorInfo, type ReactNode } from "react";

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
}

/**
 * Last-resort render guard. Catches synchronous render/lifecycle throws so
 * an unhandled error renders a readable panel instead of a blank screen —
 * critical on a kiosk webview with no DevTools.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error("[w3s-payment-processor] render error", error, info.componentStack);
  }

  render(): ReactNode {
    const { error } = this.state;
    if (!error) return this.props.children;
    return (
      <div className="fatal-panel" role="alert">
        <h1>Something went wrong</h1>
        <pre>{error.message}</pre>
      </div>
    );
  }
}
