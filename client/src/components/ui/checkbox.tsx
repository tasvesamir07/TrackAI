import * as React from "react"
import { Check } from "lucide-react"

import { cn } from "@/lib/utils"

const Checkbox = React.forwardRef<
    HTMLInputElement,
    React.InputHTMLAttributes<HTMLInputElement>
>(({ className, ...props }, ref) => (
    <div className="relative inline-flex items-center justify-center align-top">
        <input
            type="checkbox"
            className={cn(
                "peer h-4 w-4 shrink-0 appearance-none rounded-sm border border-primary ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 checked:bg-primary checked:text-primary-foreground",
                className
            )}
            ref={ref}
            {...props}
        />
        <Check className="pointer-events-none absolute h-3 w-3 text-primary-foreground opacity-0 peer-checked:opacity-100" />
    </div>
))
Checkbox.displayName = "Checkbox"

export { Checkbox }
