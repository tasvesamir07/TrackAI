/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unused-vars, react-hooks/exhaustive-deps */
import { useEffect, useState, useMemo, useRef, lazy, Suspense } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '@/context/AuthContext';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api, { uploadFilesDirectly } from '@/lib/api';
import { saveOfflineCheckin, getOfflineCheckins, clearOfflineCheckins } from '@/lib/offlineSync';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { format, addDays, isSameDay } from 'date-fns';
import { toZonedTime } from 'date-fns-tz';
import type { DateRange } from 'react-day-picker';
import { useVirtualizer } from '@tanstack/react-virtual';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import OptimizedImage from '@/components/OptimizedImage';
import { cn } from '@/lib/utils';
import { useSocket } from '@/context/SocketContext';
import { formatTime, getOffDayDetails, normalizeDateValue } from '@/lib/dateUtils';
import { compressFileList } from '@/lib/imageCompression';
import { ProductTour } from '@/components/employee/ProductTour';
import { FeatureVoting } from '@/components/employee/FeatureVoting';
import { Changelog } from '@/components/employee/Changelog';
import { KnowledgeBase } from '@/components/admin/KnowledgeBase';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
    DialogFooter,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import RoleSidebar, { MobileRoleSidebar, useEmployeeSidebarItems } from '@/components/RoleSidebar';


import {
    ClipboardList, History, Copy, Send, LogOut, Edit3,
    Calendar as CalendarIcon, Coffee, PlayCircle, StopCircle, Clock,
    Users, MessageCircle, AlertCircle, CalendarDays, Check,
    TrendingUp, Target, Sparkles, Activity, Trash2,
    RotateCcw, Upload, Video, X, Settings, Briefcase, Shield, User, ThumbsUp, Book
} from 'lucide-react';
import {
    Tooltip,
    TooltipContent,
    TooltipProvider,
    TooltipTrigger,
} from '@/components/ui/tooltip';
import { Toast } from '@/components/ui/Toast';


import { Calendar } from '@/components/ui/calendar';


const taskSchema = z.object({
    todays_task: z.string().min(1, "Today's task is required"),
});

type TaskFormValues = z.infer<typeof taskSchema>;

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

const VideoAttachment = ({ url }: { url: string }) => {
    return (
        <video
            src={`${url}#t=0.1`}
            controls
            playsInline
            muted
            preload="metadata"
            className="w-full h-full object-cover bg-black"
        />
    );
};

const apiBaseUrl = (import.meta.env.VITE_API_URL || '').replace(/\/$/, '');
const LazyChatInterface = lazy(() => import('@/components/ChatInterface'));

function getAssetUrl(path?: string | null) {
    if (!path) return undefined;
    if (path.startsWith('http://') || path.startsWith('https://')) return path;
    const normalizedPath = String(path).replace(/\\/g, '/');
    return `${apiBaseUrl}${normalizedPath.startsWith('/') ? normalizedPath : `/${normalizedPath}`}`;
}

