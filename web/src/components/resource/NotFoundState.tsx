import { Link } from "react-router-dom";
import { SearchX } from "lucide-react";
import { cn } from "@/lib/utils";

export interface NotFoundStateProps {
  title?: string;
  description?: string;
  /** Route to send the user back to. Defaults to the app root. */
  backTo?: string;
  backLabel?: string;
  className?: string;
}

export default function NotFoundState({
  title = "Not found",
  description = "The page or record you're looking for doesn't exist.",
  backTo = "/",
  backLabel = "Back home",
  className,
}: NotFoundStateProps) {
  return (
    <div className={cn("border rounded-lg p-12 text-center space-y-3", className)}>
      <SearchX className="h-8 w-8 text-muted-foreground mx-auto" />
      <div>
        <p className="font-medium">{title}</p>
        <p className="text-sm text-muted-foreground mt-1">{description}</p>
      </div>
      <Link to={backTo} className="text-sm text-primary underline underline-offset-4">
        {backLabel}
      </Link>
    </div>
  );
}
