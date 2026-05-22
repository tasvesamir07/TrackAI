const {
    startOfMonth,
    endOfMonth,
    startOfWeek,
    endOfWeek,
    eachDayOfInterval,
    format,
    addMonths,
    subMonths,
    isSameMonth,
    isSameDay
} = require('date-fns');

/**
 * Generate an inline calendar keyboard for Telegram
 * 
 * @param {Date} date - The month and year to display
 * @param {string} mode - 'single' | 'multi'
 * @param {Array<Date>} selectedDates - Array of selected dates (for multi-select)
 * @param {string} prefix - The prefix for the callback data (default: 'cal')
 * @returns {Array<Array<Object>>} Inline keyboard markup
 */
const generateCalendar = (date, mode = 'single', selectedDates = [], prefix = 'cal') => {
    const inlineKeyboard = [];
    
    // Header Row: [ < ] [ Month Year ] [ > ]
    inlineKeyboard.push([
        { text: '◀️', callback_data: `${prefix}_nav_prev_${date.getTime()}` },
        { text: format(date, 'MMMM yyyy'), callback_data: `${prefix}_ignore` },
        { text: '▶️', callback_data: `${prefix}_nav_next_${date.getTime()}` }
    ]);

    // Days Row: Su Mo Tu We Th Fr Sa
    const weekDays = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];
    const daysRow = weekDays.map(day => ({ text: day, callback_data: `${prefix}_ignore` }));
    inlineKeyboard.push(daysRow);

    // Days Grid
    const monthStart = startOfMonth(date);
    const monthEnd = endOfMonth(monthStart);
    const startDate = startOfWeek(monthStart);
    const endDate = endOfWeek(monthEnd);

    const days = eachDayOfInterval({ start: startDate, end: endDate });

    let currentWeekRow = [];

    days.forEach(day => {
        if (!isSameMonth(day, monthStart)) {
            // Empty button for days outside the current month
            currentWeekRow.push({ text: ' ', callback_data: `${prefix}_ignore` });
        } else {
            const isSelected = selectedDates.some(selected => isSameDay(selected, day));
            const text = isSelected ? `✅${format(day, 'd')}` : format(day, 'd');
            const dateStr = format(day, 'yyyy-MM-dd');
            currentWeekRow.push({ text, callback_data: `${prefix}_sel_${dateStr}` });
        }

        if (currentWeekRow.length === 7) {
            inlineKeyboard.push(currentWeekRow);
            currentWeekRow = [];
        }
    });

    if (currentWeekRow.length > 0) {
        // Pad the remainder if somehow it doesn't match 7
        while (currentWeekRow.length < 7) {
            currentWeekRow.push({ text: ' ', callback_data: `${prefix}_ignore` });
        }
        inlineKeyboard.push(currentWeekRow);
    }

    // Footer actions
    if (mode === 'multi') {
        inlineKeyboard.push([
            { text: '✅ Done', callback_data: `${prefix}_done` },
            { text: '❌ Cancel', callback_data: `cancel` }
        ]);
    } else {
        inlineKeyboard.push([
            { text: '❌ Cancel', callback_data: `cancel` }
        ]);
    }

    return inlineKeyboard;
};

const generateMonthPicker = (year = new Date().getFullYear(), prefix = 'month_picker') => {
    const inlineKeyboard = [];
    const months = [
        ['Jan', 'Feb', 'Mar'],
        ['Apr', 'May', 'Jun'],
        ['Jul', 'Aug', 'Sep'],
        ['Oct', 'Nov', 'Dec']
    ];

    // Year navigation row
    inlineKeyboard.push([
        { text: '◀️', callback_data: `${prefix}_nav_prev_${year}` },
        { text: `${year}`, callback_data: `${prefix}_ignore` },
        { text: '▶️', callback_data: `${prefix}_nav_next_${year}` }
    ]);

    months.forEach((row, rowIndex) => {
        const keyboardRow = row.map((month, colIndex) => {
            const monthNum = rowIndex * 3 + colIndex + 1;
            const monthStr = monthNum < 10 ? `0${monthNum}` : `${monthNum}`;
            return {
                text: month,
                callback_data: `${prefix}_sel_${year}-${monthStr}-01`
            };
        });
        inlineKeyboard.push(keyboardRow);
    });

    inlineKeyboard.push([{ text: '❌ Cancel', callback_data: 'cancel' }]);
    return inlineKeyboard;
};

const generateYearPicker = (baseYear = new Date().getFullYear(), prefix = 'year_picker') => {
    const inlineKeyboard = [];
    const startYear = baseYear - 4;
    const years = [];
    
    // Generate 9 years in a 3x3 grid
    for (let i = 0; i < 3; i++) {
        const row = [];
        for (let j = 0; j < 3; j++) {
            const y = startYear + (i * 3 + j);
            row.push({
                text: `${y}`,
                callback_data: `${prefix}_sel_${y}-01-01`
            });
        }
        years.push(row);
    }

    // Navigation row
    inlineKeyboard.push([
        { text: '◀️', callback_data: `${prefix}_nav_prev_${baseYear}` },
        { text: 'Years', callback_data: `${prefix}_ignore` },
        { text: '▶️', callback_data: `${prefix}_nav_next_${baseYear}` }
    ]);

    years.forEach(row => inlineKeyboard.push(row));
    inlineKeyboard.push([{ text: '❌ Cancel', callback_data: 'cancel' }]);
    return inlineKeyboard;
};

/**
 * Handle navigation callback queries
 * @param {string} callbackData 
 * @param {string} prefix 
 * @returns {Date|number|null} The new date/year to render, or null
 */
const handleNavigation = (callbackData, prefix = 'cal') => {
    if (callbackData.startsWith(`${prefix}_nav_prev_`)) {
        const val = callbackData.replace(`${prefix}_nav_prev_`, '');
        if (prefix.includes('month') || prefix.includes('year')) {
            return parseInt(val, 10) - (prefix.includes('year') ? 9 : 1);
        }
        const timestamp = parseInt(val, 10);
        return subMonths(new Date(timestamp), 1);
    }
    if (callbackData.startsWith(`${prefix}_nav_next_`)) {
        const val = callbackData.replace(`${prefix}_nav_next_`, '');
        if (prefix.includes('month') || prefix.includes('year')) {
            return parseInt(val, 10) + (prefix.includes('year') ? 9 : 1);
        }
        const timestamp = parseInt(val, 10);
        return addMonths(new Date(timestamp), 1);
    }
    return null;
};

module.exports = {
    generateCalendar,
    generateMonthPicker,
    generateYearPicker,
    handleNavigation
};
