import { Outlet, useLocation } from "react-router-dom";
import RouteErrorBoundary from "@/components/RouteErrorBoundary";

export default function CandidateLayout() {
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
          <Outlet />
        </RouteErrorBoundary>
      </main>
    </div>
  );
}
