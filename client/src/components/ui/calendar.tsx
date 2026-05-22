import * as React from "react"
import { ChevronLeft, ChevronRight } from "lucide-react"
import { DayPicker } from "react-day-picker"

import { cn } from "@/lib/utils"
import { buttonVariants } from "@/components/ui/button"

export type CalendarProps = React.ComponentProps<typeof DayPicker>

function Calendar({
    className,
    classNames,
    showOutsideDays = true,
    ...props
}: CalendarProps) {
    return (
        <DayPicker
            showOutsideDays={showOutsideDays}
            className={cn("p-4 bg-white rounded-2xl relative", className)}
            classNames={{
                months: "flex flex-col sm:flex-row space-y-4 sm:space-x-4 sm:space-y-0 justify-center w-full",
                month: "space-y-4",
                month_caption: "flex justify-center h-10 relative items-center",
                caption_label: "text-base font-bold text-slate-900",
                nav: "absolute top-4 left-4 right-4 h-10 flex items-center justify-between z-10",
                button_previous: cn(
                    buttonVariants({ variant: "outline" }),
                    "h-8 w-8 bg-white p-0 opacity-100 shadow-sm border-slate-200 hover:bg-slate-50 hover:text-purple-600 transition"
                ),
                button_next: cn(
                    buttonVariants({ variant: "outline" }),
                    "h-8 w-8 bg-white p-0 opacity-100 shadow-sm border-slate-200 hover:bg-slate-50 hover:text-purple-600 transition"
                ),
                month_grid: "w-full border-collapse",
                weekdays: "flex mb-2 justify-center",
                weekday:
                    "text-slate-900 font-bold w-9 text-[0.85rem] text-center",
                week: "flex w-full mt-2 justify-center",
                day: "group h-9 w-9 text-center text-sm p-0 relative focus-within:relative focus-within:z-20",
                day_button: cn(
                    buttonVariants({ variant: "ghost" }),
                    "h-9 w-9 p-0 font-bold text-slate-900 hover:bg-purple-50 hover:text-purple-700 transition group-aria-selected:!text-white group-[.rdp-selected]:!text-white aria-selected:!text-white opacity-100"
                ),
                selected:
                    "rdp-selected !bg-purple-600 !text-white hover:bg-purple-700 hover:text-white focus:bg-purple-600 focus:text-white rounded-full font-bold shadow-md opacity-100",
                today: "bg-slate-100 text-purple-600 font-bold rounded-full",
                outside:
                    "day-outside text-slate-300 opacity-40 aria-selected:bg-accent/50 aria-selected:text-slate-400 aria-selected:opacity-30",
                disabled: "text-slate-200 opacity-30",
                range_middle:
                    "aria-selected:bg-accent aria-selected:text-accent-foreground",
                hidden: "invisible",
                ...classNames,
            }}
            components={{
                Chevron: ({ ...props }) => {
                    if (props.orientation === 'left') {
                        return <ChevronLeft className="h-4 w-4 stroke-[3px]" />;
                    }
                    return <ChevronRight className="h-4 w-4 stroke-[3px]" />;
                },
            }}
            {...props}
        />
    )
}
Calendar.displayName = "Calendar"

export { Calendar }
