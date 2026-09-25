import { ShieldAlert } from "lucide-react";
import { cn } from "@/lib/utils";

export interface ForbiddenStateProps {
  title?: string;
  description?: string;
  className?: string;
}

export default function ForbiddenState({
  title = "Access denied",
  description = "You don't have permission to view this.",
  className,
}: ForbiddenStateProps) {
  return (
    <div className={cn("border rounded-lg p-12 text-center space-y-3", className)}>
      <ShieldAlert className="h-8 w-8 text-muted-foreground mx-auto" />
      <div>
        <p className="font-medium">{title}</p>
        <p className="text-sm text-muted-foreground mt-1">{description}</p>
      </div>
    </div>
  );
}
