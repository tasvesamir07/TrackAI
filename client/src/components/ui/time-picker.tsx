import * as React from "react"
import { Clock } from "lucide-react"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import {
    Popover,
    PopoverContent,
    PopoverTrigger,
} from "@/components/ui/popover"
import { ScrollArea } from "@/components/ui/scroll-area"

interface TimePickerProps {
    value?: string // "HH:MM" 24h format
    onChange: (value: string) => void
    className?: string
}

interface TimeState {
    hour: number;
    minute: number;
    period: "AM" | "PM";
}

export function TimePicker({ value, onChange, className }: TimePickerProps) {
    const [open, setOpen] = React.useState(false)

    // Parse initial value
    const parseTime = (val?: string): TimeState => {
        if (!val) return { hour: 12, minute: 0, period: "PM" }
        const parts = val.split(":").map(Number);
        let h = parts[0] || 12;
        const m = parts[1] || 0;
        const period = h >= 12 ? ("PM" as const) : ("AM" as const);
        h = h % 12 || 12;
        return { hour: h, minute: m, period };
    }

    const [date, setDate] = React.useState<TimeState>(parseTime(value))

    React.useEffect(() => {
        setDate(parseTime(value))
    }, [value])

    const handleTimeChange = (type: "hour" | "minute" | "period", val: string | number) => {
        const newDate: TimeState = { 
            ...date, 
            [type]: type === "period" ? (val as "AM" | "PM") : Number(val) 
        };
        setDate(newDate);

        // Convert back to 24h string
        let h = Number(newDate.hour)
        const m = Number(newDate.minute)
        const p = newDate.period

        if (p === "PM" && h !== 12) h += 12
        if (p === "AM" && h === 12) h = 0

        const timeString = `${h.toString().padStart(2, "0")}:${m.toString().padStart(2, "0")}`
        onChange(timeString)
    }

    const hours = Array.from({ length: 12 }, (_, i) => i + 1)
    const minutes = Array.from({ length: 60 }, (_, i) => i)

    return (
        <Popover open={open} onOpenChange={setOpen}>
            <PopoverTrigger asChild>
                <Button
                    variant={"outline"}
                    className={cn(
                        "w-full justify-start text-left font-normal h-10 px-3 py-2 rounded-xl border-slate-200",
                        !value && "text-muted-foreground",
                        className
                    )}
                >
                    <Clock className="mr-2 h-4 w-4 opacity-50" />
                    {value ? (
                        <span>
                            {date.hour.toString().padStart(2, "0")}:{date.minute.toString().padStart(2, "0")} {date.period}
                        </span>
                    ) : (
                        <span>Pick a time</span>
                    )}
                </Button>
            </PopoverTrigger>
            <PopoverContent className="w-auto p-0 bg-white" align="start">
                <div className="flex h-[300px] divide-x divide-slate-100">
                    {/* Hours */}
                    <ScrollArea className="h-full w-[70px]">
                        <div className="p-2 space-y-1">
                            <div className="flex flex-col gap-1 items-center">
                                <span className="text-xs font-medium text-slate-400 py-1">Hour</span>
                                {hours.map((hour) => (
                                    <Button
                                        key={hour}
                                        variant={date.hour === hour ? "default" : "ghost"}
                                        size="sm"
                                        className={cn(
                                            "w-full justify-center h-8 font-normal",
                                            date.hour === hour ? "bg-purple-600 hover:bg-purple-700 text-white" : ""
                                        )}
                                        onClick={() => handleTimeChange("hour", hour)}
                                    >
                                        {hour.toString().padStart(2, "0")}
                                    </Button>
                                ))}
                            </div>
                        </div>
                    </ScrollArea>

                    {/* Minutes */}
                    <ScrollArea className="h-full w-[70px]">
                        <div className="p-2 space-y-1">
                            <div className="flex flex-col gap-1 items-center">
                                <span className="text-xs font-medium text-slate-400 py-1">Min</span>
                                {minutes.map((minute) => (
                                    <Button
                                        key={minute}
                                        variant={date.minute === minute ? "default" : "ghost"}
                                        size="sm"
                                        className={cn(
                                            "w-full justify-center h-8 font-normal",
                                            date.minute === minute ? "bg-purple-600 hover:bg-purple-700 text-white" : ""
                                        )}
                                        onClick={() => handleTimeChange("minute", minute)}
                                    >
                                        {minute.toString().padStart(2, "0")}
                                    </Button>
                                ))}
                            </div>
                        </div>
                    </ScrollArea>

                    {/* Period */}
                    <div className="flex flex-col p-2 gap-1 w-[70px] border-l border-slate-100 bg-slate-50/50">
                        <span className="text-xs font-medium text-slate-400 py-1 text-center">AM/PM</span>
                        {["AM", "PM"].map((period) => (
                            <Button
                                key={period}
                                variant={date.period === period ? "default" : "ghost"}
                                size="sm"
                                className={cn(
                                    "w-full justify-center h-8 font-normal",
                                    date.period === period ? "bg-purple-600 hover:bg-purple-700 text-white" : "hover:bg-slate-200"
                                )}
                                onClick={() => handleTimeChange("period", period)}
                            >
                                {period}
                            </Button>
                        ))}
                    </div>
                </div>
            </PopoverContent>
        </Popover>
    )
}
