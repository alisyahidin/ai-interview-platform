import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const badgeVariants = cva(
    "inline-flex items-center rounded-md border px-2.5 py-0.5 text-xs font-semibold transition-colors focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2",
    {
        variants: {
            variant: {
                default:
                    "border-transparent bg-primary text-primary-foreground shadow hover:bg-primary/80",
                secondary:
                    "border-transparent bg-secondary text-secondary-foreground hover:bg-secondary/80",
                destructive:
                    "border-transparent bg-destructive text-destructive-foreground shadow hover:bg-destructive/80",
                outline: "text-foreground",
                // Phase 3b (#23) judgment states — F43: the canonical variant
                // surface for skill-assessment badges, replacing the old
                // hand-rolled LEVEL_BADGE_CLASSES lookup. Each is styled by
                // shape (solid fill / outline / dashed) AND paired with an
                // icon + text at the call site, so no state is colour-only.
                assessed:
                    "border-transparent bg-judgment-assessedBg text-judgment-assessedFg",
                tentative:
                    "border-2 border-judgment-tentativeBorder bg-transparent text-judgment-tentativeFg",
                notAssessed:
                    "border border-dashed border-judgment-neutralBorder bg-judgment-neutralBg text-judgment-neutralFg",
                needsReview:
                    "border border-judgment-reviewBorder bg-judgment-reviewBg text-judgment-reviewFg hover:bg-judgment-reviewBg/70",
            },
        },
        defaultVariants: {
            variant: "default",
        },
    }
);

export interface BadgeProps
    extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof badgeVariants> { }

function Badge({ className, variant, ...props }: BadgeProps) {
    return <div className={cn(badgeVariants({ variant }), className)} {...props} />;
}

export { Badge, badgeVariants };
