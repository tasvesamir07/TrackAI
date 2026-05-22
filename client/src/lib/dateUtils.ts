import { format } from 'date-fns';
import { toZonedTime } from 'date-fns-tz';

export const formatTime = (totalSeconds: number) => {
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;
    return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
};

export const normalizeDateValue = (value: Date | string | null | undefined, timezone: string) => {
    if (!value) return null;

    if (typeof value === 'string') {
        const trimmed = value.trim();
        if (!trimmed) return null;

        if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
            return trimmed;
        }

        const parsed = new Date(trimmed);
        if (Number.isNaN(parsed.getTime())) return null;
        return format(toZonedTime(parsed, timezone), 'yyyy-MM-dd');
    }

    if (value instanceof Date) {
        if (Number.isNaN(value.getTime())) return null;
        return format(toZonedTime(value, timezone), 'yyyy-MM-dd');
    }

    return null;
};

interface Holiday {
    name?: string;
    date?: string | Date;
    startDate?: string | Date;
    endDate?: string | Date;
    [key: string]: unknown;
}

interface Leave {
    leave_date?: string | Date;
    status?: string;
    [key: string]: unknown;
}

interface WorkHoursSettings {
    weekendDays?: number[];
    [key: string]: unknown;
}

export const getOffDayDetails = (
    targetDate: Date | string, 
    timezone: string, 
    workHoursSettings?: WorkHoursSettings, 
    holidays?: Holiday[], 
    leaves: Leave[] = []
) => {
    const dateStr = normalizeDateValue(targetDate, timezone);
    if (!dateStr) {
        return { isOffDay: false, isWeekend: false, isHoliday: false, isLeave: false, holidayName: null };
    }

    const parsedDate = new Date(`${dateStr}T00:00:00`);
    const zonedDate = toZonedTime(parsedDate, timezone);
    const dayOfWeek = zonedDate.getDay();
    const isWeekend = workHoursSettings?.weekendDays?.includes(dayOfWeek);

    const holiday = holidays?.find((h: Holiday) => {
        if (h.date) {
            return normalizeDateValue(h.date, timezone) === dateStr;
        }
        if (h.startDate && h.endDate) {
            const startStr = normalizeDateValue(h.startDate, timezone);
            const endStr = normalizeDateValue(h.endDate, timezone);
            if (!startStr || !endStr) return false;
            return dateStr >= startStr && dateStr <= endStr;
        }
        return false;
    });

    const leave = leaves?.find((l: Leave) => {
        if (!l.leave_date || l.status !== 'approved') return false;
        const leaveDateStr = normalizeDateValue(l.leave_date, timezone);
        return leaveDateStr === dateStr;
    });

    return {
        isOffDay: !!(isWeekend || holiday || leave),
        isWeekend: !!isWeekend,
        isHoliday: !!holiday,
        isLeave: !!leave,
        holidayName: leave ? 'Leave' : (holiday?.name || (isWeekend ? 'Weekend' : null))
    };
};
