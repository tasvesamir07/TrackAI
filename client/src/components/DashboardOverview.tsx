import { useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import api from '@/lib/api';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { Button } from '@/components/ui/button';
import { DashboardBarChart } from '@/components/charts';
import { 
    Clock, 
    CalendarDays, 
    CheckSquare, 
    MessageCircle, 
    Users, 
    TrendingUp,
    ArrowRight,
    Coffee,
    UserCheck,
    UserX,
    Plane
} from 'lucide-react';
import { format } from 'date-fns';
import { cn } from '@/lib/utils';
import { useSocket } from '@/context/SocketContext';

interface DashboardOverviewProps {
    user: any;
    isModerator?: boolean;
}

interface TeamSummary {
    totalEmployees: number;
    totalTeamHours: number;
    weeklyGoal: number;
    dailyGoal: number;
    workDaysInWeek: number;
    standardHours: number;
    weekendDays: number[];
    weeklyProgress: number;
    activeEmployees: number;
    onBreak: number;
    offline: number;
    onLeave: number;
    pendingTasksCount: number;
    pendingLeavesCount: number;
    employeesWithData: number;
}

interface WeeklyHours {
    weekStart: string;
    weekEnd: string;
    workDays: {
        date: string;
        dayName: string;
        dateNum: number;
        hours: number;
        employeeCount: number;
    }[];
}

interface UpcomingLeave {
    id: number;
    user_id: number;
    username: string;
    full_name: string;
    profile_picture?: string;
    leave_date: string;
    leave_type: string;
    reason: string;
    status: string;
}

interface AdminLeaveRequest {
    id: number;
    user_id: number;
    username: string;
    full_name?: string | null;
    leave_date?: string;
    start_date?: string;
    status: string;
    moderator_status?: string;
}

function formatHours(hours: number): string {
    if (hours >= 1000) {
        return `${(hours / 1000).toFixed(1)}k`;
    }
    return hours.toFixed(1);
}

export function DashboardOverview({ user }: DashboardOverviewProps) {
    const today = new Date();
    const dateStr = format(today, 'EEEE, MMMM d');
    const queryClient = useQueryClient();
    const { socket } = useSocket();

    const { data: teamSummary, isLoading: summaryLoading } = useQuery<TeamSummary>({
        queryKey: ['team-summary'],
        queryFn: async () => {
            const response = await api.get('/activity/team-summary');
            return response.data;
        },
        refetchOnMount: 'always',
        refetchOnWindowFocus: true,
        refetchOnReconnect: true,
    });

    const { data: weeklyHours, isLoading: weeklyLoading } = useQuery<WeeklyHours>({
        queryKey: ['team-weekly-hours'],
        queryFn: async () => {
            const response = await api.get('/activity/team-weekly-hours');
            return response.data;
        },
        refetchOnMount: 'always',
        refetchOnWindowFocus: true,
        refetchOnReconnect: true,
    });

    const { data: upcomingLeaves } = useQuery<UpcomingLeave[]>({
        queryKey: ['upcoming-leaves'],
        queryFn: async () => {
            const response = await api.get('/leaves/upcoming');
            return response.data;
        },
        refetchOnMount: 'always',
        refetchOnWindowFocus: true,
        refetchOnReconnect: true,
    });

    const { data: adminLeaves } = useQuery<AdminLeaveRequest[]>({
        queryKey: ['overview-pending-leaves'],
        queryFn: async () => {
            const response = await api.get('/leaves/admin');
            return Array.isArray(response.data) ? response.data : [];
        },
        refetchOnMount: 'always',
        refetchOnWindowFocus: true,
        refetchOnReconnect: true,
    });

    const { data: chatUnreadData } = useQuery<{ total: number }>({
        queryKey: ['chat-unread-count'],
        queryFn: async () => {
            try {
                const response = await api.get('/chat/unread-count');
                return response.data;
            } catch {
                return { total: 0 };
            }
        },
    });

    const totalTeamHours = teamSummary?.totalTeamHours || 0;
    const dailyGoal = teamSummary?.dailyGoal ?? teamSummary?.standardHours ?? 8;
    const workDaysInWeek = teamSummary?.workDaysInWeek ?? 5;
    const weeklyGoal = teamSummary?.weeklyGoal ?? (dailyGoal * workDaysInWeek);
    const weeklyProgress = teamSummary?.weeklyProgress ?? 0;
    const pendingLeaveRequests = (adminLeaves || []).filter((leave) => String(leave.status || '').toLowerCase() === 'pending');
    const pendingLeaveCount = teamSummary?.pendingLeavesCount ?? pendingLeaveRequests.length;

    const chartData = weeklyHours?.workDays?.map(day => ({
        name: day.dayName,
        value: day.hours,
        color: day.hours > 0 ? 'hsl(173, 58%, 39%)' : 'hsl(225, 80%, 56%)',
    })) || [];

    const totalChartHours = chartData.reduce((sum, day) => sum + day.value, 0);

    useEffect(() => {
        if (!socket) return;

        const refreshOverview = () => {
            queryClient.invalidateQueries({ queryKey: ['team-summary'] });
            queryClient.invalidateQueries({ queryKey: ['team-weekly-hours'] });
            queryClient.invalidateQueries({ queryKey: ['upcoming-leaves'] });
            queryClient.invalidateQueries({ queryKey: ['overview-pending-leaves'] });
        };

        socket.on('activity_logged', refreshOverview);
        socket.on('task_update', refreshOverview);
        socket.on('leave_update', refreshOverview);
        socket.on('report_summary_update', refreshOverview);
        socket.on('work_hours_update', refreshOverview);

        return () => {
            socket.off('activity_logged', refreshOverview);
            socket.off('task_update', refreshOverview);
            socket.off('leave_update', refreshOverview);
            socket.off('report_summary_update', refreshOverview);
            socket.off('work_hours_update', refreshOverview);
        };
    }, [socket, queryClient]);

    return (
        <div className="space-y-6">
            <div className="flex items-center justify-between">
                <div>
                    <h2 className="text-2xl font-bold text-foreground">Dashboard</h2>
                    <p className="text-sm text-muted-foreground">{dateStr}</p>
                </div>
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <span className="font-medium">Welcome back, {user?.full_name || user?.username}</span>
                </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                <div className="lg:col-span-2 space-y-6">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <FocusModeCard
                            hoursTracked={totalTeamHours}
                            weeklyGoal={weeklyGoal}
                            dailyGoal={dailyGoal}
                            workDaysInWeek={workDaysInWeek}
                            progress={weeklyProgress}
                            isLoading={summaryLoading}
                        />
                        <QuickStatsCard
                            activeTasks={teamSummary?.pendingTasksCount || 0}
                            pendingApprovals={teamSummary?.pendingLeavesCount || 0}
                            messagesToday={chatUnreadData?.total || 0}
                        />
                    </div>

                    <WorkloadChart
                        data={chartData}
                        totalHours={totalChartHours}
                        isLoading={weeklyLoading}
                    />
                </div>

                <div className="space-y-6">
                    <UpcomingLeaveCard
                        leaves={upcomingLeaves || []}
                        pendingLeavesCount={pendingLeaveCount}
                        pendingLeaves={pendingLeaveRequests}
                    />
                    <MyTeamCard
                        totalEmployees={teamSummary?.totalEmployees || 0}
                        activeEmployees={teamSummary?.activeEmployees || 0}
                        onBreak={teamSummary?.onBreak || 0}
                        offline={teamSummary?.offline || 0}
                        onLeave={teamSummary?.onLeave || 0}
                    />
                </div>
            </div>
        </div>
    );
}

function FocusModeCard({ hoursTracked, weeklyGoal, dailyGoal, workDaysInWeek, progress, isLoading }: {
    hoursTracked: number;
    weeklyGoal: number;
    dailyGoal: number;
    workDaysInWeek: number;
    progress: number;
    isLoading: boolean;
}) {
    const todayProgress = Math.min(100, Math.round((hoursTracked / dailyGoal) * 100));

    return (
        <Card className="border border-violet-500/20 shadow-xl bg-gradient-to-br from-violet-650 via-indigo-650 to-indigo-850 text-white rounded-2xl overflow-hidden">
            <CardHeader className="pb-2">
                <CardTitle className="flex items-center gap-2 text-lg font-semibold">
                    <Clock className="w-5 h-5 text-violet-250" />
                    Focus Mode
                </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
                {isLoading ? (
                    <div className="space-y-3">
                        <div className="h-8 bg-white/10 rounded animate-pulse" />
                        <div className="h-4 bg-white/10 rounded animate-pulse" />
                    </div>
                ) : (
                    <>
                        <div className="flex items-end justify-between">
                            <div>
                                <p className="text-4xl font-bold">{formatHours(hoursTracked)}h</p>
                                <p className="text-sm text-white/70">tracked today</p>
                            </div>
                            <div className="text-right">
                                <p className="text-lg font-semibold">{formatHours(weeklyGoal)}h</p>
                                <p className="text-xs text-white/70">weekly goal ({workDaysInWeek} days)</p>
                            </div>
                        </div>

                        <div className="space-y-2">
                            <div className="flex justify-between text-sm">
                                <span className="text-white/70">Daily goal: {dailyGoal}h</span>
                                <span className="font-medium">{todayProgress}%</span>
                            </div>
                            <Progress value={todayProgress} className="h-2 bg-white/20 [&>span]:bg-violet-300" />
                        </div>

                        <div className="pt-2 border-t border-white/10">
                            <div className="flex justify-between text-sm">
                                <span className="text-white/70">Weekly progress</span>
                                <span className="font-medium">{progress}%</span>
                            </div>
                            <Progress value={progress} className="h-2 mt-1.5 bg-white/20 [&>span]:bg-violet-400" />
                        </div>
                    </>
                )}
            </CardContent>
        </Card>
    );
}

function QuickStatsCard({ activeTasks, pendingApprovals, messagesToday }: {
    activeTasks: number;
    pendingApprovals: number;
    messagesToday: number;
}) {
    const stats = [
        {
            label: 'Active Tasks',
            value: activeTasks,
            icon: CheckSquare,
            color: 'text-violet-650 dark:text-violet-400',
            bgColor: 'bg-violet-500/10 dark:bg-violet-950/40 border border-violet-500/10'
        },
        {
            label: 'Pending Approvals',
            value: pendingApprovals,
            icon: CalendarDays,
            color: 'text-amber-500 dark:text-amber-400',
            bgColor: 'bg-amber-500/10 dark:bg-amber-950/40 border border-amber-500/10'
        },
        {
            label: 'Unread Messages',
            value: messagesToday,
            icon: MessageCircle,
            color: 'text-indigo-650 dark:text-indigo-400',
            bgColor: 'bg-indigo-500/10 dark:bg-indigo-950/40 border border-indigo-500/10'
        }
    ];

    return (
        <Card className="border border-border/40 shadow-xl bg-card/85 dark:bg-card/45 backdrop-blur-md rounded-2xl">
            <CardHeader className="pb-3">
                <CardTitle className="flex items-center gap-2 text-lg font-semibold">
                    <TrendingUp className="w-5 h-5 text-violet-600 dark:text-violet-400" />
                    Quick Stats
                </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
                {stats.map((stat, index) => (
                    <div key={index} className={cn(
                        "flex items-center justify-between p-3 rounded-xl transition-colors border",
                        stat.bgColor
                    )}>
                        <div className="flex items-center gap-3">
                            <stat.icon className={cn("w-5 h-5", stat.color)} />
                            <span className="text-sm font-medium text-foreground">{stat.label}</span>
                        </div>
                        <span className={cn("text-xl font-bold", stat.color)}>
                            {stat.value}
                        </span>
                    </div>
                ))}
            </CardContent>
        </Card>
    );
}

function WorkloadChart({ data, totalHours, isLoading }: {
    data: { name: string; value: number; color?: string }[];
    totalHours: number;
    isLoading: boolean;
}) {
    return (
        <Card className="border-0 shadow-sm rounded-2xl">
            <CardHeader className="flex flex-row items-center justify-between pb-2">
                <CardTitle className="text-lg font-semibold flex items-center gap-2">
                    <Users className="w-5 h-5 text-slate-700" />
                    Team Workload
                </CardTitle>
                <div className="flex items-center gap-2 text-sm">
                    <span className="text-muted-foreground">This week:</span>
                    <span className="font-bold text-slate-900">{formatHours(totalHours)}h total</span>
                </div>
            </CardHeader>
            <CardContent>
                {isLoading ? (
                    <div className="h-[250px] flex items-center justify-center">
                        <div className="w-full space-y-2">
                            {[1, 2, 3, 4, 5].map(i => (
                                <div key={i} className="h-8 bg-muted rounded animate-pulse" />
                            ))}
                        </div>
                    </div>
                ) : data.length > 0 ? (
                    <DashboardBarChart
                        data={data}
                        height={250}
                        colors={['hsl(225, 80%, 56%)', 'hsl(173, 58%, 39%)', 'hsl(43, 74%, 66%)', 'hsl(280, 65%, 60%)', 'hsl(340, 75%, 55%)']}
                    />
                ) : (
                    <div className="h-[250px] flex items-center justify-center text-muted-foreground">
                        <div className="text-center">
                            <Users className="w-12 h-12 mx-auto mb-2 opacity-20" />
                            <p className="font-medium">No workload data yet</p>
                            <p className="text-sm">Check back later</p>
                        </div>
                    </div>
                )}
            </CardContent>
        </Card>
    );
}

function UpcomingLeaveCard({
    leaves,
    pendingLeavesCount,
    pendingLeaves
}: {
    leaves: UpcomingLeave[];
    pendingLeavesCount: number;
    pendingLeaves: AdminLeaveRequest[];
}) {
    return (
        <Card className="border-0 shadow-sm rounded-2xl">
            <CardHeader className="pb-3">
                <CardTitle className="text-lg font-semibold flex items-center justify-between">
                    <span className="flex items-center gap-2">
                        <Plane className="w-5 h-5 text-slate-700" />
                        Upcoming Leaves
                        {pendingLeavesCount > 0 && (
                            <span className="inline-flex items-center rounded-full bg-red-100 px-2.5 py-0.5 text-xs font-bold text-red-700">
                                {pendingLeavesCount} pending
                            </span>
                        )}
                    </span>
                    <Button variant="ghost" size="sm" className="h-auto p-1 text-xs">
                        View all <ArrowRight className="w-3 h-3 ml-1" />
                    </Button>
                </CardTitle>
            </CardHeader>
            <CardContent>
                {pendingLeavesCount > 0 && (
                    <div className="mb-3 rounded-xl border border-red-200 bg-red-50 p-3">
                        <p className="text-sm font-bold text-red-700">
                            {pendingLeavesCount} leave request{pendingLeavesCount > 1 ? 's' : ''} need review
                        </p>
                        {pendingLeaves.slice(0, 2).map((leave) => (
                            <p key={leave.id} className="mt-1 text-xs text-red-700/90 truncate">
                                {leave.full_name || leave.username} · {format(new Date(leave.start_date || leave.leave_date || new Date()), 'MMM d, yyyy')}
                            </p>
                        ))}
                    </div>
                )}
                {leaves.length > 0 ? (
                    <div className="space-y-3">
                        {leaves.slice(0, 3).map((leave) => (
                            <div key={leave.id} className="flex items-center gap-3 p-3 bg-slate-50 rounded-xl">
                                <div className="w-10 h-10 rounded-full bg-slate-200 flex items-center justify-center text-sm font-bold text-slate-600">
                                    {leave.profile_picture ? (
                                        <img src={leave.profile_picture} alt="" className="w-full h-full rounded-full object-cover" />
                                    ) : (
                                        (leave.full_name || leave.username)[0]?.toUpperCase()
                                    )}
                                </div>
                                <div className="flex-1 min-w-0">
                                    <p className="font-medium text-sm truncate">{leave.full_name || leave.username}</p>
                                    <p className="text-xs text-muted-foreground">
                                        {format(new Date(leave.leave_date), 'MMM d, yyyy')}
                                    </p>
                                </div>
                                <div className="flex items-center gap-1.5">
                                    <span className={cn(
                                        "text-[10px] font-semibold px-2 py-0.5 rounded-full uppercase",
                                        leave.status === 'approved'
                                            ? "bg-emerald-100 text-emerald-700"
                                            : "bg-amber-100 text-amber-700"
                                    )}>
                                        {leave.status}
                                    </span>
                                    <span className={cn(
                                        "text-xs font-medium px-2 py-1 rounded-full",
                                        leave.leave_type === 'paid' ? "bg-blue-100 text-blue-700" : "bg-gray-100 text-gray-700"
                                    )}>
                                        {leave.leave_type}
                                    </span>
                                </div>
                            </div>
                        ))}
                    </div>
                ) : (
                    <div className="py-8 text-center text-muted-foreground">
                        <CalendarDays className="w-10 h-10 mx-auto mb-2 opacity-20" />
                        <p className="font-medium">No upcoming leaves</p>
                        {pendingLeavesCount > 0 && (
                            <p className="mt-1 text-xs font-semibold text-red-600">
                                {pendingLeavesCount} leave request{pendingLeavesCount > 1 ? 's' : ''} waiting for review
                            </p>
                        )}
                    </div>
                )}
            </CardContent>
        </Card>
    );
}

function MyTeamCard({
    totalEmployees,
    activeEmployees,
    onBreak,
    offline,
    onLeave
}: {
    totalEmployees: number;
    activeEmployees: number;
    onBreak: number;
    offline: number;
    onLeave: number;
}) {
    const teamStats = [
        { label: 'Active', value: activeEmployees, icon: UserCheck, color: 'text-emerald-600', bgColor: 'bg-emerald-50' },
        { label: 'On Break', value: onBreak, icon: Coffee, color: 'text-amber-600', bgColor: 'bg-amber-50' },
        { label: 'On Leave', value: onLeave, icon: Plane, color: 'text-blue-600', bgColor: 'bg-blue-50' },
        { label: 'Offline', value: offline, icon: UserX, color: 'text-slate-500', bgColor: 'bg-slate-100' },
    ];

    return (
        <Card className="border-0 shadow-sm rounded-2xl">
            <CardHeader className="pb-3">
                <CardTitle className="text-lg font-semibold flex items-center justify-between">
                    <span className="flex items-center gap-2">
                        <Users className="w-5 h-5 text-slate-700" />
                        My Team
                    </span>
                    <Button variant="ghost" size="sm" className="h-auto p-1 text-xs">
                        Team Overview <ArrowRight className="w-3 h-3 ml-1" />
                    </Button>
                </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
                <div className="text-center py-4 border-b border-border">
                    <p className="text-3xl font-bold text-slate-900">{totalEmployees}</p>
                    <p className="text-sm text-muted-foreground">Total Employees</p>
                </div>

                <div className="grid grid-cols-2 gap-2">
                    {teamStats.map((stat, index) => (
                        <div key={index} className={cn("p-3 rounded-xl", stat.bgColor)}>
                            <div className="flex items-center gap-2 mb-1">
                                <stat.icon className={cn("w-4 h-4", stat.color)} />
                                <span className="text-xs font-medium text-muted-foreground">{stat.label}</span>
                            </div>
                            <p className={cn("text-xl font-bold", stat.color)}>{stat.value}</p>
                        </div>
                    ))}
                </div>
            </CardContent>
        </Card>
    );
}

export default DashboardOverview;
