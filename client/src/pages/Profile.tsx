import React, { useState, useEffect } from 'react';
import { useAuth } from '@/context/AuthContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { PhoneInput } from '@/components/ui/phone-input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import OptimizedImage from '@/components/OptimizedImage';
import api from '@/lib/api';
import { compressImageIfNeeded } from '@/lib/imageCompression';
import RoleSidebar, { MobileRoleSidebar, useAdminSidebarItems, useEmployeeSidebarItems, useModeratorSidebarItems, useRoleSidebarConfig, useSuperadminSidebarItems } from '@/components/RoleSidebar';
import { useLocation, useNavigate } from 'react-router-dom';
import { cn } from '@/lib/utils';
import {
    Eye, EyeOff, Check, User, Mail, Phone,
    Building2, Lock, Shield, AlertCircle, CheckCircle2,
    Camera, Upload, X, Clock, Send, Briefcase, ArrowLeft,
    ClipboardList
} from 'lucide-react';

import { useSocket } from '@/context/SocketContext';

const USERNAME_REGEX = /^[a-z]+$/;

type NylasConnection = {
    connected: boolean;
    email: string | null;
    provider: string | null;
    grantStatus: string | null;
};

const NYLAS_PROVIDER_OPTIONS = [
    { value: 'google', label: 'Google' },
    { value: 'microsoft', label: 'Microsoft' },
    { value: 'yahoo', label: 'Yahoo' },
    { value: 'icloud', label: 'iCloud' },
    { value: 'imap', label: 'IMAP' },
    { value: 'exchange', label: 'Exchange' }
];

const getApiRootUrl = () => {
    const raw = String(import.meta.env.VITE_API_URL || '').trim().replace(/\/+$/, '');
    if (!raw) return '';
    return raw.endsWith('/api') ? raw.slice(0, -4) : raw;
};

const toProfileImageUrl = (value?: string | null) => {
    const raw = String(value || '').trim();
    if (!raw) return null;
    if (/^(https?:)?\/\//i.test(raw) || raw.startsWith('data:') || raw.startsWith('blob:')) {
        return raw;
    }
    const apiRoot = getApiRootUrl();
    if (!apiRoot) return raw.startsWith('/') ? raw : `/${raw}`;
    const normalized = raw.startsWith('/') ? raw : `/${raw}`;
    return `${apiRoot}${normalized}`;
};

