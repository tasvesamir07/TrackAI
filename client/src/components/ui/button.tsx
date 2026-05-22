/* eslint-disable react-refresh/only-export-components */
import * as React from "react"
import { Slot } from "@radix-ui/react-slot"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

const buttonVariants = cva(
    "inline-flex items-center justify-center whitespace-nowrap rounded-md text-sm font-medium ring-offset-background transition-all duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 active:scale-[0.98] touch-manipulation disabled:pointer-events-none disabled:opacity-50 disabled:cursor-not-allowed",
    {
        variants: {
            variant: {
                default: "bg-primary text-primary-foreground shadow-sm hover:bg-primary-hover hover:shadow hover:translate-y-[-1px] focus:shadow-glow",
                destructive:
                    "bg-error text-white shadow-sm hover:bg-error/90 hover:shadow hover:translate-y-[-1px]",
                outline:
                    "border border-border bg-background hover:bg-muted hover:text-foreground",
                secondary:
                    "bg-secondary-light text-secondary hover:bg-secondary/20",
                ghost: "hover:bg-muted hover:text-foreground",
                link: "text-primary underline-offset-4 hover:underline",
            },
            size: {
                default: "h-10 px-4 py-2",
                sm: "h-9 rounded-md px-3 text-xs",
                lg: "h-11 rounded-lg px-8",
                icon: "h-10 w-10",
            },
        },
        defaultVariants: {
            variant: "default",
            size: "default",
        },
    }
)

export interface ButtonProps
    extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
    asChild?: boolean
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
    ({ className, variant, size, asChild = false, ...props }, ref) => {
        const Comp = asChild ? Slot : "button"
        return (
            <Comp
                className={cn(buttonVariants({ variant, size, className }))}
                ref={ref}
                {...props}
            />
        )
    }
)
Button.displayName = "Button"

export { Button, buttonVariants }