import type { ReactNode } from "react";
import { Outlet, useLocation } from "react-router-dom";
import RouteErrorBoundary from "@/components/RouteErrorBoundary";

interface CandidateLayoutProps {
  /** Explicit content to render instead of the routed <Outlet/> — used when
   * this shell is reused outside the /interview/:token route tree (e.g. the
   * unauthenticated catch-all 404). Defaults to <Outlet/> for normal routing. */
  children?: ReactNode;
}

export default function CandidateLayout({ children }: CandidateLayoutProps) {
  const location = useLocation();

  return (
    <div className="min-h-screen flex flex-col bg-background">
      {/* Minimal header — no nav */}
      <header className="border-b bg-white">
        <div className="max-w-2xl mx-auto px-4 h-12 flex items-center">
          <span className="font-semibold text-sm text-muted-foreground">AI Interview</span>
        </div>
      </header>

      <main className="flex-1 flex flex-col">
        <RouteErrorBoundary key={location.pathname}>
          {children ?? <Outlet />}
        </RouteErrorBoundary>
      </main>
    </div>
  );
}
