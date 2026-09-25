import { Link } from "react-router-dom";
import { AlertCircle } from "lucide-react";
import { cn } from "@/lib/utils";

export interface WrongStateStateProps {
  title?: string;
  description?: string;
  /** Route to send the user back to. Omit to render no back link. */
  backTo?: string;
  backLabel?: string;
  className?: string;
}

/**
 * Rendered when `isValidState` rejects an otherwise-`ready` result (e.g. a
 * `pending` session has no transcript yet, or the Live Monitor only applies
 * to an `active` session). Distinct from `<EmptyState>`: the fetch worked
 * and returned data, but the data isn't in a state this page can show.
 *
 * `backTo` follows the same "route back" pattern as `<NotFoundState>` (AC16):
 * a guarded state should never be a dead end.
 */
export default function WrongStateState({
  title = "Not available yet",
  description = "This isn't ready to view in its current state.",
  backTo,
  backLabel = "Go back",
  className,
}: WrongStateStateProps) {
  return (
    <div className={cn("border rounded-lg p-12 text-center space-y-3", className)}>
      <AlertCircle className="h-8 w-8 text-muted-foreground mx-auto" />
      <div>
        <p className="font-medium">{title}</p>
        <p className="text-sm text-muted-foreground mt-1">{description}</p>
      </div>
      {backTo && (
        <Link to={backTo} className="text-sm text-primary underline underline-offset-4">
          {backLabel}
        </Link>
      )}
    </div>
  );
}