export default function EmployeeDashboard() {
    const { socket } = useSocket();
    const { user, logout, refetchUser } = useAuth();
    const navigate = useNavigate();
    const routerLocation = useLocation();
    const queryClient = useQueryClient();
    const isEmployee = user?.role === 'employee';
    const [location, setLocation] = useState<{ latitude: number, longitude: number } | null>(null);

    useEffect(() => {
        if (navigator.geolocation) {
            navigator.geolocation.getCurrentPosition(
                (pos) => setLocation({ latitude: pos.coords.latitude, longitude: pos.coords.longitude }),
                (err) => console.log("Location access denied or error:", err.message),
                { timeout: 10000 }
            );
        }
    }, []);

    const [date, setDate] = useState<Date>(() => {
        const tz = user?.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone;
        const zonedNow = toZonedTime(new Date(), tz);
        zonedNow.setHours(0, 0, 0, 0);
        return zonedNow;
    });

    const [showSignOutCoverModal, setShowSignOutCoverModal] = useState(false);
    const [showEarlySignOutModal, setShowEarlySignOutModal] = useState(false);
    const [earlySignOutReason, setEarlySignOutReason] = useState('');
    const [showLeaveModal, setShowLeaveModal] = useState(false);
    const [leaveRange, setLeaveRange] = useState<DateRange | undefined>();
    const [leaveReason, setLeaveReason] = useState('');
    const [leaveType, setLeaveType] = useState<'paid' | 'unpaid' | ''>('');

    // Off-day work states
    const [offDayMode, setOffDayMode] = useState<'overtime' | 'cover'>('overtime');
    const [selectedLeaveToCover, setSelectedLeaveToCover] = useState<number | null>(null);
    const [selectedLeavesForSignOut, setSelectedLeavesForSignOut] = useState<number[]>([]);
    const [activeTab, setActiveTab] = useState(() => {
        const params = new URLSearchParams(window.location.search);
        return params.get('tab') || 'tasks';
    });

    // Sync activeTab state with URL search params
    useEffect(() => {
        const params = new URLSearchParams(routerLocation.search);
        const tab = params.get('tab');
        if (tab && tab !== activeTab) {
            setActiveTab(tab);
        }
    }, [routerLocation.search]);

    // Update activeTab and query parameters when user switches tabs
    const handleTabChange = (tab: string) => {
        setActiveTab(tab);
        const params = new URLSearchParams(routerLocation.search);
        params.set('tab', tab);
        navigate({ search: params.toString() }, { replace: true });
    };
    const [chatUnreadTotal, setChatUnreadTotal] = useState(0);
    const [selectedMedia, setSelectedMedia] = useState<{ url: string; type: 'image' | 'video' } | null>(null);
    const [taskFiles, setTaskFiles] = useState<File[]>([]);
    const [removedAttachmentUrls, setRemovedAttachmentUrls] = useState<string[]>([]);
    const taskInputRef = useRef<HTMLTextAreaElement>(null);
    const [shouldFocusTaskInput, setShouldFocusTaskInput] = useState(false);
    const [showPlanModal, setShowPlanModal] = useState(false);
    const [hoursWorkedToday, setHoursWorkedToday] = useState<number>(0);
    const [timerSeconds, setTimerSeconds] = useState(0);
    const [toast, setToast] = useState<{ message: string, type: 'info' | 'success' | 'warning' | 'error' } | null>(null);
    const prevVirtualDateRef = useRef<string | null>(null);
    const timerBaseSecondsRef = useRef(0);
    const timerBaseSyncedAtRef = useRef<number | null>(null);

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

    // Copy Feedback State
    const [copiedTaskId, setCopiedTaskId] = useState<number | null>(null);
    const taskHistoryScrollRef = useRef<HTMLDivElement | null>(null);

    // Scheduled Task States
    const [scheduledAt, setScheduledAt] = useState<Date | null>(null);
    const [isSchedulingModalOpen, setIsSchedulingModalOpen] = useState(false);
    const [scheduleTime, setScheduleTime] = useState(format(new Date(), 'HH:mm'));
    const [scheduleDate, setScheduleDate] = useState<Date | undefined>(new Date());
    const holdTimerRef = useRef<any>(null);
    const holdIntervalRef = useRef<any>(null);
    const holdStartTime = useRef<number | null>(null);
    const skipNextClickSubmitRef = useRef(false);
    const scheduleOpenedByHoldRef = useRef(false);

    useEffect(() => {
        return () => {
            if (holdTimerRef.current) clearTimeout(holdTimerRef.current);
            if (holdIntervalRef.current) clearInterval(holdIntervalRef.current);
        };
    }, []);


    // Time Travel State (Developer Tools)
    const [showDevTools, setShowDevTools] = useState(false);

    // Manual Overtime Test Mutation
    const testOvertimeMutation = useMutation({
        mutationFn: async () => {
            const res = await api.post('/dev/test-overtime-alert');
            return res.data;
        },
        onSuccess: (data) => {
            setToast({ message: data.message || 'Overtime check triggered! Check your email/WhatsApp.', type: 'success' });
        },
        onError: (err: unknown) => { const error = err as { response?: { data?: { error?: string } } };
            setToast({ message: error.response?.data?.error || 'Failed to trigger overtime test', type: 'error' });
        }
    });

    // Manual Missed Day Check Mutation
    const triggerMissedDayMutation = useMutation({
        mutationFn: async () => {
            const res = await api.post('/dev/trigger-task', { task: 'missed_day_check' });
            return res.data;
        },
        onSuccess: (data) => {
            setToast({ message: data.message || 'Missed Day check triggered!', type: 'success' });
            refetchUser();
            refetchMonthlyStats();
        },
        onError: (err: unknown) => { const error = err as { response?: { data?: { error?: string } } };
            setToast({ message: error.response?.data?.error || 'Failed to trigger missed day check', type: 'error' });
        }
    });

    const heartbeatMutation = useMutation({
        mutationFn: async (locationData: { latitude: number, longitude: number } | null) => {
            await api.post('/auth/heartbeat', { location: locationData });
        }
    });

    // Time Travel State (Developer Tools)
    const { data: timeTravelData, refetch: refetchTimeTravel } = useQuery({
        queryKey: ['timeTravel'],
        queryFn: async () => {
            const res = await api.get('/dev/time-travel');
            return res.data;
        }
    });

    // Auto-sync dashboard date with virtual clock or active session date
    useEffect(() => {
        const tz = user?.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone;
        const now = timeTravelData?.virtual_time ? new Date(timeTravelData.virtual_time) : new Date();
        const virtualDate = toZonedTime(now, tz);
        const virtualDateStr = format(virtualDate, 'yyyy-MM-dd');

        let sessionDateStr = null;
        if ((user?.status === 'active' || user?.status === 'break')) {
            // Priority 1: explicitly covered date
            if (user?.coveredDate) {
                sessionDateStr = (typeof user.coveredDate === 'string') 
                    ? user.coveredDate.substring(0, 10) 
                    : format(new Date(user.coveredDate), 'yyyy-MM-dd');
            } 
            else if (user?.sessionStartTime) {
                try {
                    // sessionStartTime is now an ISO-8601 string like '2026-03-16T22:00:00+06:00'
                    // or potentially '2026-03-16 22:00:00'
                    const datePart = user.sessionStartTime.includes('T') 
                        ? user.sessionStartTime.split('T')[0] 
                        : user.sessionStartTime.split(' ')[0];
                    sessionDateStr = datePart;
                } catch (_e) {
                    console.error("Failed to parse sessionStartTime", user.sessionStartTime);
                }
            }
        }

        const targetDateStr = sessionDateStr || virtualDateStr;

        // Force date sync if target changes OR if we are working and date is out of sync
        let currentFormattedDate = '1970-01-01';
        try {
            if (date && !isNaN(date.getTime())) {
                currentFormattedDate = format(date, 'yyyy-MM-dd');
            }
        } catch (_e) {
            currentFormattedDate = 'invalid';
        }
        const isWorking = user?.status === 'active' || user?.status === 'break';

        if (prevVirtualDateRef.current !== targetDateStr || (isWorking && currentFormattedDate !== targetDateStr)) {
            console.log(`[Sync] Dashboard switching date: ${currentFormattedDate} -> ${targetDateStr} (Source: ${sessionDateStr ? 'Session' : 'Virtual Today'})`);
            const [y, m, d] = targetDateStr.split('-').map(Number);
            const newDate = new Date(y, m - 1, d);
            newDate.setHours(0, 0, 0, 0);
            
            if (!isNaN(newDate.getTime())) {
                setDate(newDate);
                prevVirtualDateRef.current = targetDateStr;
            } else {
                console.error("[Sync] Attempted to set invalid date from string:", targetDateStr);
            }

            // Auto-refresh skipped days when date changes
            refetchSkippedDays();
        }
    }, [timeTravelData?.virtual_time, user?.status, user?.sessionStartTime, user?.coveredDate, user?.timezone, date]);




    // Fetch work hours settings (admin configured)
    const { data: workHoursSettings } = useQuery({
        queryKey: ['workHoursSettings'],
        queryFn: async () => {
            const res = await api.get('/auth/work-hours');
            return res.data;
        }
    });

    const hasAlertedTarget = useRef(false);
    const hasAlertedOvertime = useRef(false);

    useEffect(() => {
        const standardHours = workHoursSettings?.standardHours || 4;
        // hoursWorkedToday from server already includes user.currentSessionHours (the accumulated time until fetch)
        // timerSeconds starts from user.currentSessionHours and ticks up.
        // So we extract the "time worked in PREVIOUS sessions today" first.
        const previousSessionsToday = hoursWorkedToday - (user?.currentSessionHours || 0);
        const currentTotal = previousSessionsToday + (timerSeconds / 3600);

        if (user?.status === 'active' && currentTotal >= standardHours && !hasAlertedTarget.current && standardHours > 0) {
            setToast({ message: `Daily target of ${standardHours} hours reached! Great job!`, type: 'success' });
            hasAlertedTarget.current = true;
        }

        const overtimeThreshold = workHoursSettings?.overtimeThreshold || 9.5;
        if (user?.status === 'active' && currentTotal >= overtimeThreshold && !hasAlertedOvertime.current && overtimeThreshold > 0) {
            setToast({ message: `Overtime threshold of ${overtimeThreshold} hours reached! You are now accumulating coverable hours.`, type: 'info' });
            hasAlertedOvertime.current = true;
        }
    }, [timerSeconds, hoursWorkedToday, workHoursSettings, user?.status]);

    const getLiveTimerSeconds = () => {
        const baseSeconds = timerBaseSecondsRef.current;
        const syncedAt = timerBaseSyncedAtRef.current;

        if (!syncedAt || user?.status !== 'active') {
            return baseSeconds;
        }

        const elapsedSeconds = Math.max(0, Math.floor((Date.now() - syncedAt) / 1000));
        return baseSeconds + elapsedSeconds;
    };

    // Sync timerSeconds with server data and manage the ticking interval
    useEffect(() => {
        // Initialize timer from server data if available AND user is active
        // If inactive (signed out), we reset to 0 as requested
        if ((user?.status === 'active' || user?.status === 'break') && user?.currentSessionHours !== undefined) {
            const baseSeconds = Math.floor(user.currentSessionHours * 3600);
            timerBaseSecondsRef.current = baseSeconds;
            timerBaseSyncedAtRef.current = user.status === 'active' ? Date.now() : null;
            setTimerSeconds(baseSeconds);
        } else {
            timerBaseSecondsRef.current = 0;
            timerBaseSyncedAtRef.current = null;
            setTimerSeconds(0);
        }

        // Sync hoursWorkedToday from server to ensure accumulation logic is correct on reload
        if (user?.hoursWorkedToday !== undefined) {
            setHoursWorkedToday(user.hoursWorkedToday);
        }

        // Only start the interval if the user is active
        let interval: any;
        if (user?.status === 'active') {
            interval = setInterval(() => {
                setTimerSeconds(getLiveTimerSeconds());
            }, 1000);
        }

        return () => {
            if (interval) clearInterval(interval);
        };
    }, [user?.status, user?.hoursWorkedToday, user?.currentSessionHours]);

    useEffect(() => {
        const handleVisibilityOrFocus = () => {
            if (document.visibilityState !== 'visible') {
                return;
            }

            if (user?.status === 'active') {
                setTimerSeconds(getLiveTimerSeconds());
            }

            if (user?.status === 'active' || user?.status === 'break') {
                void refetchUser();
            }
        };

        document.addEventListener('visibilitychange', handleVisibilityOrFocus);
        window.addEventListener('focus', handleVisibilityOrFocus);

        return () => {
            document.removeEventListener('visibilitychange', handleVisibilityOrFocus);
            window.removeEventListener('focus', handleVisibilityOrFocus);
        };
    }, [refetchUser, user?.status]);

    // Geolocation Heartbeat
    useEffect(() => {
        if (!user || (user.status !== 'active' && user.status !== 'break')) return;

        const sendHeartbeat = () => {
            if (user.status === 'active' && navigator.geolocation) {
                navigator.geolocation.getCurrentPosition(
                    (pos) => {
                        const loc = { latitude: pos.coords.latitude, longitude: pos.coords.longitude };
                        setLocation(loc);
                        heartbeatMutation.mutate(loc);
                    },
                    () => {
                        heartbeatMutation.mutate(null);
                    },
                    { timeout: 10000 }
                );
            } else {
                heartbeatMutation.mutate(null);
            }
        };

        // Initial heartbeat
        sendHeartbeat();

        // Every 60 seconds
        const interval = setInterval(sendHeartbeat, 60000);
        return () => clearInterval(interval);
    }, [user?.status, user?.id]);




    const formattedDate = (date && !isNaN(date.getTime())) ? format(date, 'yyyy-MM-dd') : 'invalid-date';

    const actualVirtualTodayStr = useMemo(() => {
        const tz = user?.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone;
        return timeTravelData?.virtual_time 
            ? format(toZonedTime(new Date(timeTravelData.virtual_time), tz), 'yyyy-MM-dd') 
            : format(toZonedTime(new Date(), tz), 'yyyy-MM-dd');
    }, [timeTravelData?.virtual_time, user?.timezone]);

    // Reset removals when switching dates
    useEffect(() => {
        setRemovedAttachmentUrls([]);
    }, [formattedDate]);

    const { register, handleSubmit, setValue, reset, watch, formState: { errors, isSubmitting } } = useForm<TaskFormValues>({
        resolver: zodResolver(taskSchema),
        defaultValues: {
            todays_task: '',
        }
    });

    const todaysTaskValue = watch('todays_task');

    // TASK DATE LOGIC: If active, we usually want current day's task.
    // However, for consistency with the "Navigation" (calendar), we mostly use formattedDate.
    // BUT the user specifically requested that when COVERING, it should show current date.
    const taskTargetDate = useMemo(() => {
        // We always favor formattedDate as it is synced with sessionStartTime/coveredDate 
        // in the auto-sync useEffect above.
        return formattedDate;
    }, [formattedDate]);

    const { data: currentTask } = useQuery({
        queryKey: ['task', taskTargetDate, user?.id],
        queryFn: async () => {
            const res = await api.get(`/tasks/by-date/${taskTargetDate}`);
            return res.data;
        }
    });


    const hasSubmitted = !!currentTask && !!currentTask.id;

    useEffect(() => {
        if (currentTask) {
            setValue('todays_task', currentTask.todays_task || '');
        } else {
            reset({ todays_task: '' });
        }
    }, [currentTask, setValue, reset]);

    const { data: history, isLoading: isHistoryLoading } = useQuery({
        queryKey: ['history', user?.id],
        queryFn: async () => {
            const res = await api.get('/tasks/my-history');
            return res.data;
        }
    });
    const historyTasks = history?.tasks || [];
    const shouldVirtualizeHistory = historyTasks.length > 50;
    const historyVirtualizer = useVirtualizer({
        count: shouldVirtualizeHistory ? historyTasks.length : 0,
        getScrollElement: () => taskHistoryScrollRef.current,
        estimateSize: () => 132,
        overscan: 5
    });

    // Unified Schedule State (Synchronized with Backend)
    const { data: activeScheduleData, refetch: refetchSchedule } = useQuery({
        queryKey: ['activeSchedule', user?.id],
        queryFn: async () => {
            const res = await api.get('/tasks/schedule');
            return res.data;
        },
        enabled: !!user?.id
    });

    const { data: assignedTaskAlerts = [] } = useQuery({
        queryKey: ['assigned-task-alerts', user?.id],
        queryFn: async () => {
            const res = await api.get('/projects/tasks/assigned-alerts');
            return res.data;
        },
        enabled: !!user?.id
    });

    const dismissAssignedTaskAlertMutation = useMutation({
        mutationFn: async (taskId: number) => {
            const res = await api.post(`/projects/tasks/${taskId}/dismiss-alert`);
            return res.data;
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['assigned-task-alerts', user?.id] });
        },
        onError: (err: unknown) => { const error = err as { response?: { data?: { error?: string } } };
            setToast({ message: error.response?.data?.error || 'Failed to dismiss assigned task alert', type: 'error' });
        }
    });

    useEffect(() => {
        if (activeScheduleData?.scheduled_at) {
            setScheduledAt(new Date(activeScheduleData.scheduled_at));
        } else {
            setScheduledAt(null);
        }
    }, [activeScheduleData]);

    const { data: colleagues, refetch: refetchColleagues } = useQuery({
        queryKey: ['colleagues'],
        queryFn: async () => {
            const res = await api.get('/auth/colleagues');
            return res.data;
        }
    });

    const { data: holidays } = useQuery({
        queryKey: ['holidays'],
        queryFn: async () => {
            const res = await api.get('/auth/holidays');
            return res.data || [];
        }
    });




    const { data: leaves, refetch: refetchLeaves } = useQuery({
        queryKey: ['leaves', user?.id],
        queryFn: async () => {
            const res = await api.get('/leaves/my');
            return res.data;
        },
        enabled: !!user?.id,
    });

    const tz = user?.timezone || 'Asia/Dhaka';
    const offDayDetails = useMemo(() => getOffDayDetails(date, tz, workHoursSettings, holidays || [], leaves || []), [date, tz, workHoursSettings, holidays, leaves]);
    const isOffDay = offDayDetails.isOffDay;

    const todayOffDayDetails = useMemo(() => {
        const today = timeTravelData?.virtual_time ? new Date(timeTravelData.virtual_time) : new Date();
        return getOffDayDetails(today, tz, workHoursSettings, holidays || [], leaves || []);
    }, [tz, workHoursSettings, holidays, leaves, timeTravelData?.virtual_time]);

    const isTodayOffDay = todayOffDayDetails.isOffDay;



    const { data: monthlyStats, refetch: refetchMonthlyStats, dataUpdatedAt: monthlyStatsUpdatedAt } = useQuery({
        queryKey: ['myMonthlyStats', user?.id],
        queryFn: async () => {
            const res = await api.get('/activity/my-monthly-stats');
            return res.data;
        },
        enabled: !!user
    });





    const { data: uncoveredLeaves, refetch: refetchUncovered } = useQuery({
        queryKey: ['uncoveredLeaves', user?.id],
        queryFn: async () => {
            const res = await api.get('/leaves/uncovered');
            return res.data;
        },
        enabled: !!user?.id
    });

    const { data: skippedDays, refetch: refetchSkippedDays } = useQuery({
        queryKey: ['skippedDays', user?.id],
        queryFn: async () => {
            const res = await api.get('/auth/skipped-days');
            return res.data;
        },
        enabled: !!user?.id
    });

    const refreshLeaveAndAttendanceState = async () => {
        await Promise.all([
            refetchLeaves(),
            refetchUncovered(),
            refetchSkippedDays(),
            refetchMonthlyStats(),
            refetchUser(),
            queryClient.refetchQueries({ queryKey: ['todayStatus', user?.id] }),
            queryClient.refetchQueries({ queryKey: ['history', user?.id] })
        ]);
    };


    // Real-time Dashboard Updates (Socket.io)
    useEffect(() => {
        if (!socket) return;

        const handleLeaveUpdate = (data: any) => {
            const leaveUserId = data.leave?.user_id || data.user_id;
            if (leaveUserId == user?.id) {
                void refreshLeaveAndAttendanceState();
            }
        };

        const handleSettingsUpdate = (data: any) => {
            if (data.type === 'work_hours_updated' || data.key === 'work_hours') {
                queryClient.invalidateQueries({ queryKey: ['workHoursSettings'] });
                setToast({ message: "Work schedule updated by admin.", type: 'info' });
            } else if (data.type === 'holidays_updated') {
                queryClient.invalidateQueries({ queryKey: ['holidays'] });
                setToast({ message: "Holiday schedule updated by admin.", type: 'info' });
            } else if (data.type === 'dev_tools_updated' || data.type === 'dev_tools_settings_updated') {
                queryClient.invalidateQueries({ queryKey: ['workHoursSettings'] });
                const enabled = typeof data?.enabled === 'boolean' ? data.enabled : data?.config?.enabled;
                setToast({ message: `Developer tools ${enabled === false ? 'disabled' : 'enabled'} by admin.`, type: 'info' });
            }
        };

        const handleStatusUpdate = () => {
            refetchColleagues();
        };

        const handleActivityLogged = (data: any) => {
            if (data.user_id == user?.id) {
                refetchMonthlyStats();
                refetchUncovered();
                refetchSkippedDays();
                queryClient.invalidateQueries({ queryKey: ['todayStatus', user?.id] });
                queryClient.invalidateQueries({ queryKey: ['me'] });
            }
        };

        const handleBalanceUpdate = (data: any) => {
            if (data.user_id == user?.id) {
                refetchMonthlyStats();
                refetchLeaves();
                refetchUncovered();
                refetchSkippedDays();
                refetchUser();
                queryClient.refetchQueries({ queryKey: ['todayStatus', user?.id] });
                queryClient.refetchQueries({ queryKey: ['history', user?.id] });
            }
        };

        const handleTaskUpdate = (data: any) => {
            if (data.userId === user?.id) {
                queryClient.invalidateQueries({ queryKey: ['task'] });
                queryClient.invalidateQueries({ queryKey: ['todayStatus', user?.id] });
                queryClient.invalidateQueries({ queryKey: ['history', user?.id] });
                queryClient.invalidateQueries({ queryKey: ['myMonthlyStats', user?.id] });
                queryClient.invalidateQueries({ queryKey: ['activeSchedule', user?.id] });
            }
        };

        const handleScheduleUpdate = (data: any) => {
            if (data.userId === user?.id) {
                queryClient.invalidateQueries({ queryKey: ['activeSchedule', user?.id] });
            }
        };

        const handleAssignedTaskAlertUpdate = (data: any) => {
            if (data.userId === user?.id) {
                queryClient.invalidateQueries({ queryKey: ['assigned-task-alerts', user?.id] });
            }
        };

        const handleProfileRequestUpdate = (data: any) => {
            if (data.userId === user?.id && data.type === 'handled') {
                queryClient.invalidateQueries({ queryKey: ['me'] });
                setToast({ message: `Your profile update request was ${data.status}`, type: data.status === 'approved' ? 'success' : 'error' });
            }
        };

        const handleOvertimeAlert = (data: any) => {
            if (data.userId === user?.id) {
                setToast({
                    message: `Time to Rest! You have been working for ${data.currentHours.toFixed(1)} hours. The limit is ${data.thresholdHours} hours.`,
                    type: 'warning'
                });
            }
        };

        socket.on('status_update', handleStatusUpdate);
        socket.on('activity_logged', handleActivityLogged);
        socket.on('balance_update', handleBalanceUpdate);
        socket.on('task_update', handleTaskUpdate);
        socket.on('schedule_update', handleScheduleUpdate);
        socket.on('assigned_task_alert_update', handleAssignedTaskAlertUpdate);
        socket.on('leave_update', handleLeaveUpdate);
        socket.on('settings_update', handleSettingsUpdate);
        socket.on('profile_request_update', handleProfileRequestUpdate);
        socket.on('overtime_alert', handleOvertimeAlert);

        return () => {
            socket.off('status_update', handleStatusUpdate);
            socket.off('activity_logged', handleActivityLogged);
            socket.off('balance_update', handleBalanceUpdate);
            socket.off('task_update', handleTaskUpdate);
            socket.off('schedule_update', handleScheduleUpdate);
            socket.off('assigned_task_alert_update', handleAssignedTaskAlertUpdate);
            socket.off('leave_update', handleLeaveUpdate);
            socket.off('settings_update', handleSettingsUpdate);
            socket.off('profile_request_update', handleProfileRequestUpdate);
            socket.off('overtime_alert', handleOvertimeAlert);
        };
    }, [socket, refetchColleagues, refetchLeaves, refetchMonthlyStats, refetchSkippedDays, refetchUncovered, refetchUser, queryClient, user?.id]);


    const submitTaskMutation = useMutation({
        mutationFn: async (payload: any) => {
            const res = await api.post('/tasks/submit', payload);
            return res.data;
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['task', formattedDate, user?.id] });
            queryClient.invalidateQueries({ queryKey: ['history', user?.id] });
            queryClient.invalidateQueries({ queryKey: ['activeSchedule', user?.id] });
            setTaskFiles([]); // Clear files
        }
    });

    const updateTaskMutation = useMutation({
        mutationFn: async (payload: any) => {
            const res = await api.put('/tasks/update', payload);
            return res.data;
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['task', formattedDate, user?.id] });
            queryClient.invalidateQueries({ queryKey: ['history', user?.id] });
            queryClient.invalidateQueries({ queryKey: ['activeSchedule', user?.id] });
            setTaskFiles([]); // Clear files
        }
    });

    const signInMutation = useMutation({
        mutationFn: async (plan: string) => {
            if (!navigator.onLine) {
                await saveOfflineCheckin({ type: 'sign-in', plan, location });
                return { isOffline: true };
            }
            const res = await api.post('/auth/sign-in', { plan, location });
            return res.data;
        },
        onSuccess: (data) => {
            if (data?.isOffline) {
                setToast({ message: "Checked in offline! Will sync when connection is restored.", type: 'warning' });
                queryClient.setQueryData(['me'], (old: any) => {
                    if (!old) return old;
                    return { ...old, status: 'active', currentSessionHours: 0 };
                });
            } else {
                queryClient.invalidateQueries({ queryKey: ["myMonthlyStats"] });
                refetchUser();
                refetchColleagues();
            }
        },
        onError: (err: unknown) => { const error = err as { response?: { data?: { error?: string } } };
            setToast({ message: error.response?.data?.error || "Failed to sign in", type: 'error' });
        }
    });

    useEffect(() => {
        const handleOnline = async () => {
            try {
                const checkins = await getOfflineCheckins();
                if (checkins.length > 0) {
                    for (const checkin of checkins) {
                        if (checkin.type === 'sign-in') {
                            await api.post('/auth/sign-in', { plan: checkin.plan, location: checkin.location });
                        }
                    }
                    await clearOfflineCheckins();
                    refetchUser();
                    setToast({ message: "Offline check-ins synced successfully!", type: 'success' });
                }
            } catch (err) {
                console.error("Failed to sync offline check-ins", err);
            }
        };

        window.addEventListener('online', handleOnline);
        if (navigator.onLine) {
            handleOnline();
        }

        return () => window.removeEventListener('online', handleOnline);
    }, []);

    const signOutMutation = useMutation({
        mutationFn: async (variables: { coverLeaveId?: number, coverLeaveIds?: number[], todaysTask?: string }) => {
            const res = await api.post('/auth/sign-out', variables);
            return res.data;
        },
        onSuccess: (data) => {
            // Instant UI update
            queryClient.setQueryData(['me'], (old: any) => {
                if (!old) return old;
                return {
                    ...old,
                    user: { ...old.user, status: 'inactive' },
                    hoursWorked: data.hoursWorked
                };
            });

            refetchUser();
            refetchColleagues();
            queryClient.invalidateQueries({ queryKey: ['todayStatus', user?.id] });
            queryClient.invalidateQueries({ queryKey: ['leaves', user?.id] });
            queryClient.invalidateQueries({ queryKey: ['uncoveredLeaves', user?.id] });
            queryClient.invalidateQueries({ queryKey: ['myMonthlyStats'] });

            const hoursWorked = data.hoursWorked || 0;
            setHoursWorkedToday(hoursWorked);

            // Close any modals
            setShowSignOutCoverModal(false);
            setShowEarlySignOutModal(false);
            setEarlySignOutReason('');
            setSelectedLeaveToCover(null);
        },
        onError: (err: unknown) => { const error = err as { response?: { data?: { error?: string } } };
            const errorMessage = error.response?.data?.error || "Failed to sign out";
            setToast({ message: errorMessage, type: 'error' });

            console.log('Sign Out Error:', errorMessage);

            if (errorMessage.includes("Please submit your task")) {
                console.log('Redirecting to tasks tab...');
                
                // Extract date from message if possible (e.g. "for 2026-03-16")
                const dateMatch = errorMessage.match(/(\d{4}-\d{2}-\d{2})/);
                if (dateMatch) {
                    const [y, m, d] = dateMatch[1].split('-').map(Number);
                    const targetDate = new Date(y, m - 1, d);
                    targetDate.setHours(0, 0, 0, 0);
                    setDate(targetDate);
                }

                handleTabChange('tasks');
                setShouldFocusTaskInput(true);
            }
        }
    });

    // Effect to handle focus after tab switch
    useEffect(() => {
        if (activeTab === 'tasks' && shouldFocusTaskInput) {
            console.log('Attempting to focus task input...', { ref: taskInputRef.current });
            // Wait for mount
            const timer = setTimeout(() => {
                if (taskInputRef.current) {
                    taskInputRef.current.focus();
                    console.log('Focus SUCCESS');
                } else {
                    console.log('Focus FAILED - Ref is null');
                }
                setShouldFocusTaskInput(false);
            }, 100);
            return () => clearTimeout(timer);
        }
    }, [activeTab, shouldFocusTaskInput]);

    const earlySignOutMutation = useMutation({
        mutationFn: async (reason: string) => {
            const res = await api.post('/auth/sign-out', { reason });
            return res.data;
        },
        onSuccess: (data) => {
            // Instant UI update
            queryClient.setQueryData(['me'], (old: any) => {
                if (!old) return old;
                return {
                    ...old,
                    user: { ...old.user, status: 'inactive' },
                    hoursWorked: data.hoursWorked
                };
            });

            refetchUser();
            refetchColleagues();
            queryClient.invalidateQueries({ queryKey: ['todayStatus', user?.id] });
            queryClient.invalidateQueries({ queryKey: ['myMonthlyStats'] });
            setShowEarlySignOutModal(false);
            setEarlySignOutReason('');
            setHoursWorkedToday(data.hoursWorked || 0);
        },
        onError: (err: unknown) => { const error = err as { response?: { data?: { error?: string } } };
            setToast({ message: error.response?.data?.error || "Failed to sign out early", type: 'error' });
        }
    });


    const coverLeaveMutation = useMutation({
        mutationFn: async ({ leaveId, holidayDate }: { leaveId: number; holidayDate: string }) => {
            const res = await api.post('/leaves/cover', { leaveId, holidayDate });
            return res.data;
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['uncoveredLeaves', user?.id] });
            queryClient.invalidateQueries({ queryKey: ['leaves', user?.id] });
        }
    });

    const handleCoverLeaveFromHistory = async (leave: any) => {
        const isAlreadyInSession = user?.status === 'active' || user?.status === 'break';

        if (isAlreadyInSession) {
            setToast({ message: 'You are already in a session', type: 'warning' });
            return;
        }

        if (!isProfileComplete) {
            setToast({
                message: 'Please complete your profile (Email, Contact, Bank Details) before signing in.',
                type: 'warning'
            });
            return;
        }

        try {
            await coverLeaveMutation.mutateAsync({
                leaveId: leave.id,
                holidayDate: actualVirtualTodayStr
            });
            await signInMutation.mutateAsync('');
            await refreshLeaveAndAttendanceState();
            setToast({
                message: `Signed in to cover ${format(new Date(leave.leave_date), 'MMM d, yyyy')}`,
                type: 'success'
            });
        } catch {
            // Mutation-level handlers already surface the error toast.
        }
    };

    const onTaskSubmit = async (data: TaskFormValues) => {
        let attachments: any[] = [];
        if (taskFiles.length > 0) {
            const optimizedTaskFiles = await compressFileList(taskFiles);
            attachments = await uploadFilesDirectly(optimizedTaskFiles);
        }

        const payload = {
            todays_task: data.todays_task,
            date: taskTargetDate,
            removed_attachments: removedAttachmentUrls,
            attachments
        };

        if (hasSubmitted) {
            await updateTaskMutation.mutateAsync(payload);
        } else {
            await submitTaskMutation.mutateAsync(payload);
        }

        // Trigger individual query invalidation for the target date to be sure
        queryClient.invalidateQueries({ queryKey: ['task', taskTargetDate, user?.id] });
        queryClient.invalidateQueries({ queryKey: ['todayStatus', user?.id, actualVirtualTodayStr] });

        // Clear scheduled state after normal submission (not scheduled)
        setScheduledAt(null);
    };



    const requestLeaveMutation = useMutation({
        mutationFn: async (data: { leaveDates: string[]; reason: string; leaveType: 'paid' | 'unpaid' }) => {
            return api.post('/leaves/request', data);
        },
        onSuccess: () => {
            setToast({ message: 'Leave request submitted successfully', type: 'success' });
            setShowLeaveModal(false);
            setLeaveReason('');
            setLeaveType('');
            refetchLeaves();
        },
        onError: (err: unknown) => { const error = err as { response?: { data?: { error?: string } } };
            setToast({ message: error.response?.data?.error || 'Failed to submit leave request', type: 'error' });
        }
    });

    const updateStatusMutation = useMutation({
        mutationFn: async (status: string) => {
            return api.put('/auth/status', { status, location: status === 'active' ? location : null });
        },
        onSuccess: (res) => {
            queryClient.invalidateQueries({ queryKey: ["myMonthlyStats"] });
            // Update local user state via refetch or manual cache update
            refetchUser();
            setToast({
                message: `Status updated to ${res.data.user.status}`,
                type: 'success'
            });
        },
        onError: () => {
            setToast({ message: 'Failed to update status', type: 'error' });
        }
    });


    const { data: todayStatus } = useQuery({
        queryKey: ['todayStatus', user?.id, taskTargetDate],
        queryFn: async () => {
            const res = await api.get(`/tasks/check-today?date=${taskTargetDate}`);
            return res.data;
        },
        enabled: !!user
    });

    const setTimeTravelMutation = useMutation({
        mutationFn: async (data: { offset_ms?: number, add_ms?: number, reset?: boolean }) => {
            return api.post('/dev/time-travel', data);
        },
        onSuccess: () => {
            refetchTimeTravel();
            refetchUser();
            refetchMonthlyStats();
            refetchSkippedDays();
            setToast({ message: 'Time travel updated', type: 'success' });
        },
        onError: () => {
            setToast({ message: 'Failed to update time', type: 'error' });
        }
    });

    const triggerTaskMutation = useMutation({
        mutationFn: async (task: string) => {
            return api.post('/dev/trigger-task', { task });
        },
        onSuccess: (_data: any, variables) => {
            setToast({ message: `Task '${variables}' triggered successfully`, type: 'success' });
        },
        onError: () => {
            setToast({ message: 'Failed to trigger task', type: 'error' });
        }
    });

    const resetUserDayMutation = useMutation({
        mutationFn: async () => {
            return api.post('/dev/reset-user-day');
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['me'] });
            queryClient.invalidateQueries({ queryKey: ['task'] });
            queryClient.invalidateQueries({ queryKey: ['todayStatus'] });
            queryClient.invalidateQueries({ queryKey: ['history'] });
            queryClient.invalidateQueries({ queryKey: ['myMonthlyStats'] });
            queryClient.invalidateQueries({ queryKey: ['colleagues'] });
            setToast({ message: "Today's session has been reset", type: 'success' });
        },
        onError: () => {
            setToast({ message: 'Failed to reset session', type: 'error' });
        }
    });

    const resetBalanceMutation = useMutation({
        mutationFn: async () => {
            return api.post('/dev/reset-balance');
        },
        onSuccess: async () => {
            await Promise.all([
                refetchSkippedDays(),
                refetchMonthlyStats(),
                refetchUser(),
                queryClient.refetchQueries({ queryKey: ['todayStatus', user?.id] }),
                queryClient.refetchQueries({ queryKey: ['history', user?.id] })
            ]);
            setToast({ message: "Balance history has been reset", type: 'success' });
        },
        onError: () => {
            setToast({ message: 'Failed to reset balance', type: 'error' });
        }
    });

    const resetMyLeavesMutation = useMutation({
        mutationFn: async () => {
            return api.post('/dev/reset-my-leaves');
        },
        onSuccess: async (data) => {
            await refreshLeaveAndAttendanceState();
            setToast({ message: data.data.message || "Leaves reset safely", type: 'success' });
        },
        onError: (err: unknown) => { const error = err as { response?: { data?: { error?: string } } };
            setToast({ message: error.response?.data?.error || "Failed to reset leaves", type: 'error' });
        }
    });

    const clearMySubmissionsMutation = useMutation({
        mutationFn: async () => {
            return api.post('/dev/clear-my-submissions');
        },
        onSuccess: async (data) => {
            await Promise.all([
                queryClient.invalidateQueries({ queryKey: ['task'] }),
                queryClient.invalidateQueries({ queryKey: ['todayStatus', user?.id] }),
                queryClient.invalidateQueries({ queryKey: ['history', user?.id] }),
                queryClient.invalidateQueries({ queryKey: ['myMonthlyStats', user?.id] }),
                queryClient.invalidateQueries({ queryKey: ['activeSchedule', user?.id] })
            ]);
            setToast({ message: data.data?.message || 'Your submissions were cleared', type: 'success' });
        },
        onError: (err: unknown) => { const error = err as { response?: { data?: { error?: string } } };
            setToast({ message: error.response?.data?.error || 'Failed to clear submissions', type: 'error' });
        }
    });



    const handlePlanSubmit = async () => {
        try {
            // If user is working on an off-day and chose to cover a leave or skipped day
            if (isOffDay && offDayMode === 'cover' && selectedLeaveToCover) {
                const coverValue = String(selectedLeaveToCover);
                if (coverValue.startsWith('skipped:')) {
                    // Covering a skipped day - sign in with coveredDate
                    const skippedDate = coverValue.replace('skipped:', '');
                    await api.post('/auth/sign-in', { coveredDate: skippedDate });
                    refetchSkippedDays();
                    queryClient.invalidateQueries({ queryKey: ['me'] });
                    
                    // Set calendar date to the skipped date immediately
                    if (skippedDate) {
                        const parts = skippedDate.split('-').map(Number);
                        if (parts.length === 3 && !parts.some(isNaN)) {
                            const cDate = new Date(parts[0], parts[1] - 1, parts[2]);
                            if (!isNaN(cDate.getTime())) {
                                cDate.setHours(0, 0, 0, 0);
                                setDate(cDate);
                            }
                        }
                    }
                    
                    setShowPlanModal(false);
                    setOffDayMode('overtime');
                    setSelectedLeaveToCover(null);
                    setToast({ message: `Signed in to cover ${skippedDate}`, type: 'success' });
                    return;
                } else {
                    // Covering a leave from the leaves table
                    const todayStr = format(new Date(), 'yyyy-MM-dd');
                    await coverLeaveMutation.mutateAsync({
                        leaveId: Number(coverValue),
                        holidayDate: todayStr
                    });
                }
            }

            await signInMutation.mutateAsync(""); // No plan needed
            setShowPlanModal(false);
            // Reset off-day states
            setOffDayMode('overtime');
            setSelectedLeaveToCover(null);
        } catch (error) {
            console.error("Failed to sign in:", error);
        }
    };

    const handleSignOut = async () => {
        // Sign out check for task on the date currently being worked on
        // FORCE check for session date if working, otherwise use calendar date
        let checkDate = formattedDate;
        if (user?.coveredDate) {
            checkDate = (typeof user.coveredDate === 'string') 
                ? user.coveredDate.substring(0, 10) 
                : format(new Date(user.coveredDate), 'yyyy-MM-dd');
        } else if (user?.sessionStartTime) {
            checkDate = user.sessionStartTime.includes('T') 
                ? user.sessionStartTime.split('T')[0] 
                : user.sessionStartTime.split(' ')[0];
        }

        let isTaskSubmitted = false;
        try {
            const res = await api.get(`/tasks/by-date/${checkDate}`);
            isTaskSubmitted = !!(res.data && res.data.id);
        } catch (err) {
            isTaskSubmitted = false;
        }

        if (!isTaskSubmitted) {
            setToast({ message: `Please submit your task for ${checkDate} before signing out.`, type: 'warning' });

            // Switch to the REQUIRED date
            const [y, m, d] = checkDate.split('-').map(Number);
            const targetDate = new Date(y, m - 1, d);
            targetDate.setHours(0, 0, 0, 0);
            setDate(targetDate);

            // Immediate Tab Switch & Focus
            handleTabChange('tasks');
            setShouldFocusTaskInput(true);
            return;
        }

        // Check if worked standard hours
        const standardHours = workHoursSettings?.standardHours || 4;
        const overtimeThreshold = workHoursSettings?.overtimeThreshold || 9.5;

        // When covering a skipped/leave day, hoursWorkedToday is for "virtual today" (different date)
        // but currentSessionHours is for the covered date. Use timer directly in that case.
        let totalHours: number;
        if (user?.coveredDate) {
            totalHours = timerSeconds / 3600;
        } else {
            const previousSessionsToday = hoursWorkedToday - (user?.currentSessionHours || 0);
            totalHours = previousSessionsToday + (timerSeconds / 3600);
        }

        // Robustness: totalHours should at least be the duration of the current session
        totalHours = Math.max(totalHours, timerSeconds / 3600);

        // Update local state for modal display
        setHoursWorkedToday(totalHours);

        const surplus = totalHours - standardHours;

        // Check if worked standard hours (skip on off-days)
        const checkOffDay = getOffDayDetails(checkDate, user?.timezone || 'Asia/Dhaka', workHoursSettings, holidays || []).isOffDay;

        if (totalHours < standardHours && !checkOffDay) {
            setShowEarlySignOutModal(true);
        } else if (totalHours >= overtimeThreshold && surplus > standardHours && uncoveredLeaves && uncoveredLeaves.length > 0) {
            // Trigger the new Pre-Sign-Out Modal for choosing to cover leave
            setShowSignOutCoverModal(true);
        } else {
            // Normal sign out (Banking Time)
            signOutMutation.mutate({});
        }
    };

    const handleEarlySignOut = () => {
        if (!earlySignOutReason.trim()) return;
        earlySignOutMutation.mutate(earlySignOutReason);
    };

    const copyToClipboard = (text: string, taskId?: number) => {
        navigator.clipboard.writeText(text);
        if (taskId) {
            setCopiedTaskId(taskId);
            setTimeout(() => setCopiedTaskId(null), 2000);
        } else {
            setToast({ message: "Copied to clipboard", type: 'success' });
        }
    };



    const isEditable = useMemo(() => {
        // Strict Session Rule: You can ONLY edit if you are actively in a session (Active/Break)
        // OR if you are viewing Today's date (even if signed out/inactive)
        const tz = user?.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone;
        const todayStr = timeTravelData?.virtual_time 
            ? format(toZonedTime(new Date(timeTravelData.virtual_time), tz), 'yyyy-MM-dd') 
            : format(toZonedTime(new Date(), tz), 'yyyy-MM-dd');
        const isActuallyToday = formattedDate === todayStr;

        if (isActuallyToday) return true;

        if (user?.status === 'active' || user?.status === 'break') {
            if (user?.coveredDate) {
                const coveredDateStr = (typeof user.coveredDate === 'string')
                    ? user.coveredDate.substring(0, 10)
                    : format(new Date(user.coveredDate), 'yyyy-MM-dd');
                return formattedDate === coveredDateStr;
            }

            if (user?.sessionStartTime) {
                // Standardize literal date extraction from sessionStartTime (ISO or Space)
                const sessionDateStr = user.sessionStartTime.includes('T') 
                    ? user.sessionStartTime.split('T')[0] 
                    : user.sessionStartTime.split(' ')[0];
                return formattedDate === sessionDateStr;
            }
        }
        return false;
    }, [user?.status, user?.sessionStartTime, user?.coveredDate, formattedDate, timeTravelData?.virtual_time, user?.timezone]);

    // Hold-to-Schedule: 10-second hold shows progress ring, then opens modal
    const HOLD_DURATION_MS = 10000;
    const HOLD_INTERVAL_MS = 50;

    const stopHold = () => {
        if (holdTimerRef.current) { clearTimeout(holdTimerRef.current); holdTimerRef.current = null; }
        if (holdIntervalRef.current) { clearInterval(holdIntervalRef.current); holdIntervalRef.current = null; }
        holdStartTime.current = null;
    };

    const handleHoldStart = (_e: React.MouseEvent | React.TouchEvent) => {
        if (!isEditable) return;
        stopHold();
        skipNextClickSubmitRef.current = false;
        scheduleOpenedByHoldRef.current = false;

        holdStartTime.current = Date.now();

        holdIntervalRef.current = setInterval(() => {
            const elapsed = Date.now() - (holdStartTime.current || 0);
            const pct = Math.min((elapsed / HOLD_DURATION_MS) * 100, 100);

            if (pct >= 100) {
                stopHold();
                scheduleOpenedByHoldRef.current = true;
                setIsSchedulingModalOpen(true);
            }
        }, HOLD_INTERVAL_MS);
    };

    const handleHoldEnd = async (_e: React.MouseEvent | React.TouchEvent) => {
        const holdDuration = holdStartTime.current ? Date.now() - holdStartTime.current : 0;
        
        // Clear state immediately to prevent parallel triggers
        stopHold();

        // If it was a quick click (less than 300ms), submit immediately
        if (holdDuration > 0 && holdDuration < 300) {
            const taskContent = (document.querySelector('[name="todays_task"]') as HTMLTextAreaElement)?.value;
            if (taskContent && taskContent.trim() && !isSubmitting) {
                skipNextClickSubmitRef.current = true;
                await onTaskSubmit({ todays_task: taskContent });
            }
        }
    };

    const handleButtonClick = (e: React.MouseEvent<HTMLButtonElement>) => {
        // Keep long-hold scheduling behavior and avoid duplicate submit after quick tap.
        e.preventDefault();
        if (scheduleOpenedByHoldRef.current) {
            scheduleOpenedByHoldRef.current = false;
            return;
        }
        if (skipNextClickSubmitRef.current) {
            skipNextClickSubmitRef.current = false;
            return;
        }
        void handleSubmit(onTaskSubmit)();
    };

    const scheduleTaskMutation = useMutation({
        mutationFn: async (payload: { scheduled_at: string, task_content: string, attachments: any[] }) => {
            const res = await api.post('/tasks/schedule', payload);
            return res.data;
        },
        onSuccess: () => {
            refetchSchedule();
            setIsSchedulingModalOpen(false);
            setToast({ message: "Submission scheduled successfully!", type: 'success' });
        },
        onError: (err: any) => {
            setToast({ message: err.response?.data?.error || "Failed to schedule", type: 'error' });
        }
    });

    const cancelScheduleMutation = useMutation({
        mutationFn: async () => {
            return api.delete('/tasks/schedule');
        },
        onSuccess: () => {
            refetchSchedule();
            setToast({ message: "Scheduled submission cancelled", type: 'info' });
        }
    });

    const handleScheduleConfirm = async () => {
        if (!scheduleDate || !scheduleTime) return;

        const [hours, minutes] = scheduleTime.split(':').map(Number);
        const schedDate = new Date(scheduleDate);
        schedDate.setHours(hours, minutes, 0, 0);

        const now = timeTravelData?.virtual_time ? new Date(timeTravelData.virtual_time) : new Date();

        if (schedDate <= now) {
            setToast({ message: "Schedule time must be in the future.", type: 'warning' });
            return;
        }

        const taskContent = (document.getElementById('todays_task') as HTMLTextAreaElement)?.value || "";
        const scheduledAtISO = schedDate.toISOString();

        let attachments: any[] = [];
        if (taskFiles.length > 0) {
            const optimizedTaskFiles = await compressFileList(taskFiles);
            attachments = await uploadFilesDirectly(optimizedTaskFiles);
        }

        scheduleTaskMutation.mutate({
            scheduled_at: scheduledAtISO,
            task_content: taskContent,
            attachments
        });
    };

    const isProfileComplete = useMemo(() => {
        if (!user || user.role !== 'employee') return true;
        return !!(user.email?.trim() && user.contact_number?.trim() && user.bank_details?.trim());
    }, [user]);

    const sidebarItems = useEmployeeSidebarItems();

    return (
        <div className="min-h-screen bg-background lg:pl-64">
            <RoleSidebar
                title="Track AI"
                subtitle="Employee Workspace"
                items={sidebarItems}
                userName={user?.full_name || user?.username}
                roleLabel={user?.department ? `${user.role} - ${user.department}` : user?.role}
                onLogout={logout}
            />
            {/* Modern Header */}
            <header className="sticky top-0 z-40 border-b border-border/40 bg-card/85 backdrop-blur-md">
                <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
                    <div className="flex min-h-16 flex-col gap-3 py-3 sm:h-16 sm:flex-row sm:items-center sm:justify-between sm:py-0">
                        {/* Logo & Title */}
                        <div className="flex w-full items-center justify-between sm:w-auto">
                            <div className="flex min-w-0 items-center gap-3">
                                <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-violet-600 via-purple-600 to-indigo-500 flex items-center justify-center shadow-lg shadow-violet-500/20">
                                    <ClipboardList className="w-5 h-5 text-white" />
                                </div>
                                <div>
                                    <h1 className="text-lg font-bold text-foreground">Dashboard</h1>
                                    <p className="text-xs text-muted-foreground">Daily Task System</p>
                                </div>
                            </div>
                            <div className="lg:hidden">
                                <MobileRoleSidebar
                                    title="Track AI"
                                    subtitle="Employee Workspace"
                                    items={sidebarItems}
                                    userName={user?.full_name || user?.username}
                                    roleLabel={user?.department ? `${user.role} - ${user.department}` : user?.role}
                                    onLogout={logout}
                                />
                            </div>
                        </div>
                    </div>
                </div>
            </header>

            <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
                {/* Status Banner */}
                {isOffDay && (
                    <div className="mb-6 bg-linear-to-r from-amber-500 to-orange-500 rounded-2xl p-6 text-white shadow-lg">
                        <div className="flex items-center gap-3">
                            <Coffee className="w-8 h-8" />
                            <div>
                                <h3 className="text-lg font-bold">Enjoy your {offDayDetails.holidayName || 'day off'}!</h3>
                                <p className="text-sm text-white/90">It's {offDayDetails.isHoliday ? 'a configured holiday' : 'your scheduled off-day'}.</p>
                            </div>
                        </div>
                    </div>
                )}

                {assignedTaskAlerts.length > 0 && (
                    <div className="mb-6 rounded-2xl border border-border/40 bg-card/75 dark:bg-card/45 backdrop-blur-md shadow-lg overflow-hidden">
                        <div className="bg-gradient-to-r from-violet-600 to-indigo-600 px-6 py-4 text-white">
                            <div className="flex items-center gap-3">
                                <div className="w-11 h-11 rounded-xl bg-white/10 flex items-center justify-center backdrop-blur-sm border border-white/20">
                                    <Briefcase className="w-5 h-5 text-white" />
                                </div>
                                <div>
                                    <h3 className="text-lg font-bold">New Assigned Tasks</h3>
                                    <p className="text-sm text-violet-100">These stay here until you dismiss them.</p>
                                </div>
                            </div>
                        </div>
                        <div className="p-4 sm:p-5 grid gap-3">
                            {assignedTaskAlerts.map((alert: any) => (
                                <div key={alert.task_id} className="rounded-2xl border border-border bg-muted/80 p-4">
                                    <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                                        <div className="min-w-0">
                                            <div className="flex flex-wrap items-center gap-2 mb-2">
                                                <span className="px-2.5 py-1 rounded-full bg-violet-100/10 dark:bg-violet-950/40 border border-violet-500/20 text-violet-600 dark:text-violet-300 text-xs font-semibold">
                                                    {alert.project_name}
                                                </span>
                                                <span className="px-2.5 py-1 rounded-full bg-secondary-light text-foreground text-xs font-semibold capitalize">
                                                    {String(alert.status || 'todo').replace('_', ' ')}
                                                </span>
                                                <span className="px-2.5 py-1 rounded-full bg-violet-100 text-violet-700 text-xs font-semibold capitalize">
                                                    {alert.priority}
                                                </span>
                                            </div>
                                            <h4 className="text-base font-bold text-foreground">{alert.title}</h4>
                                            {alert.description && (
                                                <p className="mt-1 text-sm text-muted-foreground line-clamp-2">{alert.description}</p>
                                            )}
                                            <p className="mt-3 text-xs text-muted-foreground">
                                                {alert.assigned_by_name ? `Assigned by ${alert.assigned_by_name} | ` : ''}
                                                Assigned on {format(new Date(alert.assigned_at), 'MMM d, yyyy h:mm a')}
                                                {alert.due_date ? ` | Due ${format(new Date(alert.due_date), 'MMM d, yyyy')}` : ''}
                                            </p>
                                        </div>
                                        <div className="flex items-center gap-2 shrink-0">
                                            <Button
                                                variant="outline"
                                                onClick={() => navigate(`/projects?project=${alert.project_id}`)}
                                                className="border-violet-200 dark:border-violet-850/40 text-violet-750 dark:text-violet-300 hover:bg-violet-50/50 dark:hover:bg-violet-950/20"
                                            >
                                                Open
                                            </Button>
                                            <Button
                                                variant="ghost"
                                                size="icon"
                                                onClick={() => dismissAssignedTaskAlertMutation.mutate(alert.task_id)}
                                                disabled={dismissAssignedTaskAlertMutation.isPending}
                                                className="text-muted-foreground hover:bg-secondary-light/70 hover:text-foreground"
                                            >
                                                <X className="w-4 h-4" />
                                            </Button>
                                        </div>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>
                )}

                {/* Status Section */}
                <div className={cn(
                    "grid grid-cols-1 gap-6 mb-8",
                    isEmployee ? "md:grid-cols-2" : "md:grid-cols-1"
                )}>
                    {/* Status Card */}
                    <Card className={cn(
                        "border border-border/40 shadow-xl bg-card/85 dark:bg-card/45 backdrop-blur-md rounded-2xl overflow-hidden relative",
                        !isEmployee && "md:max-w-2xl md:mx-auto w-full"
                    )}>
                        <div className="absolute top-0 right-0 p-4 opacity-10">
                            <Clock className="w-32 h-32 text-white" />
                        </div>
                        <div className="bg-gradient-to-br from-violet-600 via-indigo-650 to-indigo-800 p-6 h-full text-white relative z-10 flex flex-col justify-between">
                            <div className="flex flex-col gap-6 lg:flex-row lg:items-start lg:justify-between">
                                <div className="min-w-0 flex-1">
                                    <p className="text-violet-100 font-medium mb-1">{isEmployee ? 'Current Session' : 'Manager Status'}</p>
                                    <h2 className="text-4xl font-bold tracking-tight">{isEmployee ? formatTime(timerSeconds) : 'N/A'}</h2>
                                    <div className="mt-4 flex flex-wrap items-center gap-2">
                                        <div className={`w-3 h-3 rounded-full ${user?.status === 'active' ? 'bg-green-400 animate-pulse' : user?.status === 'break' ? 'bg-amber-400' : ((todayStatus?.hasSignedOut || todayStatus?.hasSubmitted) ? 'bg-violet-400' : 'bg-slate-400')}`} />
                                        <span className="text-sm font-medium text-violet-100">
                                            {isEmployee ? (
                                                user?.status === 'active' ? 'Currently Working' : user?.status === 'break' ? 'You are on Break' : ((todayStatus?.hasSignedOut || todayStatus?.hasSubmitted) ? 'Daily Task completed' : 'Not Working')
                                            ) : (
                                                'Management Role - No Tracking'
                                            )}
                                        </span>
                                        {todayOffDayDetails.isOffDay && (
                                            <div className={cn(
                                                "px-2 py-0.5 text-[10px] font-bold rounded-md flex items-center gap-1",
                                                todayOffDayDetails.isLeave 
                                                    ? "bg-amber-100 text-amber-800 border border-amber-200/50 shadow-sm"
                                                    : "bg-amber-400 text-amber-950 shadow-sm"
                                            )}>
                                                {todayOffDayDetails.isLeave ? (
                                                    <>
                                                        <Sparkles className="w-3 h-3 text-amber-500 animate-pulse" />
                                                        Leave Day
                                                    </>
                                                ) : (
                                                    <>
                                                        <Sparkles className="w-3 h-3" />
                                                        {todayOffDayDetails.holidayName}
                                                    </>
                                                )}
                                            </div>
                                        )}
                                        <div className="flex flex-col items-center justify-center min-w-[58px] h-[72px] bg-white/10 rounded-xl border border-white/20 shadow-sm backdrop-blur-xs transition hover:bg-white/20 overflow-hidden group">
                                            <div className="w-full bg-white/15 py-0.5 text-center">
                                                <span className="text-[8px] font-black text-violet-200 uppercase tracking-[0.2em] leading-none">
                                                    {format(date, 'MMM')}
                                                </span>
                                            </div>
                                            <div className="flex-1 flex flex-col items-center justify-center leading-none pb-1">
                                                <span className="text-xl font-black text-white group-hover:scale-110 transition-transform">
                                                    {format(date, 'd')}
                                                </span>
                                                <span className="text-[7px] font-bold text-violet-200 mt-0.5">
                                                    {format(date, 'yyyy')}
                                                </span>
                                            </div>
                                        </div>
                                    </div>
                                </div>

                                {isEmployee && user?.status === 'inactive' && (
                                    <div className="flex w-full flex-col gap-3 lg:w-auto">
                                        <div className="w-full space-y-3">
                                            <Button
                                                onClick={() => {
                                                    // If it's a leave day, user requested it count as a regular workday (no prompt for OT/Cover)
                                                    if (todayOffDayDetails.isOffDay && !todayOffDayDetails.isLeave) {
                                                        setShowPlanModal(true);
                                                    } else {
                                                        handlePlanSubmit();
                                                    }
                                                }}
                                                disabled={!isProfileComplete}
                                                className="w-full sm:w-40 h-12 rounded-xl bg-card text-violet-600 hover:text-violet-700 dark:text-violet-400 font-bold shadow-lg hover:bg-violet-50/90 dark:hover:bg-violet-950/20 transition border-0 disabled:opacity-70 disabled:cursor-not-allowed"
                                            >
                                                {!isProfileComplete ? (
                                                    <>
                                                        <AlertCircle className="w-5 h-5 mr-2 text-red-500" />
                                                        <span className="text-muted-foreground">Profile Required</span>
                                                    </>
                                                ) : (
                                                    <>
                                                        <PlayCircle className="w-5 h-5 mr-2" />
                                                        Sign In
                                                    </>
                                                )}
                                            </Button>
                                            {!isProfileComplete && (
                                                <p className="text-center text-xs text-violet-100/90 whitespace-nowrap">
                                                    <button
                                                        onClick={() => navigate('/profile')}
                                                        className="underline hover:text-white transition-colors cursor-pointer"
                                                    >
                                                        Go to Profile Settings
                                                    </button>
                                                </p>
                                            )}
                                        </div>
                                    </div>
                                )}
                            </div>

                            {isEmployee && user?.status !== 'inactive' && (
                                <div className="mt-8 flex gap-3">
                                    <Button
                                        onClick={() => {
                                            const newStatus = user?.status === 'break' ? 'active' : 'break';
                                            updateStatusMutation.mutate(newStatus);
                                        }}
                                        disabled={updateStatusMutation.isPending}
                                        className={cn(
                                            "flex-1 h-12 rounded-xl font-bold shadow-lg transition border-0",
                                            user?.status === 'break'
                                                ? "bg-green-500 hover:bg-green-600 text-white"
                                                : "bg-amber-500 hover:bg-amber-600 text-white"
                                        )}
                                    >
                                        {updateStatusMutation.isPending ? (
                                            <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                                        ) : user?.status === 'break' ? (
                                            <>
                                                <PlayCircle className="w-5 h-5 mr-2" />
                                                Resume
                                            </>
                                        ) : (
                                            <>
                                                <Coffee className="w-5 h-5 mr-2" />
                                                Break
                                            </>
                                        )}
                                    </Button>
                                    <Button
                                        onClick={handleSignOut}
                                        className="flex-1 h-12 rounded-xl bg-card text-violet-600 hover:text-violet-750 dark:text-violet-400 font-bold shadow-lg hover:bg-violet-50/90 dark:hover:bg-violet-950/20 transition border-0"
                                    >
                                        <LogOut className="w-5 h-5 mr-2" />
                                        Sign Out
                                    </Button>
                                </div>
                            )}
                        </div>
                    </Card>

                    {isEmployee && (
                        <Card className="border border-border/40 shadow-xl bg-card/85 dark:bg-card/45 backdrop-blur-md rounded-2xl overflow-hidden">
                            <div className="p-6 h-full flex flex-col">
                                <h3 className="font-semibold text-foreground mb-6 flex items-center gap-2">
                                    <CalendarIcon className="w-5 h-5 text-violet-600 dark:text-violet-450" />
                                    Monthly Activity
                                </h3>

                                <div className="space-y-6 flex-1">
                                    {/* Hours Progress */}
                                    <div className="space-y-2">
                                        <div className="flex justify-between text-sm">
                                            <span className="text-muted-foreground font-medium">Hours Worked</span>
                                            <span className="text-foreground font-bold">
                                                {(() => {
                                                    const staticHours = monthlyStats?.hoursWorked || 0;

                                                    if (user?.status !== "active") return `${staticHours.toFixed(2)} hrs`;

                                                    const sessionStartMs = user?.sessionStartTime ? new Date(user.sessionStartTime).getTime() : 0;
                                                    const lastFetchMs = monthlyStatsUpdatedAt || Date.now();

                                                    const liveBonusMs = Math.max(Date.now() - Math.max(lastFetchMs, sessionStartMs), 0);
                                                    const hoursSinceFetch = liveBonusMs / (1000 * 60 * 60);

                                                    const liveHours = staticHours + hoursSinceFetch;

                                                    return `${Math.max(liveHours, 0).toFixed(2)} hrs`;
                                                })()}
                                            </span>
                                        </div>
                                        <div className="h-2.5 w-full bg-muted rounded-full overflow-hidden">
                                            <div
                                                className="h-full bg-gradient-to-r from-violet-600 to-indigo-650 rounded-full transition duration-1000 ease-out"
                                                style={{ width: `${Math.min(((monthlyStats?.hoursWorked || 0) / ((monthlyStats?.totalWorkingDays || 20) * (workHoursSettings?.standardHours || 8))) * 100, 100)}%` }}
                                            />
                                        </div>
                                        <p className="text-xs text-muted-foreground text-right">
                                            Target: {((monthlyStats?.totalWorkingDays || 0) * (workHoursSettings?.standardHours || 8))} hrs
                                        </p>
                                    </div>

                                    {/* Days & Balance Grid */}
                                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                                        <div className="flex-1 p-3 bg-violet-100/10 dark:bg-violet-950/30 rounded-xl border border-violet-500/20 shadow-sm transition hover:bg-violet-100/20 dark:hover:bg-violet-950/50 group">
                                            <div className="flex items-center gap-2 mb-1.5">
                                                <CalendarIcon className="w-3.5 h-3.5 text-violet-500" />
                                                <span className="text-[10px] text-muted-foreground font-bold uppercase tracking-wider">Attendance</span>
                                            </div>
                                            <div className="flex items-baseline gap-1">
                                                <span className="text-xl font-bold text-foreground group-hover:scale-105 transition-transform">{monthlyStats?.attendanceCount || 0}</span>
                                                <span className="text-xs text-muted-foreground/70 font-medium">/ {monthlyStats?.totalWorkingDays || 0} days</span>
                                            </div>
                                        </div>
                                        <div className="flex-1 p-3 bg-violet-100/10 dark:bg-violet-950/30 rounded-xl border border-violet-500/20 shadow-sm transition hover:bg-violet-100/20 dark:hover:bg-violet-950/50 group">
                                            <div className="flex items-center gap-2 mb-1.5">
                                                <TrendingUp className="w-3.5 h-3.5 text-violet-500" />
                                                <span className="text-[10px] text-muted-foreground font-bold uppercase tracking-wider">Minutes Balance</span>
                                            </div>
                                            <div className={`text-xl font-bold group-hover:scale-105 transition-transform ${(() => {
                                                const balance = monthlyStats?.minutesBalance || 0;
                                                return balance >= 0 ? 'text-green-600' : 'text-red-600';
                                            })()}`}>
                                                {(() => {
                                                    const balance = monthlyStats?.minutesBalance || 0;
                                                    const isPositive = balance >= 0;
                                                    const absBalance = Math.abs(balance);
                                                    const h = Math.floor(absBalance / 60);
                                                    const m = Math.floor(absBalance % 60);
                                                    return `${isPositive ? '+' : '-'} ${h > 0 ? `${h}h ` : ''}${m}m`;
                                                })()}
                                            </div>
                                        </div>
                                        <div className="flex-1 p-3 bg-purple-50/50 rounded-xl border border-purple-100 shadow-sm transition hover:bg-purple-100/50 group">
                                            <div className="flex items-center gap-2 mb-1.5">
                                                <CalendarDays className="w-3.5 h-3.5 text-purple-500" />
                                                <span className="text-[10px] font-bold uppercase tracking-wider text-purple-600/70">Paid Leave Credit</span>
                                            </div>
                                            <div className="text-xl font-bold text-purple-600 group-hover:scale-105 transition-transform">
                                                {user?.paid_leave_balance || 0} <span className="text-[10px] text-purple-400 uppercase">Days</span>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </Card>
                    )}
                </div>



                {/* Main Tabs */}
                <Tabs value={activeTab} onValueChange={handleTabChange} className="space-y-6">
                    <div className="-mx-1 overflow-x-auto pb-1">
                    <TabsList className="inline-flex min-w-max items-center justify-start gap-1 rounded-full border border-border bg-card p-1 shadow-sm">
                        <TabsTrigger
                            value="tasks"
                            className="shrink-0 rounded-full px-4 data-[state=active]:bg-gradient-to-r data-[state=active]:from-violet-600 data-[state=active]:to-indigo-600 data-[state=active]:text-white transition sm:px-6"
                        >
                            <ClipboardList className="w-4 h-4 mr-2" />
                            Tasks
                        </TabsTrigger>
                        <TabsTrigger
                            value="history"
                            className="shrink-0 rounded-full px-4 data-[state=active]:bg-gradient-to-r data-[state=active]:from-violet-600 data-[state=active]:to-indigo-600 data-[state=active]:text-white transition sm:px-6"
                        >
                            <History className="w-4 h-4 mr-2" />
                            History
                        </TabsTrigger>
                        <TabsTrigger
                            value="team"
                            className="shrink-0 rounded-full px-4 data-[state=active]:bg-gradient-to-r data-[state=active]:from-violet-600 data-[state=active]:to-indigo-600 data-[state=active]:text-white transition sm:px-6"
                        >
                            <Users className="w-4 h-4 mr-2" />
                            Team
                        </TabsTrigger>
                        <TabsTrigger
                            value="chat"
                            className="shrink-0 rounded-full px-4 py-2.5 data-[state=active]:bg-gradient-to-r data-[state=active]:from-violet-600 data-[state=active]:to-indigo-600 data-[state=active]:text-white transition duration-300 sm:px-6"
                        >
                            <MessageCircle className="w-4 h-4 mr-2" />
                            Chat
                            {chatUnreadTotal > 0 && (
                                <span className="ml-1.5 bg-red-500 text-white text-[10px] font-bold rounded-full w-5 h-5 flex items-center justify-center">
                                    {chatUnreadTotal > 99 ? '99+' : chatUnreadTotal}
                                </span>
                            )}
                        </TabsTrigger>
                        <TabsTrigger
                            value="leaves"
                            className="shrink-0 rounded-full px-4 py-2.5 data-[state=active]:bg-gradient-to-r data-[state=active]:from-violet-600 data-[state=active]:to-indigo-600 data-[state=active]:text-white transition duration-300 sm:px-6"
                        >
                            <CalendarDays className="w-4 h-4 mr-2" />
                            Leaves
                        </TabsTrigger>
                        <TabsTrigger
                            value="skipped"
                            className="shrink-0 rounded-full px-4 py-2.5 data-[state=active]:bg-gradient-to-r data-[state=active]:from-violet-600 data-[state=active]:to-indigo-600 data-[state=active]:text-white transition duration-300 sm:px-6"
                        >
                            <AlertCircle className="w-4 h-4 mr-2" />
                            Skipped Days
                            {skippedDays?.filter((d: any) => !d.isCovered).length > 0 && (
                                <span className="ml-1.5 bg-red-500 text-white text-[10px] font-bold rounded-full w-5 h-5 flex items-center justify-center">
                                    {skippedDays.filter((d: any) => !d.isCovered).length}
                                </span>
                            )}
                        </TabsTrigger>
                        <TabsTrigger
                            value="voting"
                            className="shrink-0 rounded-full px-4 py-2.5 data-[state=active]:bg-gradient-to-r data-[state=active]:from-violet-600 data-[state=active]:to-indigo-600 data-[state=active]:text-white transition duration-300 sm:px-6"
                        >
                            <ThumbsUp className="w-4 h-4 mr-2" />
                            Feature Voting
                        </TabsTrigger>
                        <TabsTrigger
                            value="knowledge-base"
                            className="shrink-0 rounded-full px-4 py-2.5 data-[state=active]:bg-gradient-to-r data-[state=active]:from-violet-600 data-[state=active]:to-indigo-600 data-[state=active]:text-white transition duration-300 sm:px-6"
                        >
                            <Book className="w-4 h-4 mr-2" />
                            Knowledge Base
                        </TabsTrigger>
                        <TabsTrigger
                            value="changelog"
                            className="shrink-0 rounded-full px-4 py-2.5 data-[state=active]:bg-gradient-to-r data-[state=active]:from-violet-600 data-[state=active]:to-indigo-600 data-[state=active]:text-white transition duration-300 sm:px-6"
                        >
                            <Sparkles className="w-4 h-4 mr-2" />
                            Changelog
                        </TabsTrigger>
                        {workHoursSettings?.devToolsEnabled !== false && (
                            <TabsTrigger
                                value="developer"
                                className="shrink-0 rounded-full px-4 py-2.5 data-[state=active]:bg-gradient-to-r data-[state=active]:from-violet-600 data-[state=active]:to-indigo-600 data-[state=active]:text-white transition duration-300 sm:px-6"
                            >
                                <Sparkles className="w-4 h-4 mr-2" />
                                Dev Tools
                            </TabsTrigger>
                        )}
                    </TabsList>
                    </div>

                    {/* Developer Tools Tab */}
                    <TabsContent value="developer">
                        {workHoursSettings?.devToolsEnabled !== false ? (
                            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                            {/* Time Travel Card */}
                            <Card className="border-0 shadow-sm bg-card rounded-2xl">
                                <CardHeader className="border-b border-border/50">
                                    <div className="flex items-center justify-between">
                                        <CardTitle className="text-lg flex items-center gap-2">
                                            <Clock className="w-5 h-5 text-purple-500" />
                                            Time Travel (Virtual Clock)
                                        </CardTitle>
                                        <Button
                                            variant="outline"
                                            size="sm"
                                            onClick={() => refetchTimeTravel()}
                                            className="h-8 gap-2"
                                        >
                                            <Activity className="w-4 h-4" />
                                            Refresh
                                        </Button>
                                    </div>
                                    <CardDescription>
                                        Simulate future dates/times for testing scheduled tasks.
                                    </CardDescription>
                                </CardHeader>
                                <CardContent className="pt-6">
                                    <div className="space-y-6">
                                        {/* Status Banner */}
                                        <div className={cn(
                                            "rounded-xl p-4 border",
                                            timeTravelData?.offset_ms > 0
                                                ? "bg-amber-50 border-amber-100"
                                                : "bg-muted border-border/50"
                                        )}>
                                            <div className="flex gap-3">
                                                <Activity className={cn(
                                                    "w-5 h-5 shrink-0 mt-0.5",
                                                    timeTravelData?.offset_ms > 0 ? "text-amber-600" : "text-muted-foreground"
                                                )} />
                                                <div className="space-y-1">
                                                    <p className={cn(
                                                        "text-sm font-semibold",
                                                        timeTravelData?.offset_ms > 0 ? "text-amber-900" : "text-foreground"
                                                    )}>
                                                        {timeTravelData?.offset_ms > 0 ? "Time Travel Active" : "Using System Time"}
                                                    </p>
                                                    <div className="text-xs space-y-1">
                                                        <div className="flex justify-between w-64">
                                                            <span className="text-muted-foreground">System Time:</span>
                                                            <span className="font-mono">{timeTravelData?.system_time ? format(new Date(timeTravelData.system_time), 'MMM d, h:mm:ss a') : '...'}</span>
                                                        </div>
                                                        <div className="flex justify-between w-64">
                                                            <span className="text-muted-foreground">Virtual Time:</span>
                                                            <span className={cn("font-mono font-bold", timeTravelData?.offset_ms > 0 ? "text-amber-700" : "")}>
                                                                {timeTravelData?.virtual_time ? format(new Date(timeTravelData.virtual_time), 'MMM d, h:mm:ss a') : '...'}
                                                            </span>
                                                        </div>
                                                        <div className="flex justify-between w-64">
                                                            <span className="text-muted-foreground">Offset:</span>
                                                            <span className="font-mono">{timeTravelData?.offset_ms >= 0 ? '+' : ''}{((timeTravelData?.offset_ms || 0) / 3600000).toFixed(2)} hours</span>
                                                        </div>
                                                    </div>
                                                </div>
                                            </div>
                                        </div>

                                        {/* Controls */}
                                        <div className="space-y-3">
                                            <Label className="text-sm font-medium text-foreground">Adjust Time</Label>
                                            <div className="grid grid-cols-2 gap-2">
                                                <Button
                                                    variant="outline"
                                                    onClick={() => setTimeTravelMutation.mutate({ add_ms: -3600000 })} // -1 Hour
                                                    disabled={setTimeTravelMutation.isPending}
                                                    className="justify-start border-red-100 hover:bg-red-50 text-red-600"
                                                >
                                                    -1 Hour
                                                </Button>
                                                <Button
                                                    variant="outline"
                                                    onClick={() => setTimeTravelMutation.mutate({ add_ms: 3600000 })} // +1 Hour
                                                    disabled={setTimeTravelMutation.isPending}
                                                    className="justify-start"
                                                >
                                                    +1 Hour
                                                </Button>
                                                <Button
                                                    variant="outline"
                                                    onClick={() => setTimeTravelMutation.mutate({ add_ms: -86400000 })} // -1 Day
                                                    disabled={setTimeTravelMutation.isPending}
                                                    className="justify-start border-red-100 hover:bg-red-50 text-red-600"
                                                >
                                                    -1 Day
                                                </Button>
                                                <Button
                                                    variant="outline"
                                                    onClick={() => setTimeTravelMutation.mutate({ add_ms: 86400000 })} // +1 Day
                                                    disabled={setTimeTravelMutation.isPending}
                                                    className="justify-start"
                                                >
                                                    +1 Day
                                                </Button>
                                                <Button
                                                    variant="outline"
                                                    onClick={() => setTimeTravelMutation.mutate({ add_ms: 604800000 })} // +7 Days
                                                    disabled={setTimeTravelMutation.isPending}
                                                    className="justify-start"
                                                >
                                                    +7 Days
                                                </Button>
                                                <Button
                                                    variant="outline"
                                                    onClick={() => setTimeTravelMutation.mutate({ add_ms: 2592000000 })} // +30 Days
                                                    disabled={setTimeTravelMutation.isPending}
                                                    className="justify-start"
                                                >
                                                    +30 Days
                                                </Button>
                                            </div>

                                            <div className="pt-2">
                                                <Button
                                                    variant="destructive"
                                                    className="w-full"
                                                    onClick={() => setTimeTravelMutation.mutate({ reset: true })}
                                                    disabled={setTimeTravelMutation.isPending || !timeTravelData?.offset_ms}
                                                >
                                                    Reset to Real Time
                                                </Button>
                                            </div>
                                        </div>
                                    </div>
                                </CardContent>
                            </Card>

                            {/* Task Triggers Card */}
                            <Card className="border-0 shadow-sm bg-card rounded-2xl">
                                <CardHeader className="border-b border-border/50">
                                    <div className="flex items-center justify-between">
                                        <CardTitle className="text-lg flex items-center gap-2">
                                            <Sparkles className="w-5 h-5 text-purple-500" />
                                            Task Triggers
                                        </CardTitle>
                                    </div>
                                    <CardDescription>
                                        Manually trigger scheduled jobs immediately.
                                    </CardDescription>
                                </CardHeader>
                                <CardContent className="pt-6">
                                    <div className="space-y-4">
                                        <div className="p-4 rounded-xl border border-border bg-muted hover:bg-card transition">
                                            <div className="flex justify-between items-center mb-2">
                                                <div className="flex items-center gap-2">
                                                    <Clock className="w-4 h-4 text-purple-500" />
                                                    <span className="font-semibold text-foreground">Overtime Check</span>
                                                </div>
                                                <Button
                                                    size="sm"
                                                    onClick={() => triggerTaskMutation.mutate('overtime_check')}
                                                    disabled={triggerTaskMutation.isPending}
                                                >
                                                    Run Now
                                                </Button>
                                            </div>
                                            <p className="text-xs text-muted-foreground">
                                                Checks your active session for excessive hours and sends email alerts if threshold met.
                                            </p>
                                        </div>

                                        <div className="p-4 rounded-xl border border-border bg-muted hover:bg-card transition">
                                            <div className="flex justify-between items-center mb-2">
                                                <div className="flex items-center gap-2">
                                                    <Trash2 className="w-4 h-4 text-red-500" />
                                                    <span className="font-semibold text-foreground">Attachment Cleanup</span>
                                                </div>
                                                <Button
                                                    size="sm"
                                                    onClick={() => triggerTaskMutation.mutate('attachment_cleanup')}
                                                    disabled={triggerTaskMutation.isPending}
                                                >
                                                    Run Now
                                                </Button>
                                            </div>
                                            <p className="text-xs text-muted-foreground">
                                                Force clear expired chat attachments and their files from the server.
                                            </p>
                                        </div>

                                        <div className="p-4 rounded-xl border border-border bg-muted hover:bg-card transition">
                                            <div className="flex justify-between items-center mb-2">
                                                <div className="flex items-center gap-2">
                                                    <CalendarDays className="w-4 h-4 text-blue-500" />
                                                    <span className="font-semibold text-foreground">Missed Working Days</span>
                                                </div>
                                                <Button
                                                    size="sm"
                                                    onClick={() => triggerTaskMutation.mutate('missed_day_check')}
                                                    disabled={triggerTaskMutation.isPending}
                                                >
                                                    Run Now
                                                </Button>
                                            </div>
                                            <p className="text-xs text-muted-foreground">
                                                Deducts standard working hours from balance if you skipped a working day.
                                            </p>
                                        </div>

                                        <div className="pt-2">
                                            <Button
                                                variant="destructive"
                                                className="w-full gap-2"
                                                onClick={() => {
                                                    if (window.confirm("Are you sure you want to reset all logs and tasks for TODAY? This cannot be undone.")) {
                                                        resetUserDayMutation.mutate();
                                                    }
                                                }}
                                                disabled={resetUserDayMutation.isPending}
                                            >
                                                <RotateCcw className="w-4 h-4" />
                                                Reset Today's Session
                                            </Button>
                                            <p className="mt-2 text-[10px] text-muted-foreground/70 text-center">
                                                Clears your activity logs, tasks, and status for the current virtual day.
                                            </p>
                                        </div>

                                        <div className="pt-2 border-t border-border/50 mt-2">
                                            <Button
                                                variant="outline"
                                                className="w-full gap-2 text-red-600 border-red-200 hover:bg-red-50"
                                                onClick={() => {
                                                    if (window.confirm("Are you sure you want to reset your entire BALANCE history to 0? This cannot be undone.")) {
                                                        resetBalanceMutation.mutate();
                                                    }
                                                }}
                                                disabled={resetBalanceMutation.isPending}
                                            >
                                                <TrendingUp className="w-4 h-4" />
                                                Reset Balance History
                                            </Button>
                                            <p className="mt-2 text-[10px] text-muted-foreground/70 text-center">
                                                Zeroes out your accumulated minutes_balance in the database.
                                            </p>
                                        </div>

                                        <div className="pt-2 border-t border-border/50 mt-2">
                                            <Button
                                                variant="outline"
                                                className="w-full gap-2 text-amber-600 border-amber-200 hover:bg-amber-50"
                                                onClick={() => {
                                                    if (window.confirm("Are you sure you want to delete ALL your leave requests? This will also RESTORE your paid leave credits for approved ones.")) {
                                                        resetMyLeavesMutation.mutate();
                                                    }
                                                }}
                                                disabled={resetMyLeavesMutation.isPending}
                                            >
                                                <CalendarDays className="w-4 h-4" />
                                                Reset My Leave History
                                            </Button>
                                            <p className="mt-2 text-[10px] text-muted-foreground/70 text-center">
                                                Clears all your leave records and restores your Paid Leave Balance.
                                            </p>
                                        </div>

                                        <div className="pt-2 border-t border-border/50 mt-2">
                                            <Button
                                                variant="outline"
                                                className="w-full gap-2 text-rose-600 border-rose-200 hover:bg-rose-50"
                                                onClick={() => {
                                                    if (window.confirm("Are you sure you want to delete ALL your task submissions across all dates, including today and past days? Saved daily summaries for those dates will also be cleared. This cannot be undone.")) {
                                                        clearMySubmissionsMutation.mutate();
                                                    }
                                                }}
                                                disabled={clearMySubmissionsMutation.isPending}
                                            >
                                                <ClipboardList className="w-4 h-4" />
                                                {clearMySubmissionsMutation.isPending ? 'Clearing All My Submissions...' : 'Clear All My Submissions'}
                                            </Button>
                                            <p className="mt-2 text-[10px] text-muted-foreground/70 text-center">
                                                Removes your full submission history for all dates, not only today, and clears affected saved daily summaries.
                                            </p>
                                        </div>
                                    </div>
                                </CardContent>
                            </Card>
                        </div>
                        ) : (
                            <div className="flex flex-col items-center justify-center p-12 text-center space-y-4 bg-muted rounded-2xl border border-border border-dashed">
                                <div className="w-16 h-16 rounded-full bg-muted flex items-center justify-center">
                                    <Shield className="w-8 h-8 text-muted-foreground/70" />
                                </div>
                                <div className="space-y-1">
                                    <h3 className="text-lg font-semibold text-foreground">Developer Tools Disabled</h3>
                                    <p className="text-sm text-muted-foreground max-w-sm mx-auto">
                                        Developer tools have been disabled by the administrator. Contact your supervisor if you need access.
                                    </p>
                                </div>
                            </div>
                        )}
                    </TabsContent>
                    <TabsContent value="tasks" className="space-y-6">
                        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                            {/* Calendar Card */}
                            <Card className="border border-border/40 shadow-xl bg-card/85 dark:bg-card/45 backdrop-blur-md rounded-2xl">
                                <CardHeader className="pb-2">
                                    <CardTitle className="text-lg flex items-center gap-2">
                                        <CalendarIcon className="w-5 h-5 text-violet-500" />
                                        Select Date
                                    </CardTitle>
                                </CardHeader>
                                <CardContent className="pt-0">
                                    <Calendar
                                        mode="single"
                                        selected={date}
                                        onSelect={(d) => d && setDate(d)}
                                        className="rounded-xl border border-border w-full"
                                    />
                                </CardContent>
                            </Card>

                            {/* Task Form Card */}
                            <Card className="lg:col-span-2 border border-border/40 shadow-xl bg-card/85 dark:bg-card/45 backdrop-blur-md rounded-2xl">
                                <CardHeader>
                                    <CardTitle className="text-lg flex items-center gap-2">
                                        <Target className="w-5 h-5 text-violet-500" />
                                        {hasSubmitted ? 'Update Task' : 'Submit Task'}
                                    </CardTitle>
                                    <CardDescription>
                                        {format(new Date(taskTargetDate.split('-').map(Number)[0], taskTargetDate.split('-').map(Number)[1] - 1, taskTargetDate.split('-').map(Number)[2]), 'MMMM d, yyyy')}
                                        {(user?.status === 'active' || user?.status === 'break') && user?.coveredDate && (
                                            <span className="ml-2 text-violet-600 dark:text-violet-400 font-medium">(Working on {format(date, 'MMM d')})</span>
                                        )}
                                    </CardDescription>
                                </CardHeader>
                                <CardContent>
                                    <form onSubmit={handleSubmit(onTaskSubmit)} className="space-y-5">
                                        <div className="space-y-2">
                                            <Label htmlFor="todays_task" className="text-sm font-medium text-foreground">
                                                Today's Task
                                            </Label>
                                            <textarea
                                                id="todays_task"
                                                {...register('todays_task')}
                                                ref={(e) => {
                                                    register('todays_task').ref(e);
                                                    taskInputRef.current = e;
                                                }}
                                                disabled={
                                                    !isEditable ||
                                                    (!hasSubmitted && (
                                                        (isOffDay && user?.status === 'inactive') ||
                                                        (user?.status !== 'active' && user?.status !== 'break')
                                                    ))
                                                }
                                                placeholder="What did you accomplish today?"
                                                className="w-full min-h-[120px] p-4 rounded-xl border border-border bg-background focus:border-violet-500 focus:ring-2 focus:ring-violet-500/20 outline-none resize-none transition disabled:bg-muted disabled:text-muted-foreground/70"
                                            />
                                            {errors.todays_task && (
                                                <p className="text-sm text-red-500 flex items-center gap-1">
                                                    <AlertCircle className="w-4 h-4" />
                                                    {errors.todays_task.message}
                                                </p>
                                            )}

                                            {/* File Attachments */}
                                            <div className="space-y-2">
                                                <Label className="text-sm font-medium text-foreground">Attachments (Images/Videos)</Label>

                                                {/* Hidden File Input */}
                                                <input
                                                    type="file"
                                                    id="task-attachments"
                                                    multiple
                                                    accept="image/*,video/*"
                                                    className="hidden"
                                                    disabled={!isEditable}
                                                    onChange={(e) => {
                                                        if (e.target.files && e.target.files.length > 0) {
                                                            const selectedFiles = Array.from(e.target.files);
                                                            const maxSize = 70 * 1024 * 1024; // 70MB

                                                            const validFiles = selectedFiles.filter(file => {
                                                                if (file.size > maxSize) {
                                                                    setToast({ message: `File ${file.name} is too large. Max size is 70MB.`, type: 'error' });
                                                                    return false;
                                                                }
                                                                return true;
                                                            });

                                                            if (validFiles.length > 0) {
                                                                setTaskFiles(prev => [...prev, ...validFiles]);
                                                            }
                                                        }
                                                    }}
                                                />

                                                {/* Custom Upload Button */}
                                                <div className="flex flex-wrap gap-2">
                                                    <Label
                                                        htmlFor="task-attachments"
                                                        className={cn(
                                                            "inline-flex items-center gap-2 px-4 py-2 rounded-lg border border-dashed border-input bg-muted hover:bg-muted cursor-pointer transition-colors text-muted-foreground text-sm font-medium",
                                                            !isEditable && "opacity-50 cursor-not-allowed pointer-events-none"
                                                        )}
                                                    >
                                                        <Upload className="w-4 h-4" />
                                                        Add Files
                                                    </Label>
                                                </div>

                                                {/* Previews */}
                                                {taskFiles.length > 0 && (
                                                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mt-2">
                                                        {taskFiles.map((file, index) => (
                                                            <div
                                                                onClick={() => setSelectedMedia({
                                                                    url: URL.createObjectURL(file),
                                                                    type: file.type.startsWith('image/') ? 'image' : 'video'
                                                                })}
                                                                className="relative group aspect-square rounded-lg overflow-hidden border border-border cursor-pointer hover:opacity-90 transition-opacity"
                                                            >
                                                                {file.type.startsWith('image/') ? (
                                                                    <img
                                                                        src={URL.createObjectURL(file)}
                                                                        alt={file.name}
                                                                        className="w-full h-full object-cover"
                                                                    />
                                                                ) : (
                                                                    <div className="w-full h-full bg-muted flex items-center justify-center relative">
                                                                        <video
                                                                            src={`${URL.createObjectURL(file)}#t=0.1`}
                                                                            className="w-full h-full object-cover"
                                                                            preload="metadata"
                                                                            muted
                                                                            playsInline
                                                                        />
                                                                        <div className="absolute inset-0 flex items-center justify-center bg-black/10">
                                                                            <Video className="w-8 h-8 text-white drop-shadow-md" />
                                                                        </div>
                                                                    </div>
                                                                )}
                                                                {isEditable && (
                                                                    <button
                                                                        type="button"
                                                                        onClick={(e) => {
                                                                            e.stopPropagation();
                                                                            setTaskFiles(prev => prev.filter((_, i) => i !== index));
                                                                        }}
                                                                        className="absolute top-1 right-1 p-1 rounded-full bg-black/60 text-white hover:bg-black/80 transition z-10"
                                                                    >
                                                                        <X className="w-3 h-3" />
                                                                    </button>
                                                                )}
                                                                <span className="absolute bottom-0 left-0 right-0 bg-black/60 text-white text-[10px] px-2 py-1 truncate">
                                                                    {file.name}
                                                                </span>
                                                            </div>
                                                        ))}
                                                    </div>
                                                )}

                                                {/* Existing Attachments Display (With removal option) */}
                                                {currentTask?.attachments && (Array.isArray(currentTask.attachments) ? currentTask.attachments : [])
                                                    .filter((att: any) => !removedAttachmentUrls.includes(att.url)).length > 0 && (
                                                        <div className="mt-4">
                                                            <p className="text-xs font-medium text-muted-foreground mb-2">Previous Attachments:</p>
                                                            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                                                                {(Array.isArray(currentTask.attachments) ? currentTask.attachments : [])
                                                                    .filter((att: any) => !removedAttachmentUrls.includes(att.url))
                                                                    .map((att: any, idx: number) => (
                                                                        <div key={idx} className="relative group aspect-square">
                                                                            <div
                                                                                onClick={() => setSelectedMedia({
                                                                                    url: getAssetUrl(att.url) || att.url,
                                                                                    type: att.type.startsWith('image/') ? 'image' : 'video'
                                                                                })}
                                                                                className="block w-full h-full rounded-lg overflow-hidden border border-border hover:opacity-90 transition-opacity cursor-pointer"
                                                                            >
                                                                                {att.type.startsWith('image/') ? (
                                                                                    <img
                                                                                        src={getAssetUrl(att.url)}
                                                                                        alt={att.name}
                                                                                        className="w-full h-full object-cover"
                                                                                    />
                                                                                ) : (
                                                                                    <div className="w-full h-full bg-muted flex items-center justify-center relative">
                                                                                        <VideoThumbnail url={getAssetUrl(att.url) || att.url} />
                                                                                        <div className="absolute inset-0 flex items-center justify-center bg-black/10">
                                                                                            <Video className="w-8 h-8 text-white drop-shadow-md" />
                                                                                        </div>
                                                                                    </div>
                                                                                )}
                                                                            </div>
                                                                            {isEditable && (
                                                                                <button
                                                                                    type="button"
                                                                                    onClick={(e) => {
                                                                                        e.stopPropagation();
                                                                                        setRemovedAttachmentUrls(prev => [...prev, att.url]);
                                                                                    }}
                                                                                    className="absolute top-1 right-1 p-1 rounded-full bg-red-500 text-white opacity-100 transition z-10 hover:bg-red-600 shadow-sm"
                                                                                    title="Remove attachment"
                                                                                >
                                                                                    <X className="w-3 h-3" />
                                                                                </button>
                                                                            )}
                                                                        </div>
                                                                    ))}
                                                            </div>
                                                        </div>
                                                    )}
                                            </div>

                                            {(!user?.status || (user.status !== 'active' && user.status !== 'break')) && !isOffDay && !hasSubmitted && (
                                                <p className="text-xs text-amber-600 flex items-center gap-1 mt-2">
                                                    <span className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-pulse" />
                                                    Please sign in to start your work session before submitting tasks.
                                                </p>
                                            )}

                                        </div>

                                        <div className="space-y-2">
                                            {/* Removed Tomorrow's Plan field as requested */}
                                        </div>

                                        <div className="flex gap-3 pt-2">
                                            <div className="relative flex-1 group">
                                                {/* Hidden hold-progress ring removed */}
                                                <Button
                                                    type="button"
                                                    onClick={handleButtonClick}
                                                    onMouseDown={handleHoldStart}
                                                    onMouseUp={handleHoldEnd}
                                                    onMouseLeave={handleHoldEnd}
                                                    onTouchStart={handleHoldStart}
                                                    onTouchEnd={handleHoldEnd}
                                                    disabled={
                                                        isSubmitting ||
                                                        !isEditable ||
                                                        (!hasSubmitted && (
                                                            (isOffDay && user?.status === 'inactive') ||
                                                            (user?.status !== 'active' && user?.status !== 'break')
                                                        )) ||
                                                        submitTaskMutation.isPending ||
                                                        updateTaskMutation.isPending
                                                    }
                                                    className="w-full h-12 rounded-xl bg-gradient-to-r from-violet-600 to-indigo-600 hover:from-violet-500 hover:to-indigo-500 text-white font-semibold shadow-lg shadow-violet-500/20 hover:scale-[1.01] active:scale-[0.99] transition-all duration-200 select-none cursor-pointer"
                                                >
                                                    {submitTaskMutation.isPending || updateTaskMutation.isPending ? (
                                                        <span className="flex items-center gap-2">
                                                            <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                                                            {hasSubmitted ? 'Updating...' : 'Submitting...'}
                                                        </span>
                                                    ) : (
                                                        <>
                                                            {hasSubmitted ? (
                                                                <>
                                                                    <Edit3 className="w-4 h-4 mr-2" />
                                                                    Update Task
                                                                </>
                                                            ) : (
                                                                <>
                                                                    <Send className="w-4 h-4 mr-2" />
                                                                    Submit Task
                                                                </>
                                                            )}
                                                        </>
                                                    )}
                                                </Button>
                                                {scheduledAt && (
                                                    <div className="absolute -top-2 -right-2 bg-purple-600 text-white text-[10px] px-2 py-0.5 rounded-full shadow-sm animate-bounce flex items-center gap-1">
                                                        <Clock className="w-3 h-3" />
                                                        Scheduled: {scheduledAt ? format(new Date(scheduledAt), 'p') : ''}
                                                        <button
                                                            onClick={(e) => {
                                                                e.preventDefault();
                                                                e.stopPropagation();
                                                                cancelScheduleMutation.mutate();
                                                            }}
                                                            className="ml-1 hover:text-red-200"
                                                        >
                                                            <X className="w-3 h-3" />
                                                        </button>
                                                    </div>
                                                )}
                                            </div>
                                            {hasSubmitted && (
                                                <TooltipProvider>
                                                    <Tooltip>
                                                        <TooltipTrigger asChild>
                                                            <Button
                                                                type="button"
                                                                variant="outline"
                                                                disabled={!todaysTaskValue || !todaysTaskValue.trim()}
                                                                onClick={() => copyToClipboard(todaysTaskValue, currentTask.id)}
                                                                className="h-12 px-4 rounded-xl border-input hover:bg-muted transition disabled:opacity-50 disabled:cursor-not-allowed"
                                                            >
                                                                {copiedTaskId === currentTask.id ? (
                                                                    <div className="flex items-center gap-2">
                                                                        <div className="success-checkmark">
                                                                            <svg className="check-icon" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 52 52">
                                                                                <circle className="check-circle" cx="26" cy="26" r="25" fill="none" />
                                                                                <path className="check-tick" fill="none" d="M14.1 27.2l7.1 7.2 16.7-16.8" />
                                                                            </svg>
                                                                        </div>
                                                                        <span className="text-green-600 font-semibold text-sm">Copied</span>
                                                                    </div>
                                                                ) : (
                                                                    <Copy className="w-4 h-4" />
                                                                )}
                                                            </Button>
                                                        </TooltipTrigger>
                                                        <TooltipContent>Copy task</TooltipContent>
                                                    </Tooltip>
                                                </TooltipProvider>
                                            )}
                                        </div>
                                    </form >
                                </CardContent >
                            </Card >
                        </div >
                    </TabsContent >

                    {/* History Tab */}
                    < TabsContent value="history" className="space-y-4" >
                        <Card className="border-0 shadow-sm bg-card rounded-2xl">
                            <CardHeader>
                                <CardTitle className="text-lg flex items-center gap-2">
                                    <History className="w-5 h-5 text-blue-500" />
                                    Task History
                                </CardTitle>
                                <CardDescription>Your recent task submissions</CardDescription>
                            </CardHeader>
                            <CardContent>
                                <div ref={taskHistoryScrollRef} className={cn("space-y-3", shouldVirtualizeHistory && "max-h-112 overflow-y-auto")}>
                                    {isHistoryLoading ? (
                                        <div className="space-y-3">
                                            {[1, 2, 3].map((idx) => (
                                                <div key={idx} className="p-4 rounded-xl border border-border animate-pulse">
                                                    <div className="h-4 w-40 bg-secondary-light rounded mb-2" />
                                                    <div className="h-3 w-24 bg-secondary-light rounded mb-3" />
                                                    <div className="h-3 w-full bg-secondary-light rounded mb-1" />
                                                    <div className="h-3 w-5/6 bg-secondary-light rounded" />
                                                </div>
                                            ))}
                                        </div>
                                    ) : historyTasks.length > 0 ? (
                                        shouldVirtualizeHistory ? (
                                            <div style={{ height: historyVirtualizer.getTotalSize(), position: 'relative' }}>
                                                {historyVirtualizer.getVirtualItems().map((virtualRow: any) => {
                                                    const task: any = historyTasks[virtualRow.index];
                                                    return (
                                                        <div
                                                            key={task.id}
                                                            style={{
                                                                position: 'absolute',
                                                                top: 0,
                                                                left: 0,
                                                                width: '100%',
                                                                transform: `translateY(${virtualRow.start}px)`
                                                            }}
                                                        >
                                                            <div className="p-4 rounded-xl border border-border hover:border-blue-300 hover:bg-blue-50/50 transition group mb-3">
                                                                <div className="flex items-start justify-between mb-2">
                                                                    <div className="flex items-center gap-2">
                                                                        <div className="w-8 h-8 rounded-lg bg-blue-100 flex items-center justify-center">
                                                                            <CalendarIcon className="w-4 h-4 text-blue-600" />
                                                                        </div>
                                                                        <div>
                                                                            <p className="font-semibold text-foreground">{format(new Date(task.date), 'MMM d, yyyy')}</p>
                                                                            <p className="text-xs text-muted-foreground">{format(new Date(task.created_at), 'h:mm a')}</p>
                                                                        </div>
                                                                    </div>
                                                                    <Button
                                                                        variant="ghost"
                                                                        size="sm"
                                                                        onClick={() => copyToClipboard(task.todays_task, task.id)}
                                                                        className={cn("transition rounded-lg", copiedTaskId === task.id ? "bg-green-100 text-green-700 opacity-100" : "opacity-0 group-hover:opacity-100")}
                                                                    >
                                                                        {copiedTaskId === task.id ? <span className="text-green-600 font-semibold text-sm">Copied</span> : <Copy className="w-4 h-4" />}
                                                                    </Button>
                                                                </div>
                                                                <p className="text-sm text-foreground leading-relaxed">{task.todays_task}</p>
                                                            </div>
                                                        </div>
                                                    );
                                                })}
                                            </div>
                                        ) : (
                                        historyTasks.map((task: any) => (
                                            <div
                                                key={task.id}
                                                className="p-4 rounded-xl border border-border hover:border-blue-300 hover:bg-blue-50/50 transition group"
                                            >
                                                <div className="flex items-start justify-between mb-2">
                                                    <div className="flex items-center gap-2">
                                                        <div className="w-8 h-8 rounded-lg bg-blue-100 flex items-center justify-center">
                                                            <CalendarIcon className="w-4 h-4 text-blue-600" />
                                                        </div>
                                                        <div>
                                                            <p className="font-semibold text-foreground">
                                                                {format(new Date(task.date), 'MMM d, yyyy')}
                                                            </p>
                                                            <p className="text-xs text-muted-foreground">
                                                                {format(new Date(task.created_at), 'h:mm a')}
                                                            </p>
                                                        </div>
                                                    </div>
                                                    <Button
                                                        variant="ghost"
                                                        size="sm"
                                                        onClick={() => copyToClipboard(task.todays_task, task.id)}
                                                        className={cn(
                                                            "transition rounded-lg",
                                                            copiedTaskId === task.id
                                                                ? "bg-green-100 text-green-700 opacity-100"
                                                                : "opacity-0 group-hover:opacity-100"
                                                        )}
                                                    >
                                                        {copiedTaskId === task.id ? (
                                                            <div className="flex items-center gap-2">
                                                                <div className="success-checkmark">
                                                                    <svg className="check-icon" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 52 52">
                                                                        <circle className="check-circle" cx="26" cy="26" r="25" fill="none" />
                                                                        <path className="check-tick" fill="none" d="M14.1 27.2l7.1 7.2 16.7-16.8" />
                                                                    </svg>
                                                                </div>
                                                                <span className="text-green-600 font-semibold text-sm">Copied</span>
                                                            </div>
                                                        ) : (
                                                            <Copy className="w-4 h-4" />
                                                        )}
                                                    </Button>
                                                </div>
                                                <p className="text-sm text-foreground leading-relaxed">{task.todays_task}</p>

                                            </div>
                                        ))
                                        )
                                    ) : (
                                        <div className="text-center py-12">
                                            <History className="w-12 h-12 text-muted-foreground/50 mx-auto mb-3" />
                                            <p className="text-muted-foreground">No task history yet</p>
                                        </div>
                                    )}
                                </div>
                            </CardContent>
                        </Card>
                    </TabsContent >

                    {/* Team Tab */}
                    < TabsContent value="team" className="space-y-4" >
                        <Card className="border-0 shadow-sm bg-card rounded-2xl">
                            <CardHeader>
                                <CardTitle className="text-lg flex items-center gap-2">
                                    <Users className="w-5 h-5 text-blue-500" />
                                    Team Status
                                </CardTitle>
                                <CardDescription>See who's currently working</CardDescription>
                            </CardHeader>
                            <CardContent>
                                <div className="space-y-3">
                                    {colleagues && colleagues.length > 0 ? (
                                        colleagues.map((colleague: any) => (
                                            <div
                                                key={colleague.id}
                                                className="flex items-center justify-between p-4 rounded-xl border border-border hover:bg-muted transition"
                                            >
                                                <div className="flex items-center gap-3">

                                                    <Avatar className="w-10 h-10 border border-border">
                                                        {colleague.profile_picture && (
                                                            <AvatarImage
                                                                src={getAssetUrl(colleague.profile_picture)}
                                                                alt={colleague.name}
                                                                className="object-cover"
                                                            />
                                                        )}
                                                        <AvatarFallback className="bg-linear-to-br from-blue-500 to-purple-500 text-white font-semibold">
                                                            {colleague.name?.charAt(0).toUpperCase()}
                                                        </AvatarFallback>
                                                    </Avatar>
                                                    <div>
                                                        <p className="font-semibold text-foreground">{colleague.full_name || colleague.name || colleague.username}</p>
                                                        <p className="text-sm text-muted-foreground">@{colleague.username}</p>
                                                        {(colleague.role === 'admin' || colleague.role === 'moderator') && (colleague.contact_number || colleague.email) && (
                                                            <div className="mt-1 text-xs text-muted-foreground space-y-0.5">
                                                                {colleague.contact_number && <p>Phone: {colleague.contact_number}</p>}
                                                                {colleague.email && <p>Email: {colleague.email}</p>}
                                                            </div>
                                                        )}
                                                        {colleague.status === 'active' && colleague.covered_date && (
                                                            <div className="mt-1.5 flex items-center gap-2 px-2 py-1 bg-blue-50/80 rounded-lg border border-blue-100/80 w-fit group">
                                                                <div className="flex flex-col items-center leading-none pr-2 border-r border-blue-200">
                                                                    <span className="text-[7px] font-black text-blue-400 uppercase tracking-tighter">{format(new Date(colleague.covered_date || new Date()), 'MMM')}</span>
                                                                    <span className="text-xs font-black text-blue-600 group-hover:scale-110 transition-transform">{format(new Date(colleague.covered_date || new Date()), 'd')}</span>
                                                                </div>
                                                                <span className="text-[9px] font-bold text-blue-500 uppercase tracking-tight">Working Date</span>
                                                            </div>
                                                        )}
                                                    </div>
                                                </div>
                                                <div className="flex items-center gap-2">
                                                    {colleague.status === 'active' ? (
                                                        <span className="flex items-center gap-2 px-3 py-1 rounded-full bg-green-100 text-green-700 text-sm font-medium">
                                                            <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
                                                            Active
                                                        </span>
                                                    ) : (
                                                        <span className="flex items-center gap-2 px-3 py-1 rounded-full bg-muted text-muted-foreground text-sm font-medium">
                                                            <div className="w-2 h-2 rounded-full bg-slate-400" />
                                                            Offline
                                                        </span>
                                                    )}
                                                </div>
                                            </div>
                                        ))
                                    ) : (
                                        <div className="text-center py-12">
                                            <Users className="w-12 h-12 text-muted-foreground/50 mx-auto mb-3" />
                                            <p className="text-muted-foreground">No team members found</p>
                                        </div>
                                    )}
                                </div>
                            </CardContent>
                        </Card>
                    </TabsContent >

                    {/* Chat Tab */}
                    <TabsContent value="chat" forceMount className="h-[calc(100dvh-14rem)] min-h-104 focus-visible:outline-none sm:h-[calc(100dvh-12rem)]">
                        <Card className="h-full min-h-0 border-0 shadow-lg bg-card overflow-hidden rounded-3xl">
                            <CardContent className="h-full min-h-0 p-0">
                                <Suspense fallback={<div className="h-full flex items-center justify-center text-muted-foreground text-sm">Loading chat...</div>}>
                                    <LazyChatInterface
                                        isVisible={activeTab === 'chat'}
                                        onUnreadTotalChange={setChatUnreadTotal}
                                    />
                                </Suspense>
                            </CardContent>
                        </Card>
                    </TabsContent>

                    {/* Leaves Tab */}
                    <TabsContent value="leaves" className="space-y-6">
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                            <Card className="border-0 shadow-sm bg-linear-to-br from-blue-600 to-indigo-700 text-white rounded-2xl overflow-hidden relative group">
                                <div className="absolute top-0 right-0 p-8 opacity-10 transform translate-x-4 -translate-y-4 group-hover:scale-110 transition-transform duration-500">
                                    <CalendarDays className="w-24 h-24" />
                                </div>
                                <CardContent className="p-6 relative z-10">
                                    <div className="flex items-center gap-3 mb-4">
                                        <div className="w-10 h-10 rounded-xl bg-blue-500/30 flex items-center justify-center">
                                            <CalendarDays className="w-5 h-5 text-white" />
                                        </div>
                                        <p className="text-blue-100 text-sm font-semibold tracking-wide uppercase">Paid Leave Credit</p>
                                    </div>
                                    <div className="flex items-baseline gap-2">
                                        <h3 className="text-4xl font-black">{user?.paid_leave_balance || 0}</h3>
                                        <span className="text-blue-100 font-medium text-lg">Days Remaining</span>
                                    </div>
                                    <div className="mt-4 pt-4 border-t border-white/10 flex items-center justify-between">
                                        <p className="text-blue-200 text-xs">Yearly Allowance Reset: Jan 1st</p>
                                        <div className="flex -space-x-2">
                                            {[1, 2, 3].map(i => (
                                                <div key={i} className="w-6 h-6 rounded-full border-2 border-indigo-600 bg-blue-400 opacity-50" />
                                            ))}
                                        </div>
                                    </div>
                                </CardContent>
                            </Card>

                            <Card className="md:col-span-2 border-0 shadow-sm bg-card rounded-2xl overflow-hidden">
                                <CardHeader className="border-b border-border/50 flex flex-row items-center justify-between">
                                    <div>
                                        <CardTitle>My Leaves</CardTitle>
                                        <CardDescription>View history and request time off</CardDescription>
                                    </div>
                                    <Button
                                        onClick={() => {
                                            setShowLeaveModal(true);
                                            setLeaveRange(undefined);
                                            setLeaveReason('');
                                        }}
                                        className="bg-blue-500 hover:bg-blue-600 text-white rounded-xl shadow-lg shadow-blue-100"
                                    >
                                        <CalendarDays className="w-4 h-4 mr-2" />
                                        Request Leave
                                    </Button>
                                </CardHeader>
                            <CardContent className="p-6">
                                <div className="space-y-4">
                                    {leaves && leaves.length > 0 ? (
                                        leaves.map((leave: any) => {
                                            const worked = leave.worked_hours || 0;
                                            const target = leave.target_hours || 4;
                                            const balance = Math.max(target - worked, 0);
                                            const isFullyCovered = (leave.status === 'covered' || leave.status === 'working' || leave.status === 'approved' || leave.is_paid) && balance <= 0.01;
                                            const isUncoveredLeave = leave.status === 'approved' || (balance > 0.01 && !leave.is_paid && leave.status !== 'rejected' && leave.status !== 'pending');
                                            
                                            const isCoverButtonDisabled =
                                                coverLeaveMutation.isPending ||
                                                signInMutation.isPending ||
                                                user?.status === 'active' ||
                                                user?.status === 'break';

                                            return (
                                            <div key={leave.id} className="flex flex-col p-4 bg-muted rounded-xl border border-border/50 group hover:border-blue-200 transition">
                                                <div className="flex flex-col sm:flex-row sm:items-center justify-between mb-4">
                                                    <div className="flex items-center gap-4 mb-3 sm:mb-0">
                                                        <div className="w-10 h-10 rounded-xl bg-card flex items-center justify-center text-muted-foreground/70 group-hover:text-blue-500 transition-colors">
                                                            <CalendarIcon className="w-5 h-5" />
                                                        </div>
                                                        <div>
                                                            <p className="font-semibold text-foreground">
                                                                {format(new Date(leave.leave_date), 'MMMM d, yyyy')}
                                                            </p>
                                                            <p className="text-sm text-muted-foreground line-clamp-1">{leave.reason}</p>
                                                        </div>
                                                    </div>
                                                    <div className="flex flex-wrap items-center gap-2 sm:justify-end">
                                                        <span className={cn(
                                                            "px-3 py-1 rounded-full text-[10px] font-bold tracking-wider uppercase",
                                                            leave.leave_type === 'paid'
                                                                ? "bg-purple-100 text-purple-700"
                                                                : "bg-amber-100 text-amber-700"
                                                        )}>
                                                            {leave.leave_type === 'paid' ? 'PAID' : 'UNPAID'}
                                                        </span>
                                                        <span className={cn(
                                                            "px-3 py-1 rounded-full text-[10px] font-bold tracking-wider uppercase",
                                                            isFullyCovered && "bg-green-100 text-green-700",
                                                            leave.status === 'pending' && leave.moderator_status === 'pending' && "bg-muted text-muted-foreground",
                                                            leave.status === 'pending' && leave.moderator_status === 'proceeded' && "bg-indigo-100 text-indigo-700",
                                                            leave.status === 'rejected' && leave.moderator_status === 'declined' && "bg-red-100 text-red-700",
                                                            leave.status === 'approved' && balance > 0 && !leave.is_paid && "bg-amber-100 text-amber-700",
                                                            leave.status === 'rejected' && leave.moderator_status !== 'declined' && "bg-red-100 text-red-700",
                                                            leave.status === 'working' && balance > 0 && "bg-blue-100 text-blue-700",
                                                            leave.status === 'covered' && balance > 0 && "bg-orange-100 text-orange-700",
                                                        )}>
                                                            {isFullyCovered ? 'COVERED' : 
                                                             (leave.status === 'approved' && !leave.covered_by_date) ? 'UNCOVERED' : 
                                                             (leave.status === 'pending' && leave.moderator_status === 'pending') ? 'PENDING PM' :
                                                             (leave.status === 'pending' && leave.moderator_status === 'proceeded') ? 'PROCEEDED BY PM (WAITING HR)' :
                                                             (leave.status === 'rejected' && leave.moderator_status === 'declined') ? `DECLINED BY PM${leave.moderated_by_name ? ` (${leave.moderated_by_name})` : ''}` :
                                                             leave.status.toUpperCase()}
                                                        </span>
                                                        {isUncoveredLeave && balance > 0.01 && (
                                                            <Button
                                                                size="sm"
                                                                className="rounded-full bg-blue-500 px-4 text-white hover:bg-blue-600 h-8"
                                                                disabled={isCoverButtonDisabled}
                                                                onClick={() => handleCoverLeaveFromHistory(leave)}
                                                            >
                                                                {coverLeaveMutation.isPending || signInMutation.isPending ? 'Starting...' : worked > 0 ? 'Continue Cover' : 'Cover Leave'}
                                                            </Button>
                                                        )}
                                                    </div>
                                                </div>

                                                {/* Progress Bar & Balance */}
                                                {!leave.is_paid && leave.status !== 'rejected' && leave.status !== 'pending' && (
                                                    <div className="mt-2 space-y-1.5">
                                                        <div className="flex justify-between items-center text-[10px] font-bold uppercase tracking-tight">
                                                            <span className="text-muted-foreground">Progress: {worked.toFixed(1)}h / {target.toFixed(1)}h</span>
                                                            <span className={cn(
                                                                balance > 0 ? "text-amber-600" : "text-green-600"
                                                            )}>
                                                                {balance > 0 ? `${balance.toFixed(1)}h Remaining` : 'Goal Met'}
                                                            </span>
                                                        </div>
                                                        <div className="h-1.5 w-full bg-secondary-light rounded-full overflow-hidden">
                                                            <div 
                                                                className={cn(
                                                                    "h-full rounded-full transition duration-500",
                                                                    balance > 0 ? "bg-amber-500" : "bg-green-500"
                                                                )}
                                                                style={{ width: `${Math.min((worked / target) * 100, 100)}%` }}
                                                            />
                                                        </div>
                                                    </div>
                                                )}
                                            </div>
                                            );
                                        })
                                    ) : (
                                        <div className="text-center py-12 text-muted-foreground">
                                            <CalendarDays className="w-12 h-12 mx-auto mb-4 opacity-20" />
                                            <p>No leave history found</p>
                                        </div>
                                    )}
                                </div>
                            </CardContent>
                        </Card>
                    </div>
                </TabsContent >

                    {/* Skipped Days Tab */}
                    <TabsContent value="skipped">
                        <Card className="border-0 shadow-sm bg-card rounded-2xl overflow-hidden">
                            <CardHeader className="border-b border-border/50">
                                <div className="flex items-center justify-between">
                                    <div>
                                        <CardTitle className="flex items-center gap-2">
                                            <AlertCircle className="w-5 h-5 text-amber-500" />
                                            Skipped Workdays
                                        </CardTitle>
                                        <CardDescription>Days you missed and their cover status</CardDescription>
                                    </div>
                                    <Button variant="outline" size="sm" onClick={() => refetchSkippedDays()} className="h-8 gap-2">
                                        <RotateCcw className="w-3 h-3" /> Refresh
                                    </Button>
                                </div>
                            </CardHeader>
                            <CardContent className="pt-4">
                                {skippedDays && skippedDays.length > 0 ? (
                                    <div className="space-y-3">
                                        {skippedDays.map((day: any) => (
                                            <div
                                                key={day.id}
                                                className={cn(
                                                    "flex items-center justify-between p-4 rounded-xl border transition",
                                                    day.isCovered
                                                        ? "bg-emerald-50 border-emerald-200"
                                                        : "bg-amber-50 border-amber-200"
                                                )}
                                            >
                                                <div className="flex items-center gap-4">
                                                    <div className={cn(
                                                        "w-10 h-10 rounded-xl flex items-center justify-center",
                                                        day.isCovered ? "bg-emerald-100" : "bg-amber-100"
                                                    )}>
                                                        {day.isCovered
                                                            ? <Check className="w-5 h-5 text-emerald-600" />
                                                            : <AlertCircle className="w-5 h-5 text-amber-600" />}
                                                    </div>
                                                    <div>
                                                        <p className="font-semibold text-foreground">
                                                            {(() => {
                                                                try {
                                                                    const [y, m, d] = day.date.split('-').map(Number);
                                                                    return format(new Date(y, m - 1, d), 'EEEE, dd MMM yyyy');
                                                                } catch {
                                                                    return day.date;
                                                                }
                                                            })()}
                                                        </p>
                                                        <p className="text-sm text-muted-foreground">
                                                            Deducted: {Math.floor(day.deductedMinutes / 60)}h {day.deductedMinutes % 60}m
                                                        </p>
                                                    </div>
                                                </div>
                                                <div>
                                                    {day.isCovered ? (
                                                        <span className="inline-flex items-center gap-1 px-3 py-1.5 rounded-full text-xs font-semibold bg-emerald-100 text-emerald-700">
                                                            <Check className="w-3 h-3" /> Covered
                                                        </span>
                                                    ) : (
                                                        <Button
                                                            size="sm"
                                                            className="bg-amber-500 hover:bg-amber-600 text-white rounded-full px-4"
                                                            disabled={user?.status !== 'inactive' && user?.status !== 'break'}
                                                            onClick={async () => {
                                                                try {
                                                                    await api.post('/auth/sign-in', { coveredDate: day.date });
                                                                    refetchSkippedDays();
                                                                    queryClient.invalidateQueries({ queryKey: ['me'] });
                                                                    
                                                                    // Sync date in frontend immediately
                                                                    if (day.date) {
                                                                        const parts = day.date.split('-').map(Number);
                                                                        if (parts.length === 3 && !parts.some(isNaN)) {
                                                                            const cDate = new Date(parts[0], parts[1] - 1, parts[2]);
                                                                            if (!isNaN(cDate.getTime())) {
                                                                                cDate.setHours(0, 0, 0, 0);
                                                                                setDate(cDate);
                                                                            }
                                                                        }
                                                                    }
                                                                    
                                                                    setToast({ message: `Signed in to cover ${day.date}`, type: 'success' });
                                                                } catch (err: any) {
                                                                    setToast({ message: err?.response?.data?.error || 'Failed to sign in', type: 'error' });
                                                                }
                                                            }}
                                                        >
                                                            Cover This Day
                                                        </Button>
                                                    )}
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                ) : (
                                    <div className="text-center py-12 text-muted-foreground">
                                        <Check className="w-12 h-12 mx-auto mb-4 text-emerald-300" />
                                        <p className="font-medium">No skipped workdays!</p>
                                        <p className="text-sm mt-1">You're all caught up.</p>
                                    </div>
                                )}
                            </CardContent>
                        </Card>
                    </TabsContent>

                    <TabsContent value="voting" className="space-y-6 focus-visible:outline-none">
                        <FeatureVoting />
                    </TabsContent>

                    <TabsContent value="knowledge-base" className="space-y-6 focus-visible:outline-none">
                        <KnowledgeBase />
                    </TabsContent>

                    <TabsContent value="changelog" className="space-y-6 focus-visible:outline-none">
                        <Changelog />
                    </TabsContent>

                </Tabs >
            </div >

            {/* Plan Modal */}
            {
                showPlanModal && (
                    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-start justify-center overflow-y-auto z-50 p-4 sm:items-center animate-in fade-in duration-200">
                        <div className="bg-card rounded-2xl shadow-2xl max-w-md w-full max-h-[90vh] overflow-y-auto p-6 my-auto animate-in zoom-in-95 duration-200">
                            <div className="text-center mb-6">
                                <div className="w-14 h-14 rounded-2xl bg-linear-to-br from-blue-500 to-blue-600 flex items-center justify-center mx-auto mb-4 shadow-lg">
                                    <ClipboardList className="text-white w-7 h-7" />
                                </div>
                                <h3 className="text-xl font-bold text-foreground">Start Session</h3>
                                <p className="text-muted-foreground mt-1">Confirm work session details</p>
                            </div>

                            <div className="space-y-4">

                                <div className="flex gap-3 pt-2">
                                    <Button
                                        variant="outline"
                                        onClick={() => {
                                            setShowPlanModal(false);
                                            setOffDayMode('overtime');
                                            setSelectedLeaveToCover(null);
                                        }}
                                        className="flex-1 h-12 rounded-xl border-input"
                                    >
                                        Cancel
                                    </Button>
                                </div>

                                {todayOffDayDetails.isOffDay && (
                                    <div className="pt-4 border-t border-border/50 mt-4 space-y-4">
                                        <div className="flex items-center gap-2">
                                            <p className="text-sm font-semibold text-foreground">Today is {todayOffDayDetails.holidayName}</p>
                                            {todayOffDayDetails.isHoliday && <Sparkles className="w-4 h-4 text-amber-500" />}
                                        </div>
                                        <div className="flex gap-4">
                                            <label className="flex items-center gap-2 cursor-pointer">
                                                <input
                                                    type="radio"
                                                    checked={offDayMode === 'overtime'}
                                                    onChange={() => setOffDayMode('overtime')}
                                                    className="w-4 h-4 text-blue-600"
                                                />
                                                <span className="text-sm text-muted-foreground">Overtime</span>
                                            </label>
                                            <label className="flex items-center gap-2 cursor-pointer">
                                                <input
                                                    type="radio"
                                                    checked={offDayMode === 'cover'}
                                                    onChange={() => setOffDayMode('cover')}
                                                    className="w-4 h-4 text-blue-600"
                                                />
                                                <span className="text-sm text-muted-foreground">Cover Leave</span>
                                            </label>
                                        </div>

                                        {offDayMode === 'cover' && (
                                            <div className="space-y-2">
                                                <p className="text-xs text-muted-foreground">Select a leave or skipped day to cover:</p>
                                                <select
                                                    value={selectedLeaveToCover || ''}
                                                    onChange={(e) => setSelectedLeaveToCover(e.target.value as any)}
                                                    className="w-full p-3 rounded-xl border border-border text-sm outline-none focus:ring-2 focus:ring-blue-100"
                                                >
                                                    <option value="">Choose a day to cover...</option>
                                                    {skippedDays?.filter((d: any) => !d.isCovered).length > 0 && (
                                                        <optgroup label="Skipped Workdays">
                                                            {skippedDays.filter((d: any) => !d.isCovered).map((day: any) => (
                                                                <option key={`skipped-${day.id}`} value={`skipped:${day.date}`}>
                                                                    {(() => { try { const [y,m,d] = day.date.split('-').map(Number); return format(new Date(y,m-1,d), 'MMM d, yyyy'); } catch { return day.date; } })()} - {Math.floor(day.deductedMinutes/60)}h {day.deductedMinutes%60}m deducted
                                                                </option>
                                                            ))}
                                                        </optgroup>
                                                    )}
                                                    {uncoveredLeaves?.length > 0 && (
                                                        <optgroup label="Uncovered Leaves">
                                                            {uncoveredLeaves.map((leave: any) => {
                                                        const worked = leave.worked_hours || 0;
                                                        const target = leave.target_hours || 4;
                                                        const balance = Math.max(target - worked, 0);
                                                        return (
                                                            <option key={leave.id} value={leave.id}>
                                                                {format(new Date(leave.leave_date), 'MMM d, yyyy')} - {balance.toFixed(1)}h left ({worked.toFixed(1)}/{target.toFixed(1)}h)
                                                            </option>
                                                        );
                                                    })}
                                                        </optgroup>
                                                    )}
                                                </select>
                                                {(!uncoveredLeaves || uncoveredLeaves.length === 0) && (!skippedDays || skippedDays.filter((d: any) => !d.isCovered).length === 0) && (
                                                    <p className="text-xs text-amber-600">No uncovered leaves or skipped days found.</p>
                                                )}
                                            </div>
                                        )}
                                    </div>
                                )}

                                <div className="flex gap-3 pt-2">
                                    <Button
                                        onClick={handlePlanSubmit}
                                        disabled={signInMutation.isPending || (offDayMode === 'cover' && !selectedLeaveToCover)}
                                        className="flex-1 h-12 rounded-xl bg-blue-500 hover:bg-blue-600 text-white font-semibold shadow-lg"
                                    >
                                        {signInMutation.isPending ? (
                                            <span className="flex items-center gap-2">
                                                <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                                                Starting...
                                            </span>
                                        ) : (
                                            <>
                                                <PlayCircle className="w-5 h-5 mr-2" />
                                                Start Work
                                            </>
                                        )}
                                    </Button>
                                </div>
                            </div>
                        </div>
                    </div>
                )
            }

            {/* Early Sign Out Modal */}
            {
                showEarlySignOutModal && (
                    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4 animate-in fade-in duration-200">
                        <div className="bg-card rounded-2xl shadow-2xl max-w-md w-full p-6 animate-in zoom-in-95 duration-200">
                            <div className="text-center mb-6">
                                <div className="w-14 h-14 rounded-2xl bg-linear-to-br from-orange-500 to-red-500 flex items-center justify-center mx-auto mb-4 shadow-lg">
                                    <AlertCircle className="text-white w-7 h-7" />
                                </div>
                                <h3 className="text-xl font-bold text-foreground">Early Sign Out</h3>
                                <p className="text-muted-foreground mt-1">Please provide a reason</p>
                            </div>

                            <div className="space-y-4">
                                <textarea
                                    value={earlySignOutReason}
                                    onChange={(e) => setEarlySignOutReason(e.target.value)}
                                    className="w-full min-h-[120px] p-4 rounded-xl border border-border focus:border-orange-500 focus:ring-2 focus:ring-orange-100 outline-none resize-none"
                                    placeholder="Why are you signing out early?"
                                    autoFocus
                                />

                                <div className="flex gap-3 pt-2">
                                    <Button
                                        variant="outline"
                                        onClick={() => {
                                            setShowEarlySignOutModal(false);
                                            setEarlySignOutReason('');
                                        }}
                                        className="flex-1 h-12 rounded-xl border-input"
                                    >
                                        Cancel
                                    </Button>
                                    <Button
                                        onClick={handleEarlySignOut}
                                        disabled={!earlySignOutReason.trim() || earlySignOutMutation.isPending}
                                        className="flex-1 h-12 rounded-xl bg-orange-500 hover:bg-orange-600 text-white font-semibold shadow-lg"
                                    >
                                        {earlySignOutMutation.isPending ? (
                                            <span className="flex items-center gap-2">
                                                <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                                                Signing out...
                                            </span>
                                        ) : (
                                            <>
                                                <StopCircle className="w-5 h-5 mr-2" />
                                                Sign Out
                                            </>
                                        )}
                                    </Button>
                                </div>
                            </div>
                        </div>
                    </div>
                )
            }

            {/* Sign Out Cover Modal */}
            {
                showSignOutCoverModal && uncoveredLeaves && uncoveredLeaves.length > 0 && (
                    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4 animate-in fade-in duration-200">
                        <div className="bg-card rounded-2xl shadow-2xl max-w-md w-full max-h-[90vh] overflow-y-auto animate-in zoom-in-95 duration-200">
                            <div className="sticky top-0 bg-linear-to-br from-green-500 to-emerald-600 p-6 rounded-t-2xl">
                                <div className="text-center text-white">
                                    <div className="w-14 h-14 rounded-2xl bg-white/20 flex items-center justify-center mx-auto mb-4 shadow-lg">
                                        <TrendingUp className="w-7 h-7" />
                                    </div>
                                    <h3 className="text-xl font-bold">Great Work Today!</h3>
                                    <p className="text-white/90 mt-1 text-sm">You worked {hoursWorkedToday.toFixed(2)} hours</p>
                                </div>
                            </div>

                            <div className="p-6 space-y-5">
                                <div className="bg-green-50 border border-green-200 rounded-xl p-4">
                                    <p className="text-sm font-medium text-green-900">
                                        You've exceeded the daily overtime threshold.
                                    </p>
                                    <p className="text-xs text-green-700 mt-1">
                                        Would you like to bank this as overtime or cover a leave?
                                    </p>
                                </div>

                                <div className="space-y-3">
                                    <Label className="text-sm font-semibold text-foreground flex items-center gap-2">
                                        <CalendarIcon className="w-4 h-4 text-green-600" />
                                        Option 1: Cover Leaves
                                    </Label>

                                    {(() => {
                                        const standardHours = workHoursSettings?.standardHours || 4;
                                        // Use component-level isTodayOffDay which correctly handles Time Travel & Holidays

                                        const surplusHours = Math.max(0, hoursWorkedToday - (isTodayOffDay ? 0 : standardHours));
                                        const maxCoverable = Math.floor(surplusHours / standardHours);
                                        const selectedCount = selectedLeavesForSignOut.length;

                                        return (
                                            <>
                                                <div className="flex justify-between items-center text-xs px-1">
                                                    <span className="text-muted-foreground">
                                                        Surplus: <span className="font-semibold text-green-600">{surplusHours.toFixed(2)}h</span>
                                                    </span>
                                                    <span className={`font-semibold ${selectedCount > maxCoverable ? 'text-red-500' : 'text-muted-foreground'}`}>
                                                        Selected: {selectedCount}/{maxCoverable}
                                                    </span>
                                                </div>

                                                <div className="space-y-2 max-h-[200px] overflow-y-auto border rounded-xl p-2 bg-muted/50">
                                                    {uncoveredLeaves.map((leave: any) => {
                                                        const isSelected = selectedLeavesForSignOut.includes(leave.id);
                                                        const isDisabled = !isSelected && selectedCount >= maxCoverable;

                                                        return (
                                                            <div
                                                                key={leave.id}
                                                                onClick={() => {
                                                                    if (isSelected) {
                                                                        setSelectedLeavesForSignOut(prev => prev.filter(id => id !== leave.id));
                                                                    } else if (!isDisabled) {
                                                                        setSelectedLeavesForSignOut(prev => [...prev, leave.id]);
                                                                    }
                                                                }}
                                                                className={`p-3 rounded-lg border transition cursor-pointer ${isSelected
                                                                    ? 'border-green-500 bg-green-50 shadow-sm'
                                                                    : isDisabled
                                                                        ? 'border-border/50 bg-muted opacity-50 cursor-not-allowed'
                                                                        : 'border-border hover:border-green-300 bg-card'
                                                                    }`}
                                                            >
                                                                <div className="flex items-center justify-between">
                                                                    <div>
                                                                        <p className="font-semibold text-foreground text-sm">
                                                                            {format(new Date(leave.leave_date), 'MMM d, yyyy')}
                                                                        </p>
                                                                        <p className="text-xs text-muted-foreground">
                                                                            {leave.reason || 'No reason'}
                                                                        </p>
                                                                    </div>
                                                                    {isSelected && (
                                                                        <Check className="w-4 h-4 text-green-600 shrink-0" />
                                                                    )}
                                                                </div>
                                                            </div>
                                                        );
                                                    })}
                                                </div>

                                                <Button
                                                    className={`w-full h-11 rounded-xl font-semibold transition ${selectedLeavesForSignOut.length > 0 && selectedLeavesForSignOut.length <= maxCoverable && hasSubmitted
                                                        ? 'bg-green-600 hover:bg-green-700 text-white shadow-md'
                                                        : 'bg-muted text-muted-foreground/70 cursor-not-allowed'
                                                        }`}
                                                    disabled={selectedLeavesForSignOut.length === 0 || selectedLeavesForSignOut.length > maxCoverable || !hasSubmitted}
                                                    onClick={() => {
                                                        if (selectedLeavesForSignOut.length > 0) {
                                                            signOutMutation.mutate({
                                                                coverLeaveIds: selectedLeavesForSignOut
                                                            });
                                                        }
                                                    }}
                                                >
                                                    Confirm Coverage ({selectedLeavesForSignOut.length})
                                                </Button>
                                            </>
                                        );
                                    })()}
                                </div>

                                <div className="relative">
                                    <div className="absolute inset-0 flex items-center">
                                        <span className="w-full border-t border-border" />
                                    </div>
                                    <div className="relative flex justify-center text-xs uppercase">
                                        <span className="bg-card px-2 text-muted-foreground">Or</span>
                                    </div>
                                </div>

                                <div className="space-y-3">
                                    <Label className="text-sm font-semibold text-foreground flex items-center gap-2">
                                        <TrendingUp className="w-4 h-4 text-blue-600" />
                                        Option 2: Bank Overtime
                                    </Label>
                                    <Button
                                        variant="outline"
                                        className="w-full h-11 rounded-xl border-input hover:bg-blue-50 text-foreground font-medium"
                                        disabled={!hasSubmitted}
                                        onClick={() => {
                                            signOutMutation.mutate({});
                                        }}
                                    >
                                        Just Sign Out (Add to Balance)
                                    </Button>
                                    <p className="text-[10px] text-center text-muted-foreground/70">
                                        This will add the extra hours to your minutes balance.
                                    </p>
                                </div>
                            </div>
                        </div>
                    </div>
                )
            }
            {/* Request Leave Modal */}
            {
                showLeaveModal && (
                    <div className="fixed inset-0 z-50 overflow-y-auto bg-black/50 p-4 backdrop-blur-sm animate-in fade-in duration-200">
                        <div className="flex min-h-full items-start justify-center py-4 sm:items-center">
                            <div className="my-auto w-full max-w-md max-h-[90dvh] overflow-y-auto rounded-2xl bg-card p-6 shadow-2xl overscroll-contain animate-in zoom-in-95 duration-200">
                            <div className="text-center mb-6">
                                <div className="w-14 h-14 rounded-2xl bg-linear-to-br from-blue-500 to-blue-600 flex items-center justify-center mx-auto mb-4 shadow-lg">
                                    <CalendarDays className="text-white w-7 h-7" />
                                </div>
                                <h3 className="text-xl font-bold text-foreground">Request Leave</h3>
                                <p className="text-muted-foreground mt-1">Submit a new leave request</p>
                            </div>

                            <div className="space-y-4">
                                <div className="space-y-2">
                                    <Label>Select Date Range</Label>
                                    <Calendar
                                        mode="range"
                                        selected={leaveRange}
                                        onSelect={setLeaveRange}
                                        className="rounded-xl border border-border"
                                        disabled={[
                                            // Disable weekends
                                            (date) => {
                                                const day = date.getDay();
                                                return workHoursSettings?.weekendDays?.includes(day) ?? (day === 5 || day === 6);
                                            },
                                            // Disable holidays
                                            (date) => {
                                                const candidateDate = normalizeDateValue(date, tz);
                                                return holidays?.some((h: any) => normalizeDateValue(h.date, tz) === candidateDate);
                                            },
                                            // Disable existing leaves
                                            (date) => {
                                                const candidateDate = normalizeDateValue(date, tz);
                                                return (leaves || []).some((l: any) =>
                                                    (l.status === 'pending' || l.status === 'approved') &&
                                                    normalizeDateValue(l.leave_date, tz) === candidateDate
                                                );
                                            }
                                        ]}
                                        modifiers={{
                                            booked: (date) => (leaves || []).some((l: any) =>
                                                (l.status === 'pending' || l.status === 'approved') &&
                                                normalizeDateValue(l.leave_date, tz) === normalizeDateValue(date, tz)
                                            )
                                        }}
                                        modifiersClassNames={{
                                            booked: "bg-red-100 text-red-600 font-medium opacity-100 hover:bg-red-100 hover:text-red-600"
                                        }}
                                        modifiersStyles={{
                                            booked: { textDecoration: 'line-through' }
                                        }}
                                    />
                                </div>
                                <div className="space-y-2">
                                    <Label>Leave Type</Label>
                                    <div className="grid grid-cols-2 gap-3">
                                        <button
                                            type="button"
                                            onClick={() => setLeaveType('paid')}
                                            className={cn(
                                                "rounded-xl border px-4 py-3 text-left transition",
                                                leaveType === 'paid'
                                                    ? "border-purple-500 bg-purple-50 shadow-sm"
                                                    : "border-border bg-card hover:border-input"
                                            )}
                                        >
                                            <p className="text-sm font-semibold text-foreground">Paid</p>
                                            <p className="text-xs text-muted-foreground">Uses paid leave balance.</p>
                                        </button>
                                        <button
                                            type="button"
                                            onClick={() => setLeaveType('unpaid')}
                                            className={cn(
                                                "rounded-xl border px-4 py-3 text-left transition",
                                                leaveType === 'unpaid'
                                                    ? "border-amber-500 bg-amber-50 shadow-sm"
                                                    : "border-border bg-card hover:border-input"
                                            )}
                                        >
                                            <p className="text-sm font-semibold text-foreground">Unpaid</p>
                                            <p className="text-xs text-muted-foreground">Counts as uncovered and must be covered later.</p>
                                        </button>
                                    </div>
                                </div>
                                <div className="space-y-2">
                                    <Label>Reason</Label>
                                    <textarea
                                        value={leaveReason}
                                        onChange={(e) => setLeaveReason(e.target.value)}
                                        className="w-full min-h-[100px] p-4 rounded-xl border border-border focus:border-blue-500 focus:ring-2 focus:ring-blue-100 outline-none resize-none"
                                        placeholder="Why do you need leave?"
                                    />
                                </div>

                                <div className="flex gap-3 pt-2">
                                    <Button
                                        variant="outline"
                                        onClick={() => setShowLeaveModal(false)}
                                        className="flex-1 h-12 rounded-xl border-input"
                                    >
                                        Cancel
                                    </Button>
                                    <Button
                                        onClick={async () => {
                                            if (!leaveRange?.from || !leaveReason.trim()) return;

                                            const start = leaveRange.from;
                                            const end = leaveRange.to || leaveRange.from;
                                            const daysToRequest: Date[] = [];
                                            let curr = start;

                                            // 1. Collect all valid days in interval
                                            while (curr <= end) {
                                                const day = curr.getDay();
                                                const isWeekend = workHoursSettings?.weekendDays?.includes(day);
                                                const isHoliday = holidays?.some((h: any) => isSameDay(new Date(h.date), curr));

                                                if (!isWeekend && !isHoliday) {
                                                    daysToRequest.push(new Date(curr));
                                                }
                                                curr = addDays(curr, 1);
                                            }

                                            if (daysToRequest.length === 0) {
                                                setToast({ message: "No valid working days selected in this range.", type: 'error' });
                                                return;
                                            }

                                            // 2. Submit batch request
                                            try {
                                                await requestLeaveMutation.mutateAsync({
                                                    leaveDates: daysToRequest.map(d => format(d, 'yyyy-MM-dd')),
                                                    reason: leaveReason,
                                                    leaveType: leaveType as 'paid' | 'unpaid'
                                                });
                                                setLeaveRange(undefined);
                                            } catch (err) {
                                                // Error handled by mutation
                                            }
                                        }}
                                        disabled={!leaveRange?.from || !leaveReason.trim() || !leaveType || requestLeaveMutation.isPending}
                                        className="flex-1 h-12 rounded-xl bg-blue-500 hover:bg-blue-600 text-white font-semibold shadow-lg"
                                    >
                                        {requestLeaveMutation.isPending ? (
                                            <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                                        ) : (
                                            "Submit Request"
                                        )}
                                    </Button>
                                </div>
                            </div>
                        </div>
                        </div>
                    </div>
                )
            }
            {/* Media Lightbox */}
            {
                selectedMedia && (
                    <div
                        className="fixed inset-0 z-100 bg-black/90 backdrop-blur-sm flex items-center justify-center p-4 animate-in fade-in duration-300"
                        onClick={() => setSelectedMedia(null)}
                    >
                        <div className="relative max-w-5xl max-h-full transition-transform duration-300 scale-in shadow-2xl" onClick={e => e.stopPropagation()}>
                            <Button
                                variant="ghost"
                                size="icon"
                                className="absolute -top-12 right-0 text-white hover:bg-card/10 rounded-full"
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
                )
            }

            {/* Scheduled Submission Modal */}
            <Dialog open={isSchedulingModalOpen} onOpenChange={setIsSchedulingModalOpen}>
                <DialogContent className="sm:max-w-[425px] bg-card text-slate-950 border-none shadow-2xl">
                    <DialogHeader>
                        <DialogTitle className="flex items-center gap-2 text-foreground text-xl font-bold">
                            <Clock className="w-5 h-5 text-blue-600" />
                            Schedule Submission
                        </DialogTitle>
                        <DialogDescription className="text-muted-foreground">
                            Pick a time for automatic task submission and sign-out.
                        </DialogDescription>
                    </DialogHeader>
                    <div className="space-y-4 py-4">
                        <div className="space-y-2">
                            <Label className="text-sm font-semibold text-foreground">Select Date</Label>
                            <Calendar
                                mode="single"
                                selected={scheduleDate}
                                onSelect={setScheduleDate}
                                className="rounded-md border border-border mx-auto text-slate-950 bg-card shadow-sm"
                            />
                        </div>
                        <div className="space-y-2">
                            <Label className="text-sm font-semibold text-foreground">Select Time</Label>
                            <Input
                                type="time"
                                value={scheduleTime}
                                onChange={(e) => setScheduleTime(e.target.value)}
                                className="h-12 border-border focus:ring-2 focus:ring-blue-500 text-slate-950 bg-muted text-lg rounded-xl"
                            />
                            <p className="text-xs text-muted-foreground mt-1">
                                Task will execute at this time in your local timezone ({Intl.DateTimeFormat().resolvedOptions().timeZone})
                            </p>
                        </div>
                    </div>
                    <DialogFooter className="flex gap-2 sm:gap-0">
                        <Button variant="outline" onClick={() => setIsSchedulingModalOpen(false)} className="flex-1 sm:flex-none border-border text-muted-foreground hover:bg-muted font-medium">Cancel</Button>
                        <Button onClick={handleScheduleConfirm} className="flex-1 sm:flex-none bg-blue-600 hover:bg-blue-700 text-white font-bold shadow-lg shadow-blue-200">Schedule</Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            {/* Dev Tools Section */}
            {workHoursSettings?.devToolsEnabled !== false && (
                <div className="fixed bottom-4 right-4 z-50">
                <Button
                    onClick={() => setShowDevTools(!showDevTools)}
                    className="rounded-full w-12 h-12 bg-slate-800 hover:bg-slate-700 text-white shadow-lg"
                    title="Developer Tools"
                >
                    <Settings className="w-5 h-5" />
                </Button>
                {showDevTools && (
                    <div className="absolute bottom-16 right-0 w-80 bg-card rounded-lg shadow-2xl border border-border p-4 space-y-3">
                        <div className="flex items-center justify-between border-b border-border pb-2">
                            <h3 className="font-bold text-foreground flex items-center gap-2">
                                <Settings className="w-4 h-4" />
                                Developer Tools
                            </h3>
                            <button onClick={() => setShowDevTools(false)} className="text-muted-foreground/70 hover:text-muted-foreground">
                                <X className="w-4 h-4" />
                            </button>
                        </div>
                        <div className="space-y-4">
                            <div className="space-y-2">
                                <Label className="text-xs font-semibold text-foreground">Time Travel</Label>
                                <div className="grid grid-cols-2 gap-2">
                                    <Button
                                        onClick={() => setTimeTravelMutation.mutate({ add_ms: -3600000 })}
                                        disabled={setTimeTravelMutation.isPending}
                                        variant="outline"
                                        size="sm"
                                        className="text-xs"
                                    >
                                        -1 Hour
                                    </Button>
                                    <Button
                                        onClick={() => setTimeTravelMutation.mutate({ add_ms: 3600000 })}
                                        disabled={setTimeTravelMutation.isPending}
                                        variant="outline"
                                        size="sm"
                                        className="text-xs"
                                    >
                                        +1 Hour
                                    </Button>
                                    <Button
                                        onClick={() => setTimeTravelMutation.mutate({ add_ms: -86400000 })}
                                        disabled={setTimeTravelMutation.isPending}
                                        variant="outline"
                                        size="sm"
                                        className="text-xs"
                                    >
                                        -1 Day
                                    </Button>
                                    <Button
                                        onClick={() => setTimeTravelMutation.mutate({ add_ms: 86400000 })}
                                        disabled={setTimeTravelMutation.isPending}
                                        variant="outline"
                                        size="sm"
                                        className="text-xs"
                                    >
                                        +1 Day
                                    </Button>
                                </div>
                                <Button
                                    onClick={() => setTimeTravelMutation.mutate({ reset: true })}
                                    disabled={setTimeTravelMutation.isPending}
                                    variant="ghost"
                                    size="sm"
                                    className="w-full text-xs text-blue-600 hover:text-blue-700"
                                >
                                    <RotateCcw className="w-3 h-3 mr-1" />
                                    Reset Clock
                                </Button>
                            </div>

                            <div className="space-y-2 pt-2 border-t border-border/50">
                                <Label className="text-xs font-semibold text-foreground">Automation & Reset</Label>
                                <Button
                                    onClick={() => testOvertimeMutation.mutate()}
                                    disabled={testOvertimeMutation.isPending}
                                    className="w-full bg-orange-600 hover:bg-orange-700 text-white font-medium text-xs"
                                >
                                    {testOvertimeMutation.isPending ? (
                                        <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                                    ) : (
                                        <>
                                            <AlertCircle className="w-4 h-4 mr-2" />
                                            Test Overtime Alert
                                        </>
                                    )}
                                </Button>
                                <Button
                                    onClick={() => triggerMissedDayMutation.mutate()}
                                    disabled={triggerMissedDayMutation.isPending}
                                    className="w-full bg-blue-600 hover:bg-blue-700 text-white font-medium text-xs"
                                >
                                    {triggerMissedDayMutation.isPending ? (
                                        <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                                    ) : (
                                        <>
                                            <CalendarDays className="w-4 h-4 mr-2" />
                                            Check Missed Working Days
                                        </>
                                    )}
                                </Button>
                                <Button
                                    onClick={() => resetBalanceMutation.mutate()}
                                    disabled={resetBalanceMutation.isPending}
                                    className="w-full bg-red-600 hover:bg-red-700 text-white font-medium text-xs"
                                >
                                    {resetBalanceMutation.isPending ? (
                                        <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                                    ) : (
                                        <>
                                            <Trash2 className="w-4 h-4 mr-2" />
                                            Reset Balance History
                                        </>
                                    )}
                                </Button>
                                <p className="text-[10px] text-muted-foreground italic">
                                    Balance reset sets balance to 0 and clears activity logs for you.
                                </p>
                            </div>
                        </div>
                    </div>
                )}
            </div>
        )}

        {/* Toast Notification */}
            {toast && (
                <Toast
                    message={toast.message}
                    type={toast.type}
                    onClose={() => setToast(null)}
                />
            )}
            <ProductTour />
            </div >
            );
            }