const Profile = () => {
    const { user, refetchUser, logout } = useAuth();
    const { socket } = useSocket();
    const location = useLocation();
    const navigate = useNavigate();
    const [profileLoading, setProfileLoading] = useState(false);
    const [passwordLoading, setPasswordLoading] = useState(false);
    const [message, setMessage] = useState<{ type: 'success' | 'error', text: string } | null>(null);

    const [profileData, setProfileData] = useState({
        full_name: '',
        username: '',
        email: '',
        contact_number: '',
        bank_name: '',
        account_holder_name: '',
        account_number: '',
        branch_name: '',
        routing_number: '',
        bank_document_url: '',
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,

    });

    const [passwordData, setPasswordData] = useState({
        currentPassword: '',
        newPassword: '',
        confirmPassword: '',
    });

    const [showCurrentPassword, setShowCurrentPassword] = useState(false);
    const [showNewPassword, setShowNewPassword] = useState(false);
    const [showConfirmPassword, setShowConfirmPassword] = useState(false);
    const [selectedFile, setSelectedFile] = useState<File | null>(null);
    const [bankDocumentFile, setBankDocumentFile] = useState<File | null>(null);
    const [previewUrl, setPreviewUrl] = useState<string | null>(null);
    const [previewLoadFailed, setPreviewLoadFailed] = useState(false);

    const [removeProfilePicture, setRemoveProfilePicture] = useState(false);
    const [nylasLoading, setNylasLoading] = useState(false);
    const [nylasConnecting, setNylasConnecting] = useState(false);
    const [nylasDisconnecting, setNylasDisconnecting] = useState(false);
    const [upgradeOptions, setUpgradeOptions] = useState<any[]>([]);
    const [currentPlanInfo, setCurrentPlanInfo] = useState<any | null>(null);
    const [selectedUpgradePlanId, setSelectedUpgradePlanId] = useState('');
    const [planOptionsLoading, setPlanOptionsLoading] = useState(false);
    const [planUpgradeLoading, setPlanUpgradeLoading] = useState(false);
    const [selectedNylasProvider, setSelectedNylasProvider] = useState('google');
    const [nylasConnection, setNylasConnection] = useState<NylasConnection>({
        connected: false,
        email: null,
        provider: null,
        grantStatus: null
    });
    const [isEditProfileOpen, setIsEditProfileOpen] = useState(false);

    const fileInputRef = React.useRef<HTMLInputElement>(null);
    const roleValue = String(user?.role || '');
    const isBankDetailsRequired = roleValue === 'employee' || roleValue === 'EMPLOYEE';

    useEffect(() => {
        if (user) {
            let bankDetails = {
                bank_name: '',
                account_holder_name: '',
                account_number: '',
                branch_name: '',
                routing_number: '',
                bank_document_url: ''
            };

            if (user.bank_details) {
                try {
                    const parsed = typeof user.bank_details === 'string'
                        ? JSON.parse(user.bank_details)
                        : user.bank_details;
                    bankDetails = { ...bankDetails, ...parsed };
                } catch (e) {
                    console.error('Error parsing bank details:', e);
                }
            }

            setProfileData({
                full_name: user.full_name || '',
                username: user.username || '',
                email: user.email || '',
                contact_number: user.contact_number || '',
                timezone: user.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone,

                ...bankDetails
            });
            if (user.profile_picture) {
                setPreviewUrl(toProfileImageUrl(user.profile_picture));
                setPreviewLoadFailed(false);
                setRemoveProfilePicture(false);
            }
        }
    }, [user]);

    const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (file) {
            setSelectedFile(file);
            setRemoveProfilePicture(false);
            setPreviewLoadFailed(false);
            const url = URL.createObjectURL(file);
            setPreviewUrl(url);
        }
    };

    const removePhoto = () => {
        setSelectedFile(null);
        setPreviewUrl(null);
        setPreviewLoadFailed(false);
        setRemoveProfilePicture(true);
        if (fileInputRef.current) fileInputRef.current.value = '';
    };

    const handleProfileChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
        const { name } = e.target;
        let { value } = e.target;

        if (name === 'username') {
            value = value.toLowerCase().replace(/[^a-z]/g, '');
        }

        setProfileData(prev => ({ ...prev, [name]: value }));
    };

    const handlePhoneChange = (value: string) => {
        setProfileData(prev => ({ ...prev, contact_number: value }));
    };

    const handlePasswordChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const { name, value } = e.target;
        setPasswordData(prev => ({ ...prev, [name]: value }));
    };

    const fetchNylasConnectionStatus = async () => {
        if (!user?.id) return;
        setNylasLoading(true);
        try {
            const response = await api.get('/v1/nylas/connection');
            const data = response?.data || {};
            setNylasConnection({
                connected: Boolean(data.connected),
                email: data.email || null,
                provider: data.provider || null,
                grantStatus: data.grantStatus || null
            });
        } catch (err) {
            console.error('Failed to load Nylas status:', err);
            setNylasConnection({
                connected: false,
                email: null,
                provider: null,
                grantStatus: null
            });
        } finally {
            setNylasLoading(false);
        }
    };

    const handleConnectNylas = async () => {
        if (nylasConnecting) return;
        setNylasConnecting(true);
        setMessage(null);
        try {
            const response = await api.get('/v1/nylas/oauth/start', {
                params: {
                    provider: selectedNylasProvider
                }
            });
            const authUrl = String(response?.data?.authUrl || '').trim();
            if (!authUrl) {
                throw new Error('Nylas auth URL was not returned by the server.');
            }
            window.location.assign(authUrl);
        } catch (err: any) {
            console.error('Failed to start Nylas OAuth:', err);
            setMessage({
                type: 'error',
                text: err?.response?.data?.error || err?.message || 'Failed to connect Nylas'
            });
            setNylasConnecting(false);
        }
    };

    const handleDisconnectNylas = async () => {
        if (nylasDisconnecting) return;
        setNylasDisconnecting(true);
        setMessage(null);
        try {
            await api.delete('/v1/nylas/connection');
            await fetchNylasConnectionStatus();
            setMessage({
                type: 'success',
                text: 'Nylas mailbox disconnected successfully.'
            });
        } catch (err: any) {
            console.error('Failed to disconnect Nylas:', err);
            setMessage({
                type: 'error',
                text: err?.response?.data?.error || err?.message || 'Failed to disconnect Nylas'
            });
        } finally {
            setNylasDisconnecting(false);
        }
    };

    useEffect(() => {
        if (!user?.id) return;
        fetchNylasConnectionStatus();
    }, [user?.id]);

    useEffect(() => {
        const params = new URLSearchParams(location.search);
        const nylasStatus = params.get('nylas_status');
        if (!nylasStatus) return;

        const nylasMessage = params.get('nylas_message') || '';

        if (nylasStatus === 'success') {
            setMessage({
                type: 'success',
                text: nylasMessage || 'Nylas mailbox connected successfully.'
            });
            fetchNylasConnectionStatus();
        } else {
            setMessage({
                type: 'error',
                text: nylasMessage || 'Nylas connection failed.'
            });
        }

        params.delete('nylas_status');
        params.delete('nylas_message');
        const nextSearch = params.toString();
        navigate(
            {
                pathname: location.pathname,
                search: nextSearch ? `?${nextSearch}` : ''
            },
            { replace: true }
        );
    }, [location.pathname, location.search, navigate]);

    useEffect(() => {
        const acknowledge = async () => {
            if ((user as any)?.latestHandledRequest) {
                try {
                    await api.post('/auth/acknowledge-profile-notification');
                } catch (e) {
                    console.error('Failed to acknowledge notification:', e);
                }
            }
        };
        acknowledge();
    }, [(user as any)?.latestHandledRequest]);

    // Real-time updates for profile requests
    useEffect(() => {
        if (socket) {
            socket.on('profile_request_update', (data: any) => {
                if (data.userId === user?.id && data.type === 'handled') {
                    refetchUser();
                    setMessage({
                        type: data.status === 'approved' ? 'success' : 'error',
                        text: `Your profile update request was ${data.status}`
                    });
                    // Clear message after delay
                    setTimeout(() => setMessage(null), 5000);
                }
            });

            return () => {
                socket.off('profile_request_update');
            };
        }
    }, [socket, user?.id, refetchUser]);

    const submitProfile = async (e: React.FormEvent) => {
        e.preventDefault();
        setProfileLoading(true);
        setMessage(null);

        if (!USERNAME_REGEX.test(profileData.username)) {
            setMessage({
                type: 'error',
                text: 'Username must contain only lowercase letters (a-z)'
            });
            setProfileLoading(false);
            return;
        }

        try {
            const formData = new FormData();
            formData.append('full_name', profileData.full_name);
            formData.append('username', profileData.username);
            formData.append('email', profileData.email);
            formData.append('contact_number', profileData.contact_number);
            formData.append('timezone', profileData.timezone);
            formData.append('remove_profile_picture', String(removeProfilePicture));

            let bankDocumentUrl = String(profileData.bank_document_url || '').trim();
            if (bankDocumentFile) {
                const presignRes = await api.post('/uploads/presign', {
                    folder: 'bank-documents',
                    fileName: bankDocumentFile.name,
                    contentType: bankDocumentFile.type || 'application/octet-stream'
                });
                const uploadData = presignRes.data?.data || {};
                const { uploadStrategy, relativeUrl, signedUrl, token } = uploadData;
                if (uploadStrategy === 'supabase_signed_upload' && signedUrl && relativeUrl) {
                    const headers: Record<string, string> = {
                        'Content-Type': bankDocumentFile.type || 'application/octet-stream'
                    };
                    if (token) headers.Authorization = `Bearer ${token}`;
                    const uploadRes = await fetch(signedUrl, {
                        method: 'PUT',
                        headers,
                        body: bankDocumentFile
                    });
                    if (!uploadRes.ok) throw new Error('Failed to upload bank document');
                    bankDocumentUrl = relativeUrl;
                } else {
                    throw new Error('Bank document upload is unavailable in current storage mode');
                }
            }

            // Combine bank details into JSON
            const bankDetails = {
                bank_name: profileData.bank_name,
                account_holder_name: profileData.account_holder_name,
                account_number: profileData.account_number,
                branch_name: profileData.branch_name,
                routing_number: profileData.routing_number,
                bank_document_url: bankDocumentUrl
            };
            formData.append('bank_details', JSON.stringify(bankDetails));

            if (selectedFile) {
                const optimizedProfileImage = await compressImageIfNeeded(selectedFile);
                formData.append('profile_picture', optimizedProfileImage);
            }

            const res = await api.put('/auth/profile', formData);

                if (res.data.user || res.data.message) {
                    await refetchUser();
                    if (res.data?.user?.profile_picture) {
                        setPreviewUrl(toProfileImageUrl(res.data.user.profile_picture));
                        setPreviewLoadFailed(false);
                } else if (removeProfilePicture) {
                    setPreviewUrl(null);
                    setPreviewLoadFailed(false);
                }
                setSelectedFile(null); // Clear selected file after success
                setBankDocumentFile(null);
                setIsEditProfileOpen(false);
                setMessage({ type: 'success', text: res.data.message || 'Profile updated successfully!' });
                setTimeout(() => setMessage(null), 3000);
                }
        } catch (err: any) {
            console.error(err);
            setMessage({ type: 'error', text: err.response?.data?.error || 'Failed to update profile' });
        } finally {
            setProfileLoading(false);
        }
    };

    const loadUpgradeOptions = async () => {
        setPlanOptionsLoading(true);
        try {
            const res = await api.get('/auth/plan-options');
            const options = Array.isArray(res.data?.upgrade_options) ? res.data.upgrade_options : [];
            setUpgradeOptions(options);
            setCurrentPlanInfo(res.data?.current_plan || null);
            setSelectedUpgradePlanId(options[0]?.id || '');
            if (options.length === 0) {
                setMessage({ type: 'success', text: 'No higher plan available. You are already on the highest plan.' });
            }
        } catch (err: any) {
            setMessage({ type: 'error', text: err?.response?.data?.error || 'Failed to load plan options' });
        } finally {
            setPlanOptionsLoading(false);
        }
    };

    const upgradePlan = async () => {
        if (!selectedUpgradePlanId) return;
        setPlanUpgradeLoading(true);
        try {
            const res = await api.post('/auth/upgrade-plan', { planId: selectedUpgradePlanId });
            setMessage({ type: 'success', text: res.data?.message || 'Plan upgraded successfully' });
            await refetchUser();
            await loadUpgradeOptions();
        } catch (err: any) {
            setMessage({ type: 'error', text: err?.response?.data?.error || 'Failed to upgrade plan' });
        } finally {
            setPlanUpgradeLoading(false);
        }
    };

    const submitPassword = async (e: React.FormEvent) => {
        e.preventDefault();
        setPasswordLoading(true);
        setMessage(null);

        if (!isProfileCompleteForPasswordChange) {
            setMessage({
                type: 'error',
                text: isBankDetailsRequired
                    ? 'Complete your profile (Email, Contact, Bank Details) before changing password.'
                    : 'Complete your profile (Email, Contact) before changing password.'
            });
            setPasswordLoading(false);
            return;
        }

        if (passwordData.newPassword !== passwordData.confirmPassword) {
            setMessage({ type: 'error', text: 'New passwords do not match' });
            setPasswordLoading(false);
            return;
        }

        try {
            await api.post('/auth/change-password', {
                currentPassword: passwordData.currentPassword,
                newPassword: passwordData.newPassword
            });
            setMessage({ type: 'success', text: 'Password changed successfully!' });
            setPasswordData({ currentPassword: '', newPassword: '', confirmPassword: '' });
            setTimeout(() => setMessage(null), 3000);
        } catch (err: any) {
            console.error(err);
            setMessage({ type: 'error', text: err.response?.data?.error || 'Failed to change password' });
        } finally {
            setPasswordLoading(false);
        }
    };

    const hasMinLength = passwordData.newPassword.length >= 8;
    const hasSpecialOrNumber = /[0-9!@#$%^&*(),.?":{}|<>]/.test(passwordData.newPassword);
    const hasMixedCase = /[a-z]/.test(passwordData.newPassword) && /[A-Z]/.test(passwordData.newPassword);
    const isPasswordValid = hasMinLength && hasSpecialOrNumber && hasMixedCase;

    const hasBankDetailsForPasswordChange = (() => {
        const raw = user?.bank_details;
        if (!raw) return false;

        if (typeof raw === 'string') {
            const trimmed = raw.trim();
            if (!trimmed) return false;
            try {
                const parsed = JSON.parse(trimmed);
                return Object.values(parsed || {}).some((value) => String(value || '').trim().length > 0);
            } catch (_) {
                return trimmed.length > 0;
            }
        }

        return Object.values(raw as Record<string, unknown>).some((value) => String(value || '').trim().length > 0);
    })();

    const isProfileCompleteForPasswordChange = Boolean(
        user?.email?.trim() &&
        user?.contact_number?.trim() &&
        (!isBankDetailsRequired || hasBankDetailsForPasswordChange)
    );

    const PasswordRequirement = ({ met, text }: { met: boolean; text: string }) => (
        <div className={`flex items-center gap-2 text-sm transition duration-300 ${met ? 'text-green-600' : 'text-muted-foreground/70'
            }`}>
            <div className={`w-4 h-4 rounded-full flex items-center justify-center transition duration-300 ${met ? 'bg-green-500' : 'bg-slate-200'
                }`}>
                {met && <Check size={12} className="text-white" />}
            </div>
            <span className="text-xs">{text}</span>
        </div>
    );

    const getHomeRoute = (role?: string) => {
        if (role === 'employee') return '/dashboard';
        if (role === 'moderator') return '/project-manager';
        if (role === 'admin' || role === 'COMPANY_ADMIN') return '/admin';
        if (role === 'SUPERADMIN') return '/superadmin';
        return '/profile';
    };

    const homeRoute = getHomeRoute(user?.role);
    const isAdminProfileView = true;
    const isCompanyAdmin = user?.role === 'admin' || user?.role === 'COMPANY_ADMIN';
    const formatDateLabel = (value?: string | null) =>
        value
            ? new Date(value).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
            : 'Not available';
    const joinedOn = (user as any)?.created_at
        ? formatDateLabel((user as any).created_at)
        : 'Not available';
    const accountId = (user as any)?.employee_id || ((user as any)?.id ? `TRK-${(user as any).id}` : 'Not available');
    const planLabel = (() => {
        if ((user as any)?.unlimited_access) return 'UNLIMITED';
        return (user as any)?.plan_name || (isCompanyAdmin ? 'COMPANY ADMIN' : String(user?.role || 'N/A').toUpperCase());
    })();
    const planExpiresLabel = (() => {
        if (!isCompanyAdmin) return 'Not available';
        if ((user as any)?.unlimited_access) return 'Never (Unlimited)';
        const expiresAt = (user as any)?.current_period_ends_at || (user as any)?.trial_ends_at;
        return formatDateLabel(expiresAt);
    })();
    const planUsageRows = [
        {
            label: 'Admins',
            used: Number((user as any)?.used_company_admins ?? 0),
            limit: Number((user as any)?.max_company_admins ?? 0),
        },
        {
            label: 'Project Managers',
            used: Number((user as any)?.used_project_managers ?? 0),
            limit: Number((user as any)?.max_project_managers ?? 0),
        },
        {
            label: 'Employees',
            used: Number((user as any)?.used_employees ?? 0),
            limit: Number((user as any)?.max_employees ?? 0),
        },
    ];
    const adminSidebarSections = useAdminSidebarItems({
        pendingLeaves: 0,
        chatUnreadCount: 0,
    });
    const moderatorSidebarSections = useModeratorSidebarItems({
        pendingLeaves: 0,
        chatUnreadCount: 0,
    });
    const superadminSidebarItems = useSuperadminSidebarItems();
    const employeeSidebarItems = useEmployeeSidebarItems();

    const isSuperadmin = user?.role === 'SUPERADMIN';
    const isModerator = user?.role === 'moderator';
    const sidebarTitle = isSuperadmin ? 'Dashboards' : 'Track AI';
    const sidebarSubtitle = isSuperadmin ? 'Superadmin Control' : 'Account Settings';
    const sidebarRoleLabel = isSuperadmin ? 'SUPERADMIN' : (user?.role || 'User');

    const sidebarProps = useRoleSidebarConfig({
        role: user?.role,
        isCompanyAdmin,
        adminSections: adminSidebarSections,
        moderatorSections: moderatorSidebarSections,
        superadminItems: superadminSidebarItems,
        employeeItems: employeeSidebarItems,
    });

    return (
        <div className={cn(
            "min-h-screen bg-background",
            "font-sans text-foreground"
        )}>
            <RoleSidebar
                title={sidebarTitle}
                subtitle={sidebarSubtitle}
                {...sidebarProps}
                userName={user?.full_name || user?.username}
                roleLabel={sidebarRoleLabel}
                onLogout={logout}
            />

            <main
                className={cn(
                    "min-h-screen flex flex-col",
                    "lg:pl-64"
                )}
            >
                <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
                    {isAdminProfileView ? (
                        <div className="mb-8 rounded-2xl border border-border bg-card px-6 py-5 shadow-sm flex items-start sm:items-center justify-between gap-4">
                            <div className="flex items-center gap-3 sm:gap-4">
                                <Button variant="ghost" size="icon" onClick={() => navigate(homeRoute)} className="shrink-0 rounded-full bg-muted hover:bg-muted text-muted-foreground">
                                    <ArrowLeft className="w-5 h-5" />
                                </Button>
                                <div>
                                    <h1 className="text-xl sm:text-3xl font-bold tracking-tight text-foreground">My Profile</h1>
                                    <p className="mt-1 sm:mt-2 text-xs sm:text-sm text-muted-foreground">Control your professional identity and security preferences within the Track AI ecosystem.</p>
                                </div>
                            </div>
                            <div className="lg:hidden shrink-0 mt-1 sm:mt-0">
                                <MobileRoleSidebar
                                    title={sidebarTitle}
                                    subtitle={sidebarSubtitle}
                                    {...sidebarProps}
                                    userName={user?.full_name || user?.username}
                                    roleLabel={sidebarRoleLabel}
                                    onLogout={logout}
                                />
                            </div>
                        </div>
                    ) : (
                        <header className="sticky top-0 z-40 -mx-4 mb-8 border-b border-border bg-card px-4 sm:-mx-6 sm:px-6 lg:-mx-8 lg:px-8">
                            <div className="max-w-7xl mx-auto">
                                <div className="flex w-full items-center justify-between sm:w-auto h-16 gap-4">
                                    <div className="flex min-w-0 items-center gap-3">
                                        <Button variant="ghost" size="icon" onClick={() => navigate(homeRoute)} className="shrink-0 rounded-full lg:hidden bg-muted hover:bg-muted text-muted-foreground mr-1">
                                            <ArrowLeft className="w-5 h-5" />
                                        </Button>
                                        <div className="w-10 h-10 rounded-full bg-linear-to-br from-blue-500 to-blue-600 flex items-center justify-center shadow-sm">
                                            <User className="w-5 h-5 text-white" />
                                        </div>
                                        <div>
                                            <h1 className="text-lg font-bold text-foreground">My Profile</h1>
                                            <p className="text-xs text-muted-foreground">Manage your account settings</p>
                                        </div>
                                    </div>
                                    <div className="lg:hidden">
                                        <MobileRoleSidebar
                                            title={sidebarTitle}
                                            subtitle={sidebarSubtitle}
                                            {...sidebarProps}
                                            userName={user?.full_name || user?.username}
                                            roleLabel={sidebarRoleLabel}
                                            onLogout={logout}
                                        />
                                    </div>
                                </div>
                            </div>
                        </header>
                    )}
                {/* Pending Request Banner */}
                {(user as any)?.hasPendingRequest && (
                    <div className="mb-8 bg-amber-50 border border-amber-200 rounded-xl p-4 flex items-center gap-4 text-amber-900 shadow-sm animate-in fade-in slide-in-from-top-4 duration-500">
                        <div className="w-10 h-10 bg-amber-100 rounded-full flex items-center justify-center shrink-0">
                            <Clock className="w-5 h-5 text-amber-600" />
                        </div>
                        <div>
                            <h4 className="font-semibold text-sm flex items-center gap-2">
                                Implementation Pending
                                <span className="px-2 py-0.5 bg-amber-100 text-amber-700 text-[10px] rounded-full uppercase tracking-wider font-bold">Waiting Approval</span>
                            </h4>
                            <p className="text-sm mt-0.5 opacity-90 text-amber-800">
                                Your profile changes have been submitted and are waiting for admin approval. Your current details will remain until the request is approved.
                            </p>
                        </div>
                    </div>
                )}

                {/* Approved/Rejected Banner */}
                {(user as any)?.latestHandledRequest && (
                    <div className={`mb-8 border rounded-xl p-4 flex items-center justify-between gap-4 shadow-sm animate-in fade-in slide-in-from-top-4 duration-500 ${(user as any).latestHandledRequest.status === 'approved'
                        ? 'bg-green-50 border-green-200 text-green-900'
                        : 'bg-red-50 border-red-200 text-red-900'
                        }`}>
                        <div className="flex items-center gap-4">
                            <div className={`w-10 h-10 rounded-full flex items-center justify-center shrink-0 ${(user as any).latestHandledRequest.status === 'approved' ? 'bg-green-100' : 'bg-red-100'
                                }`}>
                                {(user as any).latestHandledRequest.status === 'approved'
                                    ? <CheckCircle2 className="w-5 h-5 text-green-600" />
                                    : <AlertCircle className="w-5 h-5 text-red-600" />
                                }
                            </div>
                            <div>
                                <h4 className="font-semibold text-sm flex items-center gap-2">
                                    Profile Update {(user as any).latestHandledRequest.status === 'approved' ? 'Approved' : 'Rejected'}
                                    <span className={`px-2 py-0.5 text-[10px] rounded-full uppercase tracking-wider font-bold ${(user as any).latestHandledRequest.status === 'approved' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'
                                        }`}>
                                        Admin Handled
                                    </span>
                                </h4>
                                <p className="text-sm mt-0.5 opacity-90">
                                    {(user as any).latestHandledRequest.status === 'approved'
                                        ? 'Your profile changes have been approved and applied to your account.'
                                        : `Your profile update request was rejected. Reason: ${(user as any).latestHandledRequest.rejection_reason || 'No reason provided.'}`
                                    }
                                </p>
                            </div>
                        </div>
                        <button
                            onClick={async () => {
                                await api.post('/auth/acknowledge-profile-notification');
                                refetchUser();
                            }}
                            className="p-1 hover:bg-black/5 rounded-full transition-colors"
                        >
                            <X className="w-5 h-5 opacity-50" />
                        </button>
                    </div>
                )}

                {/* Success/Error Message */}
                {message && (
                    <div className={`mb-6 p-4 rounded-xl border-2 flex items-center gap-3 animate-in fade-in slide-in-from-top-2 duration-300 ${message.type === 'success'
                        ? 'bg-green-50 border-green-200'
                        : 'bg-red-50 border-red-200'
                        }`}>
                        {message.type === 'success' ? (
                            <CheckCircle2 className="w-5 h-5 text-green-600 shrink-0" />
                        ) : (
                            <AlertCircle className="w-5 h-5 text-red-600 shrink-0" />
                        )}
                        <p className={`font-medium ${message.type === 'success' ? 'text-green-800' : 'text-red-800'
                            }`}>
                            {message.text}
                        </p>
                    </div>
                )}

                {/* Profile Cards Grid */}
                <div className={cn("grid gap-6", isAdminProfileView ? "xl:grid-cols-[minmax(0,1.4fr)_minmax(330px,0.9fr)] items-start" : "md:grid-cols-2")}>
                    {/* Personal Details Card */}
                    <Card className={cn("border-0 shadow-sm bg-card rounded-2xl", isAdminProfileView && "border border-border")}>
                        <CardHeader className="border-b border-border/50">
                            <div className="flex items-center justify-between gap-3">
                                <CardTitle className="text-lg flex items-center gap-2">
                                    <div className="w-8 h-8 rounded-lg bg-blue-100 flex items-center justify-center">
                                        <User className="w-4 h-4 text-blue-600" />
                                    </div>
                                    Personal Information
                                </CardTitle>
                                {isAdminProfileView && (
                                    <Button
                                        type="button"
                                        variant="outline"
                                        className="rounded-lg border-border bg-card text-muted-foreground hover:bg-muted hover:text-foreground"
                                        onClick={() => setIsEditProfileOpen(true)}
                                    >
                                        Edit
                                    </Button>
                                )}
                            </div>
                        </CardHeader>
                        <CardContent className="pt-6">
                            {isAdminProfileView ? (
                                <div className="space-y-6">
                                    {/* Premium Avatar Header */}
                                    <div className="flex items-center gap-5 pb-5 border-b border-border/60">
                                        <div className="relative w-20 h-20 rounded-full bg-muted border border-border overflow-hidden shadow-inner shrink-0 flex items-center justify-center">
                                            {previewUrl && !previewLoadFailed ? (
                                                <OptimizedImage
                                                    src={previewUrl}
                                                    alt="Profile Picture"
                                                    className="w-full h-full object-cover"
                                                    onError={() => setPreviewLoadFailed(true)}
                                                />
                                            ) : (
                                                <User className="w-10 h-10 text-muted-foreground" />
                                            )}
                                        </div>
                                        <div>
                                            <h3 className="text-lg font-bold text-foreground">{profileData.full_name || 'Not set'}</h3>
                                            <p className="text-sm text-muted-foreground capitalize">{user?.role || 'User'}</p>
                                        </div>
                                    </div>

                                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                                        <div>
                                            <p className="text-xs font-medium text-muted-foreground">Full Name</p>
                                            <p className="mt-1 text-sm font-semibold text-foreground">{profileData.full_name || 'Not set'}</p>
                                        </div>
                                        <div>
                                            <p className="text-xs font-medium text-muted-foreground">Username</p>
                                            <p className="mt-1 text-sm font-semibold text-foreground">{profileData.username ? `@${profileData.username}` : 'Not set'}</p>
                                        </div>
                                        <div>
                                            <p className="text-xs font-medium text-muted-foreground">Role</p>
                                            <p className="mt-1 text-sm font-semibold text-foreground capitalize">{user?.role || 'User'}</p>
                                        </div>
                                        <div>
                                            <p className="text-xs font-medium text-muted-foreground">Email Address</p>
                                            <p className="mt-1 text-sm font-semibold text-foreground">{profileData.email || 'Not set'}</p>
                                        </div>
                                        <div>
                                            <p className="text-xs font-medium text-muted-foreground">Phone Number</p>
                                            <p className="mt-1 text-sm font-semibold text-foreground">{profileData.contact_number || 'Not set'}</p>
                                        </div>
                                        <div>
                                            <p className="text-xs font-medium text-muted-foreground">Timezone</p>
                                            <p className="mt-1 text-sm font-semibold text-foreground">{profileData.timezone || 'Not set'}</p>
                                        </div>
                                    </div>

                                    {isBankDetailsRequired && (
                                        <div className="border-t border-border/60 pt-5">
                                            <h3 className="text-base font-semibold text-foreground">Bank Details</h3>
                                            <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
                                                <div>
                                                    <p className="text-xs font-medium text-muted-foreground">Bank Name</p>
                                                    <p className="mt-1 text-sm font-semibold text-foreground">{profileData.bank_name || 'Not set'}</p>
                                                </div>
                                                <div>
                                                    <p className="text-xs font-medium text-muted-foreground">Account Holder</p>
                                                    <p className="mt-1 text-sm font-semibold text-foreground">{profileData.account_holder_name || 'Not set'}</p>
                                                </div>
                                                <div>
                                                    <p className="text-xs font-medium text-muted-foreground">Account Number</p>
                                                    <p className="mt-1 text-sm font-semibold text-foreground">{profileData.account_number || 'Not set'}</p>
                                                </div>
                                                <div>
                                                    <p className="text-xs font-medium text-muted-foreground">Branch Name</p>
                                                    <p className="mt-1 text-sm font-semibold text-foreground">{profileData.branch_name || 'Not set'}</p>
                                                </div>
                                                <div className="sm:col-span-2">
                                                    <p className="text-xs font-medium text-muted-foreground">Routing Number</p>
                                                    <p className="mt-1 text-sm font-semibold text-foreground">{profileData.routing_number || 'Not set'}</p>
                                                </div>
                                                <div className="sm:col-span-2">
                                                    <p className="text-xs font-medium text-muted-foreground">Bank Document</p>
                                                    <p className="mt-1 text-sm font-semibold text-foreground break-all">{profileData.bank_document_url || 'Not set'}</p>
                                                </div>
                                            </div>
                                        </div>
                                    )}
                                </div>
                            ) : (
                            <form onSubmit={submitProfile} className="space-y-5">
                                {/* Photo Upload Section */}
                                <div className="flex flex-col items-center gap-4 pb-4">
                                    <div className="relative group">
                                        <div
                                            onClick={() => fileInputRef.current?.click()}
                                            className="w-24 h-24 rounded-full bg-muted border-2 border-dashed border-border flex items-center justify-center overflow-hidden transition group-hover:border-blue-400 group-hover:bg-blue-50 dark:group-hover:bg-blue-950/30 cursor-pointer shadow-inner"
                                        >
                                            {previewUrl && !previewLoadFailed ? (
                                                <OptimizedImage
                                                    src={previewUrl}
                                                    alt="Profile Preview"
                                                    className="w-full h-full object-cover"
                                                    onError={() => setPreviewLoadFailed(true)}
                                                />
                                            ) : (
                                                <Camera className="w-8 h-8 text-muted-foreground/70 group-hover:text-blue-500" />
                                            )}
                                        </div>
                                        {previewUrl && (
                                            <button
                                                type="button"
                                                onClick={removePhoto}
                                                className="absolute -top-2 -right-2 w-6 h-6 rounded-full bg-red-500 text-white flex items-center justify-center shadow-md hover:bg-red-600 transition-colors"
                                            >
                                                <X size={14} />
                                            </button>
                                        )}
                                        <button
                                            type="button"
                                            onClick={() => fileInputRef.current?.click()}
                                            className="absolute -bottom-2 -left-2 w-8 h-8 rounded-xl bg-card border border-border text-muted-foreground flex items-center justify-center shadow-sm hover:bg-muted hover:text-blue-600 transition active:scale-95"
                                        >
                                            <Upload size={16} />
                                        </button>
                                    </div>
                                    <input
                                        type="file"
                                        ref={fileInputRef}
                                        onChange={handleFileChange}
                                        accept="image/*"
                                        className="hidden"
                                    />
                                    <div className="text-center">
                                        <p className="text-sm font-medium text-foreground">Profile Photo</p>
                                        <p className="text-xs text-muted-foreground">JPG, PNG or GIF. Max 5MB</p>
                                    </div>
                                </div>

                                <div className="space-y-2">
                                    <Label htmlFor="full_name" className="text-sm font-medium text-foreground flex items-center gap-2">
                                        <User className="w-4 h-4 text-muted-foreground/70" />
                                        Full Name
                                        <span className="text-red-500">*</span>
                                    </Label>
                                    <Input
                                        id="full_name"
                                        name="full_name"
                                        value={profileData.full_name}
                                        onChange={handleProfileChange}
                                        placeholder="John Doe"
                                        autoComplete="name"
                                        required
                                        className="h-11 rounded-xl border-border focus:border-blue-500 focus:ring-2 focus:ring-blue-100 transition"
                                    />
                                </div>

                                <div className="space-y-2">
                                    <Label htmlFor="username" className="text-sm font-medium text-foreground flex items-center gap-2">
                                        <User className="w-4 h-4 text-muted-foreground/70" />
                                        Username
                                        <span className="text-red-500">*</span>
                                    </Label>
                                    <Input
                                        id="username"
                                        name="username"
                                        value={profileData.username}
                                        onChange={handleProfileChange}
                                        placeholder="only lowercase letters"
                                        required
                                        pattern="[a-z]+"
                                        title="Username can contain only lowercase letters (a-z)"
                                        autoComplete="username"
                                        autoCapitalize="off"
                                        spellCheck={false}
                                        className="h-11 rounded-xl border-border focus:border-blue-500 focus:ring-2 focus:ring-blue-100 transition"
                                    />
                                    <p className="text-[10px] text-muted-foreground px-1">
                                        Only lowercase letters allowed, no spaces, numbers, or symbols.
                                    </p>
                                </div>

                                <div className="space-y-2">
                                    <Label htmlFor="email" className="text-sm font-medium text-foreground flex items-center gap-2">
                                        <Mail className="w-4 h-4 text-muted-foreground/70" />
                                        Email
                                        <span className="text-red-500">*</span>
                                    </Label>
                                    <Input
                                        id="email"
                                        name="email"
                                        type="email"
                                        value={profileData.email}
                                        onChange={handleProfileChange}
                                        placeholder="john@example.com"
                                        autoComplete="email"
                                        required
                                        className="h-11 rounded-xl border-border focus:border-blue-500 focus:ring-2 focus:ring-blue-100 transition"
                                    />
                                </div>

                                <div className="space-y-2">
                                    <Label htmlFor="contact_number" className="text-sm font-medium text-foreground flex items-center gap-2">
                                        <Phone className="w-4 h-4 text-muted-foreground/70" />
                                        Contact Number
                                        <span className="text-red-500">*</span>
                                    </Label>
                                    <PhoneInput
                                        id="contact_number"
                                        name="contact_number"
                                        autoComplete="tel"
                                        value={profileData.contact_number}
                                        onChange={handlePhoneChange}
                                        placeholder="+880 1712 345678"
                                        required
                                        className="h-11 rounded-xl border-border focus:border-blue-500 focus:ring-2 focus:ring-blue-100 transition"
                                    />
                                </div>
                                
                                <div className="space-y-2">
                                    <Label htmlFor="timezone" className="text-sm font-medium text-foreground flex items-center gap-2">
                                        <Clock className="w-4 h-4 text-muted-foreground/70" />
                                        Timezone
                                        <span className="text-red-500">*</span>
                                    </Label>
                                    <select
                                        id="timezone"
                                        name="timezone"
                                        value={profileData.timezone}
                                        onChange={(e) => setProfileData(prev => ({ ...prev, timezone: e.target.value }))}
                                        className="w-full h-11 px-3 rounded-xl border border-border bg-card text-sm focus:border-blue-500 focus:ring-2 focus:ring-blue-100 transition outline-none appearance-none cursor-pointer"
                                        style={{ backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='24' height='24' viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpolyline points='6 9 12 15 18 9'%3E%3C/polyline%3E%3C/svg%3E")`, backgroundRepeat: 'no-repeat', backgroundPosition: 'right 12px center', backgroundSize: '16px' }}
                                    >
                                        <option value="Asia/Dhaka">Asia/Dhaka (GMT+6)</option>
                                        <option value="Asia/Dubai">Asia/Dubai (GMT+4)</option>
                                        <option value="Asia/Kolkata">Asia/Kolkata (GMT+5:30)</option>
                                        <option value="Asia/Singapore">Asia/Singapore (GMT+8)</option>
                                        <option value="Europe/London">Europe/London (GMT+0)</option>
                                        <option value="Europe/Paris">Europe/Paris (GMT+1)</option>
                                        <option value="America/New_York">America/New_York (GMT-5)</option>
                                        <option value="America/Chicago">America/Chicago (GMT-6)</option>
                                        <option value="America/Los_Angeles">America/Los_Angeles (GMT-8)</option>
                                        <option value="UTC">UTC/GMT</option>
                                    </select>
                                    <p className="text-[10px] text-muted-foreground px-1">Choose the timezone you are currently working from.</p>
                                </div>

                                {isBankDetailsRequired && (
                                <>
                                {/* Bank Details Section */}
                                <div className="space-y-4 pt-4 border-t border-border">
                                    <p className="text-sm font-semibold text-foreground flex items-center gap-2">
                                        <Building2 className="w-4 h-4 text-muted-foreground/70" />
                                        Bank Details
                                    </p>

                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                        <div className="space-y-2">
                                            <Label htmlFor="bank_name" className="text-sm font-medium text-foreground">
                                                Bank Name
                                                <span className="text-red-500">*</span>
                                            </Label>
                                            <Input
                                                id="bank_name"
                                                name="bank_name"
                                                value={profileData.bank_name}
                                                onChange={handleProfileChange}
                                                placeholder="Enter bank name"
                                                autoComplete="organization"
                                                required
                                                className="h-11 rounded-xl border-border focus:border-blue-500 focus:ring-2 focus:ring-blue-100 transition"
                                            />
                                        </div>

                                        <div className="space-y-2">
                                            <Label htmlFor="account_holder_name" className="text-sm font-medium text-foreground">
                                                Account Holder Name
                                                <span className="text-red-500">*</span>
                                            </Label>
                                            <Input
                                                id="account_holder_name"
                                                name="account_holder_name"
                                                value={profileData.account_holder_name}
                                                onChange={handleProfileChange}
                                                placeholder="Enter account holder name"
                                                autoComplete="name"
                                                required
                                                className="h-11 rounded-xl border-border focus:border-blue-500 focus:ring-2 focus:ring-blue-100 transition"
                                            />
                                        </div>

                                        <div className="space-y-2">
                                            <Label htmlFor="account_number" className="text-sm font-medium text-foreground">
                                                Account Number
                                                <span className="text-red-500">*</span>
                                            </Label>
                                            <Input
                                                id="account_number"
                                                name="account_number"
                                                value={profileData.account_number}
                                                onChange={handleProfileChange}
                                                placeholder="Enter account number"
                                                autoComplete="off"
                                                required
                                                className="h-11 rounded-xl border-border focus:border-blue-500 focus:ring-2 focus:ring-blue-100 transition"
                                            />
                                        </div>

                                        <div className="space-y-2">
                                            <Label htmlFor="branch_name" className="text-sm font-medium text-foreground">
                                                Branch Name
                                                <span className="text-red-500">*</span>
                                            </Label>
                                            <Input
                                                id="branch_name"
                                                name="branch_name"
                                                value={profileData.branch_name}
                                                onChange={handleProfileChange}
                                                placeholder="Enter branch name"
                                                autoComplete="off"
                                                required
                                                className="h-11 rounded-xl border-border focus:border-blue-500 focus:ring-2 focus:ring-blue-100 transition"
                                            />
                                        </div>

                                        <div className="space-y-2 md:col-span-2">
                                            <Label htmlFor="routing_number" className="text-sm font-medium text-foreground">
                                                Routing Number
                                                <span className="text-red-500">*</span>
                                            </Label>
                                            <Input
                                                id="routing_number"
                                                name="routing_number"
                                                value={profileData.routing_number}
                                                onChange={handleProfileChange}
                                                placeholder="Enter routing number"
                                                autoComplete="off"
                                                required
                                                className="h-11 rounded-xl border-border focus:border-blue-500 focus:ring-2 focus:ring-blue-100 transition"
                                            />
                                        </div>
                                    </div>
                                </div>
                                </>
                                )}

                                <Button
                                    type="submit"
                                    disabled={profileLoading}
                                    className={cn(
                                        "h-12 rounded-xl text-white font-semibold shadow-md transition disabled:opacity-50 inline-flex items-center justify-center gap-2",
                                        isAdminProfileView ? "ml-auto w-full sm:w-44 bg-blue-700 hover:bg-blue-800" : "w-full bg-blue-500 hover:bg-blue-600"
                                    )}
                                >
                                    {profileLoading ? (
                                        <span className="inline-flex items-center gap-2">
                                            <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                                            Saving...
                                        </span>
                                    ) : (
                                        <>
                                            <CheckCircle2 className="w-5 h-5" />
                                            Save Details
                                        </>
                                    )}
                                </Button>
                            </form>
                            )}
                        </CardContent>
                    </Card>

                    <div className="space-y-6">
                        {/* Change Password Card */}
                        <Card className={cn("border-0 shadow-sm bg-card rounded-2xl", isAdminProfileView && "border border-border")}>
                            <CardHeader className="border-b border-border/50">
                                <CardTitle className="text-lg flex items-center gap-2">
                                    <div className={cn("w-8 h-8 rounded-lg flex items-center justify-center", isAdminProfileView ? "bg-blue-100" : "bg-purple-100")}>
                                        <Shield className={cn("w-4 h-4", isAdminProfileView ? "text-blue-600" : "text-purple-600")} />
                                    </div>
                                    Change Password
                                </CardTitle>
                            </CardHeader>
                            <CardContent className="pt-6">
                                <form onSubmit={submitPassword} className="space-y-5">
                                {!isProfileCompleteForPasswordChange && (
                                    <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
                                        {isBankDetailsRequired
                                            ? 'Complete your profile (Email, Contact, Bank Details) before changing password.'
                                            : 'Complete your profile (Email, Contact) before changing password.'}
                                    </div>
                                )}

                                <div className="space-y-2">
                                    <Label htmlFor="currentPassword" className="text-sm font-medium text-foreground flex items-center gap-2">
                                        <Lock className="w-4 h-4 text-muted-foreground/70" />
                                        Current Password
                                        <span className="text-red-500">*</span>
                                    </Label>
                                    <div className="relative">
                                        <Input
                                            id="currentPassword"
                                            name="currentPassword"
                                            type={showCurrentPassword ? "text" : "password"}
                                            value={passwordData.currentPassword}
                                            onChange={handlePasswordChange}
                                            required
                                            autoComplete="current-password"
                                            className={cn("h-11 pr-12 rounded-xl border-border transition", isAdminProfileView ? "focus:border-blue-500 focus:ring-2 focus:ring-blue-100" : "focus:border-purple-500 focus:ring-2 focus:ring-purple-100")}
                                        />
                                        <button
                                            type="button"
                                            onClick={() => setShowCurrentPassword(!showCurrentPassword)}
                                            className="absolute right-4 top-1/2 -translate-y-1/2 text-muted-foreground/70 hover:text-muted-foreground transition-colors"
                                            tabIndex={-1}
                                        >
                                            {showCurrentPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                                        </button>
                                    </div>
                                </div>

                                <div className="space-y-2">
                                    <Label htmlFor="newPassword" className="text-sm font-medium text-foreground flex items-center gap-2">
                                        <Lock className="w-4 h-4 text-muted-foreground/70" />
                                        New Password
                                        <span className="text-red-500">*</span>
                                    </Label>
                                    <div className="relative">
                                        <Input
                                            id="newPassword"
                                            name="newPassword"
                                            type={showNewPassword ? "text" : "password"}
                                            value={passwordData.newPassword}
                                            onChange={handlePasswordChange}
                                            required
                                            autoComplete="new-password"
                                            className={cn("h-11 pr-12 rounded-xl border-border transition", isAdminProfileView ? "focus:border-blue-500 focus:ring-2 focus:ring-blue-100" : "focus:border-purple-500 focus:ring-2 focus:ring-purple-100")}
                                        />
                                        <button
                                            type="button"
                                            onClick={() => setShowNewPassword(!showNewPassword)}
                                            className="absolute right-4 top-1/2 -translate-y-1/2 text-muted-foreground/70 hover:text-muted-foreground transition-colors"
                                            tabIndex={-1}
                                        >
                                            {showNewPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                                        </button>
                                    </div>

                                    {/* Password Strength Indicators */}
                                    {passwordData.newPassword && (
                                        <div className="space-y-2 pt-2 px-1">
                                            <PasswordRequirement met={hasMinLength} text="At least 8 characters" />
                                            <PasswordRequirement met={hasSpecialOrNumber} text="Number (0-9) or symbol" />
                                            <PasswordRequirement met={hasMixedCase} text="Lowercase (a-z) and uppercase (A-Z)" />
                                        </div>
                                    )}
                                </div>

                                <div className="space-y-2">
                                    <Label htmlFor="confirmPassword" className="text-sm font-medium text-foreground flex items-center gap-2">
                                        <Lock className="w-4 h-4 text-muted-foreground/70" />
                                        Confirm Password
                                        <span className="text-red-500">*</span>
                                    </Label>
                                    <div className="relative">
                                        <Input
                                            id="confirmPassword"
                                            name="confirmPassword"
                                            type={showConfirmPassword ? "text" : "password"}
                                            value={passwordData.confirmPassword}
                                            onChange={handlePasswordChange}
                                            required
                                            autoComplete="new-password"
                                            className={cn("h-11 pr-12 rounded-xl border-border transition", isAdminProfileView ? "focus:border-blue-500 focus:ring-2 focus:ring-blue-100" : "focus:border-purple-500 focus:ring-2 focus:ring-purple-100")}
                                        />
                                        <button
                                            type="button"
                                            onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                                            className="absolute right-4 top-1/2 -translate-y-1/2 text-muted-foreground/70 hover:text-muted-foreground transition-colors"
                                            tabIndex={-1}
                                        >
                                            {showConfirmPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                                        </button>
                                    </div>
                                </div>

                                <Button
                                    type="submit"
                                    disabled={passwordLoading || !isPasswordValid || !isProfileCompleteForPasswordChange}
                                    className={cn(
                                        "w-full h-12 rounded-xl text-white font-semibold shadow-md transition disabled:opacity-50 disabled:cursor-not-allowed",
                                        isAdminProfileView ? "bg-blue-700 hover:bg-blue-800" : "bg-purple-600 hover:bg-purple-700"
                                    )}
                                >
                                    {passwordLoading ? (
                                        <span className="flex items-center gap-2">
                                            <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                                            Changing...
                                        </span>
                                    ) : (
                                        <>
                                            <Shield className="w-5 h-5 mr-2" />
                                            Change Password
                                        </>
                                    )}
                                </Button>
                                </form>
                            </CardContent>
                        </Card>

                        {isAdminProfileView && (
                            <Card className="border border-border shadow-sm bg-card rounded-2xl">
                                <CardHeader className="pb-3">
                                    <CardTitle className="text-base flex items-center gap-2 text-foreground">
                                        <AlertCircle className="w-4 h-4 text-blue-600" />
                                        Account Info
                                    </CardTitle>
                                </CardHeader>
                                <CardContent className="space-y-3 pt-0">
                                    <div className="flex items-center justify-between text-sm">
                                        <span className="text-muted-foreground">Account ID</span>
                                        <span className="font-semibold text-foreground">{accountId}</span>
                                    </div>
                                    <div className="flex items-center justify-between text-sm">
                                        <span className="text-muted-foreground">Joined On</span>
                                        <span className="font-semibold text-foreground">{joinedOn}</span>
                                    </div>
                                    {isCompanyAdmin && (
                                        <>
                                            <div className="flex items-center justify-between text-sm">
                                                <span className="text-muted-foreground">Plan</span>
                                                <span className="font-semibold text-blue-700 uppercase">{planLabel}</span>
                                            </div>
                                            <div className="flex items-center justify-between text-sm">
                                                <span className="text-muted-foreground">Plan Expires</span>
                                                <span className="font-semibold text-foreground">{planExpiresLabel}</span>
                                            </div>
                                            <div className="rounded-lg border border-border bg-muted p-3">
                                                <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Plan Usage</p>
                                                <div className="space-y-1.5">
                                                    {planUsageRows.map((row) => {
                                                        const remaining = Math.max(row.limit - row.used, 0);
                                                        const isUnlimited = Boolean((user as any)?.unlimited_access);
                                                        return (
                                                            <div key={row.label} className="flex items-center justify-between text-xs">
                                                                <span className="text-muted-foreground">{row.label}</span>
                                                                <span className="font-semibold text-foreground">
                                                                    {row.used} used
                                                                    {' / '}
                                                                    {isUnlimited ? 'Unlimited' : `${remaining} remaining`}
                                                                </span>
                                                            </div>
                                                        );
                                                    })}
                                                </div>
                                            </div>
                                            <Button
                                                type="button"
                                                variant="outline"
                                                className="mt-2 w-full rounded-lg border-slate-300 text-blue-700 hover:bg-blue-50"
                                                onClick={loadUpgradeOptions}
                                                disabled={planOptionsLoading}
                                            >
                                                {planOptionsLoading ? 'Loading Plans...' : 'View Plans'}
                                            </Button>
                                            {currentPlanInfo && (
                                                <p className="text-xs text-muted-foreground">Current plan: <span className="font-semibold text-foreground">{currentPlanInfo.name} ({currentPlanInfo.code})</span></p>
                                            )}
                                            {upgradeOptions.length > 0 && (
                                                <div className="space-y-2 rounded-lg border border-border bg-muted p-3">
                                                    <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Upgrade Plan</p>
                                                    <select
                                                        value={selectedUpgradePlanId}
                                                        onChange={(e) => setSelectedUpgradePlanId(e.target.value)}
                                                        className="w-full h-10 px-3 rounded-xl border border-border focus:border-blue-500 focus:ring-2 focus:ring-blue-100 outline-none bg-card"
                                                    >
                                                        {upgradeOptions.map((plan) => (
                                                            <option key={plan.id} value={plan.id}>
                                                                {plan.name} ({plan.code}) - ${plan.monthly_price}/mo
                                                            </option>
                                                        ))}
                                                    </select>
                                                    <Button
                                                        type="button"
                                                        className="w-full bg-blue-700 hover:bg-blue-800"
                                                        onClick={upgradePlan}
                                                        disabled={planUpgradeLoading || !selectedUpgradePlanId}
                                                    >
                                                        {planUpgradeLoading ? 'Upgrading...' : 'Upgrade Plan'}
                                                    </Button>
                                                    <p className="text-[11px] text-muted-foreground">
                                                        Downgrade is disabled. Billing period starts from the exact upgrade timestamp.
                                                    </p>
                                                </div>
                                            )}
                                        </>
                                    )}
                                </CardContent>
                            </Card>
                        )}
                    </div>
                </div>

                {isAdminProfileView && isEditProfileOpen && (
                    <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/45 p-4 backdrop-blur-sm">
                        <div className="w-full max-w-3xl rounded-2xl border border-border bg-card shadow-2xl">
                            <div className="flex items-center justify-between border-b border-border px-6 py-4">
                                <h3 className="text-lg font-semibold text-foreground">Edit Personal Information</h3>
                                <button
                                    type="button"
                                    onClick={() => setIsEditProfileOpen(false)}
                                    className="rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
                                >
                                    <X className="h-5 w-5" />
                                </button>
                            </div>
                            <form onSubmit={submitProfile} className="space-y-4 px-6 py-5 max-h-[78vh] overflow-y-auto">
                                {/* Photo Upload Section inside modal */}
                                <div className="flex flex-col items-center gap-4 pb-4 border-b border-border/60">
                                    <div className="relative group">
                                        <div
                                            onClick={() => fileInputRef.current?.click()}
                                            className="w-24 h-24 rounded-full bg-muted border-2 border-dashed border-border flex items-center justify-center overflow-hidden transition group-hover:border-blue-400 group-hover:bg-blue-50 dark:group-hover:bg-blue-950/30 cursor-pointer shadow-inner"
                                        >
                                            {previewUrl && !previewLoadFailed ? (
                                                <OptimizedImage
                                                    src={previewUrl}
                                                    alt="Profile Preview"
                                                    className="w-full h-full object-cover"
                                                    onError={() => setPreviewLoadFailed(true)}
                                                />
                                            ) : (
                                                <Camera className="w-8 h-8 text-muted-foreground group-hover:text-blue-500" />
                                            )}
                                        </div>
                                        {previewUrl && (
                                            <button
                                                type="button"
                                                onClick={removePhoto}
                                                className="absolute -top-2 -right-2 w-6 h-6 rounded-full bg-red-500 text-white flex items-center justify-center shadow-md hover:bg-red-600 transition-colors"
                                            >
                                                <X size={14} />
                                            </button>
                                        )}
                                        <button
                                            type="button"
                                            onClick={() => fileInputRef.current?.click()}
                                            className="absolute -bottom-2 -left-2 w-8 h-8 rounded-xl bg-white border border-border text-muted-foreground flex items-center justify-center shadow-sm hover:bg-muted hover:text-blue-600 transition active:scale-95"
                                        >
                                            <Upload size={16} />
                                        </button>
                                    </div>
                                    <input
                                        type="file"
                                        ref={fileInputRef}
                                        onChange={handleFileChange}
                                        accept="image/*"
                                        className="hidden"
                                    />
                                    <div className="text-center">
                                        <p className="text-sm font-medium text-foreground">Profile Photo</p>
                                        <p className="text-xs text-muted-foreground">JPG, PNG or GIF. Max 5MB</p>
                                    </div>
                                </div>

                                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                                    <div className="space-y-2 sm:col-span-2">
                                        <Label htmlFor="full_name_modal">Full Name</Label>
                                        <Input id="full_name_modal" name="full_name" value={profileData.full_name} onChange={handleProfileChange} required />
                                    </div>
                                    <div className="space-y-2">
                                        <Label htmlFor="username_modal">Username</Label>
                                        <Input id="username_modal" name="username" value={profileData.username} onChange={handleProfileChange} required pattern="[a-z]+" />
                                    </div>
                                    <div className="space-y-2">
                                        <Label htmlFor="email_modal">Email</Label>
                                        <Input id="email_modal" name="email" type="email" value={profileData.email} onChange={handleProfileChange} required />
                                    </div>
                                    <div className="space-y-2">
                                        <Label htmlFor="contact_number_modal">Contact Number</Label>
                                        <PhoneInput id="contact_number_modal" name="contact_number" value={profileData.contact_number} onChange={handlePhoneChange} required />
                                    </div>
                                    <div className="space-y-2">
                                        <Label htmlFor="timezone_modal">Timezone</Label>
                                        <select
                                            id="timezone_modal"
                                            name="timezone"
                                            value={profileData.timezone}
                                            onChange={(e) => setProfileData(prev => ({ ...prev, timezone: e.target.value }))}
                                            className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                                        >
                                            <option value="Asia/Dhaka">Asia/Dhaka (GMT+6)</option>
                                            <option value="Asia/Dubai">Asia/Dubai (GMT+4)</option>
                                            <option value="Asia/Kolkata">Asia/Kolkata (GMT+5:30)</option>
                                            <option value="Asia/Singapore">Asia/Singapore (GMT+8)</option>
                                            <option value="Europe/London">Europe/London (GMT+0)</option>
                                            <option value="Europe/Paris">Europe/Paris (GMT+1)</option>
                                            <option value="America/New_York">America/New_York (GMT-5)</option>
                                            <option value="America/Chicago">America/Chicago (GMT-6)</option>
                                            <option value="America/Los_Angeles">America/Los_Angeles (GMT-8)</option>
                                            <option value="UTC">UTC/GMT</option>
                                        </select>
                                    </div>
                                </div>

                                {isBankDetailsRequired && (
                                    <div className="space-y-4 border-t border-border pt-4">
                                        <h4 className="text-sm font-semibold text-foreground">Bank Details</h4>
                                        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                                            <div className="space-y-2">
                                                <Label htmlFor="bank_name_modal">Bank Name</Label>
                                                <Input id="bank_name_modal" name="bank_name" value={profileData.bank_name} onChange={handleProfileChange} required />
                                            </div>
                                            <div className="space-y-2">
                                                <Label htmlFor="account_holder_name_modal">Account Holder Name</Label>
                                                <Input id="account_holder_name_modal" name="account_holder_name" value={profileData.account_holder_name} onChange={handleProfileChange} required />
                                            </div>
                                            <div className="space-y-2">
                                                <Label htmlFor="account_number_modal">Account Number</Label>
                                                <Input id="account_number_modal" name="account_number" value={profileData.account_number} onChange={handleProfileChange} required />
                                            </div>
                                            <div className="space-y-2">
                                                <Label htmlFor="branch_name_modal">Branch Name</Label>
                                                <Input id="branch_name_modal" name="branch_name" value={profileData.branch_name} onChange={handleProfileChange} required />
                                            </div>
                                            <div className="space-y-2 sm:col-span-2">
                                                <Label htmlFor="routing_number_modal">Routing Number</Label>
                                                <Input id="routing_number_modal" name="routing_number" value={profileData.routing_number} onChange={handleProfileChange} required />
                                            </div>
                                            <div className="space-y-2 sm:col-span-2">
                                                <Label htmlFor="bank_document_modal">Bank Document Image</Label>
                                                <input
                                                    id="bank_document_modal"
                                                    type="file"
                                                    accept="image/*,.pdf"
                                                    onChange={(e) => setBankDocumentFile(e.target.files?.[0] || null)}
                                                    className="block w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                                                />
                                                {profileData.bank_document_url && (
                                                    <p className="text-xs text-muted-foreground break-all">Current: {profileData.bank_document_url}</p>
                                                )}
                                            </div>
                                        </div>
                                    </div>
                                )}

                                <div className="flex justify-end gap-3 border-t border-border pt-4">
                                    <Button type="button" variant="outline" onClick={() => setIsEditProfileOpen(false)}>
                                        Cancel
                                    </Button>
                                    <Button type="submit" disabled={profileLoading} className="bg-amber-500 text-white hover:bg-amber-600">
                                        {profileLoading ? 'Saving...' : 'Save Changes'}
                                    </Button>
                                </div>
                            </form>
                        </div>
                    </div>
                )}

                {/* User Info Display */}
                {!isAdminProfileView && (
                <div className="mt-8">
                    <Card className="border-0 shadow-sm bg-card rounded-2xl">
                        <CardHeader>
                            <CardTitle className="text-lg flex items-center gap-2">
                                <div className="w-8 h-8 rounded-lg bg-muted flex items-center justify-center">
                                    <User className="w-4 h-4 text-muted-foreground" />
                                </div>
                                Account Information
                            </CardTitle>
                        </CardHeader>
                        <CardContent>
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                <div className="p-4 rounded-xl bg-muted border border-border/50">
                                    <p className="text-xs font-medium text-muted-foreground mb-1">Full Name</p>
                                    <p className="text-sm font-semibold text-foreground">{user?.full_name || 'Not set'}</p>
                                </div>
                                <div className="p-4 rounded-xl bg-muted border border-border/50">
                                    <p className="text-xs font-medium text-muted-foreground mb-1">Username</p>
                                    <p className="text-sm font-semibold text-foreground">@{user?.username}</p>
                                </div>
                                <div className="p-4 rounded-xl bg-muted border border-border/50">
                                    <p className="text-xs font-medium text-muted-foreground mb-1">Role</p>
                                    <p className="text-sm font-semibold text-foreground capitalize">{user?.role || 'Employee'}</p>
                                </div>
                            </div>
                        </CardContent>
                    </Card>
                </div>
                )}

                {/* Nylas Integration Card */}
                <div className="mt-6">
                    <Card className={cn("border-0 shadow-sm bg-card rounded-2xl", isAdminProfileView && "border border-border")}>
                        <CardHeader>
                            <CardTitle className="text-lg flex items-center gap-2">
                                <div className="w-8 h-8 rounded-lg bg-emerald-50 flex items-center justify-center">
                                    <Mail className="w-4 h-4 text-emerald-600" />
                                </div>
                                Nylas Mailbox
                            </CardTitle>
                        </CardHeader>
                        <CardContent>
                            <div className={cn(
                                "flex flex-col md:flex-row items-center justify-between gap-6 p-6 rounded-2xl border",
                                isAdminProfileView ? "bg-emerald-50/40 border-emerald-100" : "bg-linear-to-br from-emerald-50 to-teal-50 border-emerald-100/50"
                            )}>
                                <div className="flex items-center gap-4">
                                    <div className={`w-12 h-12 rounded-2xl flex items-center justify-center shadow-sm ${nylasConnection.connected ? 'bg-green-100' : 'bg-amber-100'}`}>
                                        <Mail className={`w-6 h-6 ${nylasConnection.connected ? 'text-green-600' : 'text-amber-600'}`} />
                                    </div>
                                    <div>
                                        <h4 className="font-bold text-foreground">
                                            {nylasLoading ? 'Checking connection...' : nylasConnection.connected ? 'Connected' : 'Not Connected'}
                                        </h4>
                                        <p className="text-sm text-muted-foreground">
                                            {nylasConnection.connected
                                                ? `Connected mailbox: ${nylasConnection.email || 'Unknown'}${nylasConnection.provider ? ` (${nylasConnection.provider})` : ''}`
                                                : 'Connect your mailbox to send emails from your own account through Nylas.'}
                                        </p>
                                    </div>
                                </div>

                                <div className="w-full md:w-auto flex flex-col gap-2">
                                    {!nylasConnection.connected && (
                                        <div className="w-full md:w-56">
                                            <Label htmlFor="nylas-provider" className="mb-1 block text-xs font-medium text-muted-foreground">
                                                Choose Platform
                                            </Label>
                                            <select
                                                id="nylas-provider"
                                                value={selectedNylasProvider}
                                                onChange={(e) => setSelectedNylasProvider(e.target.value)}
                                                className="h-10 w-full rounded-xl border border-slate-300 bg-card px-3 text-sm text-foreground outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100"
                                            >
                                                {NYLAS_PROVIDER_OPTIONS.map((option) => (
                                                    <option key={option.value} value={option.value}>
                                                        {option.label}
                                                    </option>
                                                ))}
                                            </select>
                                        </div>
                                    )}

                                    <Button
                                        onClick={nylasConnection.connected ? handleDisconnectNylas : handleConnectNylas}
                                        disabled={nylasLoading || nylasConnecting || nylasDisconnecting}
                                        className={`h-11 px-8 rounded-xl font-bold transition shadow-md active:scale-95 ${
                                            nylasConnection.connected
                                                ? 'bg-card text-rose-700 border-2 border-rose-600 hover:bg-rose-50'
                                                : 'bg-emerald-600 text-white hover:bg-emerald-700'
                                        }`}
                                    >
                                        {nylasDisconnecting ? (
                                            <span className="flex items-center gap-2">
                                                <div className="w-4 h-4 border-2 border-rose-200 border-t-rose-600 rounded-full animate-spin" />
                                                Disconnecting...
                                            </span>
                                        ) : nylasConnecting ? (
                                            <span className="flex items-center gap-2">
                                                <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                                                Connecting...
                                            </span>
                                        ) : nylasConnection.connected ? (
                                            <>
                                                <X className="w-5 h-5 mr-2" />
                                                Disconnect
                                            </>
                                        ) : (
                                            <>
                                                <Mail className="w-5 h-5 mr-2" />
                                                Connect Nylas
                                            </>
                                        )}
                                    </Button>
                                </div>
                            </div>
                        </CardContent>
                    </Card>
                </div>

                {/* Telegram Integration Card */}
                <div className="mt-6">
                    <Card className={cn("border-0 shadow-sm bg-card rounded-2xl", isAdminProfileView && "border border-border")}>
                        <CardHeader>
                            <CardTitle className="text-lg flex items-center gap-2">
                                <div className="w-8 h-8 rounded-lg bg-blue-50 flex items-center justify-center">
                                    <Send className="w-4 h-4 text-blue-500" />
                                </div>
                                Telegram Integration
                            </CardTitle>
                        </CardHeader>
                        <CardContent>
                            <div className={cn(
                                "flex flex-col md:flex-row items-center justify-between gap-6 p-6 rounded-2xl border",
                                isAdminProfileView ? "bg-blue-50/40 border-blue-100" : "bg-linear-to-br from-blue-50 to-indigo-50 border-blue-100/50"
                            )}>
                                <div className="flex items-center gap-4">
                                    <div className={`w-12 h-12 rounded-2xl flex items-center justify-center shadow-sm ${user?.telegram_chat_id ? 'bg-green-100' : 'bg-blue-100'}`}>
                                        <Send className={`w-6 h-6 ${user?.telegram_chat_id ? 'text-green-600' : 'text-blue-600'}`} />
                                    </div>
                                    <div>
                                        <h4 className="font-bold text-foreground">
                                            {user?.telegram_chat_id ? 'Currently Connected' : 'Not Connected'}
                                        </h4>
                                        <p className="text-sm text-muted-foreground">
                                            {user?.telegram_chat_id 
                                                ? 'Your account is linked. You will receive notifications and can use commands via Telegram.' 
                                                : 'Connect your account to receive real-time notifications and manage attendance via Telegram.'}
                                        </p>
                                    </div>
                                </div>
                                
                                <Button
                                    onClick={async () => {
                                        try {
                                            const res = await api.get('/auth/telegram-token');
                                            const botUsername = (user as any)?.telegramBotUsername ; 
                                            window.open(`https://t.me/${botUsername}?start=${res.data.token}`, '_blank');
                                        } catch (err) {
                                            console.error('Failed to get TG linking token:', err);
                                            const botUsername = (user as any)?.telegramBotUsername ; 
                                            window.open(`https://t.me/${botUsername}?start=auth`, '_blank');
                                        }
                                    }}
                                    className={`h-11 px-8 rounded-xl font-bold transition shadow-md active:scale-95 ${
                                        user?.telegram_chat_id 
                                            ? 'bg-card text-green-600 border-2 border-green-500 hover:bg-green-50' 
                                            : 'bg-blue-500 text-white hover:bg-blue-600'
                                    }`}
                                >
                                    {user?.telegram_chat_id ? (
                                        <>
                                            <CheckCircle2 className="w-5 h-5 mr-2" />
                                            Re-Link Telegram
                                        </>
                                    ) : (
                                        <>
                                            <Send className="w-5 h-5 mr-2" />
                                            Connect Now
                                        </>
                                    )}
                                </Button>
                            </div>
                        </CardContent>
                    </Card>
                </div>
                </div>
            </main>
        </div>
    );
};

export default Profile;

