import { Link, useLocation } from 'react-router-dom';
import { LogOut, Menu, ChevronRight, type LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { useState, useMemo } from 'react';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { ThemeToggle } from './ui/ThemeToggle';
import {
    Activity,
    Briefcase,
    ClipboardList,
    Clock,
    DollarSign,
    FileText,
    Book,
    Key,
    Layers,
    LayoutGrid,
    Lock,
    Map as MapIcon,
    CalendarDays,
    Shield,
    ShieldAlert,
    TrendingUp,
    User,
    Users,
    MessageCircle,
    Settings,
    Sparkles,
    Zap,
} from 'lucide-react';

export interface SidebarItem {
    label: string;
    to: string;
    icon: LucideIcon;
    badge?: number;
    liveIndicator?: boolean;
}

export interface SidebarSection {
    title?: string;
    items: SidebarItem[];
}

interface RoleSidebarProps {
    title: string;
    subtitle: string;
    sections?: SidebarSection[];
    items?: SidebarItem[];
    userName?: string | null;
    roleLabel?: string | null;
    onLogout?: () => void;
    activeTab?: string;
    onTabChange?: (to: string) => void;
}

interface SidebarContentProps extends RoleSidebarProps {
    collapsed?: boolean;
}

function SidebarContent({
    title,
    subtitle,
    sections,
    items,
    userName,
    roleLabel,
    onLogout,
    activeTab,
    onTabChange,
    collapsed = false
}: SidebarContentProps & { items?: SidebarItem[] }) {
    const location = useLocation();
    
    // Convert items array to sections format for backward compatibility
    const displaySections = sections || (items ? [{ items }] : []);

    const renderItem = (item: SidebarItem, index: number, collapsed: boolean) => {
        const Icon = item.icon;
        const itemPath = item.to.split('?')[0];
        const itemSearchParams = new URLSearchParams(item.to.split('?')[1] || '');
        const itemTab = itemSearchParams.get('tab');
        const itemSub = itemSearchParams.get('sub');
        const currentSearchParams = new URLSearchParams(location.search || '');
        const currentTab = currentSearchParams.get('tab');
        const currentSub = currentSearchParams.get('sub');

        const isRouteMatch = location.pathname === itemPath;
        const isTabMatch = itemTab ? currentTab === itemTab : false;
        const isSubMatch = itemSub ? currentSub === itemSub : true;
        const isActive =
            (itemTab ? isTabMatch && isSubMatch : isRouteMatch) ||
            (activeTab && itemTab ? activeTab === itemTab && isSubMatch : false);

        if (collapsed) {
            return (
                <Tooltip key={`${item.to}-${index}`} delayDuration={0}>
                    <TooltipTrigger asChild>
                        <Link
                            to={item.to}
                            className={cn(
                                'relative flex items-center justify-center rounded-xl p-2.5 text-sm font-semibold transition-colors',
                                isActive
                                    ? 'bg-primary text-primary-foreground'
                                    : 'text-muted-foreground hover:bg-card hover:text-foreground'
                            )}
                        >
                            <Icon className={cn("h-4 w-4", isActive ? "text-primary-foreground" : "text-muted-foreground")} />
                            {item.liveIndicator && (
                                <span className="absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
                            )}
                        </Link>
                    </TooltipTrigger>
                    <TooltipContent side="right" className="bg-popover text-popover-foreground">
                        {item.label}
                    </TooltipContent>
                </Tooltip>
            );
        }

        return (
            <Link
                key={`${item.to}-${index}`}
                to={item.to}
                onClick={() => onTabChange?.(item.to)}
                className={cn(
                    'group flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-semibold transition-colors',
                    isActive
                        ? 'bg-primary text-primary-foreground'
                        : 'text-muted-foreground hover:bg-card hover:text-foreground'
                )}
            >
                <Icon className={cn("h-4 w-4 shrink-0", isActive ? "text-primary-foreground/80" : "text-muted-foreground group-hover:text-foreground")} />
                <span className="flex-1">{item.label}</span>
                {item.badge && item.badge > 0 && (
                    <span className="bg-red-500 text-white text-[10px] font-bold px-1.5 py-0.5 rounded-full">
                        {item.badge > 99 ? '99+' : item.badge}
                    </span>
                )}
                {item.liveIndicator && (
                    <span className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
                )}
            </Link>
        );
    };

    return (
        <div className="flex h-full flex-col">
            <div className={cn("px-4 py-6", collapsed ? "text-center" : "")}>
                <h2 className={cn("font-bold text-foreground", collapsed ? "text-2xl" : "text-[28px] leading-none")}>
                    {collapsed ? (
                        <span className="text-2xl">T</span>
                    ) : title}
                </h2>
                {!collapsed && (
                    <p className="mt-2 text-xs font-medium text-muted-foreground">{subtitle}</p>
                )}
            </div>

            <div className={cn("px-4 pt-2 flex-1 overflow-y-auto custom-scrollbar", collapsed && "px-2")}>
                <nav className="space-y-5">
                    {displaySections?.map((section, sectionIndex) => (
                        <div key={sectionIndex}>
                            {section.title && !collapsed && (
                                <p className="mb-2 px-3 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                                    {section.title}
                                </p>
                            )}
                            <div className="space-y-1">
                                {section.items.map((item, itemIndex) => (
                                    renderItem(item, itemIndex, collapsed)
                                ))}
                            </div>
                        </div>
                    ))}
                </nav>
            </div>

            <div className={cn("border-t border-border p-4 space-y-4", collapsed && "p-2")}>
                <div className={cn("flex items-center justify-between", collapsed && "justify-center")}>
                    <div className={cn("rounded-xl border border-border bg-card px-3 py-2.5 flex-1 mr-2", collapsed && "hidden")}>
                        <p className="truncate text-sm font-semibold text-foreground">{userName || 'User'}</p>
                        <p className="truncate text-xs text-muted-foreground">{roleLabel || 'Account'}</p>
                    </div>
                    <ThemeToggle />
                </div>
                <Button
                    type="button"
                    variant="outline"
                    onClick={onLogout}
                    className={cn(
                        "w-full justify-center rounded-xl border-border bg-card text-muted-foreground hover:bg-muted hover:text-foreground",
                        collapsed && "p-2"
                    )}
                >
                    <LogOut className={cn("h-4 w-4", !collapsed && "mr-2")} />
                    {!collapsed && <span>Sign Out</span>}
                </Button>
            </div>
        </div>
    );
}

export function MobileRoleSidebar(props: RoleSidebarProps) {
    const [open, setOpen] = useState(false);

    return (
        <>
            <div onClick={() => setOpen(true)}>
                <Button variant="ghost" size="icon" className="lg:hidden text-muted-foreground hover:bg-muted hover:text-foreground">
                    <Menu className="h-5 w-5" />
                </Button>
            </div>
            {open && (
                <>
                    <button
                        type="button"
                        aria-label="Close sidebar"
                        onClick={() => setOpen(false)}
                        className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm"
                    />
                    <div className="fixed inset-y-0 left-0 z-[60] w-72 max-w-[85vw] border-r border-border bg-background/95">
                        <div className="flex h-full flex-col">
                            <div className="absolute right-3 top-3">
                                <Button
                                    type="button"
                                    size="icon"
                                    variant="ghost"
                                    className="h-8 w-8 text-muted-foreground hover:bg-card"
                                    onClick={() => setOpen(false)}
                                >
                                    <span className="sr-only">Close sidebar</span>
                                    Ã—
                                </Button>
                            </div>
                            <SidebarContent {...props} />
                        </div>
                    </div>
                </>
            )}
        </>
    );
}

interface ExpandedRoleSidebarProps extends RoleSidebarProps {
    collapsed: boolean;
    onToggleCollapse?: () => void;
}

export function ExpandedRoleSidebar({
    title,
    subtitle,
    sections,
    items,
    userName,
    roleLabel,
    onLogout,
    activeTab,
    onTabChange,
    collapsed = false,
    onToggleCollapse,
}: ExpandedRoleSidebarProps & { items?: SidebarItem[] }) {
    return (
        <aside className={cn(
            "hidden lg:fixed lg:inset-y-0 lg:left-0 lg:z-50 lg:flex lg:flex-col lg:border-r lg:border-border lg:bg-background/95 transition-all duration-300",
            collapsed ? "lg:w-20" : "lg:w-64"
        )}>
            <SidebarContent
                title={title}
                subtitle={subtitle}
                sections={sections}
                items={items}
                userName={userName}
                roleLabel={roleLabel}
                onLogout={onLogout}
                activeTab={activeTab}
                onTabChange={onTabChange}
                collapsed={collapsed}
            />
            
            {onToggleCollapse && (
                <div className={cn("border-t border-border p-2", collapsed && "p-1")}>
                    <Button
                        variant="ghost"
                        onClick={onToggleCollapse}
                        className={cn(
                            "w-full justify-center rounded-xl text-muted-foreground hover:bg-card hover:text-foreground",
                            collapsed && "p-2"
                        )}
                    >
                        {collapsed ? (
                            <ChevronRight className="h-4 w-4" />
                        ) : (
                            <>
                                <ChevronRight className="h-4 w-4 mr-2" />
                                <span className="text-xs">Collapse</span>
                            </>
                        )}
                    </Button>
                </div>
            )}
        </aside>
    );
}

export function RoleSidebar(props: RoleSidebarProps) {
    return (
        <>
            <ExpandedRoleSidebar {...props} collapsed={false} />
            <MobileRoleSidebar {...props} />
        </>
    );
}

// Hook for Admin sidebar items
export function useAdminSidebarItems(options?: {
    pendingLeaves?: number;
    pendingProfileRequests?: number;
    chatUnreadCount?: number;
    hasLiveTracking?: boolean;
}) {
    const { pendingLeaves = 0, chatUnreadCount = 0, hasLiveTracking = false } = options || {};

    return useMemo(() => {
        const mainItems: SidebarItem[] = [
            { label: 'Dashboard', to: '/admin?tab=overview', icon: Activity },
            { label: 'Projects', to: '/projects', icon: Briefcase },
        ];

        const reportsItems: SidebarItem[] = [
            { label: 'Daily', to: '/admin?tab=reports&sub=daily', icon: FileText },
            { label: 'Weekly', to: '/admin?tab=reports&sub=weekly', icon: CalendarDays },
            { label: 'Monthly', to: '/admin?tab=reports&sub=monthly', icon: CalendarDays },
            { label: 'Yearly', to: '/admin?tab=reports&sub=yearly', icon: CalendarDays },
            { label: 'Attendance', to: '/admin?tab=reports&sub=monthly_attendance', icon: Activity },
        ];

        const teamItems: SidebarItem[] = [
            { label: 'Users', to: '/admin?tab=users', icon: Users },
            { label: 'Activity', to: '/admin?tab=activity', icon: Activity },
            { label: 'Live Tracking', to: '/admin?tab=live_tracking', icon: Sparkles, liveIndicator: hasLiveTracking },
            { label: 'My Team', to: '/admin?tab=users&sub=team', icon: Users },
            { label: 'Leaves', to: '/admin?tab=leaves', icon: CalendarDays, badge: pendingLeaves },
            { label: 'Payroll', to: '/admin?tab=payroll', icon: DollarSign },
            { label: 'Knowledge Base', to: '/admin?tab=knowledge-base', icon: Book },
        ];

        const communicationItems: SidebarItem[] = [
            { label: 'Messages', to: '/admin?tab=chat', icon: MessageCircle, badge: chatUnreadCount },
        ];

        const settingsItems: SidebarItem[] = [
            { label: 'Settings', to: '/admin?tab=settings', icon: Settings },
            { label: 'Audit Logs', to: '/admin?tab=audit-logs', icon: Shield },
            { label: 'API Keys', to: '/admin?tab=api-keys', icon: Key },
        ];

        return [
            { items: mainItems },
            { title: 'Reports', items: reportsItems },
            { title: 'Team', items: teamItems },
            { title: 'Communication', items: communicationItems },
            { title: 'Settings', items: settingsItems },
        ];
    }, [pendingLeaves, chatUnreadCount, hasLiveTracking]);
}

// Hook for Moderator sidebar items
export function useModeratorSidebarItems(options?: {
    pendingLeaves?: number;
    chatUnreadCount?: number;
}) {
    const { pendingLeaves = 0, chatUnreadCount = 0 } = options || {};

    return useMemo(() => {
        const mainItems: SidebarItem[] = [
            { label: 'Dashboard', to: '/project-manager?tab=overview', icon: Activity },
            { label: 'KPIs', to: '/project-manager?tab=kpis', icon: TrendingUp },
            { label: 'Approvals', to: '/project-manager?tab=approvals', icon: ClipboardList, badge: pendingLeaves },
            { label: 'Projects', to: '/projects', icon: Briefcase },
        ];

        const reportsItems: SidebarItem[] = [
            { label: 'Daily', to: '/project-manager?tab=reports&sub=daily', icon: FileText },
            { label: 'Weekly', to: '/project-manager?tab=reports&sub=weekly', icon: CalendarDays },
            { label: 'Monthly', to: '/project-manager?tab=reports&sub=monthly', icon: CalendarDays },
            { label: 'Yearly', to: '/project-manager?tab=reports&sub=yearly', icon: CalendarDays },
            { label: 'Attendance', to: '/project-manager?tab=reports&sub=monthly_attendance', icon: Activity },
        ];

        const teamItems: SidebarItem[] = [
            { label: 'Activity', to: '/project-manager?tab=activity', icon: Activity },
            { label: 'My Team', to: '/project-manager?tab=users&sub=team', icon: Users },
            { label: 'Leaves', to: '/project-manager?tab=leaves', icon: CalendarDays, badge: pendingLeaves },
        ];

        const communicationItems: SidebarItem[] = [
            { label: 'Messages', to: '/project-manager?tab=chat', icon: MessageCircle, badge: chatUnreadCount },
        ];

        return [
            { items: mainItems },
            { title: 'Reports', items: reportsItems },
            { title: 'Team', items: teamItems },
            { title: 'Communication', items: communicationItems },
        ];
    }, [pendingLeaves, chatUnreadCount]);
}

export function useEmployeeSidebarItems() {
    return useMemo<SidebarItem[]>(() => ([
        { label: 'Dashboard', to: '/dashboard', icon: ClipboardList },
        { label: 'Projects', to: '/projects', icon: Briefcase },
        { label: 'Profile', to: '/profile', icon: User },
    ]), []);
}

// Hook for Superadmin sidebar items (single source of truth used by dashboard + profile)
export function useSuperadminSidebarItems() {
    return useMemo<SidebarItem[]>(() => ([
        { label: 'Dashboard', to: '/superadmin', icon: LayoutGrid },
        { label: 'Plan Catalog', to: '/superadmin?tab=plans', icon: Layers },
        { label: 'Time Travel', to: '/superadmin?tab=time-travel', icon: Clock },
        { label: 'Permissions', to: '/superadmin?tab=permissions', icon: Lock },
        { label: 'Load Testing', to: '/superadmin?tab=load-testing', icon: Zap },
        { label: 'Performance Logs', to: '/superadmin?tab=performance', icon: Activity },
        { label: 'Geomap Analytics', to: '/superadmin?tab=analytics', icon: MapIcon },
        { label: 'Bot Protection', to: '/superadmin?tab=bot-protection', icon: ShieldAlert },
        { label: 'Profile', to: '/profile', icon: User },
    ]), []);
}

export function useRoleSidebarConfig(options: {
    role?: string | null;
    isCompanyAdmin?: boolean;
    adminSections: SidebarSection[];
    moderatorSections: SidebarSection[];
    superadminItems: SidebarItem[];
    employeeItems: SidebarItem[];
}) {
    const {
        role,
        isCompanyAdmin = false,
        adminSections,
        moderatorSections,
        superadminItems,
        employeeItems,
    } = options;
    const isSuperadmin = role === 'SUPERADMIN';
    const isModerator = role === 'moderator';

    return useMemo(() => {
        if (isSuperadmin) return { items: superadminItems };
        if (isCompanyAdmin) return { sections: adminSections };
        if (isModerator) return { sections: moderatorSections };
        return { items: employeeItems };
    }, [isSuperadmin, isCompanyAdmin, isModerator, superadminItems, adminSections, moderatorSections, employeeItems]);
}

export default RoleSidebar;


