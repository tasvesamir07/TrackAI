/* eslint-disable react-refresh/only-export-components */
import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "@/lib/utils"

const badgeVariants = cva(
    "inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2",
    {
        variants: {
            variant: {
                default:
                    "border-transparent bg-primary text-primary-foreground hover:bg-primary-hover",
                secondary:
                    "border-transparent bg-secondary-light text-secondary hover:bg-secondary/20",
                destructive:
                    "border-transparent bg-error-light text-error hover:bg-error/20",
                success:
                    "border-transparent bg-success-light text-success hover:bg-success/20",
                warning:
                    "border-transparent bg-warning-light text-warning hover:bg-warning/20",
                info:
                    "border-transparent bg-info-light text-info hover:bg-info/20",
                outline: "border-border text-foreground",
            },
        },
        defaultVariants: {
            variant: "default",
        },
    }
)

export interface BadgeProps
    extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof badgeVariants> { }

function Badge({ className, variant, ...props }: BadgeProps) {
    return (
        <div className={cn(badgeVariants({ variant }), className)} {...props} />
    )
}

export { Badge, badgeVariants }