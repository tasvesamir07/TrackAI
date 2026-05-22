import { ThemeToggle } from '@/components/ui/ThemeToggle';
import { HeatmapOverlay } from '@/components/admin/HeatmapOverlay';
import { AnalyticsDashboard } from '@/components/admin/AnalyticsDashboard';
import { BotProtectionPanel } from '@/components/admin/BotProtectionPanel';
import { LoadTestConfig } from '@/components/admin/LoadTestConfig';
import { PerformanceMonitor } from '@/components/admin/PerformanceMonitor';
import { WorldMap } from '@/components/analytics/WorldMap';
import { Fragment, useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ShieldCheck, Building2, Users, BadgeCheck, ShieldAlert, RefreshCw, LogOut, Search, LayoutGrid, User, Layers, Star, Plus, Clock, Lock, Activity, Map as MapIcon, Zap } from 'lucide-react';
import { Link, useLocation } from 'react-router-dom';
import { useAuth } from '@/context/AuthContext';
import api from '@/lib/api';
import { cn } from '@/lib/utils';
import { Toast } from '@/components/ui/Toast';
import { useSuperadminSidebarItems } from '@/components/RoleSidebar';

interface PlanItem {
    id: string;
    code: string;
    name: string;
    monthly_price: string | number;
    max_company_admins: number;
    max_project_managers: number;
    max_employees: number;
    is_popular: boolean;
}

interface PlanDraft {
    monthly_price: string;
    max_company_admins: string;
    max_project_managers: string;
    max_employees: string;
    is_popular: boolean;
}

interface CompanyItem {
    id: string;
    name: string;
    slug: string;
    is_active: boolean;
    unlimited_access: boolean;
    subscription_status: string;
    plan_id: string;
    plan_code: string;
    total_users: number;
    admin_email?: string | null;
    trial_ends_at?: string | null;
    current_period_ends_at?: string | null;
    expires_at?: string | null;
    expires_at_ms?: number | null;
    subscription_active?: boolean;
    subscription_block_reason?: string | null;
}

interface DashboardResponse {
    summary: {
        total_companies: number;
        active_companies: number;
        blocked_companies: number;
        subscribed_companies: number;
    };
    plans: PlanItem[];
    companies: CompanyItem[];
    landing_video_url?: string;
    landing_video_enabled?: boolean;
    clock?: {
        virtual_time: string;
        virtual_time_ms: number;
        offset_ms: number;
    };
}

interface PermissionModule {
    module_id: number;
    name: string;
    display_name: string;
    icon: string;
    sort_order: number;
    actions: Array<{
        id: number;
        name: string;
        display_name: string;
        description: string | null;
        sort_order: number;
    }>;
}

interface PermissionData {
    modules: PermissionModule[];
    globalPermissions: {
        admin: Record<string, Record<string, boolean>>;
        moderator: Record<string, Record<string, boolean>>;
        employee: Record<string, Record<string, boolean>>;
    };
}

interface CompanyOverride {
    module: string;
    action: string;
    is_enabled: boolean;
    global_default: boolean;
}

const ROLE_LABELS: Record<string, string> = {
    admin: 'Admin',
    moderator: 'Moderator',
    employee: 'Employee'
};

function PermissionsTab() {
    const [activeSection, setActiveSection] = useState<'global' | 'company'>('global');
    const [selectedCompany, setSelectedCompany] = useState<string>('');
    const [companies, setCompanies] = useState<Array<{ id: string; name: string }>>([]);
    const [companyOverrides, setCompanyOverrides] = useState<CompanyOverride[]>([]);
    const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' | 'info' } | null>(null);
    const [isSaving, setIsSaving] = useState(false);

    const { data: permData, isLoading: permLoading, refetch: refetchPerms } = useQuery<PermissionData>({
        queryKey: ['superadmin-permissions'],
        queryFn: async () => {
            const res = await api.get('/superadmin/permissions/global');
            return res.data;
        },
        enabled: true
    });

    useEffect(() => {
        api.get('/superadmin/permissions/companies').then(res => {
            setCompanies(res.data);
        }).catch(() => {});
    }, []);

    useEffect(() => {
        if (!selectedCompany) {
            setCompanyOverrides([]);
            return;
        }
        api.get(`/superadmin/permissions/companies/${selectedCompany}/overrides`).then(res => {
            setCompanyOverrides(res.data.overrides || []);
        }).catch(() => {
            setCompanyOverrides([]);
        });
    }, [selectedCompany]);

    const handleToggle = async (role: string, module: string, action: string, currentValue: boolean, isCompanyOverride: boolean) => {
        const normalizedModule = String(module || '').trim();
        const normalizedAction = String(action || '').trim();
        if (!normalizedModule || !normalizedAction) {
            setToast({ message: 'Invalid permission mapping detected. Please seed defaults.', type: 'error' });
            return;
        }

        setIsSaving(true);
        try {
            if (isCompanyOverride) {
                await api.put(`/superadmin/permissions/companies/${selectedCompany}/overrides`, {
                    role, module: normalizedModule, action: normalizedAction, is_enabled: !currentValue
                });
            } else {
                await api.put('/superadmin/permissions/global', {
                    role, module: normalizedModule, action: normalizedAction, is_enabled: !currentValue
                });
            }
            await refetchPerms();
            if (selectedCompany) {
                const res = await api.get(`/superadmin/permissions/companies/${selectedCompany}/overrides`);
                setCompanyOverrides(res.data.overrides || []);
            }
            setToast({ message: 'Permission updated', type: 'success' });
        } catch {
            setToast({ message: 'Failed to update permission', type: 'error' });
        } finally {
            setIsSaving(false);
        }
    };

    const handleResetCompany = async () => {
        if (!selectedCompany) return;
        if (!window.confirm('Reset all company permission overrides?')) return;
        try {
            await api.delete(`/superadmin/permissions/companies/${selectedCompany}/overrides`);
            setCompanyOverrides([]);
            await refetchPerms();
            setToast({ message: 'Company overrides reset', type: 'success' });
        } catch {
            setToast({ message: 'Failed to reset overrides', type: 'error' });
        }
    };

    const handleSeed = async () => {
        if (!window.confirm('Seed default permissions? This will update existing permissions.')) return;
        try {
            await api.post('/superadmin/permissions/seed');
            await refetchPerms();
            if (selectedCompany) {
                const res = await api.get(`/superadmin/permissions/companies/${selectedCompany}/overrides`);
                setCompanyOverrides(res.data.overrides || []);
            }
            setToast({ message: 'Permissions seeded successfully', type: 'success' });
        } catch {
            setToast({ message: 'Failed to seed permissions', type: 'error' });
        }
    };

    type PermissionRole = keyof PermissionData['globalPermissions'];

    const getPermission = (role: PermissionRole, module: string, action: string): boolean | null => {
        const overrides = activeSection === 'company' ? companyOverrides : [];
        const override = overrides.find(o => o.module === module && o.action === action);
        if (override) return override.is_enabled;
        
        const global = permData?.globalPermissions?.[role]?.[module]?.[action];
        if (global !== undefined) return global;
        return null;
    };

    const hasOverride = (module: string, action: string): boolean => {
        return companyOverrides.some(o => o.module === module && o.action === action);
    };

    const roles: PermissionRole[] = ['admin', 'moderator', 'employee'];
    const toReadableLabel = (value: string) => value
        .split('_')
        .filter(Boolean)
        .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
        .join(' ');

    const normalizedModules = useMemo(() => {
        const source = permData?.modules || [];
        return source
            .map((mod) => {
                const moduleName = String(mod?.name || '').trim();
                const moduleDisplayName = String(mod?.display_name || '').trim() || (moduleName ? toReadableLabel(moduleName) : 'General');
                const actions = (mod?.actions || [])
                    .map((action) => {
                        const actionName = String(action?.name || '').trim();
                        const actionDisplayName = String(action?.display_name || '').trim() || (actionName ? toReadableLabel(actionName) : 'Unnamed Action');
                        return {
                            ...action,
                            name: actionName,
                            display_name: actionDisplayName
                        };
                    })
                    .filter((action) => action.name);

                return {
                    ...mod,
                    name: moduleName,
                    display_name: moduleDisplayName,
                    actions
                };
            })
            .filter((mod) => mod.name || mod.actions.length > 0);
    }, [permData?.modules]);

    if (permLoading) {
        return (
            <div className="p-6 space-y-4">
                <div className="h-8 w-48 animate-pulse rounded bg-muted" />
                {[1, 2, 3].map(i => (
                    <div key={i} className="h-24 animate-pulse rounded-xl bg-muted" />
                ))}
            </div>
        );
    }

    return (
        <div className="p-6">
            <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
                <div>
                    <h2 className="text-lg font-bold text-foreground">Permission Management</h2>
                    <p className="text-sm text-muted-foreground">Configure role-based permissions globally or per company</p>
                </div>
                <div className="flex items-center gap-2">
                    <button
                        onClick={handleSeed}
                        className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-2 text-sm font-semibold text-amber-700 hover:bg-amber-100 transition"
                    >
                        Seed Defaults
                    </button>
                    <button
                        onClick={() => refetchPerms()}
                        className="rounded-lg border border-border bg-card px-4 py-2 text-sm font-semibold text-foreground hover:bg-muted transition"
                    >
                        Refresh
                    </button>
                </div>
            </div>

            <div className="mb-6 flex items-center gap-2">
                <button
                    onClick={() => setActiveSection('global')}
                    className={cn(
                        'rounded-lg px-4 py-2 text-sm font-semibold transition',
                        activeSection === 'global'
                            ? 'bg-blue-600 text-white'
                            : 'border border-border bg-card text-foreground hover:bg-muted'
                    )}
                >
                    Global Permissions
                </button>
                <button
                    onClick={() => setActiveSection('company')}
                    className={cn(
                        'rounded-lg px-4 py-2 text-sm font-semibold transition',
                        activeSection === 'company'
                            ? 'bg-blue-600 text-white'
                            : 'border border-border bg-card text-foreground hover:bg-muted'
                    )}
                >
                    Company Overrides
                </button>
            </div>

            {activeSection === 'company' && (
                <div className="mb-6 flex items-center gap-4">
                    <select
                        value={selectedCompany}
                        onChange={(e) => setSelectedCompany(e.target.value)}
                        className="rounded-lg border border-border bg-card px-4 py-2 text-sm text-foreground"
                    >
                        <option value="">Select a company...</option>
                        {companies.map(c => (
                            <option key={c.id} value={c.id}>{c.name}</option>
                        ))}
                    </select>
                    {selectedCompany && (
                        <button
                            onClick={handleResetCompany}
                            className="rounded-lg border border-red-200 bg-red-50 px-4 py-2 text-sm font-semibold text-red-700 hover:bg-red-100 transition"
                        >
                            Reset All Overrides
                        </button>
                    )}
                </div>
            )}

            {!selectedCompany && activeSection === 'company' ? (
                <div className="rounded-xl border border-border bg-muted/30 p-8 text-center">
                    <p className="text-muted-foreground">Select a company to manage its permission overrides</p>
                </div>
            ) : (
                <div className="overflow-x-auto rounded-xl border border-border">
                    <table className="w-full min-w-[800px] text-sm">
                        <thead>
                            <tr className="border-b border-border bg-muted/50">
                                <th className="px-4 py-3 text-left text-xs font-bold uppercase tracking-wider text-muted-foreground">Module / Action</th>
                                {roles.map(role => (
                                    <th key={role} className="px-4 py-3 text-center text-xs font-bold uppercase tracking-wider text-muted-foreground">
                                        {ROLE_LABELS[role]}
                                    </th>
                                ))}
                            </tr>
                        </thead>
                        <tbody>
                            {normalizedModules.map((mod) => (
                                <Fragment key={mod.name}>
                                    <tr key={`${mod.name}-header`} className="bg-slate-50/80">
                                        <td colSpan={4} className="px-4 py-2 font-bold text-foreground">
                                            {mod.display_name}
                                            {mod.name && <span className="font-normal text-muted-foreground"> ({mod.name})</span>}
                                        </td>
                                    </tr>
                                    {mod.actions?.map((action) => (
                                        <tr key={`${mod.name}-${action.name}`} className="border-b border-border/50 hover:bg-card/40 transition">
                                            <td className="px-4 py-3 pl-8">
                                                <span className="font-medium text-foreground">{action.display_name}</span>
                                                <span className="ml-2 text-xs text-muted-foreground">({action.name})</span>
                                            </td>
                                            {roles.map(role => {
                                                const permValue = getPermission(role, mod.name, action.name);
                                                const isOverridden = activeSection === 'company' && hasOverride(mod.name, action.name);
                                                const isEnabled = permValue === true;
                                                
                                                return (
                                                    <td key={role} className="px-4 py-3 text-center">
                                                        <button
                                                            onClick={() => handleToggle(role, mod.name, action.name, isEnabled, activeSection === 'company')}
                                                            disabled={isSaving}
                                                            aria-pressed={isEnabled}
                                                            title={isEnabled ? 'Click to turn OFF' : 'Click to turn ON'}
                                                            className={cn(
                                                                'relative inline-flex h-7 w-14 items-center rounded-full border-2 transition duration-200',
                                                                isEnabled
                                                                    ? 'border-emerald-400 bg-emerald-500/20 hover:bg-emerald-500/30'
                                                                    : 'border-slate-300 bg-slate-100 hover:bg-slate-200'
                                                            )}
                                                        >
                                                            <span
                                                                className={cn(
                                                                    'absolute left-0.5 top-0.5 h-5 w-5 rounded-full bg-white shadow-sm transition-transform',
                                                                    isEnabled ? 'translate-x-7' : 'translate-x-0'
                                                                )}
                                                            />
                                                            <span className={cn(
                                                                'absolute inset-0 flex items-center justify-center text-[10px] font-bold tracking-wide',
                                                                isEnabled ? 'text-emerald-700' : 'text-slate-600'
                                                            )}>
                                                                {isEnabled ? 'ON' : 'OFF'}
                                                            </span>
                                                        </button>
                                                        {isOverridden && (
                                                            <span className="ml-1 text-[10px] font-semibold text-blue-600">*</span>
                                                        )}
                                                    </td>
                                                );
                                            })}
                                        </tr>
                                    ))}
                                </Fragment>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}

            {toast && (
                <Toast
                    message={toast.message}
                    type={toast.type}
                    onClose={() => setToast(null)}
                />
            )}
        </div>
    );
}

const LANDING_VIDEO_MAX_SIZE_BYTES = 250 * 1024 * 1024;
const LANDING_VIDEO_ALLOWED_MIME_TYPES = ['video/mp4', 'video/quicktime', 'video/webm'];

export default function SuperadminDashboard() {
    const { user, logout } = useAuth();
    const location = useLocation();
    const queryClient = useQueryClient();
    const superadminSidebarItems = useSuperadminSidebarItems();

const getTabFromSearch = (search: string): 'companies' | 'plans' | 'time-travel' | 'permissions' | 'load-testing' | 'performance' | 'analytics' | 'bot-protection' => {
        const params = new URLSearchParams(search);
        const tab = params.get('tab');
        if (tab === 'time-travel') return 'time-travel';
        if (tab === 'permissions') return 'permissions';
        if (tab === 'load-testing') return 'load-testing';
        if (tab === 'performance') return 'performance';
        if (tab === 'analytics') return 'analytics';
        if (tab === 'bot-protection') return 'bot-protection';
        return tab === 'plans' ? 'plans' : 'companies';
    };

    const activeTab = useMemo(() => getTabFromSearch(location.search), [location.search]);

    const [searchTerm, setSearchTerm] = useState('');
    const [selectedPlans, setSelectedPlans] = useState<Record<string, string>>({});
    const [planDrafts, setPlanDrafts] = useState<Record<string, PlanDraft>>({});
    const [landingVideoUrl, setLandingVideoUrl] = useState('');
    const [isAddingPlan, setIsAddingPlan] = useState(false);
    const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' | 'info' } | null>(null);
    const [landingVideoEnabled, setLandingVideoEnabled] = useState(true);

    const { data, isLoading, isFetching, refetch } = useQuery<DashboardResponse>({
        queryKey: ['superadmin-dashboard'],
        queryFn: async () => {
            const res = await api.get('/superadmin/dashboard?view=compact');
            return res.data;
        },
        enabled: user?.role === 'SUPERADMIN',
    });

    useEffect(() => {
        if (!data?.companies) return;
        const nextPlans: Record<string, string> = {};
        for (const company of data.companies) {
            nextPlans[company.id] = company.plan_id;
        }
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setSelectedPlans(nextPlans);
    }, [data?.companies]);

    useEffect(() => {
        if (!data?.plans) return;
        const nextDrafts: Record<string, PlanDraft> = {};
        for (const plan of data.plans) {
            nextDrafts[plan.id] = {
                monthly_price: String(plan.monthly_price ?? ''),
                max_company_admins: String(plan.max_company_admins ?? 0),
                max_project_managers: String(plan.max_project_managers ?? 0),
                max_employees: String(plan.max_employees ?? 0),
                is_popular: plan.is_popular ?? false,
            };
        }
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setPlanDrafts(nextDrafts);
    }, [data?.plans]);

    useEffect(() => {
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setLandingVideoUrl(String(data?.landing_video_url || '').trim());
    }, [data?.landing_video_url]);

    useEffect(() => {
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setLandingVideoEnabled(Boolean(data?.landing_video_enabled ?? true));
    }, [data?.landing_video_enabled]);

    const updatePlanMutation = useMutation({
        mutationFn: async ({ companyId, planId }: { companyId: string; planId: string }) => {
            await api.patch(`/superadmin/companies/${companyId}/plan`, { planId });
        },
        onSuccess: () => {
            setToast({ message: 'Plan updated successfully', type: 'success' });
            queryClient.invalidateQueries({ queryKey: ['superadmin-dashboard'] });
        },
        onError: (err: unknown) => {
            const error = err as { response?: { data?: { error?: string } } };
            setToast({ message: error?.response?.data?.error || 'Failed to update plan', type: 'error' });
        }
    });

    const toggleStatusMutation = useMutation({
        mutationFn: async ({ companyId, isActive }: { companyId: string; isActive: boolean }) => {
            await api.patch(`/superadmin/companies/${companyId}/status`, { is_active: isActive });
        },
        onMutate: async ({ companyId, isActive }) => {
            await queryClient.cancelQueries({ queryKey: ['superadmin-dashboard'] });
            const previous = queryClient.getQueryData<DashboardResponse>(['superadmin-dashboard']);
            queryClient.setQueryData<DashboardResponse>(['superadmin-dashboard'], (current) => {
                if (!current) return current;
                return {
                    ...current,
                    companies: current.companies.map((company) => (
                        company.id === companyId ? { ...company, is_active: isActive } : company
                    ))
                };
            });
            return { previous };
        },
        onSuccess: (_data, variables) => {
            setToast({
                message: variables.isActive ? 'Company unblocked' : 'Company blocked',
                type: 'success'
            });
            queryClient.invalidateQueries({ queryKey: ['superadmin-dashboard'] });
        },
        onError: (err: unknown, _variables, context) => {
            if (context?.previous) {
                queryClient.setQueryData(['superadmin-dashboard'], context.previous);
            }
            const error = err as { response?: { data?: { error?: string } } };
            setToast({ message: error?.response?.data?.error || 'Failed to update company status', type: 'error' });
        },
    });

    const toggleUnlimitedAccessMutation = useMutation({
        mutationFn: async ({ companyId, unlimitedAccess }: { companyId: string; unlimitedAccess: boolean }) => {
            await api.patch(`/superadmin/companies/${companyId}/unlimited-access`, { unlimited_access: unlimitedAccess });
        },
        onMutate: async ({ companyId, unlimitedAccess }) => {
            await queryClient.cancelQueries({ queryKey: ['superadmin-dashboard'] });
            const previous = queryClient.getQueryData<DashboardResponse>(['superadmin-dashboard']);
            queryClient.setQueryData<DashboardResponse>(['superadmin-dashboard'], (current) => {
                if (!current) return current;
                return {
                    ...current,
                    companies: current.companies.map((company) => (
                        company.id === companyId ? { ...company, unlimited_access: unlimitedAccess } : company
                    ))
                };
            });
            return { previous };
        },
        onSuccess: (_data, variables) => {
            setToast({
                message: variables.unlimitedAccess
                    ? 'Unlimited access enabled for company'
                    : 'Unlimited access disabled for company',
                type: 'success'
            });
            queryClient.invalidateQueries({ queryKey: ['superadmin-dashboard'] });
        },
        onError: (err: unknown, _variables, context) => {
            if (context?.previous) {
                queryClient.setQueryData(['superadmin-dashboard'], context.previous);
            }
            const error = err as { response?: { data?: { error?: string } } };
            setToast({ message: error?.response?.data?.error || 'Failed to update unlimited access', type: 'error' });
        }
    });

    const deleteCompanyMutation = useMutation({
        mutationFn: async ({ companyId }: { companyId: string }) => {
            await api.delete(`/superadmin/companies/${companyId}`, {
                data: { confirm: true }
            });
        },
        onSuccess: () => {
            setToast({ message: 'Company deleted successfully', type: 'success' });
            queryClient.invalidateQueries({ queryKey: ['superadmin-dashboard'] });
        },
        onError: (err: unknown) => {
            const error = err as { response?: { data?: { error?: string } } };
            setToast({ message: error?.response?.data?.error || 'Failed to delete company', type: 'error' });
        }
    });

    const timeTravelMutation = useMutation({
        mutationFn: async (payload: { offset_ms?: number; add_ms?: number; reset?: boolean }) => {
            await api.post('/superadmin/time-travel', payload);
        },
        onSuccess: () => {
            setToast({ message: 'Virtual time updated', type: 'success' });
            queryClient.invalidateQueries({ queryKey: ['superadmin-dashboard'] });
        },
        onError: (err: unknown) => {
            const error = err as { response?: { data?: { error?: string } } };
            setToast({ message: error?.response?.data?.error || 'Failed to update virtual time', type: 'error' });
        }
    });

    const updateCatalogPlanMutation = useMutation({
        mutationFn: async ({
            planId,
            payload
        }: {
            planId: string;
            payload: { monthly_price: number; max_company_admins: number; max_project_managers: number; max_employees: number; is_popular: boolean; };
        }) => {
            await api.patch(`/superadmin/plans/${planId}`, payload);
        },
        onSuccess: () => {
            setToast({ message: 'Plan limits and price updated', type: 'success' });
            queryClient.invalidateQueries({ queryKey: ['superadmin-dashboard'] });
        },
        onError: (err: unknown) => {
            const error = err as { response?: { data?: { error?: string } } };
            setToast({ message: error?.response?.data?.error || 'Failed to update plan config', type: 'error' });
        }
    });

    const updateLandingVideoMutation = useMutation({
        mutationFn: async (videoUrl: string) => {
            await api.patch('/superadmin/landing-video', { video_url: videoUrl.trim() });
        },
        onSuccess: () => {
            setToast({ message: 'Landing video updated', type: 'success' });
            queryClient.invalidateQueries({ queryKey: ['superadmin-dashboard'] });
        },
        onError: (err: unknown) => {
            const error = err as { response?: { data?: { error?: string } } };
            setToast({ message: error?.response?.data?.error || 'Failed to update landing video', type: 'error' });
        }
    });

    const updateLandingVideoVisibilityMutation = useMutation({
        mutationFn: async (enabled: boolean) => {
            await api.patch('/superadmin/landing-video/visibility', { enabled });
        },
        onSuccess: (_data, enabled) => {
            setLandingVideoEnabled(enabled);
            setToast({ message: enabled ? 'Landing video enabled' : 'Landing video disabled', type: 'success' });
            queryClient.invalidateQueries({ queryKey: ['superadmin-dashboard'] });
        },
        onError: (err: unknown) => {
            const error = err as { response?: { data?: { error?: string } } };
            setToast({ message: error?.response?.data?.error || 'Failed to update landing video visibility', type: 'error' });
        }
    });

    const uploadLandingVideoFileMutation = useMutation({
        mutationFn: async (file: File) => {
            // Prefer direct-to-storage upload to bypass platform request-body limits.
            const presignRes = await api.post('/uploads/presign', {
                folder: 'landing-page-video',
                fileName: file.name,
                contentType: file.type || 'application/octet-stream'
            });

            const uploadData = presignRes.data?.data || {};
            const { uploadStrategy, relativeUrl, signedUrl, token } = uploadData;

            if (uploadStrategy === 'supabase_signed_upload' && signedUrl && relativeUrl) {
                const headers: Record<string, string> = {
                    'Content-Type': file.type || 'application/octet-stream'
                };
                if (token) headers.Authorization = `Bearer ${token}`;

                const uploadRes = await fetch(signedUrl, {
                    method: 'PUT',
                    headers,
                    body: file
                });

                if (!uploadRes.ok) {
                    throw new Error('Failed to upload video to storage');
                }

                // Persist the uploaded object URL and trigger old-video cleanup in backend.
                await api.patch('/superadmin/landing-video', { video_url: relativeUrl });
                return { video_url: relativeUrl };
            }

            // Fallback for non-supabase setups.
            const formData = new FormData();
            formData.append('video', file);
            const fallbackRes = await api.post('/superadmin/landing-video/upload', formData, {
                headers: { 'Content-Type': 'multipart/form-data' }
            });
            return fallbackRes.data;
        },
        onSuccess: (data) => {
            setToast({ message: 'Video uploaded and updated successfully', type: 'success' });
            setLandingVideoUrl(data.video_url);
            queryClient.invalidateQueries({ queryKey: ['superadmin-dashboard'] });
        },
        onError: (err: unknown) => {
            const error = err as { response?: { data?: { error?: string } } };
            setToast({ message: error?.response?.data?.error || 'Failed to upload video', type: 'error' });
        }
    });


    const filteredCompanies = useMemo(() => {
        const companies = data?.companies || [];
        const term = searchTerm.trim().toLowerCase();
        if (!term) return companies;

        return companies.filter((company) => {
            const name = String(company.name || '').toLowerCase();
            const slug = String(company.slug || '').toLowerCase();
            const adminEmail = String(company.admin_email || '').toLowerCase();
            const planCode = String(company.plan_code || '').toLowerCase();
            return name.includes(term) || slug.includes(term) || adminEmail.includes(term) || planCode.includes(term);
        });
    }, [data?.companies, searchTerm]);

    const filteredPlans = useMemo(() => {
        const plans = data?.plans || [];
        const term = searchTerm.trim().toLowerCase();
        if (!term) return plans;
        return plans.filter((plan) => {
            return String(plan.code || '').toLowerCase().includes(term) || String(plan.name || '').toLowerCase().includes(term);
        });
    }, [data?.plans, searchTerm]);

    const clockOffsetMs = Number(data?.clock?.offset_ms || 0);
    const virtualTimeMs = Number(data?.clock?.virtual_time_ms || Date.now());
    const systemTimeMs = virtualTimeMs - clockOffsetMs;
    const offsetHours = clockOffsetMs / (60 * 60 * 1000);
    const isVirtualClockActive = clockOffsetMs !== 0;

    const formatClock = (timestampMs: number) => new Date(timestampMs).toLocaleString();
    const isSidebarItemActive = (to: string) => {
        const itemPath = to.split('?')[0];
        const itemSearchParams = new URLSearchParams(to.split('?')[1] || '');
        const itemTab = itemSearchParams.get('tab');

        if (itemPath === '/profile') {
            return location.pathname === '/profile';
        }

        if (!location.pathname.includes('/superadmin')) {
            return false;
        }

        if (itemTab) {
            return activeTab === itemTab;
        }

        return activeTab === 'companies';
    };

    return (
        <div className="min-h-screen bg-background font-sans text-foreground">

            <aside className="hidden lg:fixed lg:inset-y-0 lg:left-0 lg:z-40 lg:flex lg:w-64 lg:flex-col lg:border-r lg:border-border lg:bg-background">
                <div className="px-6 py-7">
                    <h2 className="text-[30px] font-bold leading-none text-foreground">Dashboards</h2>
                    <p className="mt-2 text-xs font-medium text-muted-foreground">Superadmin Control</p>
                </div>

                <div className="px-6 flex-1">
                    <nav className="mt-4 space-y-1.5">
                        {superadminSidebarItems.map((item) => {
                            const Icon = item.icon;
                            const isActive = isSidebarItemActive(item.to);
                            return (
                                <Link
                                    key={item.to}
                                    to={item.to}
                                    className={cn(
                                        'flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-semibold transition-colors',
                                        isActive
                                            ? 'bg-card text-foreground shadow-[0_1px_0_rgba(15,23,42,0.06)]'
                                            : 'text-muted-foreground hover:bg-card hover:text-foreground'
                                    )}
                                >
                                    <Icon className={cn("h-4 w-4", isActive ? 'text-foreground' : 'text-muted-foreground')} />
                                    <span>{item.label}</span>
                                </Link>
                            );
                        })}
                    </nav>
                </div>

                <div className="mt-auto border-t border-border p-4 space-y-4">
                    <div className="flex items-center justify-between gap-3">
                        <div className="flex flex-1 items-center gap-3 rounded-xl border border-border bg-card p-3 min-w-0">
                            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-slate-200 text-foreground">
                                <ShieldCheck className="h-5 w-5" />
                            </div>
                            <div className="min-w-0">
                                <p className="truncate text-sm font-semibold text-foreground">
                                    {user?.full_name || user?.username || 'System Admin'}
                                </p>
                                <p className="truncate text-xs text-muted-foreground">
                                    SUPERADMIN
                                </p>
                            </div>
                        </div>
                        <ThemeToggle />
                    </div>
                    <button
                        onClick={logout}
                        className="flex w-full items-center justify-center gap-2 rounded-xl border border-border bg-card px-4 py-2.5 text-sm font-medium text-slate-600 transition-colors hover:bg-slate-100 hover:text-foreground"
                    >
                        <LogOut className="h-4 w-4" />
                        <span>Sign Out</span>
                    </button>
                </div>
            </aside>

            <main className="lg:pl-64 min-h-screen flex flex-col">
                <div className="mx-auto w-full max-w-7xl flex-1 px-4 py-8 sm:px-6 lg:px-10 space-y-8">
                    <div className="flex items-center justify-between rounded-2xl border border-border bg-card px-6 py-5 shadow-sm">
                        <div className="flex items-center gap-4">
                            <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-blue-50 text-blue-700 shadow-sm border border-blue-100">
                                <ShieldCheck className="h-6 w-6" />
                            </div>
                            <div>
                                <h1 className="text-xl font-bold text-foreground">Dashboard</h1>
                                <p className="text-sm text-muted-foreground">Manage tenant companies, plans and access</p>
                            </div>
                        </div>
                        <button
                            onClick={() => refetch()}
                            disabled={isFetching}
                            className="flex items-center gap-2 rounded-lg border border-border bg-white px-4 py-2.5 text-sm font-semibold text-foreground shadow-sm hover:bg-slate-50 hover:text-foreground transition disabled:opacity-50"
                        >
                            <RefreshCw className={cn('h-4 w-4', isFetching && 'animate-spin')} />
                            Refresh
                        </button>
                    </div>

                    <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-4">
                        <div className="relative overflow-hidden rounded-2xl border border-border bg-card p-6 shadow-sm">
                            <div className="flex items-center justify-between">
                                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-50 text-blue-600">
                                    <Building2 className="h-5 w-5" />
                                </div>
                            </div>
                            <div className="mt-4">
                                <p className="text-sm font-medium text-muted-foreground">Total Companies</p>
                                <h3 className="mt-1 text-3xl font-bold text-foreground">
                                    {data?.summary?.total_companies ?? 0}
                                </h3>
                            </div>
                        </div>

                        <div className="relative overflow-hidden rounded-2xl border border-border bg-card p-6 shadow-sm">
                            <div className="flex items-center justify-between">
                                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-50 text-emerald-600">
                                    <BadgeCheck className="h-5 w-5" />
                                </div>
                                <span className="text-xs font-bold text-emerald-600">Active</span>
                            </div>
                            <div className="mt-4">
                                <p className="text-sm font-medium text-muted-foreground">Active Companies</p>
                                <h3 className="mt-1 text-3xl font-bold text-foreground">
                                    {data?.summary?.active_companies ?? 0}
                                </h3>
                            </div>
                        </div>

                        <div className="relative overflow-hidden rounded-2xl border border-border bg-card p-6 shadow-sm">
                            <div className="flex items-center justify-between">
                                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-red-50 text-red-500">
                                    <ShieldAlert className="h-5 w-5" />
                                </div>
                                <span className="text-xs font-bold text-red-500">Restricted</span>
                            </div>
                            <div className="mt-4">
                                <p className="text-sm font-medium text-muted-foreground">Blocked Companies</p>
                                <h3 className="mt-1 text-3xl font-bold text-foreground">
                                    {data?.summary?.blocked_companies ?? 0}
                                </h3>
                            </div>
                        </div>

                        <div className="relative overflow-hidden rounded-2xl border border-border bg-card p-6 shadow-sm">
                            <div className="flex items-center justify-between">
                                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-purple-50 text-purple-600">
                                    <Users className="h-5 w-5" />
                                </div>
                                <span className="text-xs font-bold text-cyan-600">Premium</span>
                            </div>
                            <div className="mt-4">
                                <p className="text-sm font-medium text-muted-foreground">Subscribed</p>
                                <h3 className="mt-1 text-3xl font-bold text-foreground">
                                    {data?.summary?.subscribed_companies ?? 0}
                                </h3>
                            </div>
                        </div>
                    </div>

<div className="rounded-3xl border border-border bg-white shadow-lg">
                        <div className="flex flex-col gap-4 border-b border-border/50 p-6 sm:flex-row sm:items-center sm:justify-between">
                            {activeTab !== 'time-travel' && activeTab !== 'permissions' ? (
                                <div className="relative w-full max-w-md group">
                                    <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-4 text-muted-foreground/70 group-focus-within:text-cyan-500 transition-colors">
                                        <Search className="h-5 w-5" />
                                    </div>
                                    <input
                                        type="text"
                                        value={searchTerm}
                                        onChange={(e) => setSearchTerm(e.target.value)}
                                        placeholder={activeTab === 'companies' ? 'Search companies, domains, or IDs...' : 'Search plans by code or name...'}
                                        className="w-full rounded-xl border border-border bg-card py-2.5 pl-11 pr-4 text-sm text-foreground placeholder:text-muted-foreground/70 focus:border-cyan-400 focus:outline-none focus:ring-4 focus:ring-cyan-500/20 transition"
                                    />
                                </div>
                            ) : (
                                <div>
                                    <p className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">Time Travel (Virtual Clock)</p>
                                    <p className="text-sm text-muted-foreground">Use virtual clock controls for trial/expiry testing.</p>
                                </div>
                            )}
                            {activeTab === 'plans' && (
                                <button
                                    onClick={() => setIsAddingPlan(true)}
                                    className="flex items-center gap-2 rounded-xl bg-blue-600 px-5 py-2.5 text-sm font-bold text-white shadow-lg shadow-blue-200 hover:bg-blue-700 hover:shadow-blue-300 transition active:scale-95"
                                >
                                    <Layers className="h-4 w-4" />
                                    Add Plan
                                </button>
                            )}
                        </div>

                        {activeTab === 'time-travel' && (
                            <div className="border-b border-border/50 p-6">
                                <p className="mb-2 text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">Time Travel (Virtual Clock)</p>
                                <div className={cn('mb-4 rounded-xl border px-4 py-3', isVirtualClockActive ? 'border-amber-200 bg-amber-50/50' : 'border-border bg-muted/70')}>
                                    <p className={cn('text-sm font-semibold', isVirtualClockActive ? 'text-amber-900' : 'text-foreground')}>{isVirtualClockActive ? 'Time Travel Active' : 'Using System Time'}</p>
                                    <div className="mt-2 grid gap-1.5 text-xs sm:grid-cols-3">
                                        <p className="text-muted-foreground">System Time: <span className="font-mono font-semibold text-foreground">{formatClock(systemTimeMs)}</span></p>
                                        <p className="text-muted-foreground">Virtual Time: <span className="font-mono font-semibold text-foreground">{formatClock(virtualTimeMs)}</span></p>
                                        <p className="text-muted-foreground">Offset: <span className="font-mono font-semibold text-foreground">{offsetHours >= 0 ? '+' : ''}{offsetHours.toFixed(2)} hours</span></p>
                                    </div>
                                </div>
                                <div className="mb-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
                                    <button type="button" onClick={() => timeTravelMutation.mutate({ add_ms: -1 * 60 * 60 * 1000 })} className="h-10 rounded-lg border border-red-200 bg-red-50 px-3 text-sm font-semibold text-red-700">-1 Hour</button>
                                    <button type="button" onClick={() => timeTravelMutation.mutate({ add_ms: 1 * 60 * 60 * 1000 })} className="h-10 rounded-lg border border-border bg-card px-3 text-sm font-semibold text-foreground">+1 Hour</button>
                                    <button type="button" onClick={() => timeTravelMutation.mutate({ add_ms: -24 * 60 * 60 * 1000 })} className="h-10 rounded-lg border border-red-200 bg-red-50 px-3 text-sm font-semibold text-red-700">-1 Day</button>
                                    <button type="button" onClick={() => timeTravelMutation.mutate({ add_ms: 24 * 60 * 60 * 1000 })} className="h-10 rounded-lg border border-border bg-card px-3 text-sm font-semibold text-foreground">+1 Day</button>
                                    <button type="button" onClick={() => timeTravelMutation.mutate({ add_ms: 7 * 24 * 60 * 60 * 1000 })} className="h-10 rounded-lg border border-border bg-card px-3 text-sm font-semibold text-foreground">+7 Days</button>
                                    <button type="button" onClick={() => timeTravelMutation.mutate({ add_ms: 30 * 24 * 60 * 60 * 1000 })} className="h-10 rounded-lg border border-border bg-card px-3 text-sm font-semibold text-foreground">+30 Days</button>
                                </div>
                                <div className="mb-2">
                                    <button type="button" onClick={() => timeTravelMutation.mutate({ reset: true })} className="h-10 rounded-lg border border-amber-200 bg-amber-50 px-4 text-sm font-semibold text-amber-700">Reset To Real Time</button>
                                </div>
                            </div>
                        )}

                        {activeTab === 'plans' && (
                            <div className="border-b border-border/50 p-6">
                                <p className="mb-2 text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">Landing Page Video (Superadmin Controlled)</p>
                                <div className="flex flex-col gap-4">
                                    <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                                        <div className="relative flex-1">
                                            <input type="text" value={landingVideoUrl} onChange={(e) => setLandingVideoUrl(e.target.value)} placeholder="https://.../video.mp4 or /uploads/landing-video.mp4" className="h-10 w-full rounded-lg border border-border bg-card px-3 text-sm text-foreground placeholder:text-muted-foreground/70 focus:border-cyan-400 focus:outline-none focus:ring-4 focus:ring-cyan-500/20" />
                                        </div>
                                        <button type="button" onClick={() => updateLandingVideoMutation.mutate(landingVideoUrl)} disabled={updateLandingVideoMutation.isPending} className="h-10 rounded-lg border border-blue-200 bg-blue-50 px-4 text-sm font-semibold text-blue-700 hover:bg-blue-100 disabled:opacity-60 transition active:scale-95">{updateLandingVideoMutation.isPending ? 'Saving...' : 'Save URL'}</button>
                                        <button type="button" onClick={() => updateLandingVideoVisibilityMutation.mutate(!landingVideoEnabled)} disabled={updateLandingVideoVisibilityMutation.isPending} className={cn('h-10 rounded-lg px-4 text-sm font-semibold transition disabled:opacity-60', landingVideoEnabled ? 'border border-red-200 bg-red-50 text-red-700 hover:bg-red-100' : 'border border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100')}>
                                            {updateLandingVideoVisibilityMutation.isPending ? 'Updating...' : landingVideoEnabled ? 'Disable Video' : 'Enable Video'}
                                        </button>
                                    </div>
                                    <div className="flex items-center gap-4">
                                        <div className="h-px flex-1 bg-secondary-light/60" />
                                        <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground/70">OR UPLOAD FILE</span>
                                        <div className="h-px flex-1 bg-secondary-light/60" />
                                    </div>
                                    <div className="flex items-center gap-3">
                                        <input id="video-upload" type="file" accept="video/mp4,video/quicktime,video/webm" className="hidden" onChange={(e) => {
                                            const file = e.target.files?.[0];
                                            if (!file) return;
                                            if (!LANDING_VIDEO_ALLOWED_MIME_TYPES.includes(file.type)) {
                                                setToast({ message: 'Invalid video type. Use MP4, MOV, or WEBM.', type: 'error' });
                                                e.currentTarget.value = '';
                                                return;
                                            }
                                            if (file.size > LANDING_VIDEO_MAX_SIZE_BYTES) {
                                                setToast({ message: 'Video is too large. Maximum allowed size is 250MB.', type: 'error' });
                                                e.currentTarget.value = '';
                                                return;
                                            }
                                            uploadLandingVideoFileMutation.mutate(file);
                                        }} />
                                        <label htmlFor="video-upload" className={cn("flex flex-1 cursor-pointer items-center justify-center gap-2 rounded-xl border-2 border-dashed border-border bg-muted/50 py-3 text-sm font-semibold text-muted-foreground transition hover:border-cyan-400 hover:bg-cyan-50/30 hover:text-cyan-700", uploadLandingVideoFileMutation.isPending && "pointer-events-none opacity-60")}>
                                            <Plus className={cn("h-4 w-4", uploadLandingVideoFileMutation.isPending && "animate-spin")} />
                                            {uploadLandingVideoFileMutation.isPending ? 'Uploading...' : 'Choose Video File & Upload'}
                                        </label>
                                    </div>
                                </div>
                                <p className="mt-3 text-[11px] text-muted-foreground leading-relaxed">
                                    Status: <span className="font-semibold text-foreground">{landingVideoEnabled ? 'Enabled' : 'Disabled'}</span><br />
                                    Supported: MP4, MOV, WEBM. Max size: 250MB. <br />
                                    Old video files are automatically cleaned up when a new one is uploaded.
                                </p>
                            </div>
                        )}

                        {activeTab === 'permissions' && (
                            <PermissionsTab />
                        )}

                        {activeTab === 'load-testing' && (
                            <div className="p-6">
                                <LoadTestConfig />
                            </div>
                        )}

                        {activeTab === 'performance' && (
                            <div className="p-6">
                                <PerformanceMonitor />
                            </div>
                        )}

                        {activeTab === 'analytics' && (
                            <div className="p-6 space-y-8">
                                <AnalyticsDashboard />
                                <div className="grid grid-cols-1 xl:grid-cols-2 gap-8">
                                    <HeatmapOverlay />
                                    <WorldMap />
                                </div>
                            </div>
                        )}

                        {activeTab === 'bot-protection' && (
                            <div className="p-6">
                                <BotProtectionPanel />
                            </div>
                        )}

                        {activeTab === 'companies' ? (
                            <>
                                <div className="overflow-x-auto">
                                    <table className="w-full min-w-[1100px] text-sm">
                                        <thead>
                                            <tr className="border-b border-border/50 text-left">
                                                <th className="px-6 py-5 text-[11px] font-bold uppercase tracking-[0.15em] text-muted-foreground">Company Name</th>
                                                <th className="px-6 py-5 text-[11px] font-bold uppercase tracking-[0.15em] text-muted-foreground">Status</th>
                                                <th className="px-6 py-5 text-[11px] font-bold uppercase tracking-[0.15em] text-muted-foreground">Plan Level</th>
                                                <th className="px-6 py-5 text-[11px] font-bold uppercase tracking-[0.15em] text-muted-foreground">Users</th>
                                                <th className="px-6 py-5 text-right text-[11px] font-bold uppercase tracking-[0.15em] text-muted-foreground">Actions</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {isLoading ? (
                                                <>
                                                    {[1, 2, 3].map((skeleton) => (
                                                        <tr key={skeleton} className="border-b border-border/50/50">
                                                            <td className="px-6 py-5">
                                                                <div className="flex items-center gap-4">
                                                                    <div className="h-10 w-10 animate-pulse rounded-lg bg-secondary-light/60" />
                                                                    <div className="space-y-2">
                                                                        <div className="h-4 w-32 animate-pulse rounded bg-secondary-light/60" />
                                                                        <div className="h-3 w-24 animate-pulse rounded bg-secondary-light/60" />
                                                                    </div>
                                                                </div>
                                                            </td>
                                                            <td className="px-6 py-5"><div className="h-6 w-20 animate-pulse rounded-full bg-secondary-light/60" /></td>
                                                            <td className="px-6 py-5"><div className="h-7 w-40 animate-pulse rounded-lg bg-secondary-light/60" /></td>
                                                            <td className="px-6 py-5"><div className="h-5 w-16 animate-pulse rounded bg-secondary-light/60" /></td>
                                                            <td className="px-6 py-5 text-right"><div className="ml-auto h-8 w-20 animate-pulse rounded-lg bg-secondary-light/60" /></td>
                                                        </tr>
                                                    ))}
                                                </>
                                            ) : filteredCompanies.length === 0 ? (
                                                <tr>
                                                    <td colSpan={5} className="px-6 py-12 text-center text-muted-foreground">No companies found.</td>
                                                </tr>
                                            ) : (
                                                filteredCompanies.map((company) => {
                                                    const selectedPlanId = selectedPlans[company.id] || company.plan_id;
                                                    const isPlanUpdating = updatePlanMutation.isPending && updatePlanMutation.variables?.companyId === company.id;
                                                    const isStatusUpdating = toggleStatusMutation.isPending && toggleStatusMutation.variables?.companyId === company.id;
                                                    const isUnlimitedUpdating = toggleUnlimitedAccessMutation.isPending && toggleUnlimitedAccessMutation.variables?.companyId === company.id;

                                                    return (
                                                        <tr key={company.id} className="group border-b border-border/50/50 transition-colors hover:bg-card/40">
                                                            <td className="px-6 py-5">
                                                                <div className="flex items-center gap-4">
                                                                    <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-muted text-muted-foreground shadow-inner">
                                                                        <Building2 className="h-5 w-5" />
                                                                    </div>
                                                                    <div>
                                                                        <p className="font-bold text-foreground">{company.name}</p>
                                                                        <p className="text-xs font-medium text-muted-foreground">
                                                                            {company.admin_email || `${company.slug}.track-ai.com`}
                                                                        </p>
                                                                    </div>
                                                                </div>
                                                            </td>
                                                            <td className="px-6 py-5">
                                                                <div className="flex flex-wrap items-center gap-2">
                                                                    {company.is_active ? (
                                                                        <div className="inline-flex items-center gap-1.5 rounded-full bg-emerald-100/80 px-2.5 py-1 text-xs font-bold text-emerald-700 backdrop-blur-sm border border-emerald-200/50">
                                                                            <div className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                                                                            Active
                                                                        </div>
                                                                    ) : (
                                                                        <div className="inline-flex items-center gap-1.5 rounded-full bg-red-100/80 px-2.5 py-1 text-xs font-bold text-red-700 backdrop-blur-sm border border-red-200/50">
                                                                            <div className="h-1.5 w-1.5 rounded-full bg-red-500" />
                                                                            Restricted
                                                                        </div>
                                                                    )}
                                                                    {company.unlimited_access && (
                                                                        <div className="inline-flex items-center rounded-full border border-blue-200/70 bg-blue-100/70 px-2.5 py-1 text-[11px] font-bold uppercase tracking-[0.08em] text-blue-700">
                                                                            Unlimited
                                                                        </div>
                                                                    )}
                                                                    <div className="text-[11px] text-muted-foreground">
                                                                        Expires: {company.unlimited_access ? 'Never (Unlimited)' : (company.expires_at ? new Date(company.expires_at).toLocaleString() : 'Not set')}
                                                                    </div>
                                                                </div>
                                                            </td>
                                                            <td className="px-6 py-5">
                                                                <div className="flex items-center gap-2">
                                                                    <select
                                                                        value={selectedPlanId}
                                                                        onChange={(e) => {
                                                                            const planId = e.target.value;
                                                                            setSelectedPlans((prev) => ({ ...prev, [company.id]: planId }));
                                                                        }}
                                                                        className="h-9 rounded-lg border border-border bg-card px-3 text-xs font-semibold text-foreground"
                                                                    >
                                                                        {(data?.plans || []).map((plan) => (
                                                                            <option key={plan.id} value={plan.id}>{plan.code}</option>
                                                                        ))}
                                                                    </select>
                                                                    <button
                                                                        onClick={() => updatePlanMutation.mutate({ companyId: company.id, planId: selectedPlanId })}
                                                                        disabled={isPlanUpdating || selectedPlanId === company.plan_id}
                                                                        className="rounded-lg border border-border bg-card px-3 py-1.5 text-xs font-semibold text-foreground hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50"
                                                                    >
                                                                        {isPlanUpdating ? 'Saving...' : 'Save'}
                                                                    </button>
                                                                </div>
                                                            </td>
                                                            <td className="px-6 py-5 font-semibold text-foreground">
                                                                {company.total_users}
                                                            </td>
                                                            <td className="px-6 py-5 text-right">
                                                                <div className="flex items-center justify-end gap-2">
                                                                    <button
                                                                        onClick={() => toggleUnlimitedAccessMutation.mutate({ companyId: company.id, unlimitedAccess: !company.unlimited_access })}
                                                                        disabled={isUnlimitedUpdating}
                                                                        className={cn(
                                                                            'rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-50',
                                                                            company.unlimited_access
                                                                                ? 'border border-border bg-muted text-foreground hover:bg-muted'
                                                                                : 'border border-blue-200 bg-blue-50 text-blue-700 hover:bg-blue-100'
                                                                        )}
                                                                    >
                                                                        {isUnlimitedUpdating
                                                                            ? 'Updating...'
                                                                            : company.unlimited_access
                                                                                ? 'Disable Unlimited'
                                                                                : 'Enable Unlimited'}
                                                                    </button>
                                                                    <button
                                                                        onClick={() => toggleStatusMutation.mutate({ companyId: company.id, isActive: !company.is_active })}
                                                                        disabled={isStatusUpdating}
                                                                        className={cn(
                                                                            'rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-50',
                                                                            company.is_active
                                                                                ? 'border border-red-200 bg-red-50 text-red-700 hover:bg-red-100'
                                                                                : 'border border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100'
                                                                        )}
                                                                    >
                                                                        {isStatusUpdating
                                                                            ? 'Updating...'
                                                                            : company.is_active
                                                                                ? 'Block'
                                                                                : 'Unblock'}
                                                                    </button>
                                                                    <button
                                                                        onClick={() => {
                                                                            const ok = window.confirm(
                                                                                `Delete company "${company.name}"? This will permanently delete users, projects, and related data.`
                                                                            );
                                                                            if (!ok) return;
                                                                            deleteCompanyMutation.mutate({ companyId: company.id });
                                                                        }}
                                                                        disabled={deleteCompanyMutation.isPending}
                                                                        className="rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors border border-red-200 bg-red-50 text-red-700 hover:bg-red-100 disabled:opacity-50"
                                                                    >
                                                                        Delete
                                                                    </button>
                                                                </div>
                                                            </td>
                                                        </tr>
                                                    );
                                                })
                                            )}
                                        </tbody>
                                    </table>
                                </div>

                                <div className="flex items-center justify-between border-t border-border/50 px-6 py-4">
                                    <p className="text-sm font-medium text-muted-foreground">
                                        Showing {filteredCompanies.length} of {data?.summary?.total_companies ?? 0} companies
                                    </p>
                                </div>
                            </>
                        ) : activeTab === 'plans' ? (
                            <div className="p-6">
                                <div className="overflow-x-auto">
                                    <table className="w-full min-w-[1000px] text-sm">
                                        <thead>
                                            <tr className="border-b border-border/50 text-left">
                                                <th className="px-4 py-3 text-[11px] font-bold uppercase tracking-[0.15em] text-muted-foreground">Plan Code</th>
                                                <th className="px-4 py-3 text-[11px] font-bold uppercase tracking-[0.15em] text-muted-foreground">Plan Name</th>
                                                <th className="px-4 py-3 text-[11px] font-bold uppercase tracking-[0.15em] text-muted-foreground">Monthly Price</th>
                                                <th className="px-4 py-3 text-[11px] font-bold uppercase tracking-[0.15em] text-muted-foreground">Admin Limit</th>
                                                <th className="px-4 py-3 text-[11px] font-bold uppercase tracking-[0.15em] text-muted-foreground">PM Limit</th>
                                                <th className="px-4 py-3 text-[11px] font-bold uppercase tracking-[0.15em] text-muted-foreground">Employee Limit</th>
                                                <th className="px-4 py-3 text-[11px] font-bold uppercase tracking-[0.15em] text-muted-foreground">Popular</th>
                                                <th className="px-4 py-3 text-[11px] font-bold uppercase tracking-[0.15em] text-muted-foreground">Action</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {isLoading ? (
                                                <>
                                                    {[1, 2, 3].map((skeleton) => (
                                                        <tr key={skeleton} className="border-b border-border/50/60">
                                                            <td className="px-4 py-3"><div className="h-4 w-20 animate-pulse rounded bg-secondary-light/60" /></td>
                                                            <td className="px-4 py-3"><div className="h-4 w-32 animate-pulse rounded bg-secondary-light/60" /></td>
                                                            <td className="px-4 py-3"><div className="h-9 w-28 animate-pulse rounded-lg bg-secondary-light/60" /></td>
                                                            <td className="px-4 py-3"><div className="h-9 w-20 animate-pulse rounded-lg bg-secondary-light/60" /></td>
                                                            <td className="px-4 py-3"><div className="h-9 w-20 animate-pulse rounded-lg bg-secondary-light/60" /></td>
                                                            <td className="px-4 py-3"><div className="h-9 w-20 animate-pulse rounded-lg bg-secondary-light/60" /></td>
                                                            <td className="px-4 py-3"><div className="h-6 w-6 animate-pulse rounded bg-secondary-light/60" /></td>
                                                            <td className="px-4 py-3"><div className="h-9 w-16 animate-pulse rounded-lg bg-secondary-light/60" /></td>
                                                        </tr>
                                                    ))}
                                                </>
                                            ) : filteredPlans.length === 0 ? (
                                                <tr>
                                                    <td colSpan={8} className="px-4 py-8 text-center text-muted-foreground">No plans found.</td>
                                                </tr>
                                            ) : (
                                                filteredPlans.map((plan) => {
                                                    const draft = planDrafts[plan.id] || {
                                                        monthly_price: String(plan.monthly_price ?? ''),
                                                        max_company_admins: String(plan.max_company_admins ?? 0),
                                                        max_project_managers: String(plan.max_project_managers ?? 0),
                                                        max_employees: String(plan.max_employees ?? 0),
                                                        is_popular: plan.is_popular ?? false,
                                                    };
                                                    const isSavingPlan = updateCatalogPlanMutation.isPending && updateCatalogPlanMutation.variables?.planId === plan.id;
                                                    const hasChanges =
                                                        draft.monthly_price !== String(plan.monthly_price ?? '') ||
                                                        draft.max_company_admins !== String(plan.max_company_admins ?? 0) ||
                                                        draft.max_project_managers !== String(plan.max_project_managers ?? 0) ||
                                                        draft.max_employees !== String(plan.max_employees ?? 0) ||
                                                        draft.is_popular !== (plan.is_popular ?? false);

                                                    return (
                                                        <tr key={plan.id} className="border-b border-border/50/60">
                                                            <td className="px-4 py-3 font-semibold text-foreground">{plan.code}</td>
                                                            <td className="px-4 py-3 text-foreground">{plan.name}</td>
                                                            <td className="px-4 py-3">
                                                                <input
                                                                    type="number"
                                                                    min="0"
                                                                    step="0.01"
                                                                    value={draft.monthly_price}
                                                                    onChange={(e) => {
                                                                        const value = e.target.value;
                                                                        setPlanDrafts((prev) => ({
                                                                            ...prev,
                                                                            [plan.id]: { ...draft, monthly_price: value }
                                                                        }));
                                                                    }}
                                                                    className="h-9 w-28 rounded-lg border border-border bg-card px-3 text-sm"
                                                                />
                                                            </td>
                                                            <td className="px-4 py-3">
                                                                <input
                                                                    type="number"
                                                                    min="0"
                                                                    step="1"
                                                                    value={draft.max_company_admins}
                                                                    onChange={(e) => {
                                                                        const value = e.target.value;
                                                                        setPlanDrafts((prev) => ({
                                                                            ...prev,
                                                                            [plan.id]: { ...draft, max_company_admins: value }
                                                                        }));
                                                                    }}
                                                                    className="h-9 w-24 rounded-lg border border-border bg-card px-3 text-sm"
                                                                />
                                                            </td>
                                                            <td className="px-4 py-3">
                                                                <input
                                                                    type="number"
                                                                    min="0"
                                                                    step="1"
                                                                    value={draft.max_project_managers}
                                                                    onChange={(e) => {
                                                                        const value = e.target.value;
                                                                        setPlanDrafts((prev) => ({
                                                                            ...prev,
                                                                            [plan.id]: { ...draft, max_project_managers: value }
                                                                        }));
                                                                    }}
                                                                    className="h-9 w-24 rounded-lg border border-border bg-card px-3 text-sm"
                                                                />
                                                            </td>
                                                            <td className="px-4 py-3">
                                                                <input
                                                                    type="number"
                                                                    min="0"
                                                                    step="1"
                                                                    value={draft.max_employees}
                                                                    onChange={(e) => {
                                                                        const value = e.target.value;
                                                                        setPlanDrafts((prev) => ({
                                                                            ...prev,
                                                                            [plan.id]: { ...draft, max_employees: value }
                                                                        }));
                                                                    }}
                                                                    className="h-9 w-24 rounded-lg border border-border bg-card px-3 text-sm"
                                                                />
                                                            </td>
                                                            <td className="px-4 py-3">
                                                                <button
                                                                    onClick={() => {
                                                                        setPlanDrafts((prev) => ({
                                                                            ...prev,
                                                                            [plan.id]: { ...draft, is_popular: !draft.is_popular }
                                                                        }));
                                                                    }}
                                                                    className={cn(
                                                                        "h-9 w-9 rounded-lg flex items-center justify-center border transition-colors",
                                                                        draft.is_popular ? "bg-amber-50 border-amber-200 text-amber-500" : "bg-muted border-border text-muted-foreground/50 hover:text-muted-foreground/70"
                                                                    )}
                                                                >
                                                                    <Star className={cn("h-4 w-4", draft.is_popular && "fill-current")} />
                                                                </button>
                                                            </td>
                                                            <td className="px-4 py-3">
                                                                <button
                                                                    disabled={isSavingPlan || !hasChanges}
                                                                    onClick={() => {
                                                                        const monthlyPrice = Number(draft.monthly_price);
                                                                        const maxCompanyAdmins = Number.parseInt(draft.max_company_admins, 10);
                                                                        const maxProjectManagers = Number.parseInt(draft.max_project_managers, 10);
                                                                        const maxEmployees = Number.parseInt(draft.max_employees, 10);

                                                                        if (!Number.isFinite(monthlyPrice) || monthlyPrice < 0) {
                                                                            setToast({ message: `Invalid monthly price for ${plan.code}`, type: 'error' });
                                                                            return;
                                                                        }
                                                                        if (!Number.isInteger(maxCompanyAdmins) || maxCompanyAdmins < 0) {
                                                                            setToast({ message: `Invalid admin limit for ${plan.code}`, type: 'error' });
                                                                            return;
                                                                        }
                                                                        if (!Number.isInteger(maxProjectManagers) || maxProjectManagers < 0) {
                                                                            setToast({ message: `Invalid PM limit for ${plan.code}`, type: 'error' });
                                                                            return;
                                                                        }
                                                                        if (!Number.isInteger(maxEmployees) || maxEmployees < 0) {
                                                                            setToast({ message: `Invalid employee limit for ${plan.code}`, type: 'error' });
                                                                            return;
                                                                        }

                                                                        updateCatalogPlanMutation.mutate({
                                                                            planId: plan.id,
                                                                            payload: {
                                                                                monthly_price: monthlyPrice,
                                                                                max_company_admins: maxCompanyAdmins,
                                                                                max_project_managers: maxProjectManagers,
                                                                                max_employees: maxEmployees,
                                                                                is_popular: draft.is_popular
                                                                            }
                                                                        });
                                                                    }}
                                                                    className="rounded-lg border border-border bg-card px-3 py-1.5 text-xs font-semibold text-foreground hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50"
                                                                >
                                                                    {isSavingPlan ? 'Saving...' : 'Save'}
                                                                </button>
                                                            </td>
                                                        </tr>
                                                    );
                                                })
                                            )}
                                        </tbody>
                                    </table>
                                </div>
                            </div>
                        ) : (
                            <div className="p-6">
                                <p className="text-sm text-muted-foreground">No plan catalog entries found.</p>
                            </div>
                        )}
                    </div>
                </div>
            </main>

            {isAddingPlan && (
                <div className="fixed inset-0 z-100 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
                    <div className="w-full max-w-md rounded-2xl border border-border bg-card p-6 shadow-xl">
                        <p className="text-base font-bold text-foreground">Create Plan</p>
                        <p className="mt-1 text-sm text-muted-foreground">Use the Plan Catalog table inline editors to set price/limits, or keep this modal closed for now.</p>
                        <div className="mt-4 flex justify-end">
                            <button
                                onClick={() => setIsAddingPlan(false)}
                                className="rounded-lg border border-border bg-card px-4 py-2 text-sm font-semibold text-foreground hover:bg-muted"
                            >
                                Close
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {toast && (
                <Toast
                    message={toast.message}
                    type={toast.type}
                    onClose={() => setToast(null)}
                />
            )}
        </div>
    );
}

