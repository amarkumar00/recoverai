import type { HTMLAttributes } from "react";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/cn";

const badgeVariants = cva("badge", {
  variants: {
    tone: {
      neutral: "badge-neutral",
      positive: "badge-positive",
      warning: "badge-warning",
      blocked: "badge-blocked",
      demo: "badge-demo",
    },
  },
  defaultVariants: {
    tone: "neutral",
  },
});

type BadgeProps = HTMLAttributes<HTMLSpanElement> &
  VariantProps<typeof badgeVariants>;

export function Badge({ className, tone, ...props }: BadgeProps) {
  return <span className={cn(badgeVariants({ tone }), className)} {...props} />;
}
