/* eslint-disable @typescript-eslint/no-explicit-any */
import { useState, useEffect, useMemo, useRef, useCallback, lazy, Suspense, type ComponentProps, type ReactNode } from 'react';
import { useAuth } from '@/context/AuthContext';
import { useSocket } from '@/context/SocketContext';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ThemeToggle } from '@/components/ui/ThemeToggle';
import { Label } from '@/components/ui/label';
import { PhoneInput } from '@/components/ui/phone-input';
import { ExpandedRoleSidebar, MobileRoleSidebar, useAdminSidebarItems, useModeratorSidebarItems } from '@/components/RoleSidebar';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Calendar } from '@/components/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '@/lib/api';
import { format } from 'date-fns';
import { toZonedTime } from 'date-fns-tz';
import { useNavigate, useLocation } from 'react-router-dom';
import { cn } from '@/lib/utils';
import { useDebouncedValue } from '@/hooks/useDebouncedValue';
import { 
    Users, 
    Shield, 
    LogOut, 
    FileText, 
    Activity, 
    MessageCircle, 
    Settings, 
    CalendarIcon, 
    Clock, 
    Trash2, 
    Edit3, 
    Check, 
    Copy, 
    Save, 
    Download, 
    UserPlus, 
    Eye,
    X, 
    AlertCircle, 
    Briefcase, 
    Mail, 
    Plus, 
    Sparkles, 
    CreditCard, 
    ArrowLeft, 
    RotateCcw, 
    Send, 
    BellRing, 
    MessageSquare,
    Video,
    CalendarDays,
    UserIcon,
    Plane,
    MoreHorizontal,
    CheckCircle2,
    ChevronDown,
    ChevronUp,
    ClipboardList,
    FileDown,
    Key,
    Search,
    TrendingUp,
    Book
} from 'lucide-react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
    DialogFooter,
    DialogTrigger,
    DialogClose,
} from "@/components/ui/dialog";
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Toast } from "@/components/ui/Toast";
import OptimizedImage from '@/components/OptimizedImage';
import { DashboardOverview } from '@/components/DashboardOverview';
import { AuditLogs } from '@/components/admin/AuditLogs';
import { ApiKeys } from '@/components/admin/ApiKeys';
import { PayrollDashboard } from '@/components/admin/PayrollDashboard';
import { KnowledgeBase } from '@/components/admin/KnowledgeBase';
import { BillingDashboard } from '@/components/admin/BillingDashboard';
import { ApprovalWorkflows } from '@/components/moderator/ApprovalWorkflows';
import { ModeratorKPIs } from '@/components/moderator/ModeratorKPIs';
import { SavedViews } from '@/components/moderator/SavedViews';
import * as z from 'zod';
import { AsYouType } from 'libphonenumber-js';

const VideoAttachment = ({ url }: { url: string }) => {
    return (
        <video 
            src={url} 
            controls 
            className="max-w-full max-h-[80vh] rounded-lg shadow-xl"
            autoPlay
        >
            Your browser does not support the video tag.
        </video>
    );
};

const LazyChatInterface = lazy(() => import('@/components/ChatInterface'));
const createUserSchema = z.object({
    email: z.string().trim().email("Valid email is required"),
    role: z.enum(["admin", "moderator", "employee"], {
        message: "Role is required",
    }),
    department: z.string().trim().optional(),
}).superRefine((data, ctx) => {
    if (data.role === 'employee' && (!data.department || data.department.trim() === '')) {
        ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['department'],
            message: 'Department is required for employees'
        });
    }
});

type CreateUserFormValues = z.infer<typeof createUserSchema>;

interface User {
    id: number;
    username: string;
    role: 'admin' | 'moderator' | 'employee' | 'COMPANY_ADMIN' | 'SUPERADMIN';
    status: 'active' | 'inactive' | 'break' | 'working';
    department?: string | null;
    minutes_balance?: number;
    paid_leave_balance?: number;
    profile_picture?: string | null;
    full_name?: string;
    name?: string;
    email?: string;
    contact_number?: string;
    bank_details?: string | Record<string, unknown>;
    created_at?: string;
    categories?: string[];
    is_on_leave?: boolean;
    leave_start_date?: string | null;
    leave_end_date?: string | null;
}

interface UserManagerDraft {
    role: User['role'];
    department: string;
    paidLeaveBalance: string;
}

interface PaginatedUsersResponse {
    rows: User[];
    limits?: {
        unlimited_access: boolean;
        company_admins: { current: number; limit: number };
        project_managers: { current: number; limit: number };
        employees: { current: number; limit: number };
    } | null;
    pagination: {
        page: number;
        limit: number;
        total: number;
        totalPages: number;
        hasNext: boolean;
        hasPrevious: boolean;
    };
}

interface DepartmentOption {
    id: number;
    name: string;
    created_at?: string;
}

interface Holiday {
    id?: number;
    name?: string;
    date?: string;
    startDate?: string;
    endDate?: string;
}

interface Report {
    id: number;
    user_id: number;
    task_id: number | null;
    username: string;
    full_name?: string;
    department?: string;
    todays_task: string;
    attachments?: Record<string, unknown>[];
    created_at: string;
    updated_at?: string;
    submitted: boolean;
}

const VideoThumbnail = ({ url }: { url: string }) => {
    return (
        <video
            src={`${url}#t=0.1`}
            className="w-full h-full object-cover bg-muted"
            preload="metadata"
            muted
            playsInline
        />
    );
};

function getApiOrigin() {
    const raw = String(import.meta.env.VITE_API_URL || '').trim().replace(/\/+$/, '');
    return raw.replace(/\/api$/i, '');
}

function getAssetUrl(path?: string | null) {
    const raw = String(path || '').trim();
    if (!raw) return '';
    if (/^(https?:)?\/\//i.test(raw) || raw.startsWith('data:') || raw.startsWith('blob:')) {
        return raw;
    }
    const normalizedPath = raw.replace(/\\/g, '/');
    const withLeadingSlash = normalizedPath.startsWith('/') ? normalizedPath : `/${normalizedPath}`;
    const origin = getApiOrigin();
    return origin ? `${origin}${withLeadingSlash}` : withLeadingSlash;
}

const DEFAULT_WEEKEND_DAYS = [5, 6];
const DEFAULT_WEEK_START_DAY = 1;

function normalizeSubmissionCount(value: unknown) {
    const parsed = typeof value === 'number' ? value : Number.parseInt(String(value ?? 0), 10);
    return Number.isFinite(parsed) ? parsed : 0;
}

function hasReportSubmissions(report: Record<string, any>) {
    return normalizeSubmissionCount(report?.total_submissions) > 0;
}

function filterReportsWithSubmissions<T extends Record<string, any>>(reports: T[] | undefined | null) {
    return (reports || []).filter((report) => hasReportSubmissions(report));
}

function getConfiguredWeekStartDay(weekendDays?: number[]) {
    const normalizedWeekendDays = Array.from(new Set((weekendDays || []).filter((day) => Number.isInteger(day) && day >= 0 && day <= 6)));
    if (normalizedWeekendDays.length === 0) {
        return DEFAULT_WEEK_START_DAY;
    }

    const weekendSet = new Set(normalizedWeekendDays);
    for (let day = 0; day < 7; day++) {
        const previousDay = (day + 6) % 7;
        if (!weekendSet.has(day) && weekendSet.has(previousDay)) {
            return day;
        }
    }

    for (let day = 0; day < 7; day++) {
        if (!weekendSet.has(day)) {
            return day;
        }
    }

    return DEFAULT_WEEK_START_DAY;
}

function getDefaultReportWeekStartDate(referenceDate: Date, weekendDays?: number[]) {
    const normalizedDate = new Date(referenceDate);
    normalizedDate.setHours(0, 0, 0, 0);

    const weekStartDay = getConfiguredWeekStartDay(weekendDays);
    const daysSinceWeekStart = (normalizedDate.getDay() - weekStartDay + 7) % 7;
    normalizedDate.setDate(normalizedDate.getDate() - daysSinceWeekStart);

    return normalizedDate;
}

function getConfiguredWorkWeekLength(weekendDays?: number[]) {
    const weekendCount = Array.from(new Set((weekendDays || []).filter((day) => Number.isInteger(day) && day >= 0 && day <= 6))).length;
    return Math.max(1, 7 - weekendCount);
}

function getReportWeekEndDate(startDate: Date, weekendDays?: number[]) {
    const endDate = new Date(startDate);
    endDate.setDate(endDate.getDate() + getConfiguredWorkWeekLength(weekendDays) - 1);
    endDate.setHours(0, 0, 0, 0);
    return endDate;
}

function normalizeCalendarDate(date: Date) {
    const normalizedDate = new Date(date);
    normalizedDate.setHours(0, 0, 0, 0);
    return normalizedDate;
}

function formatWeekRangeLabel(startDate: Date, weekendDays?: number[]) {
    const endDate = getReportWeekEndDate(startDate, weekendDays);
    return `${format(startDate, 'PPP')} - ${format(endDate, 'PPP')}`;
}

type ReportExportButtonProps = ComponentProps<typeof Button> & {
    tooltip?: string;
    children: ReactNode;
};

const ReportExportButton = ({ tooltip, disabled, children, ...props }: ReportExportButtonProps) => {
    const button = (
        <Button {...props} disabled={disabled}>
            {children}
        </Button>
    );

    if (!tooltip) {
        return button;
    }

    return (
        <TooltipProvider delayDuration={150}>
            <Tooltip>
                <TooltipTrigger asChild>
                    <span className="inline-flex" tabIndex={disabled ? 0 : -1}>
                        {button}
                    </span>
                </TooltipTrigger>
                <TooltipContent>
                    <p>{tooltip}</p>
                </TooltipContent>
            </Tooltip>
        </TooltipProvider>
    );
};

