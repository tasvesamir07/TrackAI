export type AppRole = 'admin' | 'moderator' | 'employee' | 'COMPANY_ADMIN' | 'SUPERADMIN';

export interface User {
    id: number;
    full_name?: string | null;
    username: string;
    role: AppRole;
    status?: "active" | "break" | "inactive";
    department?: string | null;
    hoursWorkedToday?: number;
    currentSessionHours?: number;

    email?: string;
    contact_number?: string;
    bank_details?: string;
    profile_picture?: string;
    hasSignedOutToday?: boolean;
    sessionStartTime?: string | null;
    coveredDate?: string | null;
    telegram_chat_id?: string | null;
    telegramBotUsername?: string;
    timezone?: string;
    paid_leave_balance?: number;
    created_at?: string;
    plan_name?: string | null;
    plan_code?: string | null;
    current_period_ends_at?: string | null;
    trial_ends_at?: string | null;
    subscription_status?: string | null;
    unlimited_access?: boolean;
    max_company_admins?: number | null;
    max_project_managers?: number | null;
    max_employees?: number | null;
    used_company_admins?: number | null;
    used_project_managers?: number | null;
    used_employees?: number | null;
}

