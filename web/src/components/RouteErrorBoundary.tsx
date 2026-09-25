import { Component, type ReactNode } from "react";
import { AlertTriangle } from "lucide-react";

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
}

/**
 * Route-level error boundary. Wraps a single Layout's `<Outlet/>` (see
 * AssessorLayout/CandidateLayout), one level inside the app-wide
 * `<ErrorBoundary>` in main.tsx.
 *
 * A render failure in the routed page is isolated to that view — the Layout
 * chrome (nav, header) around it keeps rendering and stays interactive,
 * unlike the app-wide boundary, which would blank the entire application.
 *
 * This codebase uses React Router's declarative mode (BrowserRouter +
 * <Routes>/<Route>), which has no `errorElement`/`useRouteError` (that's
 * data-mode only), so a manual class component is required here.
 *
 * Recovery: the call site renders this keyed by `location.pathname`
 * (`<RouteErrorBoundary key={location.pathname}>`), so React remounts it —
 * and therefore resets `hasError` — on every navigation. Navigating away
 * from a broken view is itself the recovery action; no reset button or
 * manual reset logic is needed.
 */
export default class RouteErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false };

  static getDerivedStateFromError(): State {
    return { hasError: true };
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="border border-destructive/40 rounded-lg p-12 text-center space-y-3">
          <AlertTriangle className="h-8 w-8 text-destructive mx-auto" />
          <div>
            <p className="font-medium">This page couldn't be displayed</p>
            <p className="text-sm text-muted-foreground mt-1">
              Something went wrong while rendering this view. Navigate to another page to continue.
            </p>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