export default function AdminDashboard() {
    const { logout, user } = useAuth();
    const { socket } = useSocket();
    const navigate = useNavigate();
    const routerLocation = useLocation();
    const queryClient = useQueryClient();
    const normalizedViewerRole = String(user?.role || '').trim().toLowerCase();
    const isSuperAdminViewer = normalizedViewerRole === 'super_admin' || normalizedViewerRole === 'superadmin';
    const isAdmin = user?.role === 'admin' || user?.role === 'COMPANY_ADMIN';
    const isModerator = user?.role === 'moderator';
    const invalidateUserCaches = useCallback(() => {
        queryClient.invalidateQueries({ queryKey: ['users'] });
        queryClient.invalidateQueries({ queryKey: ['admin-users-paged'] });
    }, [queryClient]);
    const patchUserInCaches = useCallback((userId: number, patch: Partial<User>) => {
        queryClient.setQueryData(['users'], (current: User[] | undefined) => (
            Array.isArray(current)
                ? current.map((userRow) => (userRow.id === userId ? { ...userRow, ...patch } : userRow))
                : current
        ));

        queryClient.setQueriesData({ queryKey: ['admin-users-paged'] }, (current: any) => {
            if (!current || !Array.isArray(current.rows)) return current;
            return {
                ...current,
                rows: current.rows.map((userRow: User) => (userRow.id === userId ? { ...userRow, ...patch } : userRow))
            };
        });
    }, [queryClient]);
    const canManageUsers = isAdmin;
    const canManageLeaves = isAdmin || isModerator;
    const canManageSettings = isAdmin;
    const canViewLiveTracking = isAdmin;
    const getRoleDisplayName = (role?: string) => {
        if (!role) return 'User';
        if (role === 'admin') return 'Admin';
        if (role === 'moderator') return 'Project Manager';
        return role
            .replace(/[_-]+/g, ' ')
            .trim()
            .replace(/\b\w/g, (c) => c.toUpperCase());
    };
    const roleDisplayName = getRoleDisplayName(user?.role);
    const dashboardTitle = isAdmin ? 'Admin Dashboard' : `${roleDisplayName} Dashboard`;

    const normalizePhone = (phone: string) => {
        if (!phone) return '';
        const cleaned = phone.trim().replace(/\D/g, '');
        // If it starts with 0 and is 11 digits, prepend 88
        if (cleaned.startsWith('0') && cleaned.length === 11) {
            return '88' + cleaned;
        }
        return cleaned;
    };

    const normalizeEmail = (value: string) => value.trim().toLowerCase();
    const isValidEmail = (value: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizeEmail(value));

    const normalizeDomainSuffix = (value: string) => {
        let domain = value.trim().toLowerCase();
        if (!domain) return '';
        if (domain.startsWith('@')) domain = domain.slice(1);
        if (domain.startsWith('*.')) domain = domain.slice(2);
        domain = domain.replace(/\.+$/g, '');
        if (!domain.includes('.') || domain.includes('..')) return '';
        if (!/^[a-z0-9.-]+$/.test(domain)) return '';
        const labels = domain.split('.');
        if (labels.some(label => !label || label.startsWith('-') || label.endsWith('-'))) return '';
        return domain;
    };

    const isEmailAllowedByClientPolicy = (email: string) => {
        if (!isValidEmail(email)) return false;
        if (notifEmailDomainMode === 'all') return true;
        if (notifAllowedEmailDomains.length === 0) return false;
        const domain = normalizeEmail(email).split('@')[1] || '';
        return notifAllowedEmailDomains.some((allowed) => (
            domain === allowed || domain.endsWith(`.${allowed}`)
        ));
    };

    const getRoleBadgeClass = (role?: User['role'] | string) => {
        if (role === 'admin') return "bg-purple-500/10 text-purple-650 dark:text-purple-400 border border-purple-500/20 px-2 py-0.5 rounded-full text-xs font-semibold";
        if (role === 'moderator') return "bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20 px-2 py-0.5 rounded-full text-xs font-semibold";
        return "bg-violet-500/10 text-violet-650 dark:text-violet-400 border border-violet-500/20 px-2 py-0.5 rounded-full text-xs font-semibold";
    };


    const [date, setDate] = useState<Date | undefined>(() => {
        const tz = user?.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone;
        const zonedNow = toZonedTime(new Date(), tz);
        zonedNow.setHours(0, 0, 0, 0);
        return zonedNow;
    });
    const [editableReportText, setEditableReportText] = useState('');
    const lastAutoReportTextRef = useRef('');
    const lastReportDateRef = useRef('');

    // Unified Notification & Report Settings State
    const [notifEnabled, setNotifEnabled] = useState<boolean>(false);
    const [notifEmailEnabled, setNotifEmailEnabled] = useState<boolean>(false);
    const [notifRecipientEmails, setNotifRecipientEmails] = useState<string[]>([]);
    const [notifEmailDomainMode, setNotifEmailDomainMode] = useState<'all' | 'allowlist'>('all');
    const [notifAllowedEmailDomains, setNotifAllowedEmailDomains] = useState<string[]>([]);
    const [notifWhatsAppNumbers, setNotifWhatsAppNumbers] = useState<string[]>([]);
    const [notifTelegramChatIds, setNotifTelegramChatIds] = useState<string[]>([]);
    const [notifTelegramChatIdLabels, setNotifTelegramChatIdLabels] = useState<Record<string, string>>({});
    const [notifScheduleTime, setNotifScheduleTime] = useState<string>('18:00');
    
    // SMTP Settings (part of unified config)
    const [smtpConfig, setSmtpConfig] = useState({
        smtpHost: '',
        smtpPort: '587',
        smtpUser: '',
        smtpPass: ''
    });

    const [showManualEmailDialog, setShowManualEmailDialog] = useState(false);
    const [showManualWhatsAppDialog, setShowManualWhatsAppDialog] = useState(false);
    const [showManualTelegramDialog, setShowManualTelegramDialog] = useState(false);
    const [manualEmail, setManualEmail] = useState('');
    const [manualWhatsApp, setManualWhatsApp] = useState('');
    const [manualTelegram, setManualTelegram] = useState('');
    const [selectedManualEmails, setSelectedManualEmails] = useState<string[]>([]);
    const [selectedManualWhatsApp, setSelectedManualWhatsApp] = useState<string[]>([]);
    const [selectedManualTelegram, setSelectedManualTelegram] = useState<string[]>([]);
    // State for temporary inputs
    const [selectedMedia, setSelectedMedia] = useState<{ url: string; type: 'image' | 'video' } | null>(null);
    const [isSendingEmail, setIsSendingEmail] = useState(false);
    const [isSendingWhatsApp, setIsSendingWhatsApp] = useState(false);
    const [isSendingTelegram, setIsSendingTelegram] = useState(false);


    const [copied, setCopied] = useState(false);
    const [activeTab, setActiveTab] = useState('overview');
    const [activeReportsTab, setActiveReportsTab] = useState<'daily' | 'weekly' | 'monthly' | 'yearly' | 'monthly_attendance'>('daily');
    const [chatUnreadTotal, setChatUnreadTotal] = useState(0);
    const [activityDate, setActivityDate] = useState<Date | undefined>(() => {
        const tz = user?.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone;
        const zonedNow = toZonedTime(new Date(), tz);
        zonedNow.setHours(0, 0, 0, 0);
        return zonedNow;
    });
    const [reportDepartment, setReportDepartment] = useState('all');
    const [statusDepartment, setStatusDepartment] = useState('all');
    const [usersPage, setUsersPage] = useState(1);
    const [usersSearchInput, setUsersSearchInput] = useState('');
    const [standardHours, setStandardHours] = useState(4);
    const [overtimeThreshold, setOvertimeThreshold] = useState<number>(0);
    const [, setOvertimeAlertsEnabled] = useState<boolean>(false);
    const [paidLeaveDays, setPaidLeaveDays] = useState<number>(10);
    const [devToolsEnabled, setDevToolsEnabled] = useState<boolean>(true);
    const [syncPaidLeaveBalance, setSyncPaidLeaveBalance] = useState(false);

    const formatPhoneDisplay = (phone: string) => {
        const normalized = normalizePhone(phone);
        if (!normalized) return phone;

        try {
            return new AsYouType().input(`+${normalized}`);
        } catch {
            return `+${normalized}`;
        }
    };

    const getTelegramRecipientDisplay = (telegramId: string) => {
        const label = notifTelegramChatIdLabels[telegramId];
        if (label) {
            return formatPhoneDisplay(label);
        }

        if (/^\d{10,15}$/.test(telegramId)) {
            return formatPhoneDisplay(telegramId);
        }

        return 'Linked Telegram recipient';
    };

    const removeTelegramRecipient = (telegramId: string) => {
        setNotifTelegramChatIds((prev) => prev.filter((id) => id !== telegramId));
        setNotifTelegramChatIdLabels((prev) => {
            const next = { ...prev };
            delete next[telegramId];
            return next;
        });
    };

    const [newRecipientInput, setNewRecipientInput] = useState('');
    const [newAllowedDomainInput, setNewAllowedDomainInput] = useState('');
    const [newWhatsAppRecipientInput, setNewWhatsAppRecipientInput] = useState('');
    const [newNotifTelegram, setNewNotifTelegram] = useState<string>('');
    const [weekendDays, setWeekendDays] = useState<number[]>([5, 6]);
    const [toast, setToast] = useState<{ message: string, type: 'success' | 'alert' | 'error' | 'info' } | null>(null);
    const [userToDelete, setUserToDelete] = useState<User | null>(null);
    const [selectedUserDetails, setSelectedUserDetails] = useState<User | null>(null);
    const [showUserDetails, setShowUserDetails] = useState(false);
    const [managedUser, setManagedUser] = useState<User | null>(null);
    const [showUserManager, setShowUserManager] = useState(false);
    const [userManagerDraft, setUserManagerDraft] = useState<UserManagerDraft>({
        role: 'employee',
        department: '',
        paidLeaveBalance: '0'
    });
    const [showProfileRequests, setShowProfileRequests] = useState(false);
    const [leaveToDelete, setLeaveToDelete] = useState<{ id: number; [key: string]: unknown } | null>(null);
    const [newHolidayName, setNewHolidayName] = useState('');
    const [newHolidayStartDate, setNewHolidayStartDate] = useState('');
    const [newHolidayEndDate, setNewHolidayEndDate] = useState('');
    const [holidayIsRange, setHolidayIsRange] = useState(false);
    const [newDepartmentName, setNewDepartmentName] = useState('');
    const [editingDepartmentId, setEditingDepartmentId] = useState<number | null>(null);
    const [editingDepartmentName, setEditingDepartmentName] = useState('');
    const [selectedLeaveForView, setSelectedLeaveForView] = useState<any | null>(null);
    const [showLeaveDetails, setShowLeaveDetails] = useState(false);

    const isSettingsTabActive = canManageSettings && activeTab === 'settings';
    const isMonthlyReportsTabActive = activeTab === 'reports' && (activeReportsTab === 'monthly' || activeReportsTab === 'monthly_attendance' || activeReportsTab === 'weekly' || activeReportsTab === 'yearly');
    const isLiveTrackingTabActive = canViewLiveTracking && activeTab === 'live_tracking';
    const shouldRefreshDailyReport = activeTab === 'reports' && activeReportsTab === 'daily';
    const debouncedUsersSearch = useDebouncedValue(usersSearchInput, 300);
    const USERS_PAGE_SIZE = 25;

    useEffect(() => {
        setUsersPage(1);
    }, [debouncedUsersSearch, statusDepartment]);

    const addNotificationRecipientEmail = () => {
        const normalized = normalizeEmail(newRecipientInput);
        if (!normalized) return;
        if (!isValidEmail(normalized)) {
            setToast({ message: 'Invalid recipient email format', type: 'error' });
            return;
        }
        if (!isEmailAllowedByClientPolicy(normalized)) {
            const allowedText = notifAllowedEmailDomains.join(', ');
            setToast({
                message: notifEmailDomainMode === 'allowlist'
                    ? (notifAllowedEmailDomains.length > 0
                        ? `Recipient email must end with: ${allowedText}`
                        : 'Add allowed domain endings first or switch to Allow all')
                    : 'Recipient email is not allowed',
                type: 'error'
            });
            return;
        }
        if (!notifRecipientEmails.includes(normalized)) {
            setNotifRecipientEmails([...notifRecipientEmails, normalized]);
        }
        setNewRecipientInput('');
    };

    const addAllowedEmailDomain = () => {
        const normalized = normalizeDomainSuffix(newAllowedDomainInput);
        if (!normalized) {
            setToast({ message: 'Invalid domain ending. Example: royalbengal.ai', type: 'error' });
            return;
        }
        if (!notifAllowedEmailDomains.includes(normalized)) {
            setNotifAllowedEmailDomains([...notifAllowedEmailDomains, normalized]);
        }
        setNewAllowedDomainInput('');
    };

    const handleEmailDomainModeChange = (nextMode: 'all' | 'allowlist') => {
        if (nextMode === notifEmailDomainMode) return;
        if (nextMode === 'all' && notifEmailDomainMode === 'allowlist') {
            const confirmed = window.confirm(
                'Switching to "Allow all domains" will delete all saved allowed email endings. Continue?'
            );
            if (!confirmed) return;
            setNotifAllowedEmailDomains([]);
            setNewAllowedDomainInput('');
        }
        setNotifEmailDomainMode(nextMode);
    };

    useEffect(() => {
        if (!canManageLeaves && activeTab === 'leaves') {
            setActiveTab('reports');
        }
        if (!canManageSettings && activeTab === 'settings') {
            setActiveTab('reports');
        }
        if (!canViewLiveTracking && activeTab === 'live_tracking') {
            setActiveTab('reports');
        }
    }, [activeTab, canManageLeaves, canManageSettings, canViewLiveTracking]);

    useEffect(() => {
        if (!user?.id) {
            setChatUnreadTotal(0);
            return;
        }
        const loadUnreadCount = () => {
            const saved = localStorage.getItem(`chatUnreadCounts:${user.id}`);
            const unreadMap = saved ? JSON.parse(saved) : {};
            const mutedRaw = localStorage.getItem('mutedConversations');
            const muted = new Set((mutedRaw ? JSON.parse(mutedRaw) : []).map((id: string | number) => id.toString()));
            const total = Object.entries(unreadMap).reduce((sum: number, [conversationId, count]) => {
                const numeric = typeof count === 'number' ? count : 0;
                if (numeric <= 0) return sum;
                if (muted.has(String(conversationId))) return sum;
                return sum + 1;
            }, 0);
            setChatUnreadTotal(total);
        };
        loadUnreadCount();
        window.addEventListener('storage', loadUnreadCount);
        return () => window.removeEventListener('storage', loadUnreadCount);
    }, [user?.id]);

    // Monthly Reports State
    const [selectedYear, setSelectedYear] = useState(() => {
        const tz = user?.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone;
        return toZonedTime(new Date(), tz).getFullYear();
    });
    const [selectedMonth, setSelectedMonth] = useState(() => {
        const tz = user?.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone;
        return toZonedTime(new Date(), tz).getMonth() + 1; // 1-12
    });
    const [weeklyStartDate, setWeeklyStartDate] = useState<Date>(() => getDefaultReportWeekStartDate(new Date(), DEFAULT_WEEKEND_DAYS));
    const [weeklyCalendarMonth, setWeeklyCalendarMonth] = useState<Date>(() => getDefaultReportWeekStartDate(new Date(), DEFAULT_WEEKEND_DAYS));
    const [hasCustomWeeklySelection, setHasCustomWeeklySelection] = useState(false);
    const [yearlyYear, setYearlyYear] = useState(new Date().getFullYear());
    const [monthlyReportDepartment, setMonthlyReportDepartment] = useState('all');
    const [expandedUsers, setExpandedUsers] = useState<Record<string, boolean>>({});

    const toggleUserExpansion = (userId: string) => {
        setExpandedUsers(prev => ({ ...prev, [userId]: !prev[userId] }));
    };

    // Query for holidays
    const { data: holidays } = useQuery({
        queryKey: ['holidays'],
        queryFn: async () => {
            const res = await api.get('/auth/holidays');
            return res.data;
        },
        enabled: isSettingsTabActive || isMonthlyReportsTabActive
    });

    const calculateWorkingDaysCount = useMemo(() => {
        const year = selectedYear;
        const month = selectedMonth;
        const daysInMonth = new Date(year, month, 0).getDate();
        let count = 0;

        for (let day = 1; day <= daysInMonth; day++) {
            const date = new Date(year, month - 1, day);
            const dayOfWeek = date.getDay();
            const isWeekend = weekendDays.includes(dayOfWeek);

            const dateStr = format(date, 'yyyy-MM-dd');
            const isSpecialHoliday = (holidays || []).some((h: Holiday) => {
                if (h.date) {
                    const holidayDate = format(new Date(h.date), 'yyyy-MM-dd');
                    return holidayDate === dateStr;
                }
                if (h.startDate && h.endDate) {
                    const startStr = typeof h.startDate === 'string' ? h.startDate : format(new Date(h.startDate), 'yyyy-MM-dd');
                    const endStr = typeof h.endDate === 'string' ? h.endDate : format(new Date(h.endDate), 'yyyy-MM-dd');
                    return dateStr >= startStr && dateStr <= endStr;
                }
                return false;
            });

            if (!isWeekend && !isSpecialHoliday) {
                count++;
            }
        }
        return count;
    }, [selectedYear, selectedMonth, weekendDays, holidays]);

    const toggleWeekendDay = (dayIndex: number) => {
        setWeekendDays(prev => {
            if (prev.includes(dayIndex)) {
                return prev.filter(d => d !== dayIndex);
            } else {
                return [...prev, dayIndex].sort();
            }
        });
    };

    const formattedDate = date ? format(date, 'yyyy-MM-dd') : '';

    const { data: reports, refetch } = useQuery({
        queryKey: ['admin-reports', formattedDate],
        queryFn: async () => {
            if (!formattedDate) return [];
            const res = await api.get(`/admin/daily-reports?date=${formattedDate}`);
            return res.data;
        },
        enabled: !!formattedDate
    });

    const { data: storedSummary, refetch: refetchSummary } = useQuery({
        queryKey: ['report-summary', formattedDate],
        queryFn: async () => {
            if (!formattedDate) return null;
            const res = await api.get(`/admin/report-summary?date=${formattedDate}`);
            return res.data;
        },
        enabled: !!formattedDate
    });

    useEffect(() => {
        if (!socket) return;

        const handleReportUpdate = (data: any) => {
            if (data.date === formattedDate) {
                setEditableReportText(data.content);
                refetchSummary();
            }
        };

        socket.on('report_summary_update', handleReportUpdate);
        return () => {
            socket.off('report_summary_update', handleReportUpdate);
        };
    }, [socket, formattedDate, refetchSummary]);

    const reportsWithTasks = useMemo(() => {
        if (!reports || !Array.isArray(reports)) return [];
        const reportList = reports as Report[];
        
        // Remove the strict task_id check to show all daily reports
        // If a user submitted a report, we should show it.
        return reportList
            .filter(r => r.submitted || (r.todays_task && r.todays_task.trim() !== ''))
            .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
    }, [reports]);

    const summaryForDate = storedSummary?.content || null;

    const originalReportText = useMemo(() => {
        if (!reportsWithTasks.length) return '';
        return reportsWithTasks.map((r: Report) => {
            const name = (r.full_name || r.username || '').trim();
            const displayName = name ? name.charAt(0).toUpperCase() + name.slice(1) : 'Unknown';
            return `${displayName}\n${r.todays_task || ''}`;
        }).join('\n\n');
    }, [reportsWithTasks]);

    // Helper: Smart Merge a task into the report text
    const mergeTaskIntoReport = useCallback((text: string, task: Report) => {
        const name = (task.full_name || task.username || '').trim();
        const displayName = name ? name.charAt(0).toUpperCase() + name.slice(1) : 'Unknown';
        const taskContent = task.todays_task || '';

        const regex = new RegExp(`(${escapeRegExp(displayName)}\\n)([\\s\\S]*?)(?=\\n\\n|$)`, 'i');

        if (regex.test(text)) {
            return text.replace(regex, `$1${taskContent}`);
        } else {
            return text ? `${text}\n\n${displayName}\n${taskContent}` : `${displayName}\n${taskContent}`;
        }
    }, []);

    function escapeRegExp(string: string) {
        return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }

    // Sync editor text with saved summary on load or date change
    useEffect(() => {
        if (summaryForDate) {
            let finalText = summaryForDate;

            if (storedSummary?.updated_at && reportsWithTasks.length > 0) {
                const savedTime = new Date(storedSummary.updated_at).getTime();
                const newTasks = reportsWithTasks.filter(r =>
                    new Date(r.updated_at || r.created_at || 0).getTime() > (savedTime + 2000)
                );

                if (newTasks.length > 0) {
                    newTasks.forEach(task => {
                        finalText = mergeTaskIntoReport(finalText, task);
                    });
                }
            }

            setEditableReportText(finalText);
        } else {
            setEditableReportText(originalReportText);
        }
    }, [summaryForDate, originalReportText, formattedDate, reportsWithTasks, storedSummary, mergeTaskIntoReport]);

    // Profile Requests Query
    const { data: profileRequests } = useQuery({
        queryKey: ['profile-requests'],
        queryFn: async () => {
            const res = await api.get('/admin/profile-requests');
            return res.data;
        },
        enabled: isAdmin
    });

    // Handle Profile Request Mutation
    const handleProfileRequestMutation = useMutation({
        mutationFn: async ({ requestId, status, rejection_reason }: { requestId: number; status: 'approved' | 'rejected'; rejection_reason?: string }) => {
            await api.post(`/admin/profile-requests/${requestId}/handle`, { status, rejection_reason });
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['profile-requests'] });
            invalidateUserCaches();
            setToast({ message: 'Request handled successfully', type: 'success' });
        },
        onError: (error: any) => {
            setToast({ message: error.response?.data?.error || 'Failed to handle request', type: 'error' });
        }
    });

    const requestLocationMutation = useMutation({
        mutationFn: async (userId: number) => {
            const res = await api.post(`/admin/users/${userId}/request-location`);
            return res.data;
        },
        onSuccess: (data) => {
            setToast({ message: data.message || 'Location requested and sent to Telegram', type: 'success' });
            const botUsername = (user as any)?.telegramBotUsername ;
            const telegramUrl = `https://t.me/${botUsername}`;
            const opened = window.open(telegramUrl, '_blank', 'noopener,noreferrer');
            if (!opened) {
                window.location.href = telegramUrl;
            }
        },
        onError: (error: any) => {
            setToast({ message: error.response?.data?.error || 'Failed to request location', type: 'error' });
        }
    });

    // Monthly Reports Query
    const { data: monthlyReports } = useQuery({
        queryKey: ['monthly-reports', selectedYear, selectedMonth],
        queryFn: async () => {
            const res = await api.get(`/admin/monthly-reports?year=${selectedYear}&month=${selectedMonth}`);
            return res.data;
        },
        enabled: activeReportsTab === 'monthly_attendance' || activeReportsTab === 'monthly'
    });

    const weeklyEndDate = useMemo(() => getReportWeekEndDate(weeklyStartDate, weekendDays), [weeklyStartDate, weekendDays]);
    const weeklyRangeLabel = useMemo(() => formatWeekRangeLabel(weeklyStartDate, weekendDays), [weeklyStartDate, weekendDays]);
    const weeklyRangeMiddle = useMemo(() => {
        if (weeklyStartDate >= weeklyEndDate) {
            return undefined;
        }

        const middleStart = new Date(weeklyStartDate);
        middleStart.setDate(middleStart.getDate() + 1);

        const middleEnd = new Date(weeklyEndDate);
        middleEnd.setDate(middleEnd.getDate() - 1);

        if (middleStart > middleEnd) {
            return undefined;
        }

        return { from: middleStart, to: middleEnd };
    }, [weeklyStartDate, weeklyEndDate]);

    const { data: weeklyReports } = useQuery({
        queryKey: [
            'weekly-reports',
            weeklyStartDate ? format(weeklyStartDate, 'yyyy-MM-dd') : '',
            weeklyEndDate ? format(weeklyEndDate, 'yyyy-MM-dd') : ''
        ],
        queryFn: async () => {
            if (!weeklyStartDate) return [];
            const res = await api.get(`/admin/weekly-reports?startDate=${format(weeklyStartDate, 'yyyy-MM-dd')}&endDate=${format(weeklyEndDate, 'yyyy-MM-dd')}`);
            return res.data;
        },
        enabled: activeReportsTab === 'weekly'
    });

    const { data: yearlyReports } = useQuery({
        queryKey: ['yearly-reports', yearlyYear],
        queryFn: async () => {
            const res = await api.get(`/admin/yearly-reports?year=${yearlyYear}`);
            return res.data;
        },
        enabled: activeReportsTab === 'yearly'
    });

    const weeklyReportsWithSubmissions = useMemo(() => filterReportsWithSubmissions(weeklyReports), [weeklyReports]);
    const monthlyReportsWithSubmissions = useMemo(() => filterReportsWithSubmissions(monthlyReports), [monthlyReports]);
    const yearlyReportsWithSubmissions = useMemo(() => filterReportsWithSubmissions(yearlyReports), [yearlyReports]);

    // Fetch user details for modal
    const fetchUserDetails = async (userId: number) => {
        try {
            const res = await api.get(`/admin/users/${userId}`);
            setSelectedUserDetails(res.data);
            setShowUserDetails(true);
        } catch (error: any) {
            const message = error?.response?.data?.error || 'Failed to fetch user details';
            setToast({ message, type: 'error' });
        }
    };

    const refreshOpenUserDetails = async (userId: number) => {
        if (!showUserDetails || selectedUserDetails?.id !== userId) {
            return;
        }

        try {
            const res = await api.get(`/admin/users/${userId}`);
            setSelectedUserDetails(res.data);
        } catch {
            // Keep the existing modal state if the refresh fails.
        }
    };

    const openUserManager = (targetUser: User) => {
        setManagedUser(targetUser);
        setUserManagerDraft({
            role: targetUser.role,
            department: targetUser.department || '',
            paidLeaveBalance: String(targetUser.paid_leave_balance ?? 0)
        });
        setShowUserManager(true);
    };

    const closeUserManager = () => {
        setShowUserManager(false);
        setManagedUser(null);
    };

    const handleResetUserMinutesBalance = (targetUser: User) => {
        if (window.confirm(`Clear the time balance for ${targetUser.username}?`)) {
            resetUserMinutesBalanceMutation.mutate(targetUser.id);
        }
    };

    const handleResetUserPaidLeaveBalance = (targetUser: User) => {
        if (window.confirm(`Clear paid leave days for ${targetUser.username}?`)) {
            resetUserPaidLeaveBalanceMutation.mutate(targetUser.id);
        }
    };

    const handleClearUserLeaveHistory = (targetUser: User) => {
        if (window.confirm(`Delete all leave history for ${targetUser.username}? Approved paid leave days will be refunded first.`)) {
            clearUserLeaveHistoryMutation.mutate(targetUser.id);
        }
    };

    const handleClearUserSkippedDays = (targetUser: User) => {
        if (window.confirm(`Delete all skipped days for ${targetUser.username}? Restored minutes will be added back immediately.`)) {
            clearUserSkippedDaysMutation.mutate(targetUser.id);
        }
    };

    const handleClearUserSubmissions = (targetUser: User) => {
        if (window.confirm(`Delete all task submissions for ${targetUser.username} across all dates, including today and past days? Saved daily summaries for the affected dates will also be cleared.`)) {
            clearUserSubmissionsMutation.mutate(targetUser.id);
        }
    };

    const handleManageUserSave = async () => {
        if (!managedUser) {
            return;
        }

        const nextDepartment = userManagerDraft.department.trim();
        const parsedPaidLeaveBalance = Number.parseInt(userManagerDraft.paidLeaveBalance, 10);

        if (userManagerDraft.role === 'employee' && !nextDepartment) {
            setToast({ message: 'Department is required for employees', type: 'error' });
            return;
        }

        if (Number.isNaN(parsedPaidLeaveBalance) || parsedPaidLeaveBalance < 0) {
            setToast({ message: 'Paid days must be a non-negative whole number', type: 'error' });
            return;
        }

        try {
            if (userManagerDraft.role === 'employee' && nextDepartment !== (managedUser.department || '')) {
                await updateUserDepartmentMutation.mutateAsync({ id: managedUser.id, department: nextDepartment });
            }

            if (userManagerDraft.role !== managedUser.role) {
                await updateUserRoleMutation.mutateAsync({ id: managedUser.id, role: userManagerDraft.role });
            }

            if (
                userManagerDraft.role !== 'employee' &&
                nextDepartment !== (managedUser.department || '')
            ) {
                await updateUserDepartmentMutation.mutateAsync({ id: managedUser.id, department: nextDepartment });
            }

            if (parsedPaidLeaveBalance !== (managedUser.paid_leave_balance ?? 0)) {
                await updateUserPaidLeaveBalanceMutation.mutateAsync({
                    id: managedUser.id,
                    balance: parsedPaidLeaveBalance
                });
            }

            setManagedUser((prev) => prev ? {
                ...prev,
                role: userManagerDraft.role,
                department: userManagerDraft.role === 'employee' ? nextDepartment : nextDepartment || prev.department || null,
                paid_leave_balance: parsedPaidLeaveBalance
            } : prev);
            await refreshOpenUserDetails(managedUser.id);
            setToast({ message: 'User settings updated', type: 'success' });
            closeUserManager();
        } catch (error: any) {
            setToast({ message: error.response?.data?.error || 'Failed to save user settings', type: 'error' });
        }
    };

    const { data: overtimeSettings } = useQuery({
        queryKey: ['overtime-settings'],
        queryFn: async () => {
            try {
                const res = await api.get('/admin/overtime-settings');
                return res.data;
            } catch {
                return null;
            }
        },
        enabled: isAdmin && isSettingsTabActive
    });

    const { data: notificationSettings, refetch: refetchNotificationSettings } = useQuery({
        queryKey: ['notification-settings'],
        queryFn: async () => {
            const res = await api.get('/admin/notification-settings');
            return res.data;
        },
        enabled: isAdmin && isSettingsTabActive
    });

    const saveNotificationSettingsMutation = useMutation({
        mutationFn: async (settings: any) => {
            await api.post('/admin/notification-settings', settings);
        },
        onSuccess: () => {
            setToast({ message: 'Notification settings saved successfully', type: 'success' });
            refetchNotificationSettings();
            queryClient.invalidateQueries({ queryKey: ['notification-settings'] });
        },
        onError: () => {
            setToast({ message: 'Failed to save notification settings', type: 'error' });
        }
    });

    useEffect(() => {
        if (notificationSettings) {
            setNotifEnabled(notificationSettings.enabled || false);
            setNotifEmailEnabled(notificationSettings.emailEnabled || false);
            setNotifRecipientEmails(
                Array.isArray(notificationSettings.recipientEmails)
                    ? notificationSettings.recipientEmails.map((email: string) => normalizeEmail(String(email || ''))).filter(Boolean)
                    : []
            );
            setNotifEmailDomainMode(notificationSettings.emailDomainMode === 'allowlist' ? 'allowlist' : 'all');
            setNotifAllowedEmailDomains(
                Array.isArray(notificationSettings.allowedEmailDomains)
                    ? notificationSettings.allowedEmailDomains
                        .map((domain: string) => normalizeDomainSuffix(String(domain || '')))
                        .filter(Boolean)
                    : []
            );
            setNotifWhatsAppNumbers(notificationSettings.whatsappNumbers || []);
            setNotifTelegramChatIds(notificationSettings.telegramChatIds || []);
            setNotifTelegramChatIdLabels(notificationSettings.telegramChatIdLabels || {});
            setNotifScheduleTime(notificationSettings.scheduleTime || '18:00');
            setSmtpConfig({
                smtpHost: notificationSettings.smtpHost || '',
                smtpPort: notificationSettings.smtpPort || '587',
                smtpUser: notificationSettings.smtpUser || '',
                smtpPass: notificationSettings.smtpPass || ''
            });
        }
    }, [notificationSettings]);

    useEffect(() => {
        if (overtimeSettings) {
            setOvertimeThreshold(overtimeSettings.threshold || 0);
            setOvertimeAlertsEnabled(overtimeSettings.enabled || false);
        }
    }, [overtimeSettings]);

    const { data: devToolsSettings, refetch: refetchDevToolsSettings } = useQuery({
        queryKey: ['dev-tools-settings'],
        queryFn: async () => {
            const res = await api.get('/admin/dev-tools-settings');
            return res.data;
        },
        enabled: isAdmin && isSettingsTabActive
    });

    useEffect(() => {
        if (typeof devToolsSettings?.enabled === 'boolean') {
            setDevToolsEnabled(devToolsSettings.enabled);
        }
    }, [devToolsSettings]);

    const saveDevToolsSettingsMutation = useMutation({
        mutationFn: async (data: { enabled: boolean }) => {
            await api.post('/admin/dev-tools-settings', data);
        },
        onSuccess: (_data, variables) => {
            setToast({
                message: `Developer tools ${variables.enabled ? 'enabled' : 'disabled'} for employees`,
                type: 'success'
            });
            refetchDevToolsSettings();
            queryClient.invalidateQueries({ queryKey: ['dev-tools-settings'] });
            queryClient.invalidateQueries({ queryKey: ['work-hours'] });
        },
        onError: () => {
            setToast({ message: 'Failed to update developer tools setting', type: 'error' });
        }
    });

    const { data: paidLeaveSettings, refetch: refetchPaidLeaveSettings } = useQuery({
        queryKey: ['paid-leave-settings'],
        queryFn: async () => {
            const res = await api.get('/admin/paid-leave-settings');
            return res.data;
        },
        enabled: isAdmin && isSettingsTabActive
    });

    useEffect(() => {
        if (paidLeaveSettings && paidLeaveSettings.days !== undefined) {
            setPaidLeaveDays(paidLeaveSettings.days);
        }
    }, [paidLeaveSettings]);

    const savePaidLeaveSettingsMutation = useMutation({
        mutationFn: async (data: { days: number; syncAll: boolean }) => {
            await api.post('/admin/paid-leave-settings', data);
        },
        onSuccess: (_data: unknown, variables: { days: number; syncAll: boolean }) => {
            setToast({ 
                message: variables.syncAll 
                    ? `Paid leave settings saved and all balances synchronized to ${variables.days} days.` 
                    : 'Paid leave settings saved successfully', 
                type: 'success' 
            });
            setSyncPaidLeaveBalance(false);
            refetchPaidLeaveSettings();
            queryClient.invalidateQueries({ queryKey: ['paid-leave-settings'] });
            if (variables.syncAll) {
                invalidateUserCaches();
            }
        },
        onError: () => {
            setToast({ message: 'Failed to save paid leave settings', type: 'error' });
        }
    });

    const updateHolidaysMutation = useMutation({
        mutationFn: async (updatedHolidays: Holiday[]) => {
            return api.post('/admin/holidays', { holidays: updatedHolidays });
        },
        onSuccess: () => {
            setToast({ message: 'Special holidays updated successfully', type: 'success' });
            queryClient.invalidateQueries({ queryKey: ['holidays'] });
            queryClient.invalidateQueries({ queryKey: ['work-hours'] });
        },
        onError: (err: unknown) => {
            const error = err as { response?: { data?: { error?: string } } };
            setToast({ message: error.response?.data?.error || 'Failed to update holidays', type: 'error' });
        }
    });

    useEffect(() => {
        if (!socket) return;

        const handleLeaveUpdate = (data: any) => {
            if (!canManageLeaves) return;

            queryClient.invalidateQueries({ queryKey: ['admin-leaves'] });
            invalidateUserCaches();

            if (data?.type === 'status_changed') {
                setToast({ message: `Leave request ${data.newStatus || 'updated'}`, type: 'info' });
            } else if (data?.type === 'new_request_batch') {
                setToast({ message: 'New leave request received', type: 'info' });
            } else if (data?.type === 'deleted') {
                setToast({ message: 'Leave request deleted', type: 'info' });
            }
        };

        const handleProfileRequestUpdate = (data: any) => {
            if (data.type === 'new_request') {
                queryClient.invalidateQueries({ queryKey: ['profile-requests'] });
                setToast({ message: 'New profile update request received', type: 'info' });
            }
        };

        const handleActivityLogged = () => {
            queryClient.invalidateQueries({ queryKey: ['activity-log'] });
            invalidateUserCaches();
            queryClient.invalidateQueries({ queryKey: ['monthly-reports'] });
        };

        const handleTaskUpdate = (data: any) => {
            queryClient.invalidateQueries({ queryKey: ['admin-reports'] });
            queryClient.invalidateQueries({ queryKey: ['report-summary'] });
            queryClient.invalidateQueries({ queryKey: ['monthly-reports'] });

            if (data?.task?.date) {
                const taskDate = new Date(data.task.date).toISOString().split('T')[0];
                if (taskDate === formattedDate) {
                    refetch();
                    refetchSummary();
                }
            } else {
                refetch();
                refetchSummary();
            }
        };

        const handleSettingsUpdate = () => {
            queryClient.invalidateQueries({ queryKey: ['work-hours'] });
            queryClient.invalidateQueries({ queryKey: ['notification-settings'] });
            queryClient.invalidateQueries({ queryKey: ['attachmentSettings'] });
            queryClient.invalidateQueries({ queryKey: ['overtime-settings'] });
            queryClient.invalidateQueries({ queryKey: ['dev-tools-settings'] });
            queryClient.invalidateQueries({ queryKey: ['holidays'] });
            queryClient.invalidateQueries({ queryKey: ['paid-leave-settings'] });
            queryClient.invalidateQueries({ queryKey: ['departments'] });
            invalidateUserCaches();
        };

        socket.on('leave_update', handleLeaveUpdate);
        socket.on('profile_request_update', handleProfileRequestUpdate);
        socket.on('activity_logged', handleActivityLogged);
        socket.on('task_update', handleTaskUpdate);
        socket.on('settings_update', handleSettingsUpdate);
        socket.on('overtime_settings_update', () => queryClient.invalidateQueries({ queryKey: ['overtime-settings'] }));
        socket.on('work_hours_update', () => queryClient.invalidateQueries({ queryKey: ['work-hours'] }));

        return () => {
            socket.off('leave_update', handleLeaveUpdate);
            socket.off('profile_request_update', handleProfileRequestUpdate);
            socket.off('activity_logged', handleActivityLogged);
            socket.off('task_update', handleTaskUpdate);
            socket.off('settings_update', handleSettingsUpdate);
            socket.off('overtime_settings_update');
            socket.off('work_hours_update');
        };
    }, [socket, queryClient, formattedDate, refetch, refetchSummary, canManageLeaves, invalidateUserCaches]);

    const deleteMutation = useMutation({
        mutationFn: async (taskId: number) => {
            await api.delete(`/admin/tasks/${taskId}`);
            return taskId;
        },
        onSuccess: (deletedTaskId) => {
            const deletedReport = reports?.find((r: any) => r.task_id === deletedTaskId);
            if (deletedReport && editableReportText) {
                const name = (deletedReport.full_name || deletedReport.username || '').trim();
                const displayName = name ? name.charAt(0).toUpperCase() + name.slice(1) : 'Unknown';
                const regex = new RegExp(`(${escapeRegExp(displayName)}\\n)([\\s\\S]*?)(?=\\n\\n|$)(\\n\\n)?`, 'i');

                if (regex.test(editableReportText)) {
                    const newText = editableReportText.replace(regex, '').trim();
                    setEditableReportText(newText);
                    queryClient.setQueryData(['report-summary', formattedDate], (old: any) => {
                        if (!old) return { content: newText, date: formattedDate, updated_at: new Date().toISOString() };
                        return { ...old, content: newText, updated_at: new Date().toISOString() };
                    });
                    api.post('/admin/report-summary', { date: formattedDate, content: newText }).catch(() => {});
                }
            }
            refetch();
            queryClient.invalidateQueries({ queryKey: ['report-summary'] });
            setToast({ message: 'Report deleted successfully', type: 'success' });
        }
    });

    // Send Email Mutation
    const sendEmailMutation = useMutation({
        mutationFn: (data: { email: string; reportText: string; date: string }) =>
            api.post('/admin/send-report-email', { ...data, date: effectiveDate }),
        onSuccess: () => {
            setToast({ message: 'Report converted to Bangla and sent successfully', type: 'success' });
            setIsSendingEmail(false);
        },
        onError: (error: any) => {
            setToast({ message: error.response?.data?.error || 'Failed to send email', type: 'error' });
            setIsSendingEmail(false);
        }
    });

    // Send WhatsApp Mutation
    const sendWhatsAppMutation = useMutation({
        mutationFn: (data: { phoneNumber: string; reportText: string; date: string }) =>
            api.post('/admin/send-report-whatsapp', { ...data, date: effectiveDate }),
        onSuccess: () => {
            setToast({ message: 'Report sent via WhatsApp successfully', type: 'success' });
            setIsSendingWhatsApp(false);
        },
        onError: (error: any) => {
            setToast({ message: error.response?.data?.error || 'Failed to send WhatsApp', type: 'error' });
            setIsSendingWhatsApp(false);
        }
    });

    // Send Telegram Mutation
    const sendTelegramMutation = useMutation({
        mutationFn: (data: { telegramId: string; reportText: string; date: string }) =>
            api.post('/admin/send-report-telegram', { ...data, date: effectiveDate }),
        onSuccess: () => {
            setToast({ message: 'Report sent via Telegram successfully', type: 'success' });
            setIsSendingTelegram(false);
        },
        onError: (error: any) => {
            setToast({ message: error.response?.data?.error || 'Failed to send Telegram', type: 'error' });
            setIsSendingTelegram(false);
        }
    });

    // Attachment Settings State
    const [attachmentRetentionDays, setAttachmentRetentionDays] = useState(30);
    const [attachmentCleanupTime, setAttachmentCleanupTime] = useState('04:00');

    const { data: attachmentSettings } = useQuery({
        queryKey: ['attachmentSettings'],
        queryFn: async () => {
            const res = await api.get('/admin/attachment-settings');
            return res.data;
        },
        enabled: isAdmin && isSettingsTabActive
    });

    useEffect(() => {
        if (attachmentSettings) {
            setAttachmentRetentionDays(attachmentSettings.retention_days);
            setAttachmentCleanupTime(attachmentSettings.cleanup_time || '04:00');
        }
    }, [attachmentSettings]);

    const saveAttachmentSettingsMutation = useMutation({
        mutationFn: (data: { retention_days: number, cleanup_time: string }) => api.post('/admin/attachment-settings', data),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['attachmentSettings'] });
            setToast({ message: 'Retention settings saved successfully', type: 'success' });
        },
        onError: (error: any) => {
            setToast({ message: error.response?.data?.error || 'Failed to save settings', type: 'error' });
        }
    });



    const { register, handleSubmit, reset, watch, formState: { errors } } = useForm<CreateUserFormValues>({
        resolver: zodResolver(createUserSchema),
        defaultValues: {
            email: "",
            role: "employee",
            department: ""
        }
    });

    const selectedRole = watch('role');

    const createUserMutation = useMutation({
        mutationFn: async (data: CreateUserFormValues) => {
            return api.post('/admin/users', data);
        },
        onSuccess: (res: any) => {
            reset({ email: "", role: "employee", department: "" });
            setToast({ message: res?.data?.message || 'User created successfully', type: 'success' });
            invalidateUserCaches();
        },
        onError: (error: any) => {
            setToast({ message: error.response?.data?.error || 'Failed to create user', type: 'error' });
        }
    });

    const onCreateUser = (data: CreateUserFormValues) => {
        createUserMutation.mutate(data);
    };

    const { data: users } = useQuery<User[]>({
        queryKey: ['users'],
        queryFn: async () => {
            const res = await api.get('/admin/users', {
                params: {
                    activeOnly: true
                }
            });
            return res.data;
        },
        enabled: isLiveTrackingTabActive
    });

    const { data: pagedUsersResponse, isFetching: isPagedUsersFetching, isLoading: isPagedUsersLoading } = useQuery<PaginatedUsersResponse>({
        queryKey: ['admin-users-paged', usersPage, debouncedUsersSearch, statusDepartment],
        queryFn: async () => {
            const res = await api.get('/admin/users', {
                params: {
                    paginate: true,
                    page: usersPage,
                    limit: USERS_PAGE_SIZE,
                    search: debouncedUsersSearch,
                    department: statusDepartment
                }
            });
            return res.data;
        },
        enabled: activeTab === 'users',
        placeholderData: (previousData) => previousData
    });

    const { data: departments = [], refetch: refetchDepartments, error: departmentsQueryError } = useQuery<DepartmentOption[]>({
        queryKey: ['departments'],
        queryFn: async () => {
            const res = await api.get('/admin/departments');
            return res.data;
        }
    });

    const { data: earlyLeaves } = useQuery({
        queryKey: ['early-leaves'],
        queryFn: async () => {
            const res = await api.get('/admin/early-leaves');
            return res.data;
        },
        enabled: canManageLeaves && activeTab === 'leaves'
    });





    const { data: adminLeaves } = useQuery({
        queryKey: ['admin-leaves'],
        queryFn: async () => {
            const res = await api.get('/leaves/admin'); // Changed from admin/leaves
            return res.data;
        },
        enabled: canManageLeaves
    });

    const { data: activityLog } = useQuery({
        queryKey: ['activity-log', activityDate ? format(activityDate, 'yyyy-MM-dd') : ''],
        queryFn: async () => {
            if (!activityDate) return [];
            
            // Calculate UTC boundaries for the local selected day
            const start = new Date(activityDate);
            start.setHours(0, 0, 0, 0);
            const end = new Date(activityDate);
            end.setHours(23, 59, 59, 999);

            const res = await api.get(`/admin/activity-log`, {
                params: {
                    date: format(activityDate, 'yyyy-MM-dd'),
                    startDate: start.toISOString(),
                    endDate: end.toISOString()
                }
            });
            return res.data;
        },
        enabled: activeTab === 'activity' && !!activityDate
    });

    const activityRows = useMemo(() => {
        if (!activityLog || !Array.isArray(activityLog)) return [];

        // Group sessions by user_id
        const grouped = activityLog.reduce((acc: any, curr: any) => {
            const userId = curr.user_id;
            if (!acc[userId]) {
                acc[userId] = {
                    user_id: userId,
                    username: curr.username || 'Unnamed',
                    profile_picture: curr.profile_picture,
                    allSessions: []
                };
            }
            if (curr.sign_in_time || curr.sign_out_time || (curr.breaks && curr.breaks.length > 0)) {
                acc[userId].allSessions.push(curr);
            }
            return acc;
        }, {});

        // Compute total hours and sort
        return Object.values(grouped).map((row: any) => {
            // Sort sessions by sign_in_time
            row.allSessions.sort((a: any, b: any) => {
                const timeA = new Date(a.sign_in_time || a.sign_out_time || 0).getTime();
                const timeB = new Date(b.sign_in_time || b.sign_out_time || 0).getTime();
                return timeA - timeB;
            });

            let totalSec = 0;
            row.allSessions.forEach((s: any) => {
                if (s.sign_in_time && s.sign_out_time) {
                    const diff = (new Date(s.sign_out_time).getTime() - new Date(s.sign_in_time).getTime()) / 1000;
                    let net = diff;
                    if (s.breaks && Array.isArray(s.breaks)) {
                        s.breaks.forEach((b: any) => {
                            if (b.start && b.end) {
                                net -= (new Date(b.end).getTime() - new Date(b.start).getTime()) / 1000;
                            }
                        });
                    }
                    totalSec += Math.max(0, net);
                }
            });

            const h = Math.floor(totalSec / 3600);
            const m = Math.floor((totalSec % 3600) / 60);

            return {
                ...row,
                totalWorkHoursFormatted: totalSec > 0 ? `${h}h ${m}m` : '-'
            };
        }).sort((a: any, b: any) => a.username.localeCompare(b.username));
    }, [activityLog]);

    const formatActivityTime = (val?: string | null) => {
        if (!val) return '-';
        const d = new Date(val);
        return isNaN(d.getTime()) ? '-' : format(d, 'h:mm a');
    };

    const formatOptionalDate = (value: string | null | undefined, pattern: string) => {
        if (!value) return null;
        const parsed = new Date(value);
        if (Number.isNaN(parsed.getTime())) return null;
        return format(parsed, pattern);
    };

    const formatDateRangeLabel = (start: string | null | undefined, end: string | null | undefined) => {
        const formattedStartLong = formatOptionalDate(start, 'MMM dd, yyyy');
        const formattedStartShort = formatOptionalDate(start, 'MMM dd');
        const formattedEndLong = formatOptionalDate(end, 'MMM dd, yyyy');
        const formattedEndShort = formatOptionalDate(end, 'MMM dd');

        if (formattedStartLong && formattedEndLong) {
            return start === end
                ? formattedStartLong
                : `${formattedStartShort || formattedStartLong} - ${formattedEndShort || formattedEndLong}`;
        }

        return formattedStartLong || formattedEndLong || 'Invalid date';
    };

    const sortedAdminLeaves = useMemo(() => {
        if (activeTab !== 'leaves') return [];
        if (!adminLeaves) return [];
        
        const groupsMap = new Map();
        
        [...adminLeaves].forEach((leave: any) => {
            const key = `${leave.user_id}_${leave.reason}_${leave.status}_${leave.type}`;
            if (!groupsMap.has(key)) groupsMap.set(key, []);
            groupsMap.get(key).push({
                ...leave,
                start_date: leave.leave_date,
                end_date: leave.leave_date,
                days_total: leave.days_total || 1,
                ids: [leave.id]
            });
        });

        const finalGroups: any[] = [];

        groupsMap.forEach((userLeaves) => {
            userLeaves.sort((a: any, b: any) => new Date(a.leave_date).getTime() - new Date(b.leave_date).getTime());
            
            userLeaves.reduce((acc: any[], leave: any) => {
                const lastGroup = acc[acc.length - 1];
                if (lastGroup) {
                    const lastDate = new Date(lastGroup.end_date);
                    const currDate = new Date(leave.leave_date);
                    const diffTime = Math.abs(currDate.getTime() - lastDate.getTime());
                    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
                    
                    if (diffDays <= 4) {
                        lastGroup.end_date = leave.leave_date;
                        lastGroup.days_total += leave.days_total;
                        lastGroup.ids.push(...(leave.ids || []));
                        if (!lastGroup.individualLeaves) lastGroup.individualLeaves = [acc[acc.length-1]];
                        lastGroup.individualLeaves.push(leave);
                        return acc;
                    }
                }
                leave.individualLeaves = [leave];
                acc.push(leave);
                finalGroups.push(leave);
                return acc;
            }, []);
        });

        return finalGroups.sort((a: any, b: any) => {
            const aTime = new Date(a.created_at || a.start_date || 0).getTime();
            const bTime = new Date(b.created_at || b.start_date || 0).getTime();
            return bTime - aTime;
        });
    }, [activeTab, adminLeaves]);


    const sortedEarlyLeaves = useMemo(() => {
        if (activeTab !== 'leaves') return [];
        if (!earlyLeaves) return [];
        return [...earlyLeaves].sort((a: any, b: any) => {
            const aTime = new Date(a.created_at || 0).getTime();
            const bTime = new Date(b.created_at || 0).getTime();
            return bTime - aTime;
        });
    }, [activeTab, earlyLeaves]);

    const { data: workHours } = useQuery({
        queryKey: ['work-hours'],
        queryFn: async () => {
            const res = await api.get('/admin/work-hours');
            return res.data;
        },
        enabled: isAdmin && (isSettingsTabActive || isMonthlyReportsTabActive)
    });

    useEffect(() => {
        if (workHours) {
            setStandardHours(workHours.standardHours);
            setOvertimeThreshold(workHours.overtimeThreshold);
            if (workHours.weekendDays) {
                setWeekendDays(workHours.weekendDays);
            }
        }
    }, [workHours]);

    useEffect(() => {
        if (hasCustomWeeklySelection) {
            return;
        }
        const defaultWeekStart = getDefaultReportWeekStartDate(new Date(), weekendDays);
        setWeeklyStartDate(defaultWeekStart);
        setWeeklyCalendarMonth(defaultWeekStart);
    }, [weekendDays, hasCustomWeeklySelection]);

    const applyOptimisticLeaveStatusById = useCallback((leaves: any[] | undefined, leaveId: number, status: string) => {
        if (!Array.isArray(leaves)) return leaves;
        return leaves.map((leave) => {
            if (leave.id === leaveId) {
                return { ...leave, status };
            }
            if (Array.isArray(leave.individualLeaves)) {
                const nextIndividuals = leave.individualLeaves.map((item: any) => (
                    item.id === leaveId ? { ...item, status } : item
                ));
                const nextStatus = nextIndividuals.some((item: any) => item.status !== status) ? leave.status : status;
                return { ...leave, status: nextStatus, individualLeaves: nextIndividuals };
            }
            return leave;
        });
    }, []);

    const applyOptimisticLeaveStatusByRequest = useCallback((leaves: any[] | undefined, requestId: string, status: string) => {
        if (!Array.isArray(leaves)) return leaves;
        return leaves.map((leave) => {
            if (String(leave.request_id || '') === String(requestId)) {
                const nextIndividuals = Array.isArray(leave.individualLeaves)
                    ? leave.individualLeaves.map((item: any) => ({ ...item, status }))
                    : leave.individualLeaves;
                return { ...leave, status, individualLeaves: nextIndividuals };
            }
            return leave;
        });
    }, []);


    const updateLeaveStatusMutation = useMutation({
        mutationFn: async ({ id, status }: { id: number, status: string }) => {
            const res = await api.patch(`/leaves/${id}/status`, { status });
            return res.data;
        },
        onMutate: async ({ id, status }) => {
            await queryClient.cancelQueries({ queryKey: ['admin-leaves'] });
            const previousLeaves = queryClient.getQueryData(['admin-leaves']);
            queryClient.setQueryData(['admin-leaves'], (current: any) => applyOptimisticLeaveStatusById(current, id, status));
            return { previousLeaves };
        },
        onSuccess: () => {
            invalidateUserCaches();
            if (shouldRefreshDailyReport) {
                queryClient.invalidateQueries({ queryKey: ['daily-report'] });
            }
            setToast({ message: 'Leave status updated', type: 'success' });
        },
        onError: (err: any, _vars, context: any) => {
            if (context?.previousLeaves) {
                queryClient.setQueryData(['admin-leaves'], context.previousLeaves);
            }
            setToast({ message: err.response?.data?.error || 'Failed to update leave status', type: 'error' });
        },
        onSettled: () => {
            queryClient.invalidateQueries({ queryKey: ['admin-leaves'] });
        }
    });

    const proceedBatchLeaveMutation = useMutation({
        mutationFn: async (requestId: string) => {
            const res = await api.patch(`/leaves/batch-proceed/${requestId}`);
            return res.data;
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['admin-leaves'] });
            setToast({ message: 'Leave request proceeded to HR', type: 'success' });
        },
        onError: (err: any) => {
            setToast({ message: err.response?.data?.error || 'Failed to proceed leave', type: 'error' });
        }
    });

    const declineBatchLeaveMutation = useMutation({
        mutationFn: async (requestId: string) => {
            const res = await api.patch(`/leaves/batch-decline/${requestId}`);
            return res.data;
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['admin-leaves'] });
            setToast({ message: 'Leave request declined', type: 'success' });
        },
        onError: (err: any) => {
            setToast({ message: err.response?.data?.error || 'Failed to decline leave', type: 'error' });
        }
    });

    const updateBatchLeaveStatusMutation = useMutation({
        mutationFn: async ({ requestId, status }: { requestId: string, status: string }) => {
            const res = await api.patch(`/leaves/batch-status/${requestId}`, { status });
            return res.data;
        },
        onMutate: async ({ requestId, status }) => {
            await queryClient.cancelQueries({ queryKey: ['admin-leaves'] });
            const previousLeaves = queryClient.getQueryData(['admin-leaves']);
            queryClient.setQueryData(['admin-leaves'], (current: any) => applyOptimisticLeaveStatusByRequest(current, requestId, status));
            return { previousLeaves };
        },
        onSuccess: () => {
            invalidateUserCaches();
            if (shouldRefreshDailyReport) {
                queryClient.invalidateQueries({ queryKey: ['daily-report'] });
            }
            setToast({ message: 'Batch leave status updated', type: 'success' });
        },
        onError: (err: any, _vars, context: any) => {
            if (context?.previousLeaves) {
                queryClient.setQueryData(['admin-leaves'], context.previousLeaves);
            }
            setToast({ message: err.response?.data?.error || 'Failed to update batch leave status', type: 'error' });
        },
        onSettled: () => {
            queryClient.invalidateQueries({ queryKey: ['admin-leaves'] });
        }
    });

    const deleteLeaveMutation = useMutation({
        mutationFn: async (leave: any) => {
            if (leave.individualLeaves?.length > 1) {
                const res = await api.delete(`/leaves/batch/${leave.request_id}`);
                return res.data;
            } else {
                const id = typeof leave === 'object' ? leave.id : leave;
                const res = await api.delete(`/leaves/${id}`);
                return res.data;
            }
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['admin-leaves'] });
            invalidateUserCaches();
            setToast({ message: 'Leave request deleted permanently', type: 'success' });
        },
        onError: (err: any) => {
            setToast({ message: err.response?.data?.error || 'Failed to delete leave request', type: 'error' });
        }
    });
    const deleteUserMutation = useMutation({
        mutationFn: async (id: number) => {
            return api.delete(`/admin/users/${id}`);
        },
        onSuccess: (_data: any, deletedUserId: number) => {
            setUserToDelete(null);
            invalidateUserCaches();
            if (managedUser?.id === deletedUserId) {
                closeUserManager();
            }
            if (selectedUserDetails?.id === deletedUserId) {
                setShowUserDetails(false);
                setSelectedUserDetails(null);
            }
            setToast({ message: 'User deleted successfully', type: 'success' });
        },
        onError: (err: any) => {
            setToast({ message: err?.response?.data?.error || 'Failed to delete user', type: 'error' });
        }
    });

    const updateUserRoleMutation = useMutation({
        mutationFn: async ({ id, role }: { id: number; role: string }) => {
            return api.patch(`/admin/users/${id}/role`, { role });
        },
        onMutate: async ({ id, role }) => {
            await queryClient.cancelQueries({ queryKey: ['users'] });
            await queryClient.cancelQueries({ queryKey: ['admin-users-paged'] });
            const previousUsers = queryClient.getQueryData(['users']);
            const previousPaged = queryClient.getQueriesData({ queryKey: ['admin-users-paged'] });
            patchUserInCaches(id, { role: role as User['role'] });
            return { previousUsers, previousPaged };
        },
        onError: (_err: any, _variables, context: any) => {
            if (context?.previousUsers) queryClient.setQueryData(['users'], context.previousUsers);
            if (Array.isArray(context?.previousPaged)) {
                context.previousPaged.forEach(([key, value]: [any, any]) => queryClient.setQueryData(key, value));
            }
            setToast({ message: 'Failed to update role', type: 'error' });
        },
        onSuccess: () => {
            invalidateUserCaches();
        },
        onSettled: () => {
            invalidateUserCaches();
        }
    });

    const updateUserDepartmentMutation = useMutation({
        mutationFn: async ({ id, department }: { id: number; department: string }) => {
            return api.patch(`/admin/users/${id}/department`, { department });
        },
        onMutate: async ({ id, department }) => {
            await queryClient.cancelQueries({ queryKey: ['users'] });
            await queryClient.cancelQueries({ queryKey: ['admin-users-paged'] });
            const previousUsers = queryClient.getQueryData(['users']);
            const previousPaged = queryClient.getQueriesData({ queryKey: ['admin-users-paged'] });
            patchUserInCaches(id, { department });
            return { previousUsers, previousPaged };
        },
        onError: (_err: any, _variables, context: any) => {
            if (context?.previousUsers) queryClient.setQueryData(['users'], context.previousUsers);
            if (Array.isArray(context?.previousPaged)) {
                context.previousPaged.forEach(([key, value]: [any, any]) => queryClient.setQueryData(key, value));
            }
            setToast({ message: 'Failed to update department', type: 'error' });
        },
        onSuccess: () => {
            invalidateUserCaches();
        },
        onSettled: () => {
            invalidateUserCaches();
        }
    });

    const createDepartmentMutation = useMutation({
        mutationFn: async (name: string) => {
            return api.post('/admin/departments', { name });
        },
        onSuccess: () => {
            setNewDepartmentName('');
            refetchDepartments();
            setToast({ message: 'Department added', type: 'success' });
        },
        onError: (error: any) => {
            const status = error?.response?.status;
            const backendError = typeof error?.response?.data?.error === 'string' ? error.response.data.error : '';
            const fallback =
                status === 404
                    ? 'Department API not found. Deploy latest backend.'
                    : !error?.response
                        ? 'Cannot reach API server. Check backend URL and CORS.'
                        : 'Failed to add department';
            setToast({ message: backendError || fallback, type: 'error' });
        }
    });

    const updateDepartmentMutation = useMutation({
        mutationFn: async ({ id, name }: { id: number; name: string }) => {
            return api.patch(`/admin/departments/${id}`, { name });
        },
        onSuccess: () => {
            setEditingDepartmentId(null);
            setEditingDepartmentName('');
            refetchDepartments();
            invalidateUserCaches();
            setToast({ message: 'Department updated', type: 'success' });
        },
        onError: (error: any) => {
            const status = error?.response?.status;
            const backendError = typeof error?.response?.data?.error === 'string' ? error.response.data.error : '';
            const fallback =
                status === 404
                    ? 'Department API not found. Deploy latest backend.'
                    : !error?.response
                        ? 'Cannot reach API server. Check backend URL and CORS.'
                        : 'Failed to update department';
            setToast({ message: backendError || fallback, type: 'error' });
        }
    });

    const deleteDepartmentMutation = useMutation({
        mutationFn: async (id: number) => {
            return api.delete(`/admin/departments/${id}`);
        },
        onSuccess: () => {
            refetchDepartments();
            invalidateUserCaches();
            setToast({ message: 'Department deleted', type: 'success' });
        },
        onError: (error: any) => {
            const status = error?.response?.status;
            const backendError = typeof error?.response?.data?.error === 'string' ? error.response.data.error : '';
            const fallback =
                status === 404
                    ? 'Department API not found. Deploy latest backend.'
                    : !error?.response
                        ? 'Cannot reach API server. Check backend URL and CORS.'
                        : 'Failed to delete department';
            setToast({ message: backendError || fallback, type: 'error' });
        }
    });
    
    const updateUserPaidLeaveBalanceMutation = useMutation({
        mutationFn: async ({ id, balance }: { id: number; balance: number }) => {
            return api.patch(`/admin/users/${id}/paid-leave-balance`, { balance });
        },
        onSuccess: async (_data: any, variables: any) => {
            invalidateUserCaches();
            if (managedUser?.id === variables.id) {
                setManagedUser((prev) => prev ? { ...prev, paid_leave_balance: variables.balance } : prev);
                setUserManagerDraft((prev) => ({ ...prev, paidLeaveBalance: String(variables.balance) }));
            }
            await refreshOpenUserDetails(variables.id);
        },
        onError: (error: any) => {
            setToast({ message: error.response?.data?.error || 'Failed to update balance', type: 'error' });
        }
    });

    const resetUserPaidLeaveBalanceMutation = useMutation({
        mutationFn: async (id: number) => {
            return api.patch(`/admin/users/${id}/paid-leave-balance/reset`);
        },
        onSuccess: async (data: any, userId: number) => {
            setToast({ message: data.data?.message || 'Paid leave cleared', type: 'success' });
            invalidateUserCaches();
            if (managedUser?.id === userId) {
                setManagedUser((prev) => prev ? { ...prev, paid_leave_balance: 0 } : prev);
                setUserManagerDraft((prev) => ({ ...prev, paidLeaveBalance: '0' }));
            }
            await refreshOpenUserDetails(userId);
        },
        onError: (error: any) => {
            setToast({ message: error.response?.data?.error || 'Failed to clear paid leave balance', type: 'error' });
        }
    });


    const resetAllPaidLeaveBalancesMutation = useMutation({
        mutationFn: async () => {
            return api.post('/admin/users/paid-leave-balance/reset-all');
        },
        onSuccess: (data: any) => {
            setToast({ message: data.data?.message || 'All paid leave balances cleared', type: 'success' });
            invalidateUserCaches();
        },
        onError: (error: any) => {
            setToast({ message: error.response?.data?.error || 'Failed to clear all paid leave balances', type: 'error' });
        }
    });

    const resetUserMinutesBalanceMutation = useMutation({
        mutationFn: async (id: number) => {
            return api.patch(`/admin/users/${id}/minutes-balance/reset`);
        },
        onSuccess: async (data: any, userId: number) => {
            setToast({ message: data.data?.message || 'User balance cleared', type: 'success' });
            invalidateUserCaches();
            if (managedUser?.id === userId) {
                setManagedUser((prev) => prev ? { ...prev, minutes_balance: 0 } : prev);
            }
            await refreshOpenUserDetails(userId);
        },
        onError: (error: any) => {
            setToast({ message: error.response?.data?.error || 'Failed to clear user balance', type: 'error' });
        }
    });

    const clearUserLeaveHistoryMutation = useMutation({
        mutationFn: async (id: number) => {
            return api.delete(`/admin/users/${id}/leave-history`);
        },
        onSuccess: async (data: any, userId: number) => {
            setToast({ message: data.data?.message || 'Leave history cleared', type: 'success' });
            invalidateUserCaches();
            queryClient.invalidateQueries({ queryKey: ['admin-leaves'] });
            if (managedUser?.id === userId) {
                const nextPaidBalance = data.data?.paidLeaveBalance ?? managedUser.paid_leave_balance ?? 0;
                const nextMinutesBalance = data.data?.minutesBalance ?? managedUser.minutes_balance ?? 0;
                setManagedUser((prev) => prev ? {
                    ...prev,
                    paid_leave_balance: nextPaidBalance,
                    minutes_balance: nextMinutesBalance
                } : prev);
                setUserManagerDraft((prev) => ({ ...prev, paidLeaveBalance: String(nextPaidBalance) }));
            }
            await refreshOpenUserDetails(userId);
        },
        onError: (error: any) => {
            setToast({ message: error.response?.data?.error || 'Failed to clear leave history', type: 'error' });
        }
    });

    const clearUserSkippedDaysMutation = useMutation({
        mutationFn: async (id: number) => {
            return api.delete(`/admin/users/${id}/skipped-days`);
        },
        onSuccess: async (data: any, userId: number) => {
            setToast({ message: data.data?.message || 'Skipped days cleared', type: 'success' });
            invalidateUserCaches();
            if (managedUser?.id === userId) {
                const nextPaidBalance = data.data?.paidLeaveBalance ?? managedUser.paid_leave_balance ?? 0;
                const nextMinutesBalance = data.data?.minutesBalance ?? managedUser.minutes_balance ?? 0;
                setManagedUser((prev) => prev ? {
                    ...prev,
                    paid_leave_balance: nextPaidBalance,
                    minutes_balance: nextMinutesBalance
                } : prev);
                setUserManagerDraft((prev) => ({ ...prev, paidLeaveBalance: String(nextPaidBalance) }));
            }
            await refreshOpenUserDetails(userId);
        },
        onError: (error: any) => {
            setToast({ message: error.response?.data?.error || 'Failed to clear skipped days', type: 'error' });
        }
    });

    const clearUserSubmissionsMutation = useMutation({
        mutationFn: async (id: number) => {
            return api.delete(`/admin/users/${id}/submissions`);
        },
        onSuccess: async (data: any, userId: number) => {
            queryClient.invalidateQueries({ queryKey: ['admin-reports'] });
            queryClient.invalidateQueries({ queryKey: ['report-summary'] });
            queryClient.invalidateQueries({ queryKey: ['monthly-reports'] });
            refetch();
            refetchSummary();
            await refreshOpenUserDetails(userId);
            setToast({ message: data.data?.message || 'User submissions cleared', type: 'success' });
        },
        onError: (error: any) => {
            setToast({ message: error.response?.data?.error || 'Failed to clear submissions', type: 'error' });
        }
    });

    const resetAllMinutesBalancesMutation = useMutation({
        mutationFn: async () => {
            return api.post('/admin/users/minutes-balance/reset-all');
        },
        onSuccess: (data: any) => {
            setToast({ message: data.data?.message || 'All balances cleared', type: 'success' });
            invalidateUserCaches();
        },
        onError: (error: any) => {
            setToast({ message: error.response?.data?.error || 'Failed to clear all balances', type: 'error' });
        }
    });

    const saveConfigMutation = useMutation({
        mutationFn: async (config: { standardHours: number; overtimeThreshold: number }) => {
            return api.post('/admin/work-hours', config);
        },
        onSuccess: () => {
            setToast({ message: 'Work hours configuration saved successfully', type: 'success' });
            queryClient.invalidateQueries({ queryKey: ['work-hours'] });
        },
        onError: (error: any) => {
            setToast({ message: error.response?.data?.error || 'Failed to save configuration', type: 'error' });
        }
    });

    const saveWeekendDaysMutation = useMutation({
        mutationFn: async (config: { weekendDays: number[] }) => {
            return api.post('/admin/weekend-days', config);
        },
        onSuccess: () => {
            setToast({ message: 'Weekdays off saved successfully', type: 'success' });
            queryClient.invalidateQueries({ queryKey: ['work-hours'] });
        },
        onError: (error: any) => {
            setToast({ message: error.response?.data?.error || 'Failed to save weekdays off', type: 'error' });
        }
    });

    // Determine the effective date of the report (date of the data)
    // If backend returns 'report_date' in rows, use it. Otherwise fallback to selected date.
    const effectiveDate = useMemo(() => {
        if (storedSummary?.date === formattedDate) return storedSummary.date;
        if (reportsWithTasks.length > 0 && (reportsWithTasks[0] as any).report_date) {
            return (reportsWithTasks[0] as any).report_date;
        }
        return formattedDate;
    }, [reportsWithTasks, storedSummary, formattedDate]);




    const resetAllSkippedDaysMutation = useMutation({
        mutationFn: () => api.post('/admin/users/skipped-days/reset-all'),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['admin-users'] });
            setToast({ message: 'Skipped days clearing started in background', type: 'info' });
        },
        onError: () => setToast({ message: 'Failed to clear skipped days', type: 'info' })
    });

    const summarizeMutation = useMutation({
        mutationFn: async (text: string) => {
            // Use formattedDate so we always target the selected day
            return api.post('/admin/summarize-report', { text, date: formattedDate });
        },
        onSuccess: () => {
            setToast({ message: 'Summarization started in background. The text will update automatically in a few seconds.', type: 'info' });
        },
        onError: (error: any) => {
            setToast({ message: error.response?.data?.error || 'Failed to summarize report', type: 'error' });
        }
    });

    const saveReportMutation = useMutation({
        mutationFn: async (content: string) => {
            return api.post('/admin/report-summary', { date: formattedDate, content });
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['report-summary', formattedDate] });
            setToast({ message: 'Report saved successfully', type: 'success' });
        },
        onError: (error: any) => {
            setToast({ message: error.response?.data?.error || 'Failed to save report', type: 'error' });
        }
    });

    const generateOriginalReport = () => originalReportText;



    const downloadReport = async () => {
        try {
            const jspdfModule = await import('jspdf');
            const JsPdfCtor = jspdfModule.jsPDF || jspdfModule.default || jspdfModule;
            await import('jspdf-autotable');

            const doc = new (JsPdfCtor as any)();
            doc.setFontSize(16);
            doc.text('Daily Report', 20, 20);
            doc.setFontSize(12);
            doc.text(`Date: ${formattedDate}`, 20, 30);

            const lines = doc.splitTextToSize(editableReportText, 170);
            let y = 40;

            lines.forEach((line: string | string[]) => {
                if (y > 280) {
                    doc.addPage();
                    y = 20;
                }
                doc.text(line, 20, y);
                y += 7;
            });

            doc.save(`report-${formattedDate}.pdf`);
        } catch (error: any) {
            console.error('PDF Generation Error:', error);
            setToast({ message: `Failed to generate PDF report: ${error.message || 'Unknown error'}`, type: 'error' });
        }
    };

    const generateRangeReportPDF = async (title: string, dateRange: string, data: any[], individualUser?: any) => {
        try {
            const jspdfModule = await import('jspdf');
            const jsPDF = jspdfModule.jsPDF || jspdfModule.default || jspdfModule;
            const autotableModule = await import('jspdf-autotable');
            const autoTable = (autotableModule as any).default || autotableModule;
            const teamReports = filterReportsWithSubmissions(data);

            if (individualUser && !hasReportSubmissions(individualUser)) {
                setToast({ message: 'No submission there', type: 'error' });
                return;
            }

            if (!individualUser && teamReports.length === 0) {
                setToast({ message: 'No submission there', type: 'error' });
                return;
            }

            const doc = new (jsPDF as any)();
            doc.setFontSize(18);
            doc.setTextColor(40, 40, 40);
            doc.text(title, 20, 20);
            
            doc.setFontSize(11);
            doc.setTextColor(100, 100, 100);
            doc.text(`Generated on: ${format(new Date(), 'PPP p')}`, 20, 28);
            doc.text(`Period: ${dateRange}`, 20, 34);

            if (individualUser) {
                doc.setFontSize(14);
                doc.setTextColor(30, 30, 30);
                doc.text(`Employee: ${individualUser.full_name || individualUser.username}`, 20, 45);
                doc.setFontSize(10);
                doc.text(`Department: ${individualUser.department || 'N/A'}`, 20, 51);
                doc.text(`${normalizeSubmissionCount(individualUser.total_submissions)} submissions in this period`, 20, 57);
                
                const tableData = (individualUser.tasks || []).map((task: any) => [
                    format(new Date(task.date), 'MMM dd, yyyy'),
                    task.todays_task,
                    Array.isArray(task.attachments) ? task.attachments.length : 0
                ]);

                autoTable(doc, {
                    startY: 64,
                    head: [['Date', 'Task Description', 'Images/Files']],
                    body: tableData,
                    headStyles: { fillColor: [79, 70, 229] },
                    alternateRowStyles: { fillColor: [249, 250, 251] },
                    margin: { top: 20 },
                    styles: { overflow: 'linebreak', cellPadding: 5 }
                });
            } else {
                // Team Report
                let currentY = 45;
                teamReports.forEach((userReport: any, index: number) => {
                    const finalY = (doc as any).lastAutoTable ? (doc as any).lastAutoTable.finalY : currentY;
                    
                    if (index > 0) {
                        if (finalY > 240) {
                            doc.addPage();
                            currentY = 20;
                        } else {
                            currentY = finalY + 15;
                        }
                    } else {
                        currentY = 45;
                    }

                    doc.setFontSize(13);
                    doc.setTextColor(30, 30, 30);
                    doc.text(`${userReport.full_name || userReport.username} (${userReport.department || 'N/A'})`, 20, currentY);
                    doc.setFontSize(10);
                    doc.setTextColor(100, 100, 100);
                    doc.text(`${normalizeSubmissionCount(userReport.total_submissions)} submissions in this period`, 20, currentY + 6);

                    const tableData = (userReport.tasks || []).map((task: any) => [
                        format(new Date(task.date), 'MMM dd, yyyy'),
                        task.todays_task,
                        Array.isArray(task.attachments) ? task.attachments.length : 0
                    ]);

                    autoTable(doc, {
                        startY: currentY + 10,
                        head: [['Date', 'Task Description', 'Images/Files']],
                        body: tableData,
                        headStyles: { fillColor: [107, 114, 128] },
                        margin: { top: 20 },
                        styles: { overflow: 'linebreak', fontSize: 9 }
                    });
                });
            }

            const fileName = individualUser 
                ? `${individualUser.username}-${title.toLowerCase().replace(/\s+/g, '-')}.pdf`
                : `${title.toLowerCase().replace(/\s+/g, '-')}.pdf`;
            
            doc.save(fileName);
        } catch (error: any) {
            console.error('PDF Generation Error:', error);
            setToast({ message: `Failed to generate PDF report: ${error.message || 'Unknown error'}`, type: 'error' });
        }
    };

    const renderReportTaskAttachments = (attachments: any) => {
        const attachmentList = Array.isArray(attachments) ? attachments : [];
        if (attachmentList.length === 0) {
            return null;
        }

        return (
            <div className="mt-3 flex flex-wrap gap-2">
                {attachmentList.map((att: any, idx: number) => (
                    <div
                        key={`${att?.url || att?.name || 'attachment'}-${idx}`}
                        onClick={() => setSelectedMedia({
                            url: getAssetUrl(att.url),
                            type: att.type?.startsWith('image/') ? 'image' : 'video'
                        })}
                        className="block relative w-16 h-16 rounded-lg overflow-hidden border border-border hover:opacity-80 transition-opacity bg-muted cursor-pointer"
                        title={att?.name || 'Attachment'}
                    >
                        {att?.type?.startsWith('image/') ? (
                            <img
                                src={getAssetUrl(att.url)}
                                alt={att?.name || 'Attachment'}
                                className="w-full h-full object-cover"
                            />
                        ) : (
                            <div className="w-full h-full bg-muted flex items-center justify-center relative">
                                <VideoThumbnail url={getAssetUrl(att.url)} />
                                <div className="absolute inset-0 flex items-center justify-center bg-black/10">
                                    <Video className="w-6 h-6 text-foreground drop-shadow-md" />
                                </div>
                            </div>
                        )}
                    </div>
                ))}
            </div>
        );
    };

    const copyReport = () => {
        navigator.clipboard.writeText(editableReportText);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
    };

    useEffect(() => {
        const nextAutoText = summaryForDate ?? originalReportText;
        setEditableReportText((prev) => {
            if (lastReportDateRef.current !== formattedDate) {
                lastAutoReportTextRef.current = nextAutoText;
                lastReportDateRef.current = formattedDate;
                return nextAutoText;
            }
            if (prev === lastAutoReportTextRef.current) {
                lastAutoReportTextRef.current = nextAutoText;
                return nextAutoText;
            }
            return prev;
        });
    }, [summaryForDate, originalReportText, formattedDate]);


    const filteredReports = reportDepartment === 'all'
        ? reportsWithTasks
        : reportsWithTasks.filter((r: Report) => r.department === reportDepartment);

    const filteredUsers = useMemo(() => pagedUsersResponse?.rows || [], [pagedUsersResponse?.rows]);
    const usersPagination = pagedUsersResponse?.pagination;
    const planLimits = pagedUsersResponse?.limits || null;
    const roleUsageConfig = [
        { key: 'company_admins', label: 'Admins', roleValue: 'admin' },
        { key: 'project_managers', label: 'Moderators', roleValue: 'moderator' },
        { key: 'employees', label: 'Employees', roleValue: 'employee' }
    ] as const;
    const selectedRoleUsageKey =
        selectedRole === 'admin'
            ? 'company_admins'
            : selectedRole === 'moderator'
                ? 'project_managers'
                : 'employees';
    const selectedRoleUsage = planLimits ? planLimits[selectedRoleUsageKey] : null;
    const isSelectedRoleAtLimit = Boolean(
        planLimits &&
        !planLimits.unlimited_access &&
        selectedRoleUsage &&
        selectedRoleUsage.current >= selectedRoleUsage.limit
    );

    const departmentOptions = useMemo(() => {
        const fromSettings = departments.map((d) => d.name).filter(Boolean);
        const fromUsers = filteredUsers
            .map((u: User) => u.department)
            .filter((dept): dept is string => Boolean(dept && dept.trim()));

        return Array.from(new Set([...fromSettings, ...fromUsers])).sort((a, b) => a.localeCompare(b));
    }, [departments, filteredUsers]);

    const uniqueDepartments = departmentOptions;

    // Calculate Pending Leaves Count (Grouped)
    const pendingLeavesCount = useMemo(() => {
        if (!adminLeaves) return 0;
        const pendingLeaves = (adminLeaves || []).filter((l: any) => l.status === 'pending');

        // Use same simple grouping logic as the list
        const grouped = pendingLeaves.sort((a: any, b: any) =>
            new Date(a.leave_date).getTime() - new Date(b.leave_date).getTime()
        ).reduce((acc: any[], leave: any) => {
            const lastGroup = acc[acc.length - 1];
            if (lastGroup &&
                lastGroup.user_id === leave.user_id &&
                lastGroup.reason === leave.reason) {

                const lastDate = new Date(lastGroup.endDate);
                const currentDate = new Date(leave.leave_date);
                const diffTime = Math.abs(currentDate.getTime() - lastDate.getTime());
                const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

                if (diffDays <= 4) {
                    lastGroup.endDate = leave.leave_date;
                    return acc;
                }
            }
            acc.push({
                user_id: leave.user_id,
                reason: leave.reason,
                endDate: leave.leave_date
            });
            return acc;
        }, []);

        return grouped.length;
    }, [adminLeaves]);

    const adminSidebarSections = useAdminSidebarItems({
        pendingLeaves: pendingLeavesCount,
        chatUnreadCount: chatUnreadTotal,
        hasLiveTracking: canViewLiveTracking,
    });

    const moderatorSidebarSections = useModeratorSidebarItems({
        pendingLeaves: pendingLeavesCount,
        chatUnreadCount: chatUnreadTotal,
    });

    const sidebarSections = isModerator ? moderatorSidebarSections : adminSidebarSections;

    // Handle tab changes from sidebar
    const handleSidebarTabChange = (to: string) => {
        const urlParams = new URLSearchParams(to.split('?')[1] || '');
        const tab = urlParams.get('tab') || 'overview';
        const sub = urlParams.get('sub');
        
        setActiveTab(tab);
        if (sub && tab === 'reports') {
            setActiveReportsTab(sub as any);
        }

        const params = new URLSearchParams(routerLocation.search);
        params.set('tab', tab);
        if (sub) {
            params.set('sub', sub);
        } else {
            params.delete('sub');
        }
        navigate({ search: params.toString() }, { replace: true });
    };

    return (
        <div className="min-h-screen overflow-x-hidden bg-background lg:pl-64">
            <ExpandedRoleSidebar
                title="Track AI"
                subtitle={isModerator ? 'Project Manager Workspace' : 'Admin Workspace'}
                sections={sidebarSections}
                userName={(user as any)?.full_name || user?.username}
                roleLabel={isModerator ? 'Project Manager' : 'Admin'}
                onLogout={logout}
                activeTab={activeTab}
                onTabChange={handleSidebarTabChange}
                collapsed={false}
            />
{/* Modern Header */}
            <header className="sticky top-0 z-40 border-b border-border bg-card">
                <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
                    <div className="flex min-h-16 flex-col gap-3 py-3 sm:h-16 sm:flex-row sm:items-center sm:justify-between sm:py-0">
                        {/* Logo & Title */}
                        <div className="flex w-full items-center justify-between sm:w-auto">
                            <div className="flex min-w-0 items-center gap-3">
                                <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-border bg-muted">
                                    <Shield className="w-5 h-5 text-foreground" />
                                </div>
                                <div>
                                    <h1 className="text-lg font-bold text-foreground">{dashboardTitle}</h1>
                                    <p className="text-xs text-muted-foreground">{format(new Date(), 'EEEE, MMMM d')}</p>
                                </div>
                            </div>
                            <div className="flex items-center gap-2 sm:hidden">
                                <Button variant="ghost" size="icon" className="relative">
                                    <BellRing className="h-5 w-5" />
                                </Button>
                                <Button variant="ghost" size="icon" className="relative">
                                    <MessageCircle className="h-5 w-5" />
                                    {chatUnreadTotal > 0 && (
                                        <span className="absolute -top-1 -right-1 h-4 w-4 rounded-full bg-red-500 text-white text-[10px] flex items-center justify-center">
                                            {chatUnreadTotal > 9 ? '9+' : chatUnreadTotal}
                                        </span>
                                    )}
                                </Button>
                            </div>
                            <div className="lg:hidden">
                                <MobileRoleSidebar
                                    title="Track AI"
                                    subtitle={isModerator ? 'Project Manager Workspace' : 'Admin Workspace'}
                                    sections={sidebarSections}
                                    userName={(user as any)?.full_name || user?.username}
                                    roleLabel={isModerator ? 'Project Manager' : 'Admin'}
                                    onLogout={logout}
                                    activeTab={activeTab}
                                />
                            </div>
                        </div>

                        {/* Search Bar */}
                        <div className="hidden sm:flex flex-1 max-w-md mx-4">
                            <div className="relative w-full">
                                <Input
                                    type="search"
                                    placeholder="Search employees, projects, tasks..."
                                    className="w-full pl-10 pr-4 rounded-xl border-border bg-muted focus:bg-card"
                                    value=""
                                    onChange={() => {}}
                                />
                                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                            </div>
                        </div>

                        {/* Quick Actions */}
                        <div className="hidden lg:flex items-center gap-1">
                            <ThemeToggle />
                            <Button variant="ghost" size="icon" className="relative">
                                <BellRing className="h-5 w-5" />
                            </Button>
                            <Button variant="ghost" size="icon" className="relative">
                                <Video className="h-5 w-5" />
                            </Button>
                            <Button variant="ghost" size="icon" className="relative" onClick={() => setActiveTab('chat')}>
                                <MessageCircle className="h-5 w-5" />
                                {chatUnreadTotal > 0 && (
                                    <span className="absolute -top-1 -right-1 h-4 w-4 rounded-full bg-red-500 text-white text-[10px] flex items-center justify-center animate-pulse">
                                        {chatUnreadTotal > 99 ? '99+' : chatUnreadTotal > 9 ? '9+' : chatUnreadTotal}
                                    </span>
                                )}
                            </Button>
                        </div>
                    </div>
                </div>
            </header>

            <main className="max-w-7xl mx-auto overflow-x-hidden px-4 sm:px-6 lg:px-8 py-4 sm:py-8">
                {/* Main Tabs */}
                <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-6">

                    {/* Overview Tab */}
                    <TabsContent value="overview" className="space-y-6">
                        <DashboardOverview
                            user={user}
                            isModerator={isModerator}
                        />
                    </TabsContent>

                    {/* Reports Tab */}
                    <TabsContent value="reports" className="space-y-6">
                        {/* Sub-tabs for Daily and Monthly */}
                        <Tabs
                            value={activeReportsTab}
                            onValueChange={(value) => setActiveReportsTab(value as any)}
                            className="space-y-6"
                        >
                            {/* Weekly Reports Sub-Tab */}
                            <TabsContent value="weekly" className="space-y-6">
                                <Card className="border border-border/40 shadow-xl bg-card/85 dark:bg-card/45 backdrop-blur-md rounded-2xl p-6">
                                    <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-6">
                                        <div className="flex items-center gap-4">
                                            <div className="w-12 h-12 rounded-2xl bg-violet-100/10 dark:bg-violet-950/40 border border-violet-500/20 flex items-center justify-center">
                                                <CalendarDays className="w-6 h-6 text-violet-500 dark:text-violet-450" />
                                            </div>
                                            <div>
                                                <h3 className="text-xl font-bold text-foreground">Weekly Task Summary</h3>
                                                <p className="text-sm text-muted-foreground">Overview of all tasks for the selected week</p>
                                            </div>
                                        </div>
                                        <div className="flex flex-wrap items-center gap-3">
                                            <ReportExportButton
                                                variant="outline" 
                                                className="h-10 rounded-xl border-violet-200 dark:border-violet-850/40 text-violet-700 dark:text-violet-300 hover:bg-violet-50/50 dark:hover:bg-violet-950/20"
                                                onClick={() => generateRangeReportPDF('Weekly Team Report', weeklyRangeLabel, weeklyReports || [])}
                                                disabled={weeklyReportsWithSubmissions.length === 0}
                                                tooltip={weeklyReportsWithSubmissions.length === 0 ? 'No submission there' : undefined}
                                            >
                                                <FileDown className="w-4 h-4 mr-2" />
                                                Generate Full Report
                                            </ReportExportButton>
                                            <div className="space-y-1">
                                                <Popover>
                                                    <PopoverTrigger asChild>
                                                        <Button variant="outline" className="h-auto min-h-10 rounded-xl border-border min-w-[260px] justify-start text-left font-normal py-2">
                                                            <CalendarIcon className="mr-2 h-4 w-4 text-violet-500" />
                                                            <div className="flex flex-col items-start leading-tight">
                                                                <span className="text-sm font-medium text-foreground">{weeklyRangeLabel}</span>
                                                                <span className="text-[11px] text-muted-foreground">Select any day and the admin-defined workweek will be used</span>
                                                            </div>
                                                        </Button>
                                                    </PopoverTrigger>
                                                    <PopoverContent className="w-auto p-0 bg-card" align="end">
                                                        <Calendar
                                                            month={weeklyCalendarMonth}
                                                            onMonthChange={setWeeklyCalendarMonth}
                                                            onDayClick={(day) => {
                                                                const clickedDay = normalizeCalendarDate(day);
                                                                setHasCustomWeeklySelection(true);
                                                                setWeeklyCalendarMonth(clickedDay);
                                                                setWeeklyStartDate(getDefaultReportWeekStartDate(clickedDay, weekendDays));
                                                            }}
                                                            modifiers={{
                                                                weeklyRangeStart: weeklyStartDate,
                                                                weeklyRangeEnd: weeklyEndDate,
                                                                weeklyRangeMiddle: weeklyRangeMiddle,
                                                            }}
                                                            modifiersClassNames={{
                                                                weeklyRangeStart: "bg-gradient-to-r from-violet-600 to-purple-650 text-white rounded-l-full rounded-r-md shadow-md",
                                                                weeklyRangeMiddle: "bg-violet-100/35 dark:bg-violet-950/30 text-violet-950 dark:text-violet-200 rounded-none",
                                                                weeklyRangeEnd: "bg-gradient-to-r from-purple-650 to-indigo-650 text-white rounded-r-full rounded-l-md shadow-md",
                                                            }}
                                                            initialFocus
                                                        />
                                                    </PopoverContent>
                                                </Popover>
                                            </div>
                                        </div>
                                    </div>

                                    {weeklyReports && weeklyReports.length > 0 ? (
                                        <div className="space-y-3">
                                            {weeklyReports.map((userReport: any) => (
                                                <div key={userReport.user_id} className="rounded-2xl border border-border/50 overflow-hidden transition hover:border-violet-550/40 hover:shadow-violet-500/5 shadow-sm">
                                                    <div 
                                                        className="flex items-center gap-3 p-4 bg-card cursor-pointer hover:bg-muted/50"
                                                        onClick={() => toggleUserExpansion(`weekly-${userReport.user_id}`)}
                                                    >
                                                        <div className="w-10 h-10 rounded-full bg-muted flex items-center justify-center font-bold text-muted-foreground">
                                                            {userReport.profile_picture ? (
                                                                 <OptimizedImage src={getAssetUrl(userReport.profile_picture)} alt={userReport.username} className="w-full h-full object-cover rounded-full" />
                                                            ) : (userReport.full_name || userReport.username)[0].toUpperCase()}
                                                        </div>
                                                        <div className="flex-1">
                                                            <h4 className="font-bold text-foreground">{userReport.full_name || userReport.username}</h4>
                                                            <p className="text-[10px] text-muted-foreground/70 uppercase font-bold tracking-wider">{userReport.department || 'No Department'}</p>
                                                        </div>
                                                        <div className="flex items-center gap-4">
                                                            <div className="text-right">
                                                                <div className="text-xs font-bold text-violet-650 dark:text-violet-400 bg-violet-100/10 dark:bg-violet-950/40 border border-violet-500/20 px-2.5 py-1 rounded-full">
                                                                    {normalizeSubmissionCount(userReport.total_submissions)} Submissions
                                                                </div>
                                                            </div>
                                                            <ReportExportButton
                                                                variant="ghost"
                                                                size="icon"
                                                                className={cn(
                                                                    "h-8 w-8 rounded-lg transition-colors",
                                                                    normalizeSubmissionCount(userReport.total_submissions) === 0 
                                                                        ? "text-slate-200 cursor-not-allowed" 
                                                                        : "text-muted-foreground/70 hover:text-violet-650 dark:hover:text-violet-400"
                                                                )}
                                                                disabled={normalizeSubmissionCount(userReport.total_submissions) === 0}
                                                                tooltip={normalizeSubmissionCount(userReport.total_submissions) === 0 ? 'No submission there' : 'Generate Individual Report'}
                                                                onClick={(e) => {
                                                                    e.stopPropagation();
                                                                    generateRangeReportPDF('Weekly Individual Report', weeklyRangeLabel, [], userReport);
                                                                }}
                                                            >
                                                                <FileDown className="w-4 h-4" />
                                                            </ReportExportButton>
                                                            {expandedUsers[`weekly-${userReport.user_id}`] ? <ChevronUp className="w-5 h-5 text-muted-foreground/70" /> : <ChevronDown className="w-5 h-5 text-muted-foreground/70" />}
                                                        </div>
                                                    </div>
                                                    
                                                    {expandedUsers[`weekly-${userReport.user_id}`] && (
                                                        <div className="p-4 bg-muted/50 border-t border-border/50">
                                                            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                                                                {userReport.tasks?.map((task: any, tIdx: number) => (
                                                                    <div key={tIdx} className="p-4 rounded-xl border border-border bg-card shadow-sm">
                                                                        <div className="flex items-center justify-between mb-2">
                                                                            <span className="text-[10px] font-bold text-muted-foreground uppercase">{format(new Date(task.date), 'EEE, MMM dd')}</span>
                                                                            <Clock className="w-3 h-3 text-muted-foreground/50" />
                                                                        </div>
                                                                        <p className="text-xs text-foreground leading-relaxed whitespace-pre-wrap">{task.todays_task}</p>
                                                                        {renderReportTaskAttachments(task.attachments)}
                                                                    </div>
                                                                ))}
                                                            </div>
                                                        </div>
                                                    )}
                                                </div>
                                            ))}
                                        </div>
                                    ) : (
                                        <div className="py-20 text-center text-muted-foreground/70">
                                            <FileText className="w-12 h-12 mx-auto mb-4 opacity-20" />
                                            <p className="font-medium">No tasks found for this week</p>
                                        </div>
                                    )}
                                </Card>
                            </TabsContent>

                            {/* Monthly Reports Sub-Tab */}
                            <TabsContent value="monthly" className="space-y-6">
                                <Card className="border-0 shadow-sm bg-card rounded-2xl p-6">
                                    <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-6">
                                        <div className="flex items-center gap-4">
                                            <div className="w-12 h-12 rounded-2xl bg-purple-100 flex items-center justify-center">
                                                <CalendarDays className="w-6 h-6 text-purple-600" />
                                            </div>
                                            <div>
                                                <h3 className="text-xl font-bold text-foreground">Monthly Task Summary</h3>
                                                <p className="text-sm text-muted-foreground">Overview of all tasks for the selected month</p>
                                            </div>
                                        </div>
                                        <div className="flex flex-wrap items-center gap-3">
                                            <ReportExportButton
                                                variant="outline" 
                                                className="h-10 rounded-xl border-purple-200 text-purple-600 hover:bg-purple-50"
                                                onClick={() => generateRangeReportPDF('Monthly Team Report', `${format(new Date(2000, selectedMonth - 1, 1), 'MMMM')} ${selectedYear}`, monthlyReports || [])}
                                                disabled={monthlyReportsWithSubmissions.length === 0}
                                                tooltip={monthlyReportsWithSubmissions.length === 0 ? 'No submission there' : undefined}
                                            >
                                                <FileDown className="w-4 h-4 mr-2" />
                                                Generate Full Report
                                            </ReportExportButton>
                                            <div className="flex gap-2">
                                                <select
                                                    value={selectedMonth}
                                                    onChange={(e) => setSelectedMonth(parseInt(e.target.value))}
                                                    className="h-10 rounded-xl border border-border px-3 text-sm focus:ring-2 focus:ring-purple-100 outline-none"
                                                >
                                                    {Array.from({ length: 12 }, (_, i) => (
                                                        <option key={i + 1} value={i + 1}>{format(new Date(2000, i, 1), 'MMMM')}</option>
                                                    ))}
                                                </select>
                                                <select
                                                    value={selectedYear}
                                                    onChange={(e) => setSelectedYear(parseInt(e.target.value))}
                                                    className="h-10 rounded-xl border border-border px-3 text-sm focus:ring-2 focus:ring-purple-100 outline-none"
                                                >
                                                    {Array.from({ length: 5 }, (_, i) => (
                                                        <option key={i} value={new Date().getFullYear() - i}>{new Date().getFullYear() - i}</option>
                                                    ))}
                                                </select>
                                            </div>
                                        </div>
                                    </div>

                                    {monthlyReports && monthlyReports.length > 0 ? (
                                        <div className="space-y-3">
                                            {monthlyReports.map((userReport: any) => (
                                                <div key={userReport.user_id} className="rounded-2xl border border-border/50 overflow-hidden transition hover:border-purple-200 shadow-sm">
                                                    <div 
                                                        className="flex items-center gap-3 p-4 bg-card cursor-pointer hover:bg-muted/50"
                                                        onClick={() => toggleUserExpansion(`monthly-${userReport.user_id}`)}
                                                    >
                                                        <div className="w-10 h-10 rounded-full bg-muted flex items-center justify-center font-bold text-muted-foreground">
                                                            {userReport.profile_picture ? (
                                                                <OptimizedImage src={getAssetUrl(userReport.profile_picture)} alt={userReport.username} className="w-full h-full object-cover rounded-full" />
                                                            ) : (userReport.full_name || userReport.username)[0].toUpperCase()}
                                                        </div>
                                                        <div className="flex-1">
                                                            <h4 className="font-bold text-foreground">{userReport.full_name || userReport.username}</h4>
                                                            <p className="text-[10px] text-muted-foreground/70 uppercase font-bold tracking-wider">{userReport.department || 'No Department'}</p>
                                                        </div>
                                                        <div className="flex items-center gap-4">
                                                            <div className="text-right">
                                                                <div className="text-xs font-bold text-purple-600 bg-purple-50 px-2.5 py-1 rounded-full">
                                                                    {normalizeSubmissionCount(userReport.total_submissions)} Submissions
                                                                </div>
                                                            </div>
                                                            <ReportExportButton
                                                                variant="ghost"
                                                                size="icon"
                                                                className={cn(
                                                                    "h-8 w-8 rounded-lg transition-colors",
                                                                    normalizeSubmissionCount(userReport.total_submissions) === 0 
                                                                        ? "text-slate-200 cursor-not-allowed" 
                                                                        : "text-muted-foreground/70 hover:text-purple-600"
                                                                )}
                                                                disabled={normalizeSubmissionCount(userReport.total_submissions) === 0}
                                                                tooltip={normalizeSubmissionCount(userReport.total_submissions) === 0 ? 'No submission there' : 'Generate Individual Report'}
                                                                onClick={(e) => {
                                                                    e.stopPropagation();
                                                                    generateRangeReportPDF('Monthly Individual Report', `${format(new Date(2000, selectedMonth - 1, 1), 'MMMM')} ${selectedYear}`, [], userReport);
                                                                }}
                                                            >
                                                                <FileDown className="w-4 h-4" />
                                                            </ReportExportButton>
                                                            {expandedUsers[`monthly-${userReport.user_id}`] ? <ChevronUp className="w-5 h-5 text-muted-foreground/70" /> : <ChevronDown className="w-5 h-5 text-muted-foreground/70" />}
                                                        </div>
                                                    </div>
                                                    
                                                    {expandedUsers[`monthly-${userReport.user_id}`] && (
                                                        <div className="p-4 bg-muted/50 border-t border-border/50">
                                                            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                                                                {userReport.tasks?.map((task: any, tIdx: number) => (
                                                                    <div key={tIdx} className="p-4 rounded-xl border border-border bg-card shadow-sm">
                                                                        <div className="flex items-center justify-between mb-2">
                                                                            <span className="text-[10px] font-bold text-muted-foreground uppercase">{format(new Date(task.date), 'MMM dd, yyyy')}</span>
                                                                            <Clock className="w-3 h-3 text-muted-foreground/50" />
                                                                        </div>
                                                                        <p className="text-xs text-foreground leading-relaxed whitespace-pre-wrap">{task.todays_task}</p>
                                                                        {renderReportTaskAttachments(task.attachments)}
                                                                    </div>
                                                                ))}
                                                            </div>
                                                        </div>
                                                    )}
                                                </div>
                                            ))}
                                        </div>
                                    ) : (
                                        <div className="py-20 text-center text-muted-foreground/70">
                                            <FileText className="w-12 h-12 mx-auto mb-4 opacity-20" />
                                            <p className="font-medium">No tasks found for this month</p>
                                        </div>
                                    )}
                                </Card>
                            </TabsContent>

                            {/* Yearly Reports Sub-Tab */}
                            <TabsContent value="yearly" className="space-y-6">
                                <Card className="border-0 shadow-sm bg-card rounded-2xl p-6">
                                    <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-6">
                                        <div className="flex items-center gap-4">
                                            <div className="w-12 h-12 rounded-2xl bg-amber-100 flex items-center justify-center">
                                                <CalendarDays className="w-6 h-6 text-amber-600" />
                                            </div>
                                            <div>
                                                <h3 className="text-xl font-bold text-foreground">Yearly Task Summary</h3>
                                                <p className="text-sm text-muted-foreground">Overview of all tasks for the selected year</p>
                                            </div>
                                        </div>
                                        <div className="flex flex-wrap items-center gap-3">
                                            <ReportExportButton
                                                variant="outline" 
                                                className="h-10 rounded-xl border-amber-200 text-amber-600 hover:bg-amber-50"
                                                onClick={() => generateRangeReportPDF('Yearly Team Report', `${yearlyYear}`, yearlyReports || [])}
                                                disabled={yearlyReportsWithSubmissions.length === 0}
                                                tooltip={yearlyReportsWithSubmissions.length === 0 ? 'No submission there' : undefined}
                                            >
                                                <FileDown className="w-4 h-4 mr-2" />
                                                Generate Full Report
                                            </ReportExportButton>
                                            <select
                                                value={yearlyYear}
                                                onChange={(e) => setYearlyYear(parseInt(e.target.value))}
                                                className="h-10 rounded-xl border border-border px-4 text-sm focus:ring-2 focus:ring-amber-100 outline-none font-bold"
                                            >
                                                {Array.from({ length: 5 }, (_, i) => (
                                                    <option key={i} value={new Date().getFullYear() - i}>{new Date().getFullYear() - i}</option>
                                                ))}
                                            </select>
                                        </div>
                                    </div>

                                    {yearlyReports && yearlyReports.length > 0 ? (
                                        <div className="space-y-3">
                                            {yearlyReports.map((userReport: any) => (
                                                <div key={userReport.user_id} className="rounded-2xl border border-border/50 overflow-hidden transition hover:border-amber-200 shadow-sm">
                                                    <div 
                                                        className="flex items-center gap-3 p-4 bg-card cursor-pointer hover:bg-muted/50"
                                                        onClick={() => toggleUserExpansion(`yearly-${userReport.user_id}`)}
                                                    >
                                                        <div className="w-10 h-10 rounded-full bg-muted flex items-center justify-center font-bold text-muted-foreground">
                                                            {userReport.profile_picture ? (
                                                                <OptimizedImage src={getAssetUrl(userReport.profile_picture)} alt={userReport.username} className="w-full h-full object-cover rounded-full" />
                                                            ) : (userReport.full_name || userReport.username)[0].toUpperCase()}
                                                        </div>
                                                        <div className="flex-1">
                                                            <h4 className="font-bold text-foreground">{userReport.full_name || userReport.username}</h4>
                                                            <p className="text-[10px] text-muted-foreground/70 uppercase font-bold tracking-wider">{userReport.department || 'No Department'}</p>
                                                        </div>
                                                        <div className="flex items-center gap-4">
                                                            <div className="text-right">
                                                                <div className="text-xs font-bold text-amber-600 bg-amber-50 px-2.5 py-1 rounded-full">
                                                                    {normalizeSubmissionCount(userReport.total_submissions)} Submissions
                                                                </div>
                                                            </div>
                                                            <ReportExportButton
                                                                variant="ghost"
                                                                size="icon"
                                                                className={cn(
                                                                    "h-8 w-8 rounded-lg transition-colors",
                                                                    normalizeSubmissionCount(userReport.total_submissions) === 0 
                                                                        ? "text-slate-200 cursor-not-allowed" 
                                                                        : "text-muted-foreground/70 hover:text-amber-600"
                                                                )}
                                                                disabled={normalizeSubmissionCount(userReport.total_submissions) === 0}
                                                                tooltip={normalizeSubmissionCount(userReport.total_submissions) === 0 ? 'No submission there' : 'Generate Individual Report'}
                                                                onClick={(e) => {
                                                                    e.stopPropagation();
                                                                    generateRangeReportPDF('Yearly Individual Report', `${yearlyYear}`, [], userReport);
                                                                }}
                                                            >
                                                                <FileDown className="w-4 h-4" />
                                                            </ReportExportButton>
                                                            {expandedUsers[`yearly-${userReport.user_id}`] ? <ChevronUp className="w-5 h-5 text-muted-foreground/70" /> : <ChevronDown className="w-5 h-5 text-muted-foreground/70" />}
                                                        </div>
                                                    </div>
                                                    
                                                    {expandedUsers[`yearly-${userReport.user_id}`] && (
                                                        <div className="p-4 bg-muted/50 border-t border-border/50">
                                                            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                                                                {userReport.tasks?.map((task: any, tIdx: number) => (
                                                                    <div key={tIdx} className="p-4 rounded-xl border border-border bg-card shadow-sm">
                                                                        <div className="flex items-center justify-between mb-2">
                                                                            <span className="text-[10px] font-bold text-muted-foreground uppercase">{format(new Date(task.date), 'MMM dd, yyyy')}</span>
                                                                            <Clock className="w-3 h-3 text-muted-foreground/50" />
                                                                        </div>
                                                                        <p className="text-xs text-foreground leading-relaxed whitespace-pre-wrap">{task.todays_task}</p>
                                                                        {renderReportTaskAttachments(task.attachments)}
                                                                    </div>
                                                                ))}
                                                            </div>
                                                        </div>
                                                    )}
                                                </div>
                                            ))}
                                        </div>
                                    ) : (
                                        <div className="py-20 text-center text-muted-foreground/70">
                                            <FileText className="w-12 h-12 mx-auto mb-4 opacity-20" />
                                            <p className="font-medium">No tasks found for this year</p>
                                        </div>
                                    )}
                                </Card>
                            </TabsContent>

                            {/* Daily Reports Sub-Tab */}
                            <TabsContent value="daily" className="space-y-0">
                                <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
                                    {/* Date Picker Card */}
                                    <Card className="border-0 shadow-sm bg-card rounded-2xl">
                                        <CardHeader className="pb-2">
                                            <CardTitle className="text-lg flex items-center gap-2">
                                                <CalendarIcon className="w-5 h-5 text-purple-500" />
                                                Select Date
                                            </CardTitle>
                                        </CardHeader>
                                        <CardContent className="p-4 pt-0">
                                            <div className="w-full">
                                                <Calendar
                                                    mode="single"
                                                    selected={date}
                                                    onSelect={setDate}
                                                    className="rounded-xl border-0 w-full"
                                                />
                                            </div>
                                            <div className="mt-4 space-y-2">
                                                <Label className="text-sm font-medium text-foreground">Filter by Department</Label>
                                                <select
                                                    value={reportDepartment}
                                                    onChange={(e) => setReportDepartment(e.target.value)}
                                                    className="w-full h-10 px-3 rounded-xl border border-border focus:border-purple-500 focus:ring-2 focus:ring-purple-100 outline-none transition"
                                                >
                                                    <option value="all">All Departments</option>
                                                    {uniqueDepartments.map((dept: any) => (
                                                        <option key={dept} value={dept}>{dept}</option>
                                                    ))}
                                                </select>
                                            </div>
                                        </CardContent>
                                    </Card>

                                    {/* Reports Card */}
                                    <Card className="lg:col-span-3 border-0 shadow-sm bg-card rounded-2xl">
                                        <CardHeader className="border-b border-border/50">

                                            <CardTitle className="text-lg flex items-center gap-2">
                                                <FileText className="w-5 h-5 text-purple-500" />
                                                Daily Reports
                                            </CardTitle>
                                            <div className="mt-4 flex items-center gap-4">
                                                <div className="flex flex-col items-center justify-center min-w-[58px] h-[72px] bg-purple-50 rounded-xl border border-purple-100 shadow-sm transition hover:bg-purple-100/50 overflow-hidden group">
                                                    <div className="w-full bg-purple-100/50 py-0.5 text-center">
                                                        <span className="text-[9px] font-black text-purple-500 uppercase tracking-[0.2em] leading-none">
                                                            {format(date || new Date(), 'MMM')}
                                                        </span>
                                                    </div>
                                                    <div className="flex-1 flex flex-col items-center justify-center leading-none px-2 pb-1">
                                                        <span className="text-xl font-black text-purple-700 group-hover:scale-110 transition-transform">
                                                            {format(date || new Date(), 'd')}
                                                        </span>
                                                        <span className="text-[8px] font-bold text-purple-400 mt-0.5">
                                                            {format(date || new Date(), 'yyyy')}
                                                        </span>
                                                    </div>
                                                </div>
                                                <div className="flex flex-col gap-1">
                                                    <CardTitle className="text-lg flex items-center gap-2 text-foreground">
                                                        <FileText className="w-5 h-5 text-purple-500" />
                                                        Daily Reports
                                                    </CardTitle>
                                                    <div className="px-2.5 py-1 bg-muted rounded-lg border border-border/50 text-[10px] font-bold text-muted-foreground uppercase tracking-widest w-fit">
                                                        {filteredReports?.length || 0} Submissions Today
                                                    </div>
                                                </div>
                                            </div>

                                        </CardHeader>
                                        <CardContent className="p-6">
                                            {filteredReports && filteredReports.length > 0 ? (
                                                <div className="space-y-4">
                                                    {filteredReports.map((report: any, index: number) => (
                                                        <div
                                                            key={report.task_id || `report-${index}`}
                                                            className="p-4 rounded-xl border border-border hover:border-purple-300 hover:bg-purple-50/50 transition group"
                                                        >
                                                            <div className="flex items-start justify-between mb-3">
                                                                <div className="flex items-center gap-3">
                                                                    <div className="w-10 h-10 rounded-full bg-linear-to-br from-purple-500 to-pink-500 flex items-center justify-center overflow-hidden">
                                                                        {report.profile_picture ? (
                                                                            <img
                                                                                src={(import.meta.env.VITE_API_URL || '').replace(/\/$/, '') + '/' + report.profile_picture.replace(/^\//, '')}
                                                                                alt={report.username}
                                                                                className="w-full h-full object-cover"
                                                                                onError={(e) => {
                                                                                    (e.target as HTMLImageElement).src = `https://ui-avatars.com/api/?name=${encodeURIComponent(report.username)}&background=random`;
                                                                                }}
                                                                            />
                                                                        ) : (
                                                                            <span className="text-white text-sm font-semibold">
                                                                                {(report.full_name || report.username)?.charAt(0).toUpperCase()}
                                                                            </span>
                                                                        )}
                                                                    </div>
                                                                    <div>
                                                                        <p className="font-semibold text-foreground">{report.full_name || report.username}</p>
                                                                        <p className="text-[10px] flex items-center gap-1.5 text-muted-foreground mt-0.5">
                                                                            <span className="font-medium bg-muted px-1.5 py-0.5 rounded text-[9px] uppercase tracking-wide">{report.department || 'No Dept'}</span>
                                                                            <span className="w-1 h-1 rounded-full bg-slate-300" />
                                                                            <span className="flex items-center gap-1">
                                                                                <Clock className="w-3 h-3 text-muted-foreground" />
                                                                                {report.created_at && !isNaN(new Date(report.created_at).getTime()) ? format(new Date(report.created_at), 'h:mm a') : 'Invalid Time'}
                                                                            </span>
                                                                        </p>
                                                                    </div>
                                                                </div>
                                                                {report.task_id && (
                                                                    <Button
                                                                        variant="ghost"
                                                                        size="icon"
                                                                        onClick={() => deleteMutation.mutate(report.task_id)}
                                                                        className="opacity-0 group-hover:opacity-100 transition-opacity h-8 w-8 rounded-lg hover:bg-red-100 hover:text-red-600"
                                                                    >
                                                                        <Trash2 className="w-4 h-4" />
                                                                    </Button>
                                                                )}
                                                            </div>
                                                            <p className="text-sm text-foreground leading-relaxed whitespace-pre-wrap">
                                                                {report.todays_task}
                                                            </p>

                                                            {/* Task Attachments */}
                                                            {report.attachments && (Array.isArray(report.attachments) ? report.attachments : []).length > 0 && (
                                                                <div className="mt-3 flex flex-wrap gap-2">
                                                                    {(Array.isArray(report.attachments) ? report.attachments : []).map((att: any, idx: number) => (
                                                                        <div
                                                                            key={idx}
                                                                            onClick={() => setSelectedMedia({
                                                                                url: getAssetUrl(att.url),
                                                                                type: att.type.startsWith('image/') ? 'image' : 'video'
                                                                            })}
                                                                            className="block relative w-16 h-16 rounded-lg overflow-hidden border border-border hover:opacity-80 transition-opacity bg-muted cursor-pointer"
                                                                            title={att.name}
                                                                        >
                                                                            {att.type.startsWith('image/') ? (
                                                                                <img
                                                                                    src={getAssetUrl(att.url)}
                                                                                    alt={att.name}
                                                                                    className="w-full h-full object-cover"
                                                                                />
                                                                            ) : (
                                                                                <div className="w-full h-full bg-muted flex items-center justify-center relative">
                                                                                <VideoThumbnail url={getAssetUrl(att.url)} />
                                                                                <div className="absolute inset-0 flex items-center justify-center bg-black/10">
                                                                                    <Video className="w-6 h-6 text-foreground drop-shadow-md" />
                                                                                </div>
                                                                                </div>
                                                                            )}
                                                                        </div>
                                                                    ))}
                                                                </div>
                                                            )}
                                                        </div>
                                                    ))}
                                                </div>
                                            ) : (
                                                <div className="text-center py-12">
                                                    <FileText className="w-12 h-12 text-foreground mx-auto mb-3" />
                                                    <p className="text-muted-foreground">No reports for this date</p>
                                                </div>
                                            )}
                                        </CardContent>
                                    </Card>

                                    {/* Report Editor Card */}
                                    <div className="lg:col-span-4 mt-6">
                                        <Card className="border-0 shadow-sm bg-card rounded-2xl">
                                            <CardHeader className="border-b border-border/50">
                                                <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                                                    <div>
                                                        <CardTitle className="text-lg flex items-center gap-2">
                                                            <Edit3 className="w-5 h-5 text-purple-500" />
                                                            Report Editor
                                                        </CardTitle>
                                                    </div>
                                                    <div className="flex flex-wrap gap-2">

                                                        <Button
                                                            onClick={copyReport}
                                                            variant="outline"
                                                            className="rounded-full h-9 sm:h-10 px-3 sm:px-4 text-xs sm:text-sm border-input hover:bg-muted"
                                                        >
                                                            {copied ? (
                                                                <>
                                                                    <Check className="w-4 h-4 mr-2 text-green-600" />
                                                                    Copied!
                                                                </>
                                                            ) : (
                                                                <>
                                                                    <Copy className="w-4 h-4 mr-2" />
                                                                    Copy
                                                                </>
                                                            )}
                                                        </Button>

                                                        <Button
                                                            onClick={() => summarizeMutation.mutate(editableReportText)}
                                                            disabled={summarizeMutation.isPending || !editableReportText.trim()}
                                                            variant="outline"
                                                            className="rounded-full h-9 sm:h-10 px-3 sm:px-4 text-xs sm:text-sm border-purple-200 hover:bg-purple-50 text-purple-600 hover:text-purple-700 font-semibold"
                                                        >
                                                            {summarizeMutation.isPending ? (
                                                                <div className="flex items-center gap-2">
                                                                    <div className="w-4 h-4 border-2 border-purple-600 border-t-transparent rounded-full animate-spin" />
                                                                    Summarizing...
                                                                </div>
                                                            ) : (
                                                                <>
                                                                    <Sparkles className="w-4 h-4 mr-2" />
                                                                    AI Summarize (Bangla)
                                                                </>
                                                            )}
                                                        </Button>

                                                        <Button
                                                            onClick={() => saveReportMutation.mutate(editableReportText)}
                                                            disabled={saveReportMutation.isPending || !editableReportText.trim()}
                                                            className="rounded-full h-9 sm:h-10 px-3 sm:px-4 text-xs sm:text-sm bg-green-500 hover:bg-green-600 text-foreground font-semibold shadow-sm transition"
                                                        >
                                                            {saveReportMutation.isPending ? (
                                                                <div className="flex items-center gap-2">
                                                                    <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                                                                    Saving...
                                                                </div>
                                                            ) : (
                                                                <>
                                                                    <Save className="w-4 h-4 mr-2" />
                                                                    Save Report
                                                                </>
                                                            )}
                                                        </Button>

                                                        {editableReportText !== generateOriginalReport() && (
                                                            <Button
                                                                onClick={() => setEditableReportText(generateOriginalReport())}
                                                                variant="outline"
                                                                className="rounded-full h-9 sm:h-10 px-3 sm:px-4 text-xs sm:text-sm border-border hover:bg-muted text-muted-foreground font-medium"
                                                            >
                                                                <RotateCcw className="w-4 h-4 mr-2" />
                                                                Reset
                                                            </Button>
                                                        )}

                                                        <DropdownMenu>
                                                            <DropdownMenuTrigger asChild>
                                                                <Button
                                                                    variant="outline"
                                                                    className="rounded-full h-9 sm:h-10 px-3 sm:px-4 text-xs sm:text-sm border-input hover:bg-muted"
                                                                >
                                                                    <Mail className="w-4 h-4 mr-2" />
                                                                    Send Report
                                                                </Button>
                                                            </DropdownMenuTrigger>
                                                            <DropdownMenuContent align="end" className="w-48 bg-card border-border">
                                                                    <DropdownMenuItem
                                                                        onClick={() => {
                                                                            setSelectedManualEmails(notifRecipientEmails);
                                                                            setManualEmail('');
                                                                            setShowManualEmailDialog(true);
                                                                        }}
                                                                        className="flex items-center gap-2 cursor-pointer hover:bg-purple-50"
                                                                    >
                                                                        <Mail className="w-4 h-4" />
                                                                        Send via Email
                                                                    </DropdownMenuItem>
                                                                    <DropdownMenuItem
                                                                        onClick={() => {
                                                                            setSelectedManualWhatsApp(notifWhatsAppNumbers);
                                                                            setManualWhatsApp('');
                                                                            setShowManualWhatsAppDialog(true);
                                                                        }}
                                                                        className="flex items-center gap-2 cursor-pointer hover:bg-purple-50"
                                                                    >
                                                                        <MessageCircle className="w-4 h-4" />
                                                                        Send via WhatsApp
                                                                    </DropdownMenuItem>
                                                                    <DropdownMenuItem
                                                                        onClick={() => {
                                                                            setSelectedManualTelegram(notifTelegramChatIds);
                                                                            setManualTelegram('');
                                                                            setShowManualTelegramDialog(true);
                                                                        }}
                                                                        className="flex items-center gap-2 cursor-pointer hover:bg-purple-50"
                                                                    >
                                                                        <Send className="w-4 h-4" />
                                                                        Send via Telegram
                                                                    </DropdownMenuItem>
                                                            </DropdownMenuContent>
                                                        </DropdownMenu>
                                                        <Button
                                                            onClick={downloadReport}
                                                            variant="outline"
                                                            className="rounded-full h-9 sm:h-10 px-3 sm:px-4 text-xs sm:text-sm border-input hover:bg-muted"
                                                        >
                                                            <Download className="w-4 h-4 mr-2" />
                                                            Export PDF
                                                        </Button>


                                                    </div>
                                                </div>
                                            </CardHeader>
                                            <CardContent className="p-4 sm:p-6">
                                                <textarea
                                                    value={editableReportText}
                                                    onChange={(e) => setEditableReportText(e.target.value)}
                                                    className="w-full min-h-[280px] sm:min-h-[400px] p-4 rounded-xl border border-border focus:border-purple-500 focus:ring-2 focus:ring-purple-100 outline-none resize-none font-mono text-sm leading-relaxed"
                                                    placeholder="Report content will appear here..."
                                                />
                                            </CardContent>
                                        </Card>

                                        {/* Unified Communication Settings consolidated into the main Card below */}
                                    </div>
                                </div>
                            </TabsContent>

                            {/* Monthly Attendance Sub-Tab */}
                            <TabsContent value="monthly_attendance" className="space-y-0">
                                <div className="grid grid-cols-1 gap-6">
                                    {/* Month/Year Selector */}
                                    <Card className="border-0 shadow-sm bg-card rounded-2xl">
                                        <CardHeader>
                                            <CardTitle className="text-lg flex items-center gap-2">
                                                <CalendarIcon className="w-5 h-5 text-purple-500" />
                                                Monthly Attendance Report
                                            </CardTitle>
                                            <CardDescription>
                                                {['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'][selectedMonth - 1]} {selectedYear}
                                            </CardDescription>
                                        </CardHeader>
                                        <CardContent className="space-y-4">
                                            <div className="flex flex-col sm:flex-row gap-4">
                                                <div className="flex-1 space-y-2">
                                                    <Label className="text-sm font-medium text-foreground">Month</Label>
                                                    <select
                                                        value={selectedMonth}
                                                        onChange={(e) => setSelectedMonth(parseInt(e.target.value))}
                                                        className="w-full h-10 px-3 rounded-xl border border-border focus:border-purple-500 focus:ring-2 focus:ring-purple-100 outline-none transition"
                                                    >
                                                        {['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'].map((month, idx) => (
                                                            <option key={idx} value={idx + 1}>{month}</option>
                                                        ))}
                                                    </select>
                                                </div>
                                                <div className="flex-1 space-y-2">
                                                    <Label className="text-sm font-medium text-foreground">Year</Label>
                                                    <select
                                                        value={selectedYear}
                                                        onChange={(e) => setSelectedYear(parseInt(e.target.value))}
                                                        className="w-full h-10 px-3 rounded-xl border border-border focus:border-purple-500 focus:ring-2 focus:ring-purple-100 outline-none transition"
                                                    >
                                                        {Array.from({ length: new Date().getFullYear() - 2020 + 3 }, (_, i) => 2020 + i).reverse().map(year => (
                                                            <option key={year} value={year}>{year}</option>
                                                        ))}
                                                    </select>
                                                </div>
                                                <div className="flex-1 space-y-2">
                                                    <Label className="text-sm font-medium text-foreground">Department</Label>
                                                    <select
                                                        value={monthlyReportDepartment}
                                                        onChange={(e) => setMonthlyReportDepartment(e.target.value)}
                                                        className="w-full h-10 px-3 rounded-xl border border-border focus:border-purple-500 focus:ring-2 focus:ring-purple-100 outline-none transition"
                                                    >
                                                        <option value="all">All Departments</option>
                                                        {uniqueDepartments.map((dept: any) => (
                                                            <option key={dept} value={dept}>{dept}</option>
                                                        ))}
                                                    </select>
                                                </div>
                                            </div>
                                        </CardContent>
                                    </Card>

                                    {/* Attendance Table */}
                                    <Card className="border-0 shadow-sm bg-card rounded-2xl overflow-hidden">
                                        <div className="overflow-x-auto no-scrollbar">
                                            <table className="w-full text-xs sm:text-sm border-collapse min-w-[800px]">
                                                <thead>
                                                    <tr className="border-b border-border/50 italic">
                                                        <th className="sticky left-0 z-20 bg-linear-to-r from-purple-50 to-pink-50 px-6 py-4 text-left font-semibold text-foreground min-w-[240px] w-[240px] shadow-[2px_0_5px_rgba(0,0,0,0.05)]">
                                                            Employee
                                                        </th>
                                                        <th className="sticky left-[240px] z-10 bg-purple-50 px-4 py-4 text-center font-semibold text-foreground min-w-[88px] w-[88px] shadow-[2px_0_5px_rgba(0,0,0,0.05)]">
                                                            Count
                                                        </th>
                                                        {Array.from({ length: new Date(selectedYear, selectedMonth, 0).getDate() }, (_, i) => i + 1).map(day => (
                                                            <th key={day} className="px-3 py-4 text-center font-semibold text-foreground min-w-[40px]">
                                                                {day}
                                                            </th>
                                                        ))}
                                                    </tr>
                                                </thead>
                                                <tbody>
                                                    {(monthlyReports || [])
                                                        .filter((report: any) => monthlyReportDepartment === 'all' || report.department === monthlyReportDepartment)
                                                        .map((report: any) => {
                                                            const daysInMonth = new Date(selectedYear, selectedMonth, 0).getDate();
                                                            const submittedDates = new Set(
                                                                report.tasks?.map((task: any) => new Date(task.date).getDate()) || []
                                                            );

                                                            return (
                                                                <tr key={report.user_id} className="border-b border-border/50 hover:bg-purple-50/30 transition-colors">
                                                                    <td className="sticky left-0 z-20 bg-card px-6 py-4 hover:bg-purple-50/30 transition-colors min-w-[240px] w-[240px]">
                                                                        <div className="flex items-center gap-3">
                                                                            <div className="w-8 h-8 rounded-full bg-linear-to-br from-purple-500 to-pink-500 flex items-center justify-center shrink-0">
                                                                                <span className="text-foreground text-sm font-semibold">
                                                                                    {(report.full_name || report.username)?.charAt(0).toUpperCase()}
                                                                                </span>
                                                                            </div>
                                                                            <div>
                                                                                <p className="font-medium text-foreground text-sm">{report.full_name || report.username}</p>
                                                                                <p className="text-xs text-muted-foreground">{report.department || 'No Dept'}</p>
                                                                            </div>
                                                                        </div>
                                                                    </td>
                                                                    <td className="sticky left-[240px] z-10 bg-card px-4 py-4 text-center min-w-[88px] w-[88px]">
                                                                        <span className="inline-flex items-center justify-center px-3 py-1 rounded-full bg-purple-100 text-purple-700 font-semibold text-sm">
                                                                            {report.total_submissions}/{calculateWorkingDaysCount}
                                                                        </span>
                                                                    </td>
                                                                    {Array.from({ length: daysInMonth }, (_, i) => i + 1).map(day => {
                                                                        const tasksOnThisDay = report.tasks?.filter((task: any) => {
                                                                            const createdDate = new Date(task.created_at);
                                                                            return createdDate.getDate() === day;
                                                                        }) || [];

                                                                        const isDoubleShift = tasksOnThisDay.length > 1;
                                                                        const hasSubmissionAtAll = submittedDates.has(day);

                                                                        return (
                                                                            <td key={day} className="px-3 py-4 text-center">
                                                                                {isDoubleShift ? (
                                                                                    <div className="flex justify-center -space-x-2">
                                                                                        <div className="text-green-600">
                                                                                            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                                                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                                                                                            </svg>
                                                                                        </div>
                                                                                        <div className="text-green-600">
                                                                                            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                                                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                                                                                            </svg>
                                                                                        </div>
                                                                                    </div>
                                                                                ) : hasSubmissionAtAll ? (
                                                                                    <svg className="w-5 h-5 text-green-600 mx-auto" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                                                                                    </svg>
                                                                                ) : (
                                                                                    <svg className="w-5 h-5 text-red-500 mx-auto" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M6 18L18 6M6 6l12 12" />
                                                                                    </svg>
                                                                                )}
                                                                            </td>
                                                                        );
                                                                    })}
                                                                </tr>
                                                            );
                                                        })}
                                                </tbody>
                                            </table>
                                        </div>
                                    </Card>
                                </div>
                            </TabsContent>
                        </Tabs>
                    </TabsContent>


    {/* Users Tab */}
    <TabsContent value="users" className="space-y-6">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* Create User Card */}
            {canManageUsers && (
            <Card className="border-0 shadow-sm bg-card rounded-2xl">
                <CardHeader className="border-b border-border/50">
                    <CardTitle className="text-lg flex items-center gap-2">
                        <UserPlus className="w-5 h-5 text-purple-500" />
                        Create User
                    </CardTitle>
                </CardHeader>
                <CardContent className="pt-6">
                    <form onSubmit={handleSubmit(onCreateUser)} className="space-y-4">
                        {planLimits && !planLimits.unlimited_access && (
                            <div className="space-y-3 rounded-xl border border-border bg-muted p-3">
                                {roleUsageConfig.map((item) => {
                                    const usage = planLimits[item.key];
                                    const limit = Math.max(0, Number(usage?.limit ?? 0));
                                    const current = Math.max(0, Number(usage?.current ?? 0));
                                    const clampedPercent = limit > 0 ? Math.min(100, Math.round((current / limit) * 100)) : 100;
                                    const atLimit = current >= limit;
                                    return (
                                        <div key={item.key} className="space-y-1.5">
                                            <div className="flex items-center justify-between text-xs">
                                                <span className="font-semibold text-foreground">{item.label}</span>
                                                <span className={cn("font-semibold", atLimit ? "text-red-600" : "text-muted-foreground")}>
                                                    {current}/{limit}
                                                </span>
                                            </div>
                                            <div className="h-2 rounded-full bg-secondary-light">
                                                <div
                                                    className={cn("h-2 rounded-full transition-all", atLimit ? "bg-red-500" : "bg-purple-500")}
                                                    style={{ width: `${clampedPercent}%` }}
                                                />
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        )}

                        <div className="space-y-2">
                            <Label htmlFor="email" className="text-sm font-medium text-foreground">
                                Email <span className="text-red-500">*</span>
                            </Label>
                            <Input
                                id="email"
                                type="email"
                                {...register('email')}
                                placeholder="employee@company.com"
                                className="h-10 rounded-xl border-border focus:border-purple-500 focus:ring-2 focus:ring-purple-100"
                            />
                            {errors.email && (
                                <p className="text-sm text-red-500 flex items-center gap-1">
                                    <AlertCircle className="w-4 h-4" />
                                    {errors.email.message}
                                </p>
                            )}
                        </div>

                        <div className="space-y-2">
                            <Label htmlFor="role" className="text-sm font-medium text-foreground">
                                Role <span className="text-red-500">*</span>
                            </Label>
                            <select
                                id="role"
                                {...register('role')}
                                className="w-full h-10 px-3 rounded-xl border border-border focus:border-purple-500 focus:ring-2 focus:ring-purple-100 outline-none"
                            >
                                <option
                                    value="employee"
                                    disabled={Boolean(planLimits && !planLimits.unlimited_access && planLimits.employees.current >= planLimits.employees.limit)}
                                >
                                    Employee
                                </option>
                                <option
                                    value="moderator"
                                    disabled={Boolean(planLimits && !planLimits.unlimited_access && planLimits.project_managers.current >= planLimits.project_managers.limit)}
                                >
                                    Moderator
                                </option>
                                <option
                                    value="admin"
                                    disabled={Boolean(planLimits && !planLimits.unlimited_access && planLimits.company_admins.current >= planLimits.company_admins.limit)}
                                >
                                    Admin
                                </option>
                            </select>
                            {errors.role && (
                                <p className="text-sm text-red-500 flex items-center gap-1">
                                    <AlertCircle className="w-4 h-4" />
                                    {errors.role.message}
                                </p>
                            )}
                            {isSelectedRoleAtLimit && (
                                <p className="text-xs text-red-600 font-medium">
                                    Plan limit reached for this role. Upgrade plan or reduce existing users first.
                                </p>
                            )}
                        </div>

                        {selectedRole === 'employee' && (
                            <div className="space-y-2">
                                <Label htmlFor="department" className="text-sm font-medium text-foreground">
                                    Department <span className="text-red-500">*</span>
                                </Label>
                                <select
                                    id="department"
                                    {...register('department')}
                                    className="w-full h-10 px-3 rounded-xl border border-border focus:border-purple-500 focus:ring-2 focus:ring-purple-100 outline-none"
                                >
                                    <option value="">Select Department</option>
                                    {departmentOptions.map((dept) => (
                                        <option key={dept} value={dept}>{dept}</option>
                                    ))}
                                </select>
                                {errors.department && (
                                    <p className="text-sm text-red-500 flex items-center gap-1">
                                        <AlertCircle className="w-4 h-4" />
                                        {errors.department.message}
                                    </p>
                                )}
                            </div>
                        )}

                        <Button
                            type="submit"
                            disabled={createUserMutation.isPending || isSelectedRoleAtLimit}
                            className="w-full h-10 rounded-xl bg-purple-500 hover:bg-purple-600 text-foreground font-semibold shadow-md transition"
                        >
                            {createUserMutation.isPending ? (
                                <span className="flex items-center gap-2">
                                    <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                                    Creating...
                                </span>
                            ) : (
                                <>
                                    <UserPlus className="w-4 h-4 mr-2" />
                                    Create User
                                </>
                            )}
                        </Button>
                    </form>
                </CardContent>
            </Card>
            )}

            {/* Users List Card */}
            <Card className={cn("border-0 shadow-sm bg-card rounded-2xl", canManageUsers ? "lg:col-span-2" : "lg:col-span-3")}>
                <CardHeader className="border-b border-border/50">
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                        <div>
                            <CardTitle className="text-lg flex items-center gap-2">
                                <Users className="w-5 h-5 text-purple-500" />
                                All Users
                            </CardTitle>
                            <CardDescription className="mt-1">
                                {usersPagination
                                    ? (isSuperAdminViewer
                                        ? `${usersPagination.total} total users (all companies)`
                                        : `${usersPagination.total} users in your company`)
                                    : `${filteredUsers?.length || 0} users`}
                            </CardDescription>
                        </div>
                        <div className="flex flex-wrap items-center gap-2 sm:justify-end">
                            {canManageUsers && (
                                <Button
                                    onClick={() => {
                                        if (window.confirm('Clear the time balance for all users?')) {
                                            resetAllMinutesBalancesMutation.mutate();
                                        }
                                    }}
                                    variant="outline"
                                    disabled={resetAllMinutesBalancesMutation.isPending}
                                    className="h-10 gap-2 border-red-200 text-red-600 hover:bg-red-50 hover:text-red-700 text-xs sm:text-sm px-3 sm:px-4"
                                >
                                    <RotateCcw className="w-4 h-4" />
                                    <span className="hidden xs:inline">{resetAllMinutesBalancesMutation.isPending ? 'Clearing...' : 'Clear All Balances'}</span>
                                    <span className="xs:hidden">Clear All</span>
                                </Button>
                            )}
                            {isAdmin && (
                                <Button
                                    onClick={() => setShowProfileRequests(true)}
                                    variant="outline"
                                    className="h-10 gap-2 relative bg-card text-xs sm:text-sm px-3 sm:px-4"
                                >
                                    <UserIcon className="w-4 h-4" />
                                    <span>Profile Requests</span>
                                    {profileRequests && profileRequests.length > 0 && (
                                        <span className="absolute -top-1 -right-1 w-4 h-4 bg-red-500 text-foreground text-[10px] flex items-center justify-center rounded-full animate-pulse">
                                            {profileRequests.length}
                                        </span>
                                    )}
                                </Button>
                            )}
                            <select
                                value={statusDepartment}
                                onChange={(e) => setStatusDepartment(e.target.value)}
                                className="h-10 px-2 sm:px-3 rounded-xl border border-border focus:border-purple-500 focus:ring-2 focus:ring-purple-100 outline-none text-xs sm:text-sm bg-card min-w-[120px]"
                            >
                                <option value="all">All Departments</option>
                                {uniqueDepartments.map((dept: any) => (
                                    <option key={dept} value={dept}>{dept}</option>
                                ))}
                            </select>
                            <Input
                                value={usersSearchInput}
                                onChange={(e) => setUsersSearchInput(e.target.value)}
                                placeholder="Search name, username, email..."
                                className="h-10 w-[220px] rounded-xl border-border focus:border-purple-500 focus:ring-2 focus:ring-purple-100"
                            />
                        </div>
                    </div>
                </CardHeader>
                <CardContent className="p-6">
                    {isPagedUsersFetching ? (
                        <div className="mb-4 text-xs text-muted-foreground">Refreshing users...</div>
                    ) : null}
                    <div className="space-y-3">
                        {isPagedUsersLoading ? (
                            <div className="space-y-3">
                                {[1, 2, 3, 4].map((idx) => (
                                    <div key={idx} className="p-5 rounded-2xl border border-border/50 bg-card animate-pulse">
                                        <div className="flex items-center gap-4">
                                            <div className="w-12 h-12 rounded-2xl bg-secondary-light" />
                                            <div className="flex-1">
                                                <div className="h-4 w-40 bg-secondary-light rounded mb-2" />
                                                <div className="h-3 w-56 bg-secondary-light rounded" />
                                            </div>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        ) : filteredUsers && filteredUsers.length > 0 ? (
                            filteredUsers.map((u: any, index: number) => {
                                const displayName = (u.full_name || u.username || '').trim() || 'Unnamed User';
                                const avatarLabel = displayName.charAt(0).toUpperCase();
                                const minutesBalance = u.minutes_balance || 0;
                                const paidLeaveBalance = u.paid_leave_balance ?? 0;
                                const isEmployee = u.role === 'employee';
                                const canOpenUserDetails = isAdmin || isModerator || isEmployee;
                                const isOnLeave = Boolean(u.is_on_leave);
                                const leaveRangeLabel = u.leave_start_date
                                    ? formatDateRangeLabel(u.leave_start_date, u.leave_end_date)
                                    : null;

                                return (
                                <div
                                    key={u.id || index}
                                    className={cn(
                                        "group p-5 rounded-2xl border transition flex flex-col gap-4 xl:flex-row xl:items-center",
                                        isOnLeave
                                            ? "bg-red-50/80 border-red-200 hover:border-red-300 hover:shadow-md"
                                            : "bg-card border-border/50 hover:border-purple-200 hover:shadow-md"
                                    )}
                                >
                                    <div className="flex min-w-0 flex-1 items-center gap-4">
                                        <div className="relative">
                                            <div className="w-12 h-12 rounded-2xl bg-linear-to-br from-purple-500 to-pink-500 flex items-center justify-center text-white font-bold text-lg shadow-sm overflow-hidden">
                                                {u.profile_picture ? (
                                                    <img
                                                        src={(import.meta.env.VITE_API_URL || '').replace(/\/$/, '') + '/' + u.profile_picture.replace(/^\//, '')}
                                                        alt={u.username}
                                                        className="w-full h-full object-cover"
                                                        onError={(e) => {
                                                            (e.target as HTMLImageElement).src = `https://ui-avatars.com/api/?name=${encodeURIComponent(u.username)}&background=random`;
                                                        }}
                                                    />
                                                ) : (
                                                    avatarLabel
                                                )}
                                            </div>
                                            {isEmployee && (u.status === 'active' || u.status === 'break') && (
                                                <div
                                                    className={cn(
                                                        "absolute -bottom-1 -right-1 w-4 h-4 rounded-full border-2 border-white",
                                                        u.status === 'break' ? "bg-amber-400" : "bg-green-500"
                                                    )}
                                                />
                                            )}
                                        </div>
                                        <div className="min-w-0 flex-1">
                                            <div className="flex flex-wrap items-center gap-2">
                                                <h3 className="text-base font-bold leading-tight text-foreground wrap-break-word">
                                                    {displayName}
                                                </h3>
                                                {isOnLeave && (
                                                    <span className="inline-flex items-center rounded-full bg-red-100 px-2.5 py-1 text-[11px] font-bold uppercase tracking-wide text-red-700">
                                                        <Plane className="mr-1 h-3.5 w-3.5" />
                                                        On Leave
                                                    </span>
                                                )}
                                            </div>
                                            <div className="mt-0.5 text-xs text-muted-foreground">
                                                <p className="min-w-0 break-all">@{u.username}</p>
                                                {isOnLeave && leaveRangeLabel && (
                                                    <p className="mt-1 font-semibold text-red-700">
                                                        Leave: {leaveRangeLabel}
                                                    </p>
                                                )}
                                            </div>
                                        </div>
                                    </div>

                                    <div className="min-w-0 xl:flex-[1.1]">
                                        <div className="flex flex-wrap items-center gap-2">
                                            {isAdmin && (
                                                <span className={cn(
                                                    "inline-flex rounded-full px-3 py-1 text-[11px] font-bold uppercase tracking-wide",
                                                    getRoleBadgeClass(u.role)
                                                )}>
                                                    {u.role}
                                                </span>
                                            )}
                                            <span className="inline-flex rounded-full bg-muted px-3 py-1 text-[11px] font-semibold text-muted-foreground">
                                                {u.department || 'No Dept'}
                                            </span>
                                            {isEmployee && (
                                                <span className={cn(
                                                    "inline-flex rounded-full px-3 py-1 text-[11px] font-semibold",
                                                    minutesBalance >= 0 ? "bg-green-100 text-green-700" : "bg-red-100 text-red-700"
                                                )}>
                                                    Balance {(minutesBalance >= 0 ? '+' : '-')}{Math.floor(Math.abs(minutesBalance) / 60)}h {Math.abs(minutesBalance) % 60}m
                                                </span>
                                            )}
                                            {isEmployee && (
                                                <span className="inline-flex rounded-full bg-purple-50 px-3 py-1 text-[11px] font-semibold text-purple-700">
                                                    Paid Days {paidLeaveBalance}
                                                </span>
                                            )}
                                        </div>
                                    </div>

                                    <div className="flex shrink-0 items-center gap-2 border-t border-border/50 pt-3 xl:border-l xl:border-t-0 xl:pl-4 xl:pt-0">
                                        <Button
                                            variant="ghost"
                                            size="sm"
                                            onClick={() => fetchUserDetails(u.id)}
                                            disabled={!canOpenUserDetails}
                                            title={!canOpenUserDetails ? 'You can only view employee details' : 'View details'}
                                            className={cn(
                                                "h-9 w-9 p-0 rounded-xl transition-colors",
                                                canOpenUserDetails
                                                    ? "text-muted-foreground hover:text-violet-600 dark:hover:text-violet-400 hover:bg-violet-500/10"
                                                    : "text-muted-foreground/50 cursor-not-allowed"
                                            )}
                                        >
                                            <Eye className="w-4 h-4" />
                                        </Button>
                                        {canManageUsers && (
                                            <DropdownMenu>
                                                <DropdownMenuTrigger asChild>
                                                    <Button
                                                        variant="outline"
                                                        size="sm"
                                                        className="h-9 gap-2 rounded-xl border-border bg-card px-3 text-foreground hover:bg-muted"
                                                    >
                                                        <MoreHorizontal className="h-4 w-4" />
                                                        Actions
                                                    </Button>
                                                </DropdownMenuTrigger>
                                                <DropdownMenuContent align="end" className="w-52">
                                                    <DropdownMenuItem onClick={() => openUserManager(u)}>
                                                        Manage User
                                                    </DropdownMenuItem>
                                                    {user?.id !== u.id && (
                                                        <>
                                                            <DropdownMenuSeparator />
                                                            <DropdownMenuItem
                                                                onClick={() => setUserToDelete(u)}
                                                                className="text-red-600 focus:text-red-700"
                                                            >
                                                                Delete User
                                                            </DropdownMenuItem>
                                                        </>
                                                    )}
                                                </DropdownMenuContent>
                                            </DropdownMenu>
                                        )}
                                    </div>
                                </div>
                                );
                            })
                        ) : (
                            <div className="bg-card rounded-2xl border border-dashed border-input p-12 text-center text-muted-foreground">
                                <Users className="w-12 h-12 mx-auto mb-3 text-muted-foreground/50" />
                                <p>No users found for the selected department.</p>
                            </div>
                        )}
                    </div>
                    {usersPagination ? (
                        <div className="mt-6 flex flex-col gap-3 border-t border-border/50 pt-4 sm:flex-row sm:items-center sm:justify-between">
                            <p className="text-xs text-muted-foreground">
                                Page {usersPagination.page} of {usersPagination.totalPages} ({usersPagination.total} {isSuperAdminViewer ? 'total users' : 'company users'})
                            </p>
                            <div className="flex items-center gap-2">
                                <Button
                                    variant="outline"
                                    size="sm"
                                    onClick={() => setUsersPage((p) => Math.max(1, p - 1))}
                                    disabled={!usersPagination.hasPrevious}
                                    className="rounded-xl"
                                >
                                    Previous
                                </Button>
                                <Button
                                    variant="outline"
                                    size="sm"
                                    onClick={() => setUsersPage((p) => p + 1)}
                                    disabled={!usersPagination.hasNext}
                                    className="rounded-xl"
                                >
                                    Next
                                </Button>
                            </div>
                        </div>
                    ) : null}
                </CardContent>
            </Card>
        </div>

    </TabsContent>

                {/* Activity Tab */}
                <TabsContent value="activity" className="space-y-6 focus-visible:outline-none">
                    <div className="space-y-6">
                        {/* Activity Log */}
                        <Card className="border-0 shadow-sm bg-card rounded-2xl">
                            <CardHeader className="border-b border-border/50 pb-4">
                                <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                                    <div>
                                        <CardTitle className="text-xl font-bold text-foreground flex items-center gap-2">
                                            <Activity className="w-5 h-5 text-purple-500" />
                                            Activity Log
                                        </CardTitle>
                                        <CardDescription>Sign in/out records</CardDescription>
                                    </div>
                                    <Popover>
                                        <PopoverTrigger asChild>
                                            <Button variant="outline" className={cn(
                                                "w-full sm:w-auto justify-start text-left font-normal rounded-full border-border px-5",
                                                !activityDate && "text-muted-foreground"
                                            )}>
                                                <CalendarIcon className="mr-2 h-4 w-4" />
                                                {activityDate ? format(activityDate, "MMM d, yyyy") : <span>Pick a date</span>}
                                            </Button>
                                        </PopoverTrigger>
                                        <PopoverContent className="w-auto p-0 rounded-2xl border border-border shadow-2xl bg-card ring-1 ring-black/5 z-100" align="start">
                                            <Calendar
                                                mode="single"
                                                selected={activityDate}
                                                onSelect={setActivityDate}
                                                initialFocus
                                                disabled={(date) => date > new Date()}
                                                className="rounded-2xl bg-card"
                                            />
                                        </PopoverContent>
                                    </Popover>
                                </div>
                            </CardHeader>
                            <CardContent className="p-0">
                                <div className="overflow-x-auto no-scrollbar">
                                    {activityRows.length > 0 ? (
                                        <table className="w-full min-w-[800px] border-collapse">
                                            <thead>
                                                <tr className="border-y border-purple-100 bg-purple-50/40">
                                                    <th className="w-[280px] px-7 py-5 text-left text-sm font-semibold text-foreground">Employee</th>
                                                    <th className="px-4 py-5 text-center text-sm font-semibold text-foreground">Sign In</th>
                                                    <th className="px-4 py-5 text-center text-sm font-semibold text-foreground">Break Start</th>
                                                    <th className="px-4 py-5 text-center text-sm font-semibold text-foreground">Break End</th>
                                                    <th className="px-4 py-5 text-center text-sm font-semibold text-foreground">Sign Out</th>
                                                    <th className="px-4 py-5 text-center text-sm font-semibold text-foreground">Work Hours</th>
                                                </tr>
                                            </thead>
                                            <tbody>
                                                {activityRows.map((row: any) => {
                                                    return (
                                                        <tr key={row.user_id} className="border-b border-border/50 last:border-b-0 hover:bg-muted/50 transition-colors">
                                                            <td className="border-r border-border/50 px-7 py-4">
                                                                <div className="flex items-center gap-4">
                                                                    <div className="relative">
                                                                        <div className="flex h-11 w-11 items-center justify-center rounded-full bg-linear-to-br from-violet-500 to-pink-500 text-white font-bold shadow-sm overflow-hidden border-2 border-white">
                                                                            {row.profile_picture ? (
                                                                                <img
                                                                                    src={(import.meta.env.VITE_API_URL || '').replace(/\/$/, '') + '/' + row.profile_picture.replace(/^\//, '')}
                                                                                    alt={row.username}
                                                                                    className="w-full h-full object-cover"
                                                                                    onError={(e) => {
                                                                                        (e.target as HTMLImageElement).src = `https://ui-avatars.com/api/?name=${encodeURIComponent(row.username)}&background=random`;
                                                                                    }}
                                                                                />
                                                                            ) : (
                                                                                row.username?.[0]?.toUpperCase() || 'U'
                                                                            )}
                                                                        </div>
                                                                    </div>
                                                                    <div>
                                                                        <p className="text-[15px] font-semibold text-foreground">{row.username}</p>
                                                                        <div className="flex items-center gap-1.5 mt-1">
                                                                            <span className="w-2 h-2 rounded-full bg-purple-400"></span>
                                                                            <p className="text-[12px] font-medium text-purple-600">
                                                                                {row.allSessions?.length || 0} session{row.allSessions?.length !== 1 ? 's' : ''} today
                                                                            </p>
                                                                        </div>
                                                                    </div>
                                                                </div>
                                                            </td>
                                                            <td className="px-4 py-4 text-center">
                                                                <div className="flex flex-col gap-1.5 items-center">
                                                                    {row.allSessions?.map((s: any, idx: number) => (
                                                                        s.sign_in_time ? (
                                                                            <span key={idx} className="inline-flex rounded-full bg-emerald-50 border border-emerald-100 px-3 py-1 text-[13px] font-medium text-emerald-700">
                                                                                {formatActivityTime(s.sign_in_time)}
                                                                            </span>
                                                                        ) : <span key={idx} className="text-muted-foreground/50 font-medium">-</span>
                                                                    ))}
                                                                </div>
                                                            </td>
                                                            <td className="px-4 py-4 text-center">
                                                                <div className="flex flex-col gap-1.5 items-center">
                                                                    {row.allSessions?.map((s: any, idx: number) => {
                                                                        const b = s.breaks?.[0]; // Show first break of each session
                                                                        return b?.start ? (
                                                                            <span key={idx} className="inline-flex rounded-full bg-amber-50 border border-amber-100 px-3 py-1 text-[13px] font-medium text-amber-700">
                                                                                {formatActivityTime(b.start)}
                                                                            </span>
                                                                        ) : <span key={idx} className="text-muted-foreground/50 font-medium">-</span>
                                                                    })}
                                                                </div>
                                                            </td>
                                                            <td className="px-4 py-4 text-center">
                                                                <div className="flex flex-col gap-1.5 items-center">
                                                                    {row.allSessions?.map((s: any, idx: number) => {
                                                                        const b = s.breaks?.[0];
                                                                        return b?.end ? (
                                                                            <span key={idx} className="inline-flex rounded-full bg-indigo-500/10 border border-indigo-500/20 px-3 py-1 text-[13px] font-medium text-indigo-650 dark:text-indigo-400">
                                                                                {formatActivityTime(b.end)}
                                                                            </span>
                                                                        ) : <span key={idx} className="text-muted-foreground/50 font-medium">-</span>
                                                                    })}
                                                                </div>
                                                            </td>
                                                            <td className="px-4 py-4 text-center">
                                                                <div className="flex flex-col gap-1.5 items-center">
                                                                    {row.allSessions?.map((s: any, idx: number) => (
                                                                        s.sign_out_time ? (
                                                                            <span key={idx} className="inline-flex rounded-full bg-rose-500/10 border border-rose-500/20 px-3 py-1 text-[13px] font-medium text-rose-650 dark:text-rose-455">
                                                                                {formatActivityTime(s.sign_out_time)}
                                                                            </span>
                                                                        ) : <span key={idx} className="text-muted-foreground/50 font-medium">-</span>
                                                                    ))}
                                                                </div>
                                                            </td>
                                                            <td className="px-4 py-4 text-center">
                                                                <span className="inline-flex items-center gap-1.5 text-[15px] font-bold text-foreground bg-muted/80 px-4 py-2 rounded-xl shadow-sm border border-border/60">
                                                                    <svg className="w-4 h-4 text-muted-foreground" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                                                                    </svg>
                                                                    {row.totalWorkHoursFormatted}
                                                                </span>
                                                            </td>
                                                        </tr>
                                                    );
                                                })}
                                            </tbody>
                                        </table>
                                    ) : (
                                        <div className="flex flex-col items-center justify-center py-12 text-muted-foreground/70">
                                            <Activity className="w-12 h-12 mb-4 opacity-20" />
                                            <p className="font-medium">No activity recorded for this date</p>
                                        </div>
                                    )}
                                </div>
                            </CardContent>
                        </Card>

                    </div>
                </TabsContent>
                
                {canViewLiveTracking && (
                    <TabsContent value="live_tracking" className="space-y-6">
                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                            {(users || [])
                                .filter(u => u.role === 'employee' && u.status === 'active')
                                .map(u => (
                                    <Card key={u.id} className="border-0 shadow-lg bg-card rounded-3xl overflow-hidden hover:shadow-xl transition group">
                                        <div className="p-6">
                                            <div className="flex items-center gap-4 mb-6">
                                                <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-violet-600 to-indigo-600 flex items-center justify-center text-white text-xl font-bold shadow-lg shadow-violet-500/10 shrink-0">
                                                    {u.profile_picture ? (
                                                        <OptimizedImage 
                                                            src={getAssetUrl(u.profile_picture)} 
                                                            alt={u.username} 
                                                            className="w-full h-full object-cover rounded-2xl"
                                                        />
                                                    ) : (
                                                        u.username[0].toUpperCase()
                                                    )}
                                                </div>
                                                <div className="min-w-0">
                                                    <h3 className="text-lg font-bold text-foreground truncate">{u.full_name || u.username}</h3>
                                                    <p className="text-sm text-muted-foreground flex items-center gap-1.5 mt-0.5">
                                                        <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
                                                        Currently Working
                                                    </p>
                                                </div>
                                            </div>
                                            
                                            <div className="space-y-4">
                                                <div className="flex items-center justify-between p-3 rounded-2xl bg-muted border border-border/50">
                                                    <div className="flex items-center gap-2 text-muted-foreground">
                                                        <Briefcase className="w-4 h-4" />
                                                        <span className="text-xs font-semibold">{u.department || 'No Dept'}</span>
                                                    </div>
                                                    <div className="flex items-center gap-2 text-muted-foreground">
                                                        <Clock className="w-4 h-4" />
                                                        <span className="text-xs font-semibold">Live Now</span>
                                                    </div>
                                                </div>
                                                
                                                <Button
                                                    onClick={() => requestLocationMutation.mutate(u.id)}
                                                    disabled={requestLocationMutation.isPending && requestLocationMutation.variables === u.id}
                                                    className="w-full h-12 rounded-2xl bg-slate-900 hover:bg-black text-white font-bold shadow-lg shadow-slate-200 transition active:scale-95 flex items-center justify-center gap-2"
                                                >
                                                    {requestLocationMutation.isPending && requestLocationMutation.variables === u.id ? (
                                                        <>
                                                            <RotateCcw className="w-4 h-4 animate-spin" />
                                                            Locating...
                                                        </>
                                                    ) : (
                                                        <>
                                                            <Activity className="w-4 h-4" />
                                                            Request Live Location
                                                        </>
                                                    )}
                                                </Button>
                                            </div>
                                        </div>
                                    </Card>
                                ))}
                            
                            {(users || []).filter(u => u.role === 'employee' && u.status === 'active').length === 0 && (
                                <div className="col-span-full py-20 text-center">
                                    <div className="w-20 h-20 bg-muted rounded-full flex items-center justify-center mx-auto mb-4 border border-border/50">
                                        <Users className="w-10 h-10 text-muted-foreground/50" />
                                    </div>
                                    <h3 className="text-xl font-bold text-foreground mb-2">No employees currently active</h3>
                                    <p className="text-muted-foreground max-w-xs mx-auto text-sm">
                                        Only signed-in employees can be tracked for live location.
                                    </p>
                                </div>
                            )}
                        </div>
                    </TabsContent>
                )}

                {/* Chat Tab */}
                <TabsContent value="chat" className="h-[calc(100dvh-14rem)] min-h-104 focus-visible:outline-none sm:h-[calc(100dvh-12rem)]">
                    <Card className="h-full min-h-0 border-0 shadow-lg bg-card overflow-hidden rounded-3xl">
                        <Suspense fallback={<div className="h-full flex items-center justify-center text-muted-foreground text-sm">Loading chat...</div>}>
                            <LazyChatInterface
                                adminMode={true}
                                isVisible={activeTab === 'chat'}
                                onUnreadTotalChange={setChatUnreadTotal}
                            />
                        </Suspense>
                    </Card>
                </TabsContent>

                {/* Leaves Tab */}
                {canManageLeaves && (
                <TabsContent value="leaves" className="space-y-6 focus-visible:outline-none">
                    <Tabs defaultValue="leave" className="space-y-6">
                        <div className="-mx-1 overflow-x-auto pb-1">
                        <TabsList className="inline-flex min-w-max items-center gap-1 rounded-full border border-border bg-card p-1 shadow-sm">
                            <TabsTrigger
                                value="leave"
                                className="flex h-9 shrink-0 items-center justify-center rounded-full px-4 py-0 data-[state=active]:bg-purple-500 data-[state=active]:text-white transition"
                            >
                                <CalendarDays className="w-4 h-4 mr-2" />
                                Leave
                            </TabsTrigger>
                            <TabsTrigger
                                value="early-sign-out"
                                className="flex h-9 shrink-0 items-center justify-center rounded-full px-4 py-0 data-[state=active]:bg-purple-500 data-[state=active]:text-white transition"
                            >
                                <LogOut className="w-4 h-4 mr-2" />
                                Early Sign Out
                            </TabsTrigger>
                        </TabsList>
                        </div>

                        <TabsContent value="leave" className="space-y-6 focus-visible:outline-none">
                    <Card className="border-0 shadow-sm bg-card rounded-2xl overflow-hidden">
                        <CardHeader className="border-b border-border/50 pb-6">
                            <div className="flex items-center justify-between">
                                <div>
                                    <CardTitle className="text-xl font-bold text-foreground flex items-center gap-2">
                                        <CalendarDays className="w-5 h-5 text-violet-550 dark:text-violet-400" />
                                        Leave Management
                                    </CardTitle>
                                    <CardDescription>Review and handle all team leave requests</CardDescription>
                                </div>
                                <div className="flex items-center gap-2">
                                    <div className="h-2 w-2 rounded-full bg-violet-600 dark:bg-violet-400 animate-pulse" />
                                    <span className="text-xs font-bold text-muted-foreground uppercase tracking-wider">
                                        {sortedAdminLeaves.length} Total Requests
                                    </span>
                                </div>
                            </div>
                        </CardHeader>
                        <CardContent className="p-0 sm:p-6">
                            <div className="overflow-x-auto no-scrollbar">
                                <table className="w-full text-left border-collapse min-w-[700px]">
                                    <thead>
                                        <tr className="bg-muted/50 border-b border-border/50 text-[10px] sm:text-[11px]">
                                            <th className="px-4 sm:px-6 py-4 font-bold uppercase tracking-widest text-muted-foreground/70">Employee</th>
                                            <th className="px-4 sm:px-6 py-4 font-bold uppercase tracking-widest text-muted-foreground/70">Duration</th>
                                            <th className="px-4 sm:px-6 py-4 font-bold uppercase tracking-widest text-muted-foreground/70 text-center">Moderator</th>
                                            <th className="px-4 sm:px-6 py-4 font-bold uppercase tracking-widest text-muted-foreground/70 text-center">HR Status</th>
                                            <th className="px-4 sm:px-6 py-4 font-bold uppercase tracking-widest text-muted-foreground/70 text-right">Actions</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {sortedAdminLeaves.length > 0 ? (
                                             sortedAdminLeaves.map((leave: any) => (
                                                 <tr key={leave.id} className="border-b border-slate-50 group hover:bg-muted/30 transition-colors">
                                                     <td className="px-6 py-4">
                                                         <div className="flex items-center gap-3">
                                                             <div className="h-8 w-8 rounded-full bg-muted flex items-center justify-center font-bold text-muted-foreground text-xs shadow-sm overflow-hidden relative">
                                                                 <span>{(leave.username?.[0] || '?').toUpperCase()}</span>
                                                                 {leave.profile_picture ? (
                                                                     <img
                                                                         src={(import.meta.env.VITE_API_URL || '').replace(/\/$/, '') + '/' + String(leave.profile_picture).replace(/^\//, '')}
                                                                         alt={leave.full_name || leave.username}
                                                                         className="absolute inset-0 h-full w-full object-cover"
                                                                         onError={(e) => {
                                                                             (e.target as HTMLImageElement).style.display = 'none';
                                                                         }}
                                                                     />
                                                                 ) : null}
                                                             </div>
                                                             <div>
                                                                 <p className="text-sm font-bold text-foreground">@{leave.username}</p>
                                                                 <p className="text-[10px] text-muted-foreground/70">{leave.full_name || 'No full name'}</p>
                                                             </div>
                                                         </div>
                                                     </td>
                                                     <td className="px-6 py-4">
                                                         <div className="flex flex-col">
                                                             <span className="text-sm font-semibold text-foreground">
                                                                 {formatDateRangeLabel(leave.start_date, leave.end_date)}
                                                             </span>
                                                             <span className="text-[10px] font-bold text-muted-foreground/70 uppercase">
                                                                 {leave.days_total} {leave.days_total === 1 ? 'Day' : 'Days'}
                                                             </span>
                                                         </div>
                                                     </td>
                                                     <td className="px-6 py-4 text-center">
                                                         <div className="flex flex-col items-center gap-1">
                                                              <span className={cn(
                                                                  "inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider shadow-sm",
                                                                  leave.moderator_status === 'pending' ? "bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20" : 
                                                                  leave.moderator_status === 'proceeded' ? "bg-indigo-500/10 text-indigo-650 dark:text-indigo-400 border border-indigo-500/20" : 
                                                                  "bg-red-500/10 text-red-650 dark:text-red-400 border border-red-500/20"
                                                              )}>
                                                                  <div className={cn("h-1.5 w-1.5 rounded-full", 
                                                                      leave.moderator_status === 'pending' ? "bg-amber-500 animate-pulse" : 
                                                                      leave.moderator_status === 'proceeded' ? "bg-indigo-500" : 
                                                                      "bg-red-500"
                                                                  )} />
                                                                 {leave.moderator_status || 'pending'}
                                                             </span>
                                                             {leave.moderated_by_name && (
                                                                 <span className="text-[9px] text-muted-foreground font-bold">
                                                                     By: {leave.moderated_by_name}
                                                                 </span>
                                                             )}
                                                             {leave.moderated_at && (
                                                                 <span className="text-[9px] text-muted-foreground/70 italic">
                                                                     {format(new Date(leave.moderated_at), 'MMM dd')}
                                                                 </span>
                                                             )}
                                                         </div>
                                                     </td>
                                                     <td className="px-6 py-4 text-center">
                                                         <div className="flex flex-col items-center gap-1">
                                                             <span className={cn(
                                                                 "inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider shadow-sm",
                                                                 leave.status === 'pending' ? (leave.moderator_status === 'proceeded' ? "bg-indigo-100 text-indigo-700" : "bg-muted text-muted-foreground/70") : 
                                                                 leave.status === 'approved' ? "bg-emerald-100 text-emerald-700" : 
                                                                 "bg-red-100 text-red-700"
                                                             )}>
                                                                 {leave.status === 'pending' ? (leave.moderator_status === 'proceeded' ? 'Waiting HR' : 'Waiting PM') : leave.status}
                                                             </span>
                                                         </div>
                                                     </td>
                                                     <td className="px-6 py-4 text-right">
                                                         {leave.status === 'pending' ? (
                                                             <div className="flex justify-end gap-2">
                                                                 {isModerator && leave.moderator_status === 'pending' && (
                                                                     <>
                                                                         <Button
                                                                             size="sm"
                                                                             onClick={() => proceedBatchLeaveMutation.mutate(leave.request_id)}
                                                                             className="h-8 rounded-lg bg-indigo-500 hover:bg-indigo-600 text-white shadow-sm"
                                                                         >
                                                                             Proceed to HR
                                                                         </Button>
                                                                         <Button
                                                                             size="sm"
                                                                             variant="outline"
                                                                             onClick={() => declineBatchLeaveMutation.mutate(leave.request_id)}
                                                                             className="h-8 rounded-lg border-red-200 text-red-600 hover:bg-red-50"
                                                                         >
                                                                             Decline
                                                                         </Button>
                                                                     </>
                                                                 )}
                                                                 {isAdmin && (
                                                                     <>
                                                                         <Button
                                                                             size="sm"
                                                                             disabled={leave.moderator_status !== 'proceeded'}
                                                                             onClick={() => {
                                                                                 if (leave.individualLeaves?.length > 1) {
                                                                                     updateBatchLeaveStatusMutation.mutate({ requestId: leave.request_id, status: 'approved' });
                                                                                 } else {
                                                                                     updateLeaveStatusMutation.mutate({ id: leave.id, status: 'approved' });
                                                                                 }
                                                                             }}
                                                                             className={cn(
                                                                                 "h-8 rounded-lg bg-green-500 hover:bg-green-600 text-white shadow-sm",
                                                                                 leave.moderator_status !== 'proceeded' && "opacity-50 cursor-not-allowed"
                                                                             )}
                                                                             title={leave.moderator_status !== 'proceeded' ? "Waiting for PM to proceed" : "Approve leave"}
                                                                         >
                                                                             Approve {leave.individualLeaves?.length > 1 ? 'All' : ''}
                                                                         </Button>
                                                                          <Button
                                                                              size="sm"
                                                                              variant="outline"
                                                                              disabled={leave.moderator_status !== "proceeded"}
                                                                              onClick={() => {
                                                                                  if (leave.individualLeaves?.length > 1) {
                                                                                      updateBatchLeaveStatusMutation.mutate({ requestId: leave.request_id, status: "rejected" });
                                                                                  } else {
                                                                                      updateLeaveStatusMutation.mutate({ id: leave.id, status: "rejected" });
                                                                                  }
                                                                              }}
                                                                              className={cn(
                                                                                  "h-8 rounded-lg border-red-200 text-red-600 hover:bg-red-50",
                                                                                  leave.moderator_status !== "proceeded" && "opacity-50 cursor-not-allowed"
                                                                              )}
                                                                              title={leave.moderator_status !== "proceeded" ? "Waiting for PM to proceed" : "Reject leave"}
                                                                          >
                                                                              Reject {leave.individualLeaves?.length > 1 ? 'All' : ''}
                                                                          </Button>
                                                                      </>
                                                                 )}
                                                             </div>
                                                         ) : (
                                                             <div className="flex justify-end items-center gap-2">
                                                                 <Button
                                                                     variant="ghost"
                                                                     size="icon"
                                                                     onClick={() => {
                                                                         setSelectedLeaveForView(leave);
                                                                         setShowLeaveDetails(true);
                                                                     }}
                                                                     className="h-8 w-8 text-muted-foreground/70 hover:text-violet-600 dark:hover:text-violet-400 hover:bg-violet-500/10 rounded-lg"
                                                                     title="View Details"
                                                                 >
                                                                     <Eye className="w-4 h-4" />
                                                                 </Button>
                                                                 <Button
                                                                     variant="ghost"
                                                                     size="icon"
                                                                     onClick={() => {
                                                                         if (leave.individualLeaves?.length > 1 && window.confirm('Delete this entire range?')) {
                                                                             setLeaveToDelete(leave);
                                                                         } else {
                                                                             setLeaveToDelete(leave);
                                                                         }
                                                                     }}
                                                                     className="h-8 w-8 text-muted-foreground/70 hover:text-red-500"
                                                                 >
                                                                     <Trash2 className="w-4 h-4" />
                                                                  </Button>
                                                              </div>
                                                          )}
                                                      </td>
                                                  </tr>
                                             ))
                                        ) : (
                                            <tr>
                                                <td colSpan={6} className="px-6 py-12 text-center text-muted-foreground/70 italic">
                                                    No leave requests found.
                                                </td>
                                            </tr>
                                        )}
                                    </tbody>
                                </table>
                            </div>
                        </CardContent>
                    </Card>

                        </TabsContent>

                        <TabsContent value="early-sign-out" className="space-y-6 focus-visible:outline-none">
                    <Card className="border-0 shadow-sm bg-card rounded-2xl">
                        <CardHeader className="border-b border-border/50">
                            <CardTitle className="text-xl font-bold text-foreground flex items-center gap-2">
                                <LogOut className="w-5 h-5 text-amber-500" />
                                Early Sign out
                            </CardTitle>
                            <CardDescription>Users who signed out before daily target</CardDescription>
                        </CardHeader>
                        <CardContent className="p-6">
                            <div className="space-y-4">
                                {sortedEarlyLeaves.length > 0 ? (
                                    sortedEarlyLeaves.map((record: any) => (
                                        <div key={record.id} className="flex gap-4 p-4 rounded-2xl border border-border/50 bg-muted/50">
                                            <div className="w-10 h-10 rounded-full bg-amber-100 flex items-center justify-center text-amber-600 shrink-0">
                                                {record.username?.[0]?.toUpperCase() || 'U'}
                                            </div>
                                            <div className="flex-1 min-w-0">
                                                <div className="flex justify-between items-start gap-4">
                                                    <h4 className="text-sm font-bold text-foreground truncate">@{record.username}</h4>
                                                    <span className="text-[10px] font-bold text-muted-foreground/70 uppercase tracking-wider whitespace-nowrap">
                                                        {record.created_at ? format(new Date(record.created_at), 'MMM dd, yyyy') : '-'}
                                                    </span>
                                                </div>
                                                <p className="text-xs text-muted-foreground mt-1 italic leading-relaxed">
                                                    "{record.reason || 'No reason provided'}"
                                                </p>
                                                <div className="mt-2 flex items-center gap-2 flex-wrap">
                                                    <span className="text-[10px] font-bold text-amber-600 bg-amber-50 px-2 py-0.5 rounded-full border border-amber-100">
                                                        Target Missed
                                                    </span>
                                                    <span className="text-[10px] font-bold text-muted-foreground bg-muted px-2 py-0.5 rounded-full border border-border">
                                                        {record.created_at ? format(new Date(record.created_at), 'h:mm a') : '-'}
                                                    </span>
                                                </div>
                                            </div>
                                        </div>
                                    ))
                                ) : (
                                    <div className="text-center py-8 text-muted-foreground/70">
                                        <Check className="w-10 h-10 mx-auto mb-3 opacity-20" />
                                        <p className="text-sm font-medium">Clear for today. No early sign outs recorded.</p>
                                    </div>
                                )}
                            </div>
                        </CardContent>
                    </Card>
                        </TabsContent>
                    </Tabs>
                </TabsContent>
                )}

                {/* Settings Tab */}
                {canManageSettings && (
                <TabsContent value="settings" className="space-y-6 focus-visible:outline-none">
                    <div className="mb-0 p-6 rounded-3xl bg-linear-to-r from-slate-900 via-indigo-950 to-slate-800 text-white shadow-2xl overflow-hidden relative group">
                        <div className="absolute top-0 right-0 w-64 h-64 bg-cyan-400/10 rounded-full blur-3xl -mr-20 -mt-20 group-hover:bg-cyan-400/20 transition duration-700" />
                        <h2 className="text-2xl font-bold flex items-center gap-3">
                            <Settings className="w-7 h-7 text-purple-400 animate-spin-slow" />
                            System Configuration
                        </h2>
                        <p className="mt-2 text-slate-200 max-w-3xl font-medium leading-relaxed">Manage work schedules, holidays, department structure, and automation controls from one place.</p>
                    </div>

                    <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
                        {/* Work Schedule Configuration */}
                        <Card className="lg:col-span-6 xl:col-span-4 border border-border/50 shadow-sm bg-card rounded-2xl overflow-hidden">
                            <CardHeader className="border-b border-border/50">
                                <CardTitle className="text-lg flex items-center gap-2">
                                    <Clock className="w-5 h-5 text-purple-500" />
                                    Work Hours & Target Schedule
                                </CardTitle>
                                <CardDescription>Define daily goals and overtime thresholds</CardDescription>
                            </CardHeader>
                            <CardContent className="p-6 space-y-6">
                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
                                    <div className="space-y-2">
                                        <Label className="text-xs font-bold text-muted-foreground uppercase tracking-wider">Standard Hours/Day</Label>
                                        <div className="relative">
                                            <Input
                                                type="number"
                                                value={standardHours}
                                                onChange={(e) => setStandardHours(parseFloat(e.target.value) || 0)}
                                                className="h-11 rounded-xl border-border pl-10 font-bold"
                                            />
                                            <Clock className="w-4 h-4 absolute left-3.5 top-3.5 text-purple-500" />
                                        </div>
                                        <p className="text-[10px] text-muted-foreground/70 font-medium">Minimum hours required for a "Full Day"</p>
                                    </div>
                                    <div className="space-y-2">
                                        <Label className="text-xs font-bold text-muted-foreground uppercase tracking-wider">Overtime Threshold</Label>
                                        <div className="relative">
                                            <Input
                                                type="number"
                                                value={overtimeThreshold}
                                                onChange={(e) => setOvertimeThreshold(parseFloat(e.target.value) || 0)}
                                                className="h-11 rounded-xl border-border pl-10 font-bold"
                                            />
                                            <Sparkles className="w-4 h-4 absolute left-3.5 top-3.5 text-amber-500" />
                                        </div>
                                        <p className="text-[10px] text-muted-foreground/70 font-medium">Hours after which "Coverable Time" starts</p>
                                    </div>
                                </div>

                                <div className="space-y-3 rounded-2xl border border-violet-500/20 bg-violet-500/5 backdrop-blur-md p-4">
                                    <div className="flex items-start justify-between gap-3">
                                        <div className="space-y-1">
                                            <Label htmlFor="dev-tools-enabled" className="text-xs font-bold text-foreground uppercase tracking-wider">
                                                Development Tools
                                            </Label>
                                            <p className="text-xs text-muted-foreground">Allow employees to access Developer Tools in their dashboard.</p>
                                        </div>
                                        <input
                                            id="dev-tools-enabled"
                                            type="checkbox"
                                            checked={devToolsEnabled}
                                            onChange={(e) => setDevToolsEnabled(e.target.checked)}
                                            className="mt-0.5 h-4 w-4 rounded border-input text-violet-650 focus:ring-violet-500"
                                        />
                                    </div>
                                    <Button
                                        onClick={() => saveDevToolsSettingsMutation.mutate({ enabled: devToolsEnabled })}
                                        disabled={saveDevToolsSettingsMutation.isPending}
                                        className="h-9 rounded-xl bg-gradient-to-r from-violet-600 to-indigo-600 hover:from-violet-500 hover:to-indigo-500 shadow-md shadow-violet-500/10 hover:shadow-lg transition duration-200 text-white px-4 w-full sm:w-auto"
                                    >
                                        {saveDevToolsSettingsMutation.isPending ? 'Saving...' : 'Save Developer Tools Setting'}
                                    </Button>
                                </div>


                                <div className="space-y-3">
                                    <Label className="text-xs font-bold text-muted-foreground uppercase tracking-wider">Weekend Days (Automatic Holidays)</Label>
                                    <div className="flex flex-wrap gap-2">
                                        {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((day, idx) => (
                                            <button
                                                key={day}
                                                onClick={() => toggleWeekendDay(idx)}
                                                className={cn(
                                                    "px-4 py-2 rounded-xl text-sm font-bold transition border-2",
                                                    weekendDays.includes(idx)
                                                    ? "bg-purple-500 border-purple-500 text-white shadow-md shadow-purple-200"
                                                    : "bg-muted border-border/50 text-muted-foreground hover:border-input"
                                                )}
                                            >
                                                {day}
                                            </button>
                                        ))}
                                    </div>
                                    <p className="text-xs text-muted-foreground">Selected days will be excluded from task requirements and balance calculations.</p>
                                </div>

                                <div className="flex items-center gap-2 p-3 bg-purple-50 rounded-2xl border border-purple-100">
                                    <div className="w-8 h-8 rounded-lg bg-card flex items-center justify-center shadow-sm">
                                        <CalendarIcon className="w-4 h-4 text-purple-500" />
                                    </div>
                                    <div className="flex-1">
                                        <p className="text-xs font-bold text-foreground">Dynamic Calculation</p>
                                        <p className="text-[10px] text-muted-foreground">This month has <strong>{calculateWorkingDaysCount} working days</strong> based on your selections.</p>
                                    </div>
                                </div>

                                <div className="flex gap-3">
                                    <Button
                                        onClick={() => saveConfigMutation.mutate({ standardHours, overtimeThreshold })}
                                        disabled={saveConfigMutation.isPending}
                                        className="flex-1 h-11 rounded-xl bg-purple-500 hover:bg-purple-600 text-white shadow-sm"
                                    >
                                        <Save className="w-4 h-4 mr-2" />
                                        Save Hours
                                    </Button>
                                    <Button
                                        variant="outline"
                                        onClick={() => saveWeekendDaysMutation.mutate({ weekendDays })}
                                        disabled={saveWeekendDaysMutation.isPending}
                                        className="flex-1 h-11 rounded-xl border-border"
                                    >
                                        Update Weekends
                                    </Button>
                                </div>
                            </CardContent>
                        </Card>

                        {/* Holiday Calendar Management */}
                        <Card className="lg:col-span-6 xl:col-span-4 border border-border/50 shadow-sm bg-card rounded-2xl overflow-hidden">
                            <CardHeader className="border-b border-border/50">
                                <CardTitle className="text-lg flex items-center gap-2">
                                    <CalendarDays className="w-5 h-5 text-violet-550 dark:text-violet-400" />
                                    Holiday Calendar
                                </CardTitle>
                                <CardDescription>Register public holidays and company breaks</CardDescription>
                            </CardHeader>
                            <CardContent className="p-6 space-y-6">
                                <div className="bg-muted rounded-2xl p-4 border border-border/50">
                                    <div className="flex flex-col gap-4">
                                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                            <div className="space-y-2">
                                                <Label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground/70">Holiday Name</Label>
                                                <Input
                                                    placeholder="e.g. Eid-ul-Fitr"
                                                    value={newHolidayName}
                                                    onChange={(e) => setNewHolidayName(e.target.value)}
                                                    className="h-10 rounded-xl bg-card border-border"
                                                />
                                            </div>
                                            <div className="space-y-2">
                                                <Label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground/70">Date Type</Label>
                                                <div className="flex bg-muted p-1 rounded-xl">
                                                    <button 
                                                        onClick={() => setHolidayIsRange(false)}
                                                        className={cn("flex-1 text-[10px] font-bold uppercase py-1.5 rounded-lg transition", !holidayIsRange ? "bg-card text-foreground shadow-sm" : "text-muted-foreground")}
                                                    >Single</button>
                                                    <button 
                                                        onClick={() => setHolidayIsRange(true)}
                                                        className={cn("flex-1 text-[10px] font-bold uppercase py-1.5 rounded-lg transition", holidayIsRange ? "bg-card text-foreground shadow-sm" : "text-muted-foreground")}
                                                    >Range</button>
                                                </div>
                                            </div>
                                        </div>
                                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                            <div className="space-y-2">
                                                <Label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground/70">{holidayIsRange ? 'Start Date' : 'Date'}</Label>
                                                <Input
                                                    type="date"
                                                    value={newHolidayStartDate}
                                                    onChange={(e) => setNewHolidayStartDate(e.target.value)}
                                                    className="h-10 rounded-xl bg-card border-border"
                                                />
                                            </div>
                                            {holidayIsRange && (
                                                <div className="space-y-2">
                                                    <Label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground/70">End Date</Label>
                                                    <Input
                                                        type="date"
                                                        value={newHolidayEndDate}
                                                        onChange={(e) => setNewHolidayEndDate(e.target.value)}
                                                        className="h-10 rounded-xl bg-card border-border"
                                                    />
                                                </div>
                                            )}
                                        </div>
                                        <Button
                                            onClick={() => {
                                                const updated = [...(holidays || [])];
                                                if (holidayIsRange) {
                                                    updated.push({ name: newHolidayName, startDate: newHolidayStartDate, endDate: newHolidayEndDate });
                                                } else {
                                                    updated.push({ name: newHolidayName, date: newHolidayStartDate });
                                                }
                                                updateHolidaysMutation.mutate(updated);
                                                setNewHolidayName('');
                                                setNewHolidayStartDate('');
                                                setNewHolidayEndDate('');
                                            }}
                                            disabled={!newHolidayName || !newHolidayStartDate || (holidayIsRange && !newHolidayEndDate)}
                                            className="w-full h-10 rounded-xl bg-slate-900 hover:bg-slate-800 text-white font-bold"
                                        >
                                            <Plus className="w-4 h-4 mr-2" />
                                            Add to Calendar
                                        </Button>
                                    </div>
                                </div>

                                <div className="space-y-3">
                                    <Label className="text-xs font-bold text-muted-foreground uppercase tracking-wider">Scheduled Holidays</Label>
                                    <div className="max-h-[220px] overflow-y-auto pr-2 custom-scrollbar space-y-2">
                                        {holidays && holidays.length > 0 ? (
                                            holidays.map((h: any, idx: number) => (
                                                <div key={idx} className="flex items-center justify-between p-3 bg-muted rounded-xl border border-border/50 group">
                                                    <div>
                                                        <p className="text-sm font-bold text-foreground">{h.name}</p>
                                                        <p className="text-[10px] font-semibold text-muted-foreground">
                                                            {h.date ? format(new Date(h.date), 'MMMM dd, yyyy') : `${format(new Date(h.startDate), 'MMM dd')} - ${format(new Date(h.endDate), 'MMM dd, yyyy')}`}
                                                        </p>
                                                    </div>
                                                    <Button
                                                        variant="ghost"
                                                        size="icon"
                                                        onClick={() => {
                                                            const updated = (holidays || []).filter((_: any, i: number) => i !== idx);
                                                            updateHolidaysMutation.mutate(updated);
                                                        }}
                                                        className="h-8 w-8 text-muted-foreground/70 hover:text-red-500 transition-colors"
                                                    >
                                                        <X className="w-4 h-4" />
                                                    </Button>
                                                </div>
                                            ))
                                        ) : (
                                            <p className="text-sm text-muted-foreground/70 italic text-center py-4">No holidays configured yet.</p>
                                        )}
                                    </div>
                                </div>
                            </CardContent>
                        </Card>

                        <Card className="lg:col-span-6 xl:col-span-4 border border-border/50 shadow-sm bg-card rounded-2xl overflow-hidden">
                            <CardHeader className="border-b border-indigo-100 bg-linear-to-r from-indigo-50/70 to-cyan-50/60">
                                <div className="flex items-start justify-between gap-3">
                                    <div>
                                        <CardTitle className="text-lg flex items-center gap-2">
                                            <Briefcase className="w-5 h-5 text-indigo-500" />
                                            Department Management
                                        </CardTitle>
                                        <CardDescription className="mt-1">Create, rename, and remove departments used for employee assignment and mentions.</CardDescription>
                                    </div>
                                    <span className="inline-flex items-center rounded-full border border-indigo-200 bg-white px-2.5 py-1 text-xs font-semibold text-indigo-700">
                                        {departments.length} Total
                                    </span>
                                </div>
                            </CardHeader>
                            <CardContent className="p-6 space-y-5">
                                <div className="space-y-2">
                                    <Label className="text-sm font-medium text-foreground">Add Department</Label>
                                    <div className="flex flex-col sm:flex-row gap-2">
                                        <Input
                                            value={newDepartmentName}
                                            onChange={(e) => setNewDepartmentName(e.target.value)}
                                            placeholder="e.g. Programming"
                                            className="h-10 rounded-xl border-border flex-1"
                                        />
                                        <Button
                                            onClick={() => createDepartmentMutation.mutate(newDepartmentName)}
                                            disabled={!newDepartmentName.trim() || createDepartmentMutation.isPending}
                                            className="h-10 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white sm:min-w-[96px]"
                                        >
                                            {createDepartmentMutation.isPending ? 'Adding...' : 'Add'}
                                        </Button>
                                    </div>
                                </div>

                                <div className="space-y-2">
                                    <Label className="text-sm font-medium text-foreground">Existing Departments</Label>
                                    {departmentsQueryError && (
                                        <p className="text-xs text-red-600 bg-red-50 border border-red-100 rounded-lg px-2.5 py-2">
                                            Could not load departments from server.
                                        </p>
                                    )}
                                    <div className="max-h-[300px] overflow-y-auto pr-2 space-y-2">
                                        {departments.length === 0 ? (
                                            <div className="rounded-xl border border-dashed border-border bg-muted py-6 px-4 text-center">
                                                <Briefcase className="w-5 h-5 mx-auto mb-2 text-muted-foreground/70" />
                                                <p className="text-sm text-muted-foreground italic">No departments created yet.</p>
                                            </div>
                                        ) : (
                                            departments.map((dept) => (
                                                <div key={dept.id} className="flex items-center gap-2 rounded-xl border border-border/50 bg-card p-2.5 shadow-sm">
                                                    {editingDepartmentId === dept.id ? (
                                                        <Input
                                                            value={editingDepartmentName}
                                                            onChange={(e) => setEditingDepartmentName(e.target.value)}
                                                            className="h-9 rounded-lg border-border bg-muted"
                                                        />
                                                    ) : (
                                                        <p className="text-sm font-semibold text-foreground px-1">{dept.name}</p>
                                                    )}

                                                    <div className="ml-auto flex items-center gap-1">
                                                        {editingDepartmentId === dept.id ? (
                                                            <>
                                                                <Button
                                                                    size="icon"
                                                                    variant="ghost"
                                                                    className="h-8 w-8 text-green-600 hover:bg-green-50"
                                                                    onClick={() => updateDepartmentMutation.mutate({ id: dept.id, name: editingDepartmentName })}
                                                                    disabled={!editingDepartmentName.trim() || updateDepartmentMutation.isPending}
                                                                    title="Save"
                                                                >
                                                                    <Check className="w-4 h-4" />
                                                                </Button>
                                                                <Button
                                                                    size="icon"
                                                                    variant="ghost"
                                                                    className="h-8 w-8 text-muted-foreground hover:bg-secondary-light"
                                                                    onClick={() => {
                                                                        setEditingDepartmentId(null);
                                                                        setEditingDepartmentName('');
                                                                    }}
                                                                    title="Cancel"
                                                                >
                                                                    <X className="w-4 h-4" />
                                                                </Button>
                                                            </>
                                                        ) : (
                                                            <>
                                                                <Button
                                                                    size="icon"
                                                                    variant="ghost"
                                                                    className="h-8 w-8 text-muted-foreground hover:bg-indigo-50 hover:text-indigo-700"
                                                                    onClick={() => {
                                                                        setEditingDepartmentId(dept.id);
                                                                        setEditingDepartmentName(dept.name);
                                                                    }}
                                                                    title="Rename"
                                                                >
                                                                    <Edit3 className="w-4 h-4" />
                                                                </Button>
                                                                <Button
                                                                    size="icon"
                                                                    variant="ghost"
                                                                    className="h-8 w-8 text-red-500 hover:bg-red-50"
                                                                    onClick={() => {
                                                                        if (window.confirm(`Delete department "${dept.name}"?`)) {
                                                                            deleteDepartmentMutation.mutate(dept.id);
                                                                        }
                                                                    }}
                                                                    disabled={deleteDepartmentMutation.isPending}
                                                                    title="Delete"
                                                                >
                                                                    <Trash2 className="w-4 h-4" />
                                                                </Button>
                                                            </>
                                                        )}
                                                    </div>
                                                </div>
                                            ))
                                        )}
                                    </div>
                                </div>
                            </CardContent>
                        </Card>

                        {/* Paid Leave Configuration */}
                        <Card className="lg:col-span-6 xl:col-span-4 border border-border/50 shadow-sm bg-card rounded-2xl overflow-hidden">
                            <CardHeader className="border-b border-border/50">
                                <CardTitle className="text-lg flex items-center gap-2">
                                    <Plane className="w-5 h-5 text-purple-500" />
                                    Paid Leave Configuration
                                </CardTitle>
                                <CardDescription>Manage global leave quotas and synchronisation</CardDescription>
                            </CardHeader>
                            <CardContent className="p-6 space-y-6">
                                <div className="space-y-2">
                                    <Label className="text-sm font-medium text-foreground">Annual Paid Leave Quota (Days)</Label>
                                    <Input
                                        type="number"
                                        min="0"
                                        value={paidLeaveDays}
                                        onChange={(e) => setPaidLeaveDays(parseInt(e.target.value) || 0)}
                                        className="h-10 rounded-xl border-border font-bold"
                                    />
                                    <p className="text-[10px] text-muted-foreground/70">This value defines the starting leave balance for all new users.</p>
                                </div>

                                <div className="flex items-center gap-3 p-4 rounded-2xl border border-amber-100 bg-amber-50/50">
                                    <div className="flex items-center h-5">
                                        <input
                                            id="sync-all-balances"
                                            type="checkbox"
                                            checked={syncPaidLeaveBalance}
                                            onChange={(e) => setSyncPaidLeaveBalance(e.target.checked)}
                                            className="w-4 h-4 rounded border-input text-amber-600 focus:ring-amber-500"
                                        />
                                    </div>
                                    <div className="ml-1 text-sm">
                                        <Label htmlFor="sync-all-balances" className="font-bold text-amber-900">Synchronize All User Balances</Label>
                                        <p className="text-[10px] text-amber-700">If checked, saving will immediately update ALL active users to this new quota.</p>
                                    </div>
                                </div>

                                <Button
                                    onClick={() => savePaidLeaveSettingsMutation.mutate({
                                        days: paidLeaveDays,
                                        syncAll: syncPaidLeaveBalance
                                    })}
                                    disabled={savePaidLeaveSettingsMutation.isPending}
                                    className="w-full h-11 rounded-xl bg-slate-900 text-white font-bold shadow-lg shadow-slate-100"
                                >
                                    {savePaidLeaveSettingsMutation.isPending ? 'Syncing...' : 'Update Leave Settings'}
                                </Button>
                            </CardContent>
                        </Card>

                        <Card className="lg:col-span-6 xl:col-span-4 border border-red-100 shadow-sm bg-card rounded-2xl overflow-hidden">
                            <CardHeader className="border-b border-red-50 bg-red-50/30">
                                <CardTitle className="text-lg flex items-center gap-2 text-red-700">
                                    <Trash2 className="w-5 h-5" />
                                    Bulk Data Actions
                                </CardTitle>
                                <CardDescription>Dangerous operations that affect all employees</CardDescription>
                            </CardHeader>
                            <CardContent className="p-6 space-y-4">
                                <div className="space-y-3">
                                    <div className="flex items-center justify-between gap-4 p-3 rounded-xl border border-border/50 bg-muted/50">
                                        <div className="flex-1">
                                            <p className="text-sm font-bold text-foreground">Clear All Balances</p>
                                            <p className="text-[10px] text-muted-foreground font-medium">Reset minutes balance to 0 for all employees.</p>
                                        </div>
                                        <Button 
                                            variant="destructive" 
                                            size="sm"
                                            className="h-9 rounded-xl px-4 font-bold shadow-sm shadow-red-100"
                                            onClick={() => {
                                                if (window.confirm("Are you sure you want to reset ALL employee balances to 0? This cannot be undone.")) {
                                                    resetAllMinutesBalancesMutation.mutate();
                                                }
                                            }}
                                            disabled={resetAllMinutesBalancesMutation.isPending}
                                        >
                                            {resetAllMinutesBalancesMutation.isPending ? 'Clearing...' : 'Reset All'}
                                        </Button>
                                    </div>

                                    <div className="flex items-center justify-between gap-4 p-3 rounded-xl border border-border/50 bg-muted/50">
                                        <div className="flex-1">
                                            <p className="text-sm font-bold text-foreground">Clear Skipped Days</p>
                                            <p className="text-[10px] text-muted-foreground font-medium">Clear all recorded skipped days and restore balances.</p>
                                        </div>
                                        <Button 
                                            variant="outline" 
                                            size="sm"
                                            className="h-9 rounded-xl px-4 font-bold border-red-200 text-red-600 hover:bg-red-50"
                                            onClick={() => {
                                                if (window.confirm("Are you sure you want to clear ALL skipped days history? This will restore penalized minutes.")) {
                                                    resetAllSkippedDaysMutation.mutate();
                                                }
                                            }}
                                            disabled={resetAllSkippedDaysMutation.isPending}
                                        >
                                            {resetAllSkippedDaysMutation.isPending ? 'Clearing...' : 'Clear All'}
                                        </Button>
                                    </div>

                                    <div className="flex items-center justify-between gap-4 p-3 rounded-xl border border-border/50 bg-muted/50">
                                        <div className="flex-1">
                                            <p className="text-sm font-bold text-foreground">Clear Paid Leaves</p>
                                            <p className="text-[10px] text-muted-foreground font-medium">Reset all employee paid leave balances to 0.</p>
                                        </div>
                                        <Button 
                                            variant="outline" 
                                            size="sm"
                                            className="h-9 rounded-xl px-4 font-bold border-red-200 text-red-600 hover:bg-red-50"
                                            onClick={() => {
                                                if (window.confirm("Are you sure you want to reset ALL paid leave balances to 0?")) {
                                                    resetAllPaidLeaveBalancesMutation.mutate();
                                                }
                                            }}
                                            disabled={resetAllPaidLeaveBalancesMutation.isPending}
                                        >
                                            {resetAllPaidLeaveBalancesMutation.isPending ? 'Clearing...' : 'Clear All'}
                                        </Button>
                                    </div>
                                </div>

                                <div className="mt-2 p-3 rounded-xl bg-red-50 border border-red-100 flex gap-3">
                                    <AlertCircle className="w-5 h-5 text-red-600 shrink-0" />
                                    <p className="text-[10px] text-red-800 font-medium leading-relaxed">
                                        <strong>Warning:</strong> These actions are irreversible and will immediately affect all employees in your company. Use with caution.
                                    </p>
                                </div>
                            </CardContent>
                        </Card>

                                <Card className="lg:col-span-6 xl:col-span-4 border border-border/50 shadow-sm bg-card rounded-2xl overflow-hidden pointer-events-auto">
                                <CardHeader className="border-b border-border/50">
                                            <CardTitle className="text-lg flex items-center gap-2">
                                                <Send className="w-5 h-5 text-purple-500" />
                                                Admin Telegram Integration
                                            </CardTitle>
                                            <CardDescription>Configure how you receive real-time alerts</CardDescription>
                                        </CardHeader>
                                        <CardContent className="pt-5">
                                            <div className="space-y-4">
                                                <div className={cn(
                                                    "flex items-center gap-4 p-4 rounded-2xl border",
                                                    user?.telegram_chat_id ? "bg-green-50 border-green-100" : "bg-purple-50 border-purple-100"
                                                )}>
                                                    <div className={cn(
                                                        "w-10 h-10 rounded-xl flex items-center justify-center shadow-sm shrink-0",
                                                        user?.telegram_chat_id ? "bg-green-100 text-green-600" : "bg-purple-100 text-purple-600"
                                                    )}>
                                                        <Send className="w-5 h-5" />
                                                    </div>
                                                    <div>
                                                        <h4 className="font-bold text-foreground text-sm">
                                                            {user?.telegram_chat_id ? 'Telegram Bot Connected' : 'Bot Not Linked'}
                                                        </h4>
                                                        <p className="text-xs text-muted-foreground">
                                                            {user?.telegram_chat_id
                                                                ? 'Notification delivery is active for your account.'
                                                                : 'Link your Telegram to receive and manage leave requests.'}
                                                        </p>
                                                    </div>
                                                </div>
                                                <div className="flex gap-2">
                                                    <Button
                                                        onClick={async () => {
                                                            if (user?.telegram_chat_id) {
                                                                // Future: Test notification logic
                                                                return;
                                                            }
                                                            try {
                                                                const res = await api.get('/auth/telegram-token');
                                                                const botUsername = (user as any).telegramBotUsername ;
                                                                window.open(`https://t.me/${botUsername}?start=${res.data.token}`, '_blank');
                                                            } catch (err) {
                                                                console.error('Failed to get TG linking token:', err);
                                                                const botUsername = (user as any).telegramBotUsername ;
                                                                window.open(`https://t.me/${botUsername}?start=auth`, '_blank');
                                                            }
                                                        }}
                                                        className="flex-1 h-10 rounded-xl font-bold bg-purple-500 text-white hover:bg-purple-600 shadow-sm transition active:scale-95"
                                                    >
                                                        {user?.telegram_chat_id ? 'Test Notification' : 'Connect Telegram'}
                                                    </Button>
                                                    <Button
                                                        variant="outline"
                                                        onClick={() => navigate('/profile')}
                                                        className="flex-1 h-10 rounded-xl font-bold border-border text-muted-foreground hover:bg-muted transition"
                                                    >
                                                        Go to Profile
                                                    </Button>
                                                </div>
                                                <div className="p-3 rounded-xl bg-muted border border-border/50">
                                                    <h5 className="text-xs font-bold text-muted-foreground uppercase tracking-wider mb-2">Instructions</h5>
                                                    <ul className="text-xs text-muted-foreground space-y-1.5 list-disc pl-4">
                                                        <li>Click <strong>Connect Telegram</strong> to open the bot.</li>
                                                        <li>Press <strong>START</strong> in the bot to link your account.</li>
                                                        <li>Once linked, you will receive interactive notifications for every new leave request.</li>
                                                        <li>You can approve or reject leaves directly from the Telegram chat.</li>
                                                    </ul>
                                                </div>
                                            </div>
                                        </CardContent>
                                    </Card>

                                    {/* Data Retention Card */}
                        <Card className="lg:col-span-6 xl:col-span-4 border border-border/50 shadow-sm bg-card rounded-2xl overflow-hidden">
                                        <CardHeader className="border-b border-border/50">
                                            <CardTitle className="text-lg flex items-center gap-2">
                                                <Trash2 className="w-5 h-5 text-purple-500" />
                                                Data Retention
                                            </CardTitle>
                                        </CardHeader>
                                        <CardContent className="pt-5">
                                            <div className="space-y-4">
                                                <div className="bg-amber-50 rounded-xl p-4 border border-amber-100">
                                                    <div className="flex gap-2">
                                                        <AlertCircle className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
                                                        <div className="space-y-1">
                                                            <p className="text-sm font-medium text-amber-800">Automatic Cleanup</p>
                                                            <p className="text-xs text-amber-700 leading-relaxed">
                                                                Attachment files older than the specified days will be permanently deleted to save space. Message text will remain.
                                                                <br />
                                                                <strong>Note:</strong> Deletion happens daily at 4:00 AM.
                                                            </p>
                                                        </div>
                                                    </div>
                                                </div>
                                                <div className="space-y-2">
                                                    <Label htmlFor="retention" className="text-sm font-medium text-foreground">Retention Period (Days)</Label>
                                                    <Input
                                                        id="retention"
                                                        type="number"
                                                        min="1"
                                                        value={attachmentRetentionDays}
                                                        onChange={(e) => setAttachmentRetentionDays(parseInt(e.target.value) || 0)}
                                                        className="h-10 rounded-xl border-border"
                                                    />
                                                </div>
                                                <div className="space-y-2">
                                                    <Label htmlFor="cleanup-time" className="text-sm font-medium text-foreground">Cleanup Execution Time</Label>
                                                    <Input
                                                        id="cleanup-time"
                                                        type="time"
                                                        value={attachmentCleanupTime}
                                                        onChange={(e) => setAttachmentCleanupTime(e.target.value)}
                                                        className="h-10 rounded-xl border-border"
                                                    />
                                                </div>
                                                <p className="text-xs text-muted-foreground">Cleanup will run daily at the specified time ({attachmentCleanupTime}).</p>
                                                <Button
                                                    onClick={() => saveAttachmentSettingsMutation.mutate({
                                                        retention_days: attachmentRetentionDays,
                                                        cleanup_time: attachmentCleanupTime
                                                    })}
                                                    disabled={attachmentRetentionDays < 1 || !attachmentCleanupTime || saveAttachmentSettingsMutation.isPending}
                                                    className="w-full h-10 rounded-xl bg-purple-500 hover:bg-purple-600 text-white"
                                                >
                                                    {saveAttachmentSettingsMutation.isPending ? 'Saving...' : 'Save Retention Settings'}
                                                </Button>
                                            </div>
                                        </CardContent>
                                    </Card>

                                    {/* Admin Communication Hub ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â  spans 1 col on the right in a 3-col grid */}
                                    <Card className="lg:col-span-12 border border-border/50 shadow-sm bg-card rounded-2xl overflow-hidden">
                                        <CardHeader className="border-b border-border/50">
                                            <div className="flex items-center justify-between">
                                                <CardTitle className="text-lg flex items-center gap-2">
                                                    <BellRing className="w-5 h-5 text-purple-500" />
                                                    Communication Hub
                                                </CardTitle>
                                                <div className="flex items-center gap-3">
                                                    <div className="flex items-center gap-1.5">
                                                        <input
                                                            type="checkbox"
                                                            id="notifEnabled"
                                                            checked={notifEnabled}
                                                            onChange={(e) => setNotifEnabled(e.target.checked)}
                                                            className="w-4 h-4 rounded border-input text-purple-600 focus:ring-purple-500 transition cursor-pointer"
                                                        />
                                                        <Label htmlFor="notifEnabled" className="text-xs font-bold text-foreground cursor-pointer">Enabled</Label>
                                                    </div>
                                                    <Dialog>
                                                        <DialogTrigger asChild>
                                                            <Button variant="outline" size="sm" className="rounded-xl border-border hover:bg-muted h-8 text-xs px-3">
                                                                <Settings className="w-3 h-3 mr-1" />
                                                                SMTP
                                                            </Button>
                                                        </DialogTrigger>
                                                        <DialogContent className="bg-card">
                                                            <DialogHeader>
                                                                <DialogTitle>Email Server Settings</DialogTitle>
                                                                <DialogDescription>Configure SMTP settings for automated report delivery</DialogDescription>
                                                            </DialogHeader>
                                                            <div className="space-y-4 py-4">
                                                                <div className="grid grid-cols-2 gap-4">
                                                                    <div className="space-y-2">
                                                                        <Label className="text-xs">SMTP Host</Label>
                                                                        <Input
                                                                            value={smtpConfig.smtpHost}
                                                                            onChange={(e) => setSmtpConfig({ ...smtpConfig, smtpHost: e.target.value })}
                                                                            className="h-10 rounded-xl border-border"
                                                                        />
                                                                    </div>
                                                                    <div className="space-y-2">
                                                                        <Label className="text-xs">SMTP Port</Label>
                                                                        <Input
                                                                            value={smtpConfig.smtpPort}
                                                                            onChange={(e) => setSmtpConfig({ ...smtpConfig, smtpPort: e.target.value })}
                                                                            className="h-10 rounded-xl border-border"
                                                                        />
                                                                    </div>
                                                                </div>
                                                                <div className="grid grid-cols-2 gap-4">
                                                                    <div className="space-y-2">
                                                                        <Label className="text-xs">SMTP User</Label>
                                                                        <Input
                                                                            value={smtpConfig.smtpUser}
                                                                            onChange={(e) => setSmtpConfig({ ...smtpConfig, smtpUser: e.target.value })}
                                                                            className="h-10 rounded-xl border-border"
                                                                        />
                                                                    </div>
                                                                    <div className="space-y-2">
                                                                        <Label className="text-xs">SMTP Pass</Label>
                                                                        <Input
                                                                            type="password"
                                                                            value={smtpConfig.smtpPass}
                                                                            onChange={(e) => setSmtpConfig({ ...smtpConfig, smtpPass: e.target.value })}
                                                                            className="h-10 rounded-xl border-border"
                                                                        />
                                                                    </div>
                                                                </div>
                                                            </div>
                                                        </DialogContent>
                                                    </Dialog>
                                                </div>
                                            </div>
                                            <CardDescription>Task summaries and automated PDF reports</CardDescription>
                                        </CardHeader>
                                        <CardContent className="pt-5">
                                            <div className="space-y-5">
                                                {/* Global Schedule & PDF */}
                                                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                                    <div className="flex items-center justify-between p-3 rounded-xl border border-purple-100 bg-purple-50/30">
                                                        <div>
                                                            <Label className="text-sm font-bold text-foreground flex items-center gap-1.5">
                                                                <Clock className="w-4 h-4 text-purple-500" />
                                                                Global Schedule
                                                            </Label>
                                                            <p className="text-xs text-muted-foreground">Trigger time for all communications</p>
                                                        </div>
                                                        <Input
                                                            type="time"
                                                            value={notifScheduleTime}
                                                            onChange={(e) => setNotifScheduleTime(e.target.value)}
                                                            className="w-28 h-10 rounded-xl border-border text-center font-bold bg-card shadow-sm"
                                                        />
                                                    </div>
                                                    <div className="flex items-center justify-between p-3 rounded-xl border border-violet-500/20 bg-violet-500/5 backdrop-blur-md">
                                                        <div>
                                                            <Label className="text-sm font-bold text-foreground flex items-center gap-1.5">
                                                                <FileText className="w-4 h-4 text-violet-550 dark:text-violet-400" />
                                                                PDF Reporting
                                                            </Label>
                                                            <p className="text-xs text-muted-foreground">Attach automated PDF to email</p>
                                                        </div>
                                                        <input
                                                            type="checkbox"
                                                            id="notifEmailEnabled"
                                                            checked={notifEmailEnabled}
                                                            onChange={(e) => setNotifEmailEnabled(e.target.checked)}
                                                            className="w-5 h-5 rounded-lg border-input text-violet-650 focus:ring-violet-500 transition cursor-pointer"
                                                        />
                                                    </div>
                                                </div>

                                                <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                                                    {/* Email */}
                                                    <div className="space-y-2 bg-muted/50 p-3 rounded-xl border border-border/50">
                                                        <div className="flex items-center gap-2">
                                                            <div className="w-7 h-7 rounded-lg bg-orange-100 flex items-center justify-center">
                                                                <Mail className="w-3.5 h-3.5 text-orange-600" />
                                                            </div>
                                                            <h4 className="font-bold text-foreground text-sm">Email</h4>
                                                        </div>
                                                        <div className="flex gap-2">
                                                            <Input
                                                                placeholder="email@example.com"
                                                                value={newRecipientInput}
                                                                onChange={(e) => setNewRecipientInput(e.target.value)}
                                                                onKeyDown={(e) => {
                                                                    if (e.key === 'Enter') {
                                                                        e.preventDefault();
                                                                        addNotificationRecipientEmail();
                                                                    }
                                                                }}
                                                                className="h-9 rounded-xl border-border text-sm"
                                                            />
                                                            <Button
                                                                onClick={addNotificationRecipientEmail}
                                                                size="icon"
                                                                className="h-9 w-9 rounded-xl bg-orange-500 hover:bg-orange-600 px-0 shrink-0"
                                                            >
                                                                <Plus className="w-4 h-4" />
                                                            </Button>
                                                        </div>
                                                        <div className="space-y-2 p-2 bg-card border border-border/50 rounded-lg">
                                                            <Label className="text-[11px] font-semibold text-foreground">Allowed Email Endings</Label>
                                                            <select
                                                                value={notifEmailDomainMode}
                                                                onChange={(e) => handleEmailDomainModeChange(e.target.value === 'allowlist' ? 'allowlist' : 'all')}
                                                                className="h-8 w-full rounded-lg border border-border bg-card px-2 text-xs"
                                                            >
                                                                <option value="all">Allow all domains</option>
                                                                <option value="allowlist">Allow selected endings only</option>
                                                            </select>

                                                            {notifEmailDomainMode === 'allowlist' && (
                                                                <>
                                                                    <div className="flex gap-2">
                                                                        <Input
                                                                            placeholder="royalbengal.ai"
                                                                            value={newAllowedDomainInput}
                                                                            onChange={(e) => setNewAllowedDomainInput(e.target.value)}
                                                                            onKeyDown={(e) => {
                                                                                if (e.key === 'Enter') {
                                                                                    e.preventDefault();
                                                                                    addAllowedEmailDomain();
                                                                                }
                                                                            }}
                                                                            className="h-8 rounded-lg border-border text-xs"
                                                                        />
                                                                        <Button
                                                                            onClick={addAllowedEmailDomain}
                                                                            size="icon"
                                                                            className="h-8 w-8 rounded-lg bg-slate-700 hover:bg-slate-800 px-0 shrink-0"
                                                                        >
                                                                            <Plus className="w-3.5 h-3.5" />
                                                                        </Button>
                                                                    </div>

                                                                    <div className="space-y-1 max-h-[82px] overflow-y-auto">
                                                                        {notifAllowedEmailDomains.map((domain) => (
                                                                            <div key={domain} className="flex items-center justify-between p-1.5 border border-border/50 rounded-md">
                                                                                <span className="text-[11px] text-foreground">@{domain}</span>
                                                                                <button
                                                                                    onClick={() => setNotifAllowedEmailDomains(notifAllowedEmailDomains.filter((d) => d !== domain))}
                                                                                    className="text-muted-foreground/70 hover:text-red-500 transition-colors"
                                                                                >
                                                                                    <Trash2 className="w-3 h-3" />
                                                                                </button>
                                                                            </div>
                                                                        ))}
                                                                        {notifAllowedEmailDomains.length === 0 && (
                                                                            <p className="text-[10px] text-muted-foreground/70 italic text-center py-1">No domain endings added</p>
                                                                        )}
                                                                    </div>
                                                                </>
                                                            )}
                                                        </div>
                                                        <div className="space-y-1 max-h-[100px] overflow-y-auto">
                                                            {notifRecipientEmails.map(email => (
                                                                <div key={email} className="flex items-center justify-between p-2 bg-card border border-border/50 rounded-lg group">
                                                                    <span className="text-xs font-medium text-muted-foreground truncate mr-2">{email}</span>
                                                                    <button onClick={() => setNotifRecipientEmails(notifRecipientEmails.filter(e => e !== email))} className="text-muted-foreground/70 hover:text-red-500 transition-colors shrink-0">
                                                                        <Trash2 className="w-3.5 h-3.5" />
                                                                    </button>
                                                                </div>
                                                            ))}
                                                            {notifRecipientEmails.length === 0 && <p className="text-[10px] text-muted-foreground/70 italic text-center py-1">No emails added</p>}
                                                        </div>
                                                    </div>

                                                    {/* WhatsApp */}
                                                    <div className="space-y-2 bg-muted/50 p-3 rounded-xl border border-border/50">
                                                        <div className="flex items-center gap-2">
                                                            <div className="w-7 h-7 rounded-lg bg-green-100 flex items-center justify-center">
                                                                <MessageSquare className="w-3.5 h-3.5 text-green-600" />
                                                            </div>
                                                            <h4 className="font-bold text-foreground text-sm">WhatsApp</h4>
                                                        </div>
                                                        <div className="flex gap-2">
                                                            <PhoneInput
                                                                placeholder="+8801..."
                                                                value={newWhatsAppRecipientInput}
                                                                onChange={(val) => setNewWhatsAppRecipientInput(val)}
                                                                className="flex-1 min-w-0"
                                                            />
                                                            <Button
                                                                onClick={() => {
                                                                    if (newWhatsAppRecipientInput) {
                                                                        const cleaned = normalizePhone(newWhatsAppRecipientInput);
                                                                        if (!notifWhatsAppNumbers.includes(cleaned)) {
                                                                            setNotifWhatsAppNumbers([...notifWhatsAppNumbers, cleaned]);
                                                                            setNewWhatsAppRecipientInput('');
                                                                        }
                                                                    }
                                                                }}
                                                                size="icon"
                                                                className="h-9 w-9 rounded-xl bg-green-500 hover:bg-green-600 px-0 shrink-0"
                                                            >
                                                                <Plus className="w-4 h-4" />
                                                            </Button>
                                                        </div>
                                                        <div className="space-y-1 max-h-[80px] overflow-y-auto">
                                                            {notifWhatsAppNumbers.map(num => (
                                                                <div key={num} className="flex items-center justify-between p-2 bg-card border border-border/50 rounded-lg">
                                                                    <span className="text-xs font-medium text-muted-foreground truncate mr-2">{num}</span>
                                                                    <button onClick={() => setNotifWhatsAppNumbers(notifWhatsAppNumbers.filter(n => n !== num))} className="text-muted-foreground/70 hover:text-red-500 transition-colors shrink-0">
                                                                        <Trash2 className="w-3.5 h-3.5" />
                                                                    </button>
                                                                </div>
                                                            ))}
                                                            {notifWhatsAppNumbers.length === 0 && <p className="text-[10px] text-muted-foreground/70 italic text-center py-1">No numbers added</p>}
                                                        </div>
                                                    </div>

                                                    {/* Telegram */}
                                                    <div className="space-y-2 bg-muted/50 p-3 rounded-xl border border-border/50">
                                                        <div className="flex items-center gap-2">
                                                            <div className="w-7 h-7 rounded-lg bg-sky-500/10 dark:bg-sky-500/5 border border-sky-500/20 flex items-center justify-center">
                                                                <Send className="w-3.5 h-3.5 text-sky-500 dark:text-sky-400" />
                                                            </div>
                                                            <h4 className="font-bold text-foreground text-sm">Telegram</h4>
                                                        </div>
                                                        <div className="flex gap-2">
                                                            <PhoneInput
                                                                placeholder="+880..."
                                                                value={newNotifTelegram}
                                                                onChange={(val) => setNewNotifTelegram(val || '')}
                                                                className="flex-1 min-w-0"
                                                            />
                                                            <Button
                                                                onClick={() => {
                                                                    if (newNotifTelegram) {
                                                                        const cleaned = normalizePhone(newNotifTelegram);
                                                                        if (cleaned && !notifTelegramChatIds.includes(cleaned)) {
                                                                            setNotifTelegramChatIds([...notifTelegramChatIds, cleaned]);
                                                                            setNotifTelegramChatIdLabels((prev) => ({
                                                                                ...prev,
                                                                                [cleaned]: cleaned
                                                                            }));
                                                                            setNewNotifTelegram('');
                                                                        }
                                                                    }
                                                                }}
                                                                size="icon"
                                                                className="h-9 w-9 rounded-xl bg-gradient-to-r from-violet-600 to-indigo-600 hover:from-violet-500 hover:to-indigo-500 text-white shadow-md shadow-violet-500/10 hover:shadow-lg transition duration-200 px-0 shrink-0"
                                                            >
                                                                <Plus className="w-4 h-4" />
                                                            </Button>
                                                        </div>
                                                        <div className="space-y-1 max-h-[120px] overflow-y-auto pr-2 custom-scrollbar">
                                                            {notifTelegramChatIds.map(id => (
                                                                <div key={id} className="flex items-center justify-between p-2 bg-card border border-border/50 rounded-lg">
                                                                    <div className="min-w-0 mr-2">
                                                                        <span className="block text-xs font-medium text-foreground break-all">{getTelegramRecipientDisplay(id)}</span>
                                                                    </div>
                                                                    <button onClick={() => removeTelegramRecipient(id)} className="text-muted-foreground/70 hover:text-red-500 transition-colors shrink-0">
                                                                        <Trash2 className="w-3.5 h-3.5" />
                                                                    </button>
                                                                </div>
                                                            ))}
                                                            {notifTelegramChatIds.length === 0 && <p className="text-[10px] text-muted-foreground/70 italic text-center py-1">No numbers added</p>}
                                                        </div>
                                                    </div>
                                                </div>

                                                <Button
                                                    onClick={() => {
                                                        if (notifEmailDomainMode === 'allowlist' && notifAllowedEmailDomains.length === 0) {
                                                            setToast({ message: 'Add at least one allowed email ending or switch to Allow all', type: 'error' });
                                                            return;
                                                        }

                                                        const invalidRecipient = notifRecipientEmails.find((email) => !isEmailAllowedByClientPolicy(email));
                                                        if (invalidRecipient) {
                                                            setToast({ message: `Recipient email not allowed by current policy: ${invalidRecipient}`, type: 'error' });
                                                            return;
                                                        }

                                                        saveNotificationSettingsMutation.mutate({
                                                            enabled: notifEnabled,
                                                            emailEnabled: notifEmailEnabled,
                                                            recipientEmails: notifRecipientEmails,
                                                            emailDomainMode: notifEmailDomainMode,
                                                            allowedEmailDomains: notifAllowedEmailDomains,
                                                            whatsappNumbers: notifWhatsAppNumbers,
                                                            telegramChatIds: notifTelegramChatIds,
                                                            telegramChatIdLabels: notifTelegramChatIdLabels,
                                                            scheduleTime: notifScheduleTime,
                                                            timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
                                                            ...smtpConfig
                                                        });
                                                    }}
                                                    disabled={saveNotificationSettingsMutation.isPending}
                                                    className="w-full h-12 rounded-xl bg-gradient-to-r from-violet-600 to-indigo-600 hover:from-violet-500 hover:to-indigo-500 text-white font-bold shadow-lg shadow-violet-500/10 hover:shadow-violet-500/25 transition active:scale-[0.98]"
                                                >
                                                    {saveNotificationSettingsMutation.isPending ? (
                                                        <div className="flex items-center gap-2">
                                                            <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                                                            Updating...
                                                        </div>
                                                    ) : (
                                                        <>
                                                            <Save className="w-5 h-5 mr-2" />
                                                            Save All Communication Settings
                                                        </>
                                                    )}
                                                </Button>
                                            </div>
                                        </CardContent>
                                    </Card>

                                    {/* Action Hub - Bulk Actions */}
                                    <Card className="lg:col-span-12 border border-border/50 shadow-sm bg-card rounded-2xl overflow-hidden">
                                        <CardHeader className="border-b border-border/50">
                                            <CardTitle className="text-lg flex items-center gap-2 text-red-600">
                                                <Shield className="w-5 h-5" />
                                                Administrative Action Hub
                                            </CardTitle>
                                            <CardDescription>Destructive bulk actions for system maintenance</CardDescription>
                                        </CardHeader>
                                        <CardContent className="p-6">
                                            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
                                                <Button
                                                    variant="outline"
                                                    onClick={() => {
                                                        if (window.confirm('Are you absolutely sure? This will set all user time balances to zero.')) {
                                                            resetAllMinutesBalancesMutation.mutate();
                                                        }
                                                    }}
                                                    className="h-auto py-4 flex-col gap-2 rounded-2xl border-red-100 hover:bg-red-50 text-red-700"
                                                >
                                                    <RotateCcw className="w-5 h-5" />
                                                    <div className="text-center">
                                                        <p className="font-bold">Reset Balances</p>
                                                        <p className="text-[10px] opacity-70">Clear all time balances</p>
                                                    </div>
                                                </Button>
                                                <Button
                                                    variant="outline"
                                                    onClick={() => {
                                                        if (window.confirm('Clear all recorded skipped days for everyone?')) {
                                                            resetAllSkippedDaysMutation.mutate();
                                                        }
                                                    }}
                                                    className="h-auto py-4 flex-col gap-2 rounded-2xl border-orange-100 hover:bg-orange-50 text-orange-700"
                                                >
                                                    <Trash2 className="w-5 h-5" />
                                                    <div className="text-center">
                                                        <p className="font-bold">Clear Skipped Days</p>
                                                        <p className="text-[10px] opacity-70">Wipe all missed day logs</p>
                                                    </div>
                                                </Button>
                                                <Button
                                                    variant="outline"
                                                    onClick={() => {
                                                        if (window.confirm('Reset all paid leave balances to their default starting value?')) {
                                                            resetAllPaidLeaveBalancesMutation.mutate();
                                                        }
                                                    }}
                                                    className="h-auto py-4 flex-col gap-2 rounded-2xl border border-violet-500/20 hover:bg-violet-500/10 text-violet-750 dark:text-violet-400"
                                                >
                                                    <Sparkles className="w-5 h-5" />
                                                    <div className="text-center">
                                                        <p className="font-bold">Reset Paid Leaves</p>
                                                        <p className="text-[10px] opacity-70">Restore default entitlements</p>
                                                    </div>
                                                </Button>
                                            </div>
                                        </CardContent>
                                    </Card>

                        </div>
                    </TabsContent>
                )}
                    <TabsContent value="audit-logs" className="space-y-6 focus-visible:outline-none">
                        <AuditLogs />
                    </TabsContent>

                    <TabsContent value="api-keys" className="space-y-6 focus-visible:outline-none">
                        <ApiKeys />
                    </TabsContent>

                    <TabsContent value="payroll" className="space-y-6 focus-visible:outline-none">
                        <PayrollDashboard />
                    </TabsContent>

                    <TabsContent value="knowledge-base" className="space-y-6 focus-visible:outline-none">
                        <KnowledgeBase />
                    </TabsContent>

                    <TabsContent value="kpis" className="space-y-6 focus-visible:outline-none">
                        <ModeratorKPIs />
                    </TabsContent>

                    <TabsContent value="approvals" className="space-y-6 focus-visible:outline-none">
                        <ApprovalWorkflows />
                    </TabsContent>

                    <TabsContent value="saved-views" className="space-y-6 focus-visible:outline-none">
                        <SavedViews />
                    </TabsContent>

                    <TabsContent value="billing" className="space-y-6 focus-visible:outline-none">
                        <BillingDashboard />
                    </TabsContent>
                </Tabs>
            </main >

            <Dialog open={showUserManager} onOpenChange={(open) => !open ? closeUserManager() : setShowUserManager(true)}>
                <DialogContent className="bg-card sm:max-w-2xl">
                    <DialogHeader>
                        <DialogTitle>Manage User</DialogTitle>
                        <DialogDescription>
                            Update role, department, paid days, and run account actions for {managedUser?.username ? `@${managedUser.username}` : 'this user'}.
                        </DialogDescription>
                    </DialogHeader>
                    <div className="space-y-6 py-2">
                        <div className="grid gap-4 md:grid-cols-3">
                            <div className="space-y-2">
                                <Label htmlFor="manage-user-role">Role</Label>
                                <select
                                    id="manage-user-role"
                                    value={userManagerDraft.role}
                                    onChange={(e) => setUserManagerDraft((prev) => ({
                                        ...prev,
                                        role: e.target.value as User['role']
                                    }))}
                                    className="h-11 w-full rounded-xl border border-border bg-card px-3 text-sm outline-none transition focus:border-purple-400 focus:ring-2 focus:ring-purple-100"
                                >
                                    <option value="admin">Admin</option>
                                    <option value="moderator">Moderator</option>
                                    <option value="employee">Employee</option>
                                </select>
                            </div>
                            <div className="space-y-2">
                                <Label htmlFor="manage-user-department">Department</Label>
                                <select
                                    id="manage-user-department"
                                    value={userManagerDraft.department}
                                    onChange={(e) => setUserManagerDraft((prev) => ({
                                        ...prev,
                                        department: e.target.value
                                    }))}
                                    className="h-11 w-full rounded-xl border border-border bg-card px-3 text-sm outline-none transition focus:border-purple-400 focus:ring-2 focus:ring-purple-100"
                                >
                                    <option value="">Select Dept</option>
                                    {departmentOptions.map((dept) => (
                                        <option key={dept} value={dept}>{dept}</option>
                                    ))}
                                </select>
                            </div>
                            <div className="space-y-2">
                                <Label htmlFor="manage-user-paid-days">Paid Days</Label>
                                <Input
                                    id="manage-user-paid-days"
                                    type="number"
                                    min="0"
                                    step="1"
                                    value={userManagerDraft.paidLeaveBalance}
                                    onChange={(e) => setUserManagerDraft((prev) => ({
                                        ...prev,
                                        paidLeaveBalance: e.target.value
                                    }))}
                                    className="h-11 rounded-xl border-border"
                                />
                            </div>
                        </div>

                        <div className="grid gap-3 rounded-2xl border border-border/50 bg-muted p-4 md:grid-cols-2">
                            <Button
                                type="button"
                                variant="outline"
                                onClick={() => managedUser && handleResetUserMinutesBalance(managedUser)}
                                disabled={!managedUser || resetUserMinutesBalanceMutation.isPending}
                                className="justify-start rounded-xl border-amber-200 text-amber-700 hover:bg-amber-50 hover:text-amber-800"
                            >
                                <RotateCcw className="mr-2 h-4 w-4" />
                                Clear Balance
                            </Button>
                            <Button
                                type="button"
                                variant="outline"
                                onClick={() => managedUser && handleResetUserPaidLeaveBalance(managedUser)}
                                disabled={!managedUser || resetUserPaidLeaveBalanceMutation.isPending}
                                className="justify-start rounded-xl border-purple-200 text-purple-700 hover:bg-purple-50 hover:text-purple-800"
                            >
                                <CalendarDays className="mr-2 h-4 w-4" />
                                Clear Paid Days
                            </Button>
                            <Button
                                type="button"
                                variant="outline"
                                onClick={() => managedUser && handleClearUserLeaveHistory(managedUser)}
                                disabled={!managedUser || clearUserLeaveHistoryMutation.isPending}
                                className="justify-start rounded-xl border border-rose-500/20 text-rose-700 dark:text-rose-400 hover:bg-rose-500/10 dark:hover:bg-rose-500/20"
                            >
                                <Trash2 className="mr-2 h-4 w-4" />
                                Clear Leave History
                            </Button>
                            <Button
                                type="button"
                                variant="outline"
                                onClick={() => managedUser && handleClearUserSkippedDays(managedUser)}
                                disabled={!managedUser || clearUserSkippedDaysMutation.isPending}
                                className="justify-start rounded-xl border border-violet-500/20 text-violet-750 dark:text-violet-400 hover:bg-violet-500/10 dark:hover:bg-violet-500/20"
                            >
                                <AlertCircle className="mr-2 h-4 w-4" />
                                Clear Skipped Days
                            </Button>
                            <Button
                                type="button"
                                variant="outline"
                                onClick={() => managedUser && handleClearUserSubmissions(managedUser)}
                                disabled={!managedUser || clearUserSubmissionsMutation.isPending}
                                className="justify-start rounded-xl border-rose-200 text-rose-700 hover:bg-rose-50 hover:text-rose-800"
                            >
                                <FileText className="mr-2 h-4 w-4" />
                                {clearUserSubmissionsMutation.isPending ? 'Clearing All Submissions...' : 'Clear All Submissions'}
                            </Button>
                            <Button
                                type="button"
                                variant="outline"
                                onClick={() => {
                                    if (!managedUser || user?.id === managedUser.id) {
                                        return;
                                    }
                                    closeUserManager();
                                    setUserToDelete(managedUser);
                                }}
                                disabled={!managedUser || user?.id === managedUser?.id}
                                className="justify-start rounded-xl border-red-200 text-red-600 hover:bg-red-50 hover:text-red-700"
                            >
                                <Trash2 className="mr-2 h-4 w-4" />
                                Delete User
                            </Button>
                        </div>
                    </div>
                    <DialogFooter className="gap-2 sm:justify-between">
                        <Button type="button" variant="ghost" onClick={closeUserManager}>
                            Cancel
                        </Button>
                        <Button
                            type="button"
                            onClick={handleManageUserSave}
                            disabled={
                                !managedUser ||
                                updateUserRoleMutation.isPending ||
                                updateUserDepartmentMutation.isPending ||
                                updateUserPaidLeaveBalanceMutation.isPending
                            }
                            className="rounded-xl bg-purple-600 hover:bg-purple-700"
                        >
                            <Save className="mr-2 h-4 w-4" />
                            Save Changes
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            <AlertDialog open={!!userToDelete} onOpenChange={(open) => !open && setUserToDelete(null)}>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>Are you absolutely sure?</AlertDialogTitle>
                        <AlertDialogDescription>
                            This will permanently delete the user <span className="font-semibold text-foreground dark:text-foreground">{userToDelete?.username}</span> and remove all associated data. This action cannot be undone.
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                        <AlertDialogAction
                            onClick={() => {
                                if (userToDelete) {
                                    deleteUserMutation.mutate(userToDelete.id);
                                }
                            }}
                            disabled={deleteUserMutation.isPending}
                            className="bg-red-500 hover:bg-red-600 focus:ring-red-500"
                        >
                            {deleteUserMutation.isPending ? 'Deleting...' : 'Delete User'}
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>

            <Dialog open={showManualEmailDialog} onOpenChange={setShowManualEmailDialog}>
                <DialogContent className="bg-card">
                    <DialogHeader>
                        <DialogTitle>Send Report via Email</DialogTitle>
                        <DialogDescription>
                            Enter the recipient email address for this report.
                        </DialogDescription>
                    </DialogHeader>
                    <div className="space-y-4 py-4">
                        <div className="space-y-3">
                            <Label className="text-sm font-semibold text-foreground">Select Recipients</Label>
                            <div className="border rounded-xl border-border bg-muted/30 overflow-hidden">
                                <div className="max-h-[200px] overflow-y-auto divide-y divide-slate-100">
                                    {notifRecipientEmails.length === 0 ? (
                                        <div className="p-4 text-center text-muted-foreground text-sm">
                                            No recipients configured in settings.
                                        </div>
                                    ) : (
                                        notifRecipientEmails.map((email, idx) => {
                                            const isCurrentlySelected = selectedManualEmails.includes(email);

                                            return (
                                                <div key={idx} className="flex items-center gap-3 p-3 hover:bg-card transition-colors">
                                                    <input
                                                        type="checkbox"
                                                        id={`manual-recipient-${idx}`}
                                                        checked={isCurrentlySelected}
                                                        onChange={() => {
                                                            if (isCurrentlySelected) {
                                                                setSelectedManualEmails(prev => prev.filter(e => e !== email));
                                                            } else {
                                                                setSelectedManualEmails(prev => [...prev, email]);
                                                            }
                                                        }}
                                                        className="w-4 h-4 rounded border-input text-purple-600 focus:ring-purple-500 cursor-pointer"
                                                    />
                                                    <label
                                                        htmlFor={`manual-recipient-${idx}`}
                                                        className="text-sm font-medium text-foreground cursor-pointer flex-1"
                                                    >
                                                        {email}
                                                    </label>
                                                </div>
                                            );
                                        })
                                    )}
                                </div>
                            </div>
                        </div>

                        <div className="space-y-2">
                            <Label htmlFor="manualEmail" className="text-sm font-semibold text-foreground">Add One-time Recipient (Optional)</Label>
                            <div className="flex gap-2">
                                <Input
                                    id="manualEmail"
                                    type="email"
                                    placeholder="new-recipient@example.com"
                                    value={manualEmail}
                                    onChange={(e) => setManualEmail(e.target.value)}
                                    className="flex-1 h-10 rounded-xl border-border focus:border-purple-500"
                                />
                                <Button
                                    onClick={() => {
                                        if (manualEmail && manualEmail.includes('@') && !selectedManualEmails.includes(manualEmail)) {
                                            setSelectedManualEmails(prev => [...prev, manualEmail]);
                                            setManualEmail('');
                                        }
                                    }}
                                    disabled={!manualEmail || !manualEmail.includes('@')}
                                    className="bg-muted hover:bg-secondary-light text-foreground h-10"
                                >
                                    Add
                                </Button>
                            </div>
                        </div>
                    </div>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setShowManualEmailDialog(false)}>Cancel</Button>
                        <Button
                            onClick={() => {
                                // Final recipients = selected from list + the one-off if it's not empty but valid
                                const finalRecipients = [...selectedManualEmails];
                                if (manualEmail && manualEmail.includes('@') && !finalRecipients.includes(manualEmail)) {
                                    finalRecipients.push(manualEmail);
                                }

                                if (finalRecipients.length === 0) {
                                    setToast({ message: 'Please select or enter at least one recipient', type: 'error' });
                                    return;
                                }

                                setIsSendingEmail(true);
                                sendEmailMutation.mutate({
                                    email: finalRecipients.join(','),
                                    reportText: editableReportText,
                                    date: formattedDate
                                });
                                setShowManualEmailDialog(false);
                            }}
                            disabled={isSendingEmail || (selectedManualEmails.length === 0 && !manualEmail)}
                            className="bg-purple-500 hover:bg-purple-600 text-foreground"
                        >
                            {isSendingEmail ? 'Sending...' : 'Send Email'}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            <Dialog open={showManualWhatsAppDialog} onOpenChange={setShowManualWhatsAppDialog}>
                <DialogContent className="bg-card">
                    <DialogHeader>
                        <DialogTitle>Send Report via WhatsApp</DialogTitle>
                        <DialogDescription>
                            Select recipients or enter a phone number.
                        </DialogDescription>
                    </DialogHeader>
                    <div className="space-y-4 py-4">
                        <div className="space-y-3">
                            <Label className="text-sm font-semibold text-foreground">Select Recipients</Label>
                            <div className="border rounded-xl border-border bg-muted/30 overflow-hidden">
                                <div className="max-h-[200px] overflow-y-auto divide-y divide-slate-100">
                                    {notifWhatsAppNumbers.length === 0 ? (
                                        <div className="p-4 text-center text-muted-foreground text-sm">
                                            No WhatsApp recipients configured in settings.
                                        </div>
                                    ) : (
                                        notifWhatsAppNumbers.map((phone, idx) => {
                                            const isCurrentlySelected = selectedManualWhatsApp.includes(phone);

                                            return (
                                                <div key={idx} className="flex items-center gap-3 p-3 hover:bg-card transition-colors">
                                                    <input
                                                        type="checkbox"
                                                        id={`manual-whatsapp-recipient-${idx}`}
                                                        checked={isCurrentlySelected}
                                                        onChange={() => {
                                                            if (isCurrentlySelected) {
                                                                setSelectedManualWhatsApp(prev => prev.filter(e => e !== phone));
                                                            } else {
                                                                setSelectedManualWhatsApp(prev => [...prev, phone]);
                                                            }
                                                        }}
                                                        className="w-4 h-4 rounded border-input text-purple-600 focus:ring-purple-500 cursor-pointer"
                                                    />
                                                    <label
                                                        htmlFor={`manual-whatsapp-recipient-${idx}`}
                                                        className="text-sm font-medium text-foreground cursor-pointer flex-1"
                                                    >
                                                        {phone}
                                                    </label>
                                                </div>
                                            );
                                        })
                                    )}
                                </div>
                            </div>
                        </div>

                        <div className="space-y-2">
                            <Label htmlFor="manualWhatsApp" className="text-sm font-semibold text-foreground">Add One-time Recipient (Optional)</Label>
                            <div className="flex gap-2">
                                <PhoneInput
                                    placeholder="+880 1712 345678"
                                    value={manualWhatsApp}
                                    onChange={(value) => setManualWhatsApp(value)}
                                    className="flex-1 h-10 rounded-xl border-border focus:border-purple-500"
                                />
                                <Button
                                    onClick={() => {
                                        if (manualWhatsApp) {
                                            const cleaned = normalizePhone(manualWhatsApp);
                                            if (!selectedManualWhatsApp.includes(cleaned)) {
                                                setSelectedManualWhatsApp(prev => [...prev, cleaned]);
                                            }
                                            setManualWhatsApp('');
                                        }
                                    }}
                                    disabled={!manualWhatsApp}
                                    className="bg-muted hover:bg-secondary-light text-foreground h-10"
                                >
                                    Add
                                </Button>
                            </div>
                        </div>
                    </div>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setShowManualWhatsAppDialog(false)}>Cancel</Button>
                        <Button
                            onClick={() => {
                                const finalRecipients = [...selectedManualWhatsApp];
                                if (manualWhatsApp) {
                                    const cleaned = normalizePhone(manualWhatsApp);
                                    if (!finalRecipients.includes(cleaned)) {
                                        finalRecipients.push(cleaned);
                                    }
                                }

                                if (finalRecipients.length === 0) {
                                    setToast({ message: 'Please select or enter at least one recipient', type: 'error' });
                                    return;
                                }

                                setIsSendingWhatsApp(true);
                                // For WhatsApp, we might need to send multiple messages if multiple recipients
                                // But sendWhatsAppMutation currently takes one phoneNumber.
                                // We can loop or update the mutation. For simplicity, let's loop or take the first one if only one is allowed?
                                // Usually reports go to one number or a few. Let's loop.
                                Promise.all(finalRecipients.map(phone =>
                                    sendWhatsAppMutation.mutateAsync({
                                        phoneNumber: phone,
                                        reportText: editableReportText,
                                        date: formattedDate
                                    })
                                )).then(() => {
                                    setIsSendingWhatsApp(false);
                                    setShowManualWhatsAppDialog(false);
                                }).catch(() => {
                                    setIsSendingWhatsApp(false);
                                });
                            }}
                            disabled={isSendingWhatsApp || (selectedManualWhatsApp.length === 0 && !manualWhatsApp)}
                            className="bg-purple-500 hover:bg-purple-600 text-foreground"
                        >
                            {isSendingWhatsApp ? 'Sending...' : 'Send WhatsApp'}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            <Dialog open={showManualTelegramDialog} onOpenChange={setShowManualTelegramDialog}>
                <DialogContent className="bg-card">
                    <DialogHeader>
                        <DialogTitle>Send Report via Telegram</DialogTitle>
                        <DialogDescription>
                            Select recipients or enter a Telegram phone number.
                        </DialogDescription>
                    </DialogHeader>
                    <div className="space-y-4 py-4">
                        <div className="space-y-3">
                            <Label className="text-sm font-semibold text-foreground">Select Recipients</Label>
                            <div className="border rounded-xl border-border bg-muted/30 overflow-hidden">
                                <div className="max-h-[200px] overflow-y-auto divide-y divide-slate-100">
                                    {notifTelegramChatIds.length === 0 ? (
                                        <div className="p-4 text-center text-muted-foreground text-sm">
                                            No Telegram recipients configured in settings.
                                        </div>
                                    ) : (
                                        notifTelegramChatIds.map((chatId, idx) => {
                                            const isCurrentlySelected = selectedManualTelegram.includes(chatId);
                                            const recipientLabel = getTelegramRecipientDisplay(chatId);

                                            return (
                                                <div key={idx} className="flex items-center gap-3 p-3 hover:bg-card transition-colors">
                                                    <input
                                                        type="checkbox"
                                                        id={`manual-telegram-recipient-${idx}`}
                                                        checked={isCurrentlySelected}
                                                        onChange={() => {
                                                            if (isCurrentlySelected) {
                                                                setSelectedManualTelegram(prev => prev.filter(e => e !== chatId));
                                                            } else {
                                                                setSelectedManualTelegram(prev => [...prev, chatId]);
                                                            }
                                                        }}
                                                        className="w-4 h-4 rounded border-input text-purple-600 focus:ring-purple-500 cursor-pointer"
                                                    />
                                                    <label
                                                        htmlFor={`manual-telegram-recipient-${idx}`}
                                                        className="text-sm font-medium text-foreground cursor-pointer flex-1"
                                                    >
                                                        {recipientLabel}
                                                    </label>
                                                </div>
                                            );
                                        })
                                    )}
                                </div>
                            </div>
                        </div>

                        <div className="space-y-2">
                            <Label htmlFor="manualTelegram" className="text-sm font-semibold text-foreground">Add One-time Recipient (Optional)</Label>
                            <div className="flex gap-2">
                                <Input
                                    id="manualTelegram"
                                    type="text"
                                    placeholder="Chat ID or Phone Number"
                                    value={manualTelegram}
                                    onChange={(e) => setManualTelegram(e.target.value)}
                                    className="flex-1 h-10 rounded-xl border-border focus:border-purple-500"
                                />
                                <Button
                                    onClick={() => {
                                        if (manualTelegram && !selectedManualTelegram.includes(manualTelegram)) {
                                            setSelectedManualTelegram(prev => [...prev, manualTelegram]);
                                            setManualTelegram('');
                                        }
                                    }}
                                    disabled={!manualTelegram}
                                    className="bg-muted hover:bg-secondary-light text-foreground h-10"
                                >
                                    Add
                                </Button>
                            </div>
                        </div>
                    </div>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setShowManualTelegramDialog(false)}>Cancel</Button>
                        <Button
                            onClick={() => {
                                const finalRecipients = [...selectedManualTelegram];
                                if (manualTelegram && !finalRecipients.includes(manualTelegram)) {
                                    finalRecipients.push(manualTelegram);
                                }

                                if (finalRecipients.length === 0) {
                                    setToast({ message: 'Please select or enter at least one recipient', type: 'error' });
                                    return;
                                }

                                setIsSendingTelegram(true);
                                sendTelegramMutation.mutate({
                                    telegramId: finalRecipients.join(','),
                                    reportText: editableReportText,
                                    date: formattedDate
                                });
                                setShowManualTelegramDialog(false);
                            }}
                            disabled={isSendingTelegram || (selectedManualTelegram.length === 0 && !manualTelegram)}
                            className="bg-purple-500 hover:bg-purple-600 text-foreground"
                        >
                            {isSendingTelegram ? 'Sending...' : 'Send Telegram'}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            {/* User Details Dialog */}
            <Dialog open={showUserDetails} onOpenChange={setShowUserDetails}>
                <DialogContent className="sm:max-w-[700px] max-h-[90vh] overflow-y-auto rounded-3xl bg-card p-0 border-0 shadow-2xl">
                    {selectedUserDetails && (
                        isModerator ? (
                            <div className="p-8 space-y-5">
                                <div className="flex items-center justify-between">
                                    <h2 className="text-xl font-bold text-foreground">User Details</h2>
                                    <DialogClose className="h-9 w-9 rounded-full bg-muted flex items-center justify-center text-muted-foreground hover:bg-secondary-light transition-colors">
                                        <X className="w-4 h-4" />
                                    </DialogClose>
                                </div>

                                <div className="space-y-3">
                                    <div className="p-3 rounded-2xl bg-muted border border-border/50">
                                        <p className="text-[10px] font-bold text-muted-foreground/70 uppercase mb-0.5">Name</p>
                                        <p className="text-sm font-medium text-foreground">
                                            {selectedUserDetails.name || selectedUserDetails.username || 'Not provided'}
                                        </p>
                                    </div>
                                    <div className="p-3 rounded-2xl bg-muted border border-border/50">
                                        <p className="text-[10px] font-bold text-muted-foreground/70 uppercase mb-0.5">Email Address</p>
                                        <p className="text-sm font-medium text-foreground break-all">{selectedUserDetails.email || 'Not provided'}</p>
                                    </div>
                                    <div className="p-3 rounded-2xl bg-muted border border-border/50">
                                        <p className="text-[10px] font-bold text-muted-foreground/70 uppercase mb-0.5">Contact Number</p>
                                        <p className="text-sm font-medium text-foreground">{selectedUserDetails.contact_number || 'Not provided'}</p>
                                    </div>
                                    {selectedUserDetails.role === 'employee' && selectedUserDetails.status === 'active' && (
                                        <div className="p-3 rounded-2xl bg-muted border border-border/50">
                                            <p className="text-[10px] font-bold text-muted-foreground/70 uppercase mb-0.5">Account Status</p>
                                            <p className="text-sm font-medium text-foreground capitalize">{selectedUserDetails.status || 'Unknown'}</p>
                                        </div>
                                    )}
                                    {selectedUserDetails.role === 'employee' && selectedUserDetails.status !== 'active' && (
                                        <div className="p-3 rounded-2xl bg-muted border border-border/50">
                                            <p className="text-[10px] font-bold text-muted-foreground/70 uppercase mb-0.5">Account Status</p>
                                            <p className="text-sm font-medium text-foreground capitalize">{selectedUserDetails.status || 'Unknown'}</p>
                                        </div>
                                    )}
                                </div>
                            </div>
                        ) : (
                        <div className="flex flex-col">
                            {/* Header Section with Profile Banner style */}
                            <div className="h-32 bg-gradient-to-r from-violet-600 to-indigo-600 relative">
                                <DialogClose className="absolute top-4 right-4 h-10 w-10 rounded-full bg-black/20 backdrop-blur-md border border-white/20 flex items-center justify-center text-white hover:bg-black/40 hover:scale-110 transition duration-300 group z-10">
                                    <X className="w-5 h-5 group-hover:rotate-90 transition-transform duration-300" />
                                </DialogClose>
                            </div>
                            
                            <div className="px-8 pb-8 -mt-12 relative">
                                <div className="flex flex-col md:flex-row gap-6 items-start md:items-end mb-8">
                                    <div className="w-24 h-24 rounded-3xl border-4 border-white bg-linear-to-br from-slate-100 to-slate-200 flex items-center justify-center text-3xl font-bold text-muted-foreground/70 shadow-lg overflow-hidden shrink-0">
                                        {selectedUserDetails.profile_picture ? (
                                            <img
                                                src={(import.meta.env.VITE_API_URL || '').replace(/\/$/, '') + (selectedUserDetails.profile_picture.startsWith('/') ? selectedUserDetails.profile_picture : '/' + selectedUserDetails.profile_picture)}
                                                alt={selectedUserDetails.username}
                                                className="w-full h-full object-cover"
                                            />
                                        ) : (
                                            selectedUserDetails.username?.[0]?.toUpperCase()
                                        )}
                                    </div>
                                    <div className="flex-1 min-w-0 pb-1">
                                        <div className="flex items-center justify-between gap-4">
                                            <h2 className="text-2xl font-bold text-foreground truncate">
                                                {selectedUserDetails.full_name || `@${selectedUserDetails.username}`}
                                            </h2>
                                            {selectedUserDetails.role === 'employee' && selectedUserDetails.status === 'active' && (
                                                <Button
                                                    onClick={() => requestLocationMutation.mutate(selectedUserDetails.id)}
                                                    disabled={requestLocationMutation.isPending && requestLocationMutation.variables === selectedUserDetails.id}
                                                    className="rounded-2xl bg-purple-600 hover:bg-purple-700 text-white font-bold h-10 px-6 shadow-lg shadow-purple-200 flex items-center gap-2"
                                                >
                                                    <Activity className="w-4 h-4" />
                                                    {requestLocationMutation.isPending && requestLocationMutation.variables === selectedUserDetails.id ? 'Locating...' : 'Locate User'}
                                                </Button>
                                            )}
                                        </div>
                                        <div className="flex flex-wrap items-center gap-2 mt-1">
                                            <span className={cn(
                                                "px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider",
                                                getRoleBadgeClass(selectedUserDetails.role)
                                            )}>
                                                {selectedUserDetails.role}
                                            </span>
                                            <span className="px-2.5 py-0.5 rounded-full bg-muted text-muted-foreground text-[10px] font-bold uppercase tracking-wider">
                                                {selectedUserDetails.department || 'No Dept'}
                                            </span>
                                            {selectedUserDetails.role === 'employee' && (
                                                <span className={cn(
                                                    "px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider",
                                                    selectedUserDetails.status === 'active' ? "bg-green-100 text-green-700" : "bg-red-100 text-red-700"
                                                )}>
                                                    {selectedUserDetails.status}
                                                </span>
                                            )}
                                        </div>
                                    </div>
                                </div>

                                <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                                    {/* Contact Information */}
                                    <div className="md:col-span-2 space-y-4">
                                        <h4 className="text-xs font-bold text-muted-foreground/70 uppercase tracking-widest flex items-center gap-2">
                                            <Mail className="w-3.5 h-3.5" />
                                            Contact Information
                                        </h4>
                                        <div className="space-y-3">
                                            <div className="p-3 rounded-2xl bg-muted border border-border/50">
                                                <p className="text-[10px] font-bold text-muted-foreground/70 uppercase mb-0.5">Email Address</p>
                                                <p className="text-sm font-medium text-foreground break-all">{selectedUserDetails.email || 'Not provided'}</p>
                                            </div>
                                            <div className="p-3 rounded-2xl bg-muted border border-border/50">
                                                <p className="text-[10px] font-bold text-muted-foreground/70 uppercase mb-0.5">Contact Number</p>
                                                <p className="text-sm font-medium text-foreground">{selectedUserDetails.contact_number || 'Not provided'}</p>
                                            </div>
                                        </div>
                                    </div>

                                    {/* Bank Details */}
                                    <div className="md:col-span-2 space-y-4">
                                        <h4 className="text-xs font-bold text-muted-foreground/70 uppercase tracking-widest flex items-center gap-2">
                                            <CreditCard className="w-3.5 h-3.5" />
                                            Financial Information
                                        </h4>
                                        {selectedUserDetails.bank_details ? (
                                            <div className="p-4 rounded-2xl bg-slate-900 text-white relative overflow-hidden group">
                                                <div className="absolute top-0 right-0 w-32 h-32 bg-card/5 rounded-full -mr-16 -mt-16 blur-2xl group-hover:bg-card/10 transition-colors" />
                                                {(() => {
                                                    try {
                                                        const bank = typeof selectedUserDetails.bank_details === 'string' 
                                                            ? JSON.parse(selectedUserDetails.bank_details) 
                                                            : selectedUserDetails.bank_details;
                                                        return (
                                                            <div className="grid grid-cols-1 sm:grid-cols-3 gap-6 relative">
                                                                <div className="space-y-1">
                                                                    <p className="text-[10px] font-bold text-muted-foreground uppercase">Bank Name</p>
                                                                    <p className="text-sm font-bold text-white/90">{bank.bank_name || '—'}</p>
                                                                </div>
                                                                <div className="space-y-1">
                                                                    <p className="text-[10px] font-bold text-muted-foreground uppercase">Account Holder</p>
                                                                    <p className="text-sm font-bold text-white/90 truncate">{bank.account_holder_name || '—'}</p>
                                                                </div>
                                                                <div className="space-y-1">
                                                                    <p className="text-[10px] font-bold text-muted-foreground uppercase">Account Number</p>
                                                                    <p className="text-sm font-mono font-bold text-white/90 tracking-wider">{bank.account_number || '—'}</p>
                                                                </div>
                                                                <div className="space-y-1">
                                                                    <p className="text-[10px] font-bold text-muted-foreground uppercase">Branch Name</p>
                                                                    <p className="text-sm font-bold text-white/90">{bank.branch_name || '—'}</p>
                                                                </div>
                                                                <div className="space-y-1">
                                                                    <p className="text-[10px] font-bold text-muted-foreground uppercase">Routing Number</p>
                                                                    <p className="text-sm font-mono font-bold text-white/90">{bank.routing_number || '—'}</p>
                                                                </div>
                                                            </div>
                                                        );
                                                    } catch {
                                                        return <p className="text-sm italic opacity-50">Invalid bank detail format</p>;
                                                    }
                                                })()}
                                            </div>
                                        ) : (
                                            <div className="p-8 rounded-2xl border-2 border-dashed border-border text-center">
                                                <p className="text-sm text-muted-foreground/70 font-medium">No bank details added yet</p>
                                            </div>
                                        )}
                                    </div>
                                    
                                    <div className="md:col-span-2 pt-4 border-t border-border/50 flex items-center justify-between text-[10px] font-medium text-muted-foreground/70 uppercase tracking-widest">
                                        <span>User ID: {selectedUserDetails.id}</span>
                                        <span>Joined: {selectedUserDetails.created_at ? format(new Date(selectedUserDetails.created_at), 'MMMM do, yyyy') : '—'}</span>
                                    </div>
                                </div>
                            </div>
                        </div>
                        )
                    )}
                </DialogContent>
            </Dialog>

            {/* Toasts */}
            {/* Profile Requests Dialog */}
            {isAdmin && (
            <Dialog open={showProfileRequests} onOpenChange={setShowProfileRequests}>
                <DialogContent className="sm:max-w-[700px] max-h-[85vh] overflow-y-auto rounded-2xl bg-card">
                    <DialogHeader>
                        <DialogTitle className="flex items-center gap-2">
                            <UserIcon className="w-5 h-5 text-purple-500" />
                            Profile Update Requests
                        </DialogTitle>
                        <DialogDescription>
                            Review and approve pending profile changes from employees.
                        </DialogDescription>
                    </DialogHeader>

                    <div className="space-y-4 py-4">
                        {profileRequests && profileRequests.length > 0 ? (
                            profileRequests.map((req: Record<string, any>) => {
                                const changes = typeof req.requested_changes === 'string' ? JSON.parse(req.requested_changes) : req.requested_changes;

                                return (
                                    <div key={req.id} className="border border-border rounded-xl p-4 space-y-4 bg-muted/50">
                                        <div className="flex items-center justify-between border-b border-border pb-3">
                                            <div>
                                                <h4 className="font-semibold text-foreground">{req.current_username}</h4>
                                                <p className="text-xs text-muted-foreground">Requested on {format(new Date(req.created_at), 'PPP p')}</p>
                                            </div>
                                            <div className="flex gap-2">
                                                <Button
                                                    size="sm"
                                                    variant="outline"
                                                    className="text-red-500 hover:text-red-600 hover:bg-red-50 border-red-200"
                                                    onClick={() => handleProfileRequestMutation.mutate({ requestId: req.id, status: 'rejected' })}
                                                >
                                                    Reject
                                                </Button>
                                                <Button
                                                    size="sm"
                                                    className="bg-green-500 hover:bg-green-600 text-foreground"
                                                    onClick={() => handleProfileRequestMutation.mutate({ requestId: req.id, status: 'approved' })}
                                                >
                                                    Approve
                                                </Button>
                                            </div>
                                        </div>

                                        <div className="grid grid-cols-2 gap-4 text-sm">
                                            {changes.username && changes.username !== req.current_username && (
                                                <div className="col-span-2 md:col-span-1 space-y-1">
                                                    <span className="text-xs text-muted-foreground font-medium">Username</span>
                                                    <div className="flex items-center gap-2">
                                                        <span className="line-through text-muted-foreground text-xs">{req.current_username}</span>
                                                        <ArrowLeft className="w-3 h-3 text-foreground rotate-180" />
                                                        <span className="font-medium text-purple-600 bg-purple-50 px-2 py-0.5 rounded">{changes.username}</span>
                                                    </div>
                                                </div>
                                            )}

                                            {changes.email && changes.email !== req.current_email && (
                                                <div className="col-span-2 md:col-span-1 space-y-1">
                                                    <span className="text-xs text-muted-foreground font-medium">Email</span>
                                                    <div className="flex flex-wrap items-center gap-2">
                                                        <span className="line-through text-muted-foreground text-xs">{req.current_email}</span>
                                                        <ArrowLeft className="w-3 h-3 text-foreground rotate-180" />
                                                        <span className="font-medium text-purple-600 bg-purple-50 px-2 py-0.5 rounded">{changes.email}</span>
                                                    </div>
                                                </div>
                                            )}

                                            {changes.contact_number && changes.contact_number !== req.current_contact && (
                                                <div className="col-span-2 md:col-span-1 space-y-1">
                                                    <span className="text-xs text-muted-foreground font-medium">Phone</span>
                                                    <div className="flex items-center gap-2">
                                                        <span className="line-through text-muted-foreground text-xs">{req.current_contact || '-'}</span>
                                                        <ArrowLeft className="w-3 h-3 text-foreground rotate-180" />
                                                        <span className="font-medium text-purple-600 bg-purple-50 px-2 py-0.5 rounded">{changes.contact_number}</span>
                                                    </div>
                                                </div>
                                            )}

                                            {changes.bank_details && (
                                                <div className="col-span-2 space-y-2 p-3 rounded-lg bg-card border border-border mt-2">
                                                    <span className="text-xs font-semibold text-muted-foreground flex items-center gap-1">
                                                        <CreditCard className="w-3 h-3" />
                                                        New Bank Details
                                                    </span>
                                                    {(() => {
                                                        try {
                                                            const details = typeof changes.bank_details === 'string'
                                                                ? JSON.parse(changes.bank_details)
                                                                : changes.bank_details;
                                                            
                                                            const oldDetails = req.current_bank ? (
                                                                typeof req.current_bank === 'string' ? JSON.parse(req.current_bank) : req.current_bank
                                                            ) : null;

                                                            const ItemDiff = ({ label, oldVal, newVal, isMono = false }: { label: string, oldVal?: string, newVal?: string, isMono?: boolean }) => {
                                                                if (!newVal || newVal === oldVal) return null;
                                                                return (
                                                                    <div className="space-y-1">
                                                                        <span className="text-[10px] text-muted-foreground font-bold uppercase tracking-wider">{label}</span>
                                                                        <div className="flex items-center gap-2 flex-wrap">
                                                                            {oldVal && <span className="line-through text-muted-foreground/70 text-[10px]">{oldVal}</span>}
                                                                            {oldVal && <ArrowLeft className="w-2.5 h-2.5 text-muted-foreground/70 rotate-180 shrink-0" />}
                                                                            <span className={cn(
                                                                                "font-bold text-purple-700 bg-purple-50 px-1.5 py-0.5 rounded text-xs",
                                                                                isMono && "font-mono"
                                                                            )}>
                                                                                {newVal}
                                                                            </span>
                                                                        </div>
                                                                    </div>
                                                                );
                                                            };

                                                            return (
                                                                <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pt-1">
                                                                    <ItemDiff label="Bank Name" oldVal={oldDetails?.bank_name} newVal={details.bank_name} />
                                                                    <ItemDiff label="Acc. Holder" oldVal={oldDetails?.account_holder_name} newVal={details.account_holder_name} />
                                                                    <ItemDiff label="Acc. Number" oldVal={oldDetails?.account_number} newVal={details.account_number} isMono />
                                                                    <ItemDiff label="Branch" oldVal={oldDetails?.branch_name} newVal={details.branch_name} />
                                                                    <ItemDiff label="Routing #" oldVal={oldDetails?.routing_number} newVal={details.routing_number} isMono />
                                                                </div>
                                                            )
                                                        } catch {
                                                            return <p className="text-xs italic text-red-400 bg-red-50 p-2 rounded">Format error in bank details</p>
                                                        }
                                                    })()}
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                );
                            })
                        ) : (
                            <div className="text-center py-12">
                                <div className="w-12 h-12 bg-muted rounded-full flex items-center justify-center mx-auto mb-3">
                                    <Check className="w-6 h-6 text-foreground" />
                                </div>
                                <p className="text-muted-foreground">No pending profile update requests</p>
                            </div>
                        )}
                    </div>
                    <DialogFooter>
                        <Button onClick={() => setShowProfileRequests(false)}>Close</Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
            )}

            {/* Delete Leave Confirmation Dialog */}
            <AlertDialog open={!!leaveToDelete} onOpenChange={(open) => !open && setLeaveToDelete(null)}>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>Delete Leave Request</AlertDialogTitle>
                        <AlertDialogDescription>
                            Are you sure you want to delete this leave request? This action cannot be undone.
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                        <AlertDialogAction
                            className="bg-red-500 hover:bg-red-600 focus:ring-red-500"
                            onClick={() => {
                                if (leaveToDelete) {
                                    deleteLeaveMutation.mutate(leaveToDelete);
                                    setLeaveToDelete(null);
                                }
                            }}
                        >
                            Delete
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>

            {/* Leave Details Modal */}
            <Dialog open={showLeaveDetails} onOpenChange={setShowLeaveDetails}>
                <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto bg-card shadow-2xl border-border">
                    <DialogHeader>
                        <DialogTitle className="flex items-center gap-2">
                            <Plane className="w-5 h-5 text-violet-550 dark:text-violet-400" />
                            Leave Request Details
                        </DialogTitle>
                        <DialogDescription>
                            Full information and management controls for this leave request.
                        </DialogDescription>
                    </DialogHeader>

                    {selectedLeaveForView && (
                        <div className="space-y-6 py-4">
                            {/* Employee Info */}
                            <div className="flex items-center gap-3 p-3 rounded-xl bg-muted border border-border/50">
                                <div>
                                    <h4 className="font-bold text-foreground">@{selectedLeaveForView.username}</h4>
                                    <p className="text-xs text-muted-foreground">{selectedLeaveForView.full_name || 'No full name provided'}</p>
                                </div>
                                <div className="ml-auto text-right">
                                    <span className={cn(
                                        "px-2 py-1 rounded-full text-[10px] font-bold uppercase border",
                                        selectedLeaveForView.type === 'paid' ? "bg-purple-50 text-purple-600 border-purple-100" : "bg-muted text-muted-foreground border-border/50"
                                    )}>
                                        {selectedLeaveForView.type}
                                    </span>
                                </div>
                            </div>

                            {/* Duration & Status */}
                            <div className="grid grid-cols-2 gap-4">
                                <div className="space-y-1">
                                    <span className="text-[10px] uppercase font-bold text-muted-foreground/70 flex items-center gap-1">
                                        <CalendarIcon className="w-3 h-3" />
                                        Duration
                                    </span>
                                    <p className="text-sm font-semibold text-foreground">
                                        {formatDateRangeLabel(selectedLeaveForView.start_date, selectedLeaveForView.end_date)}
                                        <span className="ml-2 text-xs text-muted-foreground/70 font-medium">({selectedLeaveForView.days_total} {selectedLeaveForView.days_total === 1 ? 'Day' : 'Days'})</span>
                                    </p>
                                </div>
                                <div className="space-y-1 text-right">
                                    <span className="text-[10px] uppercase font-bold text-muted-foreground/70 flex items-center gap-1 justify-end">
                                        <Activity className="w-3 h-3" />
                                        Current Status
                                    </span>
                                    <span className={cn(
                                        "inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-bold uppercase",
                                        selectedLeaveForView.status === 'pending' ? "bg-amber-500/10 text-amber-650 dark:text-amber-400 border border-amber-500/20" : 
                                        selectedLeaveForView.status === 'approved' ? "bg-indigo-500/10 text-indigo-650 dark:text-indigo-400 border border-indigo-500/20" : 
                                        selectedLeaveForView.status === 'working' ? "bg-rose-500/10 text-rose-650 dark:text-rose-450 border border-rose-500/20" :
                                        selectedLeaveForView.status === 'covered' ? "bg-emerald-500/10 text-emerald-650 dark:text-emerald-450 border border-emerald-500/20" :
                                        "bg-red-500/10 text-red-650 dark:text-red-400 border border-red-500/20"
                                    )}>
                                        {selectedLeaveForView.status}
                                    </span>
                                </div>
                            </div>

                            {/* Full Reason */}
                            <div className="space-y-2">
                                <span className="text-[10px] uppercase font-bold text-muted-foreground/70 flex items-center gap-1">
                                    <FileText className="w-3 h-3" />
                                    Full Reason
                                </span>
                                <div className="p-4 rounded-xl bg-muted border border-border/50 text-sm text-foreground leading-relaxed italic whitespace-pre-wrap">
                                    "{selectedLeaveForView.reason}"
                                </div>
                            </div>

                            {/* Individual Days Breakdown */}
                            {selectedLeaveForView.individualLeaves && selectedLeaveForView.individualLeaves.length > 0 && (
                                <div className="space-y-3">
                                    <span className="text-[10px] uppercase font-bold text-muted-foreground/70 flex items-center gap-1">
                                        <Clock className="w-3 h-3" />
                                        Daily Breakdown & Coverage
                                    </span>
                                    <div className="grid gap-2">
                                        {selectedLeaveForView.individualLeaves.map((ind: any) => (
                                            <div key={ind.id} className="flex items-center justify-between p-3 rounded-xl bg-card border border-border/50 shadow-sm hover:border-border transition-colors">
                                                <div className="flex flex-col">
                                                    <span className="text-xs font-semibold text-foreground flex items-center gap-2">
                                                        {format(new Date(ind.leave_date), 'EEEE, MMM dd, yyyy')}
                                                        <span className={cn(
                                                            "text-[9px] px-1.5 py-0.5 rounded uppercase font-bold border",
                                                            ind.status === 'covered' ? "bg-emerald-500/10 text-emerald-650 dark:text-emerald-450 border border-emerald-500/20" :
                                                            ind.status === 'approved' ? "bg-indigo-500/10 text-indigo-650 dark:text-indigo-400 border border-indigo-500/20" :
                                                            ind.status === 'working' ? "bg-rose-500/10 text-rose-650 dark:text-rose-455 border border-rose-500/20 animate-pulse" :
                                                            ind.status === 'pending' ? "bg-amber-500/10 text-amber-650 dark:text-amber-400 border border-amber-500/20" :
                                                            "bg-red-500/10 text-red-650 dark:text-red-400 border border-red-500/20"
                                                        )}>
                                                            {ind.status}
                                                        </span>
                                                    </span>
                                                    {((ind.worked_hours || 0) > 0 || ind.status === 'working') && (
                                                        <span className="text-[10px] font-bold text-muted-foreground mt-0.5">
                                                            Progress: {(ind.worked_hours || 0).toFixed(1)}h / {ind.target_hours || 4}h
                                                        </span>
                                                    )}
                                                </div>
                                                <div className="flex items-center gap-2">
                                                    {ind.status === 'pending' && (
                                                        <>
                                                            <Button
                                                                size="sm"
                                                                variant="outline"
                                                                className="h-7 text-[10px] border-green-200 text-green-600 hover:bg-green-50"
                                                                onClick={() => updateLeaveStatusMutation.mutate({ id: ind.id, status: 'approved' })}
                                                            >
                                                                Approve
                                                            </Button>
                                                            <Button
                                                                size="sm"
                                                                variant="outline"
                                                                className="h-7 text-[10px] border-red-200 text-red-600 hover:bg-red-50"
                                                                onClick={() => updateLeaveStatusMutation.mutate({ id: ind.id, status: 'rejected' })}
                                                            >
                                                                Reject
                                                            </Button>
                                                        </>
                                                    )}
                                                    {(ind.status === 'approved' || ind.status === 'working' || ind.status === 'pending') && (
                                                        <Button
                                                            size="sm"
                                                            variant="outline"
                                                            className="h-7 text-[10px] border-emerald-200 text-emerald-600 hover:bg-emerald-50"
                                                            onClick={() => updateLeaveStatusMutation.mutate({ id: ind.id, status: 'covered' })}
                                                            title="Mark as Covered"
                                                        >
                                                            <CheckCircle2 className="h-3 w-3 mr-1" />
                                                            Mark as Cover
                                                        </Button>
                                                    )}
                                                    <Button
                                                        size="icon"
                                                        variant="ghost"
                                                        className="h-7 w-7 text-muted-foreground/70 hover:text-red-500"
                                                        onClick={() => setLeaveToDelete(ind)}
                                                    >
                                                        <Trash2 className="h-3.5 w-3.5" />
                                                    </Button>
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            )}

                            {/* Batch Actions Footer */}
                            <div className="pt-4 border-t border-border/50 flex flex-wrap gap-2 justify-end">
                                {selectedLeaveForView.status === 'pending' && (
                                    <>
                                        <Button
                                            size="sm"
                                            className="bg-green-500 hover:bg-green-600 text-white"
                                            onClick={() => {
                                                if (selectedLeaveForView.individualLeaves?.length > 1) {
                                                    updateBatchLeaveStatusMutation.mutate({ requestId: selectedLeaveForView.request_id, status: 'approved' });
                                                } else {
                                                    updateLeaveStatusMutation.mutate({ id: selectedLeaveForView.id, status: 'approved' });
                                                }
                                                setShowLeaveDetails(false);
                                            }}
                                        >
                                            Approve All
                                        </Button>
                                        <Button
                                            size="sm"
                                            variant="outline"
                                            className="border-red-200 text-red-600 hover:bg-red-50"
                                            onClick={() => {
                                                if (selectedLeaveForView.individualLeaves?.length > 1) {
                                                    updateBatchLeaveStatusMutation.mutate({ requestId: selectedLeaveForView.request_id, status: 'rejected' });
                                                } else {
                                                    updateLeaveStatusMutation.mutate({ id: selectedLeaveForView.id, status: 'rejected' });
                                                }
                                                setShowLeaveDetails(false);
                                            }}
                                        >
                                            Reject All
                                        </Button>
                                    </>
                                )}
                                {(selectedLeaveForView.status === 'approved' || selectedLeaveForView.status === 'working') && (
                                    <Button
                                        size="sm"
                                        variant="outline"
                                        className="border-emerald-200 text-emerald-600 hover:bg-emerald-50 font-bold"
                                        onClick={() => {
                                            if (selectedLeaveForView.individualLeaves?.length > 1) {
                                                updateBatchLeaveStatusMutation.mutate({ requestId: selectedLeaveForView.request_id, status: 'covered' });
                                            } else {
                                                updateLeaveStatusMutation.mutate({ id: selectedLeaveForView.id, status: 'covered' });
                                            }
                                            setShowLeaveDetails(false);
                                        }}
                                    >
                                        Mark All as Cover
                                    </Button>
                                )}
                                <Button
                                    size="sm"
                                    variant="destructive"
                                    onClick={() => {
                                        setLeaveToDelete(selectedLeaveForView);
                                        setShowLeaveDetails(false);
                                    }}
                                >
                                    Delete Request
                                </Button>
                            </div>
                        </div>
                    )}
                </DialogContent>
            </Dialog>

            {/* Media Lightbox */}
            {selectedMedia && (
                <div
                    className="fixed inset-0 z-100 bg-black/90 backdrop-blur-sm flex items-center justify-center p-4 animate-in fade-in duration-300"
                    onClick={() => setSelectedMedia(null)}
                >
                    <div className="relative max-w-5xl max-h-full transition-transform duration-300 scale-in shadow-2xl" onClick={e => e.stopPropagation()}>
                        <Button
                            variant="ghost"
                            size="icon"
                            className="absolute -top-12 right-0 text-foreground hover:bg-muted rounded-full"
                            onClick={() => setSelectedMedia(null)}
                        >
                            <X className="w-8 h-8" />
                        </Button>
                        {selectedMedia.type === 'image' ? (
                            <OptimizedImage src={selectedMedia.url} className="max-w-full max-h-[85vh] object-contain rounded-lg shadow-2xl" alt="Fullscreen preview" />
                        ) : (
                            <div className="max-w-full max-h-[85vh] rounded-lg shadow-2xl overflow-hidden bg-black">
                                <VideoAttachment url={selectedMedia.url} />
                            </div>
                        )}
                    </div>
                </div>
            )}
            {
                toast && (
                    <Toast
                        message={toast.message}
                        type={toast.type === 'alert' ? 'warning' : (toast.type as "success" | "error" | "info" | "warning")}
                        onClose={() => setToast(null)}
                    />
                )
            }
        </div >
    );
}


