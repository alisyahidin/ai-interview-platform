import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

interface TruncatedTextProps {
  text: string;
  className?: string;
}

/**
 * Renders `text` visually truncated with an ellipsis, while keeping the full
 * value available on hover *and* keyboard focus (via an accessible tooltip).
 * Used anywhere a free-text field (skill label, vacancy name, ...) could be
 * long enough to overflow or break a fixed-width layout (F8/AC39).
 *
 * Must be rendered under a `TooltipProvider`.
 */
export function TruncatedText({ text, className }: TruncatedTextProps) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          tabIndex={0}
          className={cn(
            "inline-block max-w-full truncate align-bottom focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring",
            className
          )}
        >
          {text}
        </span>
      </TooltipTrigger>
      <TooltipContent>{text}</TooltipContent>
    </Tooltip>
  );
}
