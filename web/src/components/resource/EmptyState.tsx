import type { ReactNode } from "react";
import { Inbox } from "lucide-react";
import { cn } from "@/lib/utils";

export interface EmptyStateProps {
  title?: string;
  description?: string;
  icon?: ReactNode;
  action?: ReactNode;
  className?: string;
}

export default function EmptyState({
  title = "Nothing here yet",
  description = "There's no data to show right now.",
  icon,
  action,
  className,
}: EmptyStateProps) {
  return (
    <div className={cn("border rounded-lg p-12 text-center space-y-3", className)}>
      {icon ?? <Inbox className="h-8 w-8 text-muted-foreground mx-auto" />}
      <div>
        <p className="font-medium">{title}</p>
        <p className="text-sm text-muted-foreground mt-1">{description}</p>
      </div>
      {action}
    </div>
  );
}
