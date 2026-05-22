/* eslint-disable react-refresh/only-export-components */
import React, { createContext, useContext, useEffect, useState } from "react";
import api from "@/lib/api";
import { unregisterPushSubscription } from "@/lib/pushNotifications";
import { getCachedSupabaseSession } from "@/lib/supabase";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { Toast } from "@/components/ui/Toast";
import { clickTracker } from "@/lib/clickTracker";
import type { User } from "@/types/auth";

interface AuthContextType {
    user: User | null;
    login: (credentials: Record<string, unknown>) => Promise<void>;
    googleLogin: (token: string, isAccessToken?: boolean) => Promise<void>;
    logout: () => Promise<void>;
    isLoading: boolean;
    refetchUser: () => Promise<unknown>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);
const FORCE_LOGOUT_FLAG = 'force_logged_out';
const LOCAL_STORAGE_PRESERVE_KEYS = new Set(['loadtest_history', 'theme', 'language']);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    const navigate = useNavigate();
    const queryClient = useQueryClient();
    const [authToast, setAuthToast] = useState<{ message: string; type: "warning" | "error" } | null>(null);
    const [sessionEpoch, setSessionEpoch] = useState(0);
    const hasAuthToken = typeof window !== 'undefined' && sessionEpoch >= 0;

    useEffect(() => {
        let cancelled = false;

        const checkSession = async () => {
            if (typeof window === 'undefined') return;
            if (cancelled) return;
            if (sessionStorage.getItem(FORCE_LOGOUT_FLAG) === '1') return;

            try {
                const res = await api.get('/auth/me', { timeout: 3000 });
                if (res.data?.user && !cancelled) {
                    setSessionEpoch((value) => value + 1);
                }
            } catch {
                // No active session
            }
        };

        void checkSession();
        return () => {
            cancelled = true;
        };
    }, []);

    const clearClientSideSession = () => {
        const preservedEntries: Array<[string, string]> = [];
        for (let i = 0; i < localStorage.length; i++) {
            const key = localStorage.key(i);
            if (!key || !LOCAL_STORAGE_PRESERVE_KEYS.has(key)) continue;
            const value = localStorage.getItem(key);
            if (value != null) preservedEntries.push([key, value]);
        }

        localStorage.clear();
        for (const [key, value] of preservedEntries) {
            localStorage.setItem(key, value);
        }

        sessionStorage.clear();

        if (typeof window !== 'undefined' && 'caches' in window) {
            // Keep logout/login snappy: cache cleanup is best-effort in background.
            void window.caches.keys()
                .then((cacheKeys) => Promise.all(cacheKeys.map((key) => window.caches.delete(key))))
                .catch(() => undefined);
        }
    };

    const { data: user, isLoading, refetch } = useQuery({
        queryKey: ["me"],
        queryFn: async () => {
            try {
                const res = await api.get("/auth/me", { timeout: 5000 });
                if (res.data.user) {
                    const userId = String(res.data.user.id || '');
                    if (userId) {
                        clickTracker.init(userId);
                    }
                    return {
                        ...res.data.user,
                        hoursWorkedToday: res.data.hoursWorked,
                        currentSessionHours: res.data.currentSessionHours,
                        sessionStartTime: res.data.sessionStartTime,
                        telegramBotUsername: res.data.telegramBotUsername
                    } as User;
                }
                return null;
            } catch (err: unknown) {
                const error = err as { response?: { status?: number } };
                const status = Number(error?.response?.status || 0);
                if (status === 401 || status === 403) {
                    return null;
                }
                throw err;
            }
        },
        retry: 2,
        retryDelay: (attempt) => Math.min(500 * (attempt + 1), 2000),
        enabled: hasAuthToken,
    });

    const login = async (credentials: Record<string, unknown>) => {
        const res = await api.post("/auth/login", credentials);
        await establishSession(res.data);
    };

    const googleLogin = async (token: string, isAccessToken: boolean = false) => {
        const payload = isAccessToken ? { accessToken: token } : { idToken: token };
        const res = await api.post("/auth/google-login", payload);
        await establishSession(res.data);
    };

    const establishSession = async (data: { token?: string; role?: string }) => {
        clearClientSideSession();
        sessionStorage.removeItem(FORCE_LOGOUT_FLAG);

        setSessionEpoch((value) => value + 1);

        if (data.role) {
            // Prevent previous user's cached queries from leaking into this session.
            queryClient.clear();

            // Force immediate refetch with one retry to survive slow cold starts.
            let userData: User | null = null;
            const firstTry = await refetch();
            userData = (firstTry.data as User | null) || null;

            if (!userData) {
                await new Promise((resolve) => setTimeout(resolve, 400));
                const secondTry = await refetch();
                userData = (secondTry.data as User | null) || null;
            }

            if (userData) {
                const userId = String(userData.id || '');
                if (userId) {
                    clickTracker.init(userId);
                }
                // Manually set query data to ensure immediate UI update before navigation
                queryClient.setQueryData(["me"], userData);
            } else {
                // Do not block login on a transient /auth/me fetch failure.
                console.warn('[Auth] Login succeeded, but /auth/me did not return user immediately.');
            }

            // Navigate to appropriate dashboard based on role
            if (data.role === 'SUPERADMIN') {
                navigate('/superadmin', { replace: true });
            } else if (data.role === 'COMPANY_ADMIN') {
                navigate('/admin', { replace: true });
            } else if (data.role === 'admin') {
                navigate('/admin', { replace: true });
            } else if (data.role === 'moderator') {
                navigate('/project-manager', { replace: true });
            } else {
                navigate('/dashboard', { replace: true });
            }
        }
    };

    const logout = async () => {
        sessionStorage.setItem(FORCE_LOGOUT_FLAG, '1');
        // Never block logout on service worker/push teardown.
        void unregisterPushSubscription().catch(() => undefined);
        const currentRole = String(user?.role || '');
        const isWorkTrackedRole = currentRole === 'employee' || currentRole === 'EMPLOYEE';

        // Non-work-tracked roles (including SUPERADMIN): clear local session immediately.
        if (!isWorkTrackedRole) {
            clickTracker.destroy();
            try {
                await api.post("/auth/logout", undefined, { timeout: 5000 });
            } catch {
                // Best-effort cookie clear; still force local logout below.
            }
            clearClientSideSession();
            sessionStorage.setItem(FORCE_LOGOUT_FLAG, '1');
            setSessionEpoch((value) => value + 1);
            queryClient.setQueryData(["me"], null);
            queryClient.clear();
            navigate('/login', { replace: true });
            return;
        }

        let shouldAbortLogout = false;
        try {
            await api.post("/auth/logout", undefined, { timeout: 5000 });
        } catch (err: unknown) {
            const error = err as { response?: { data?: { error?: string, requiresSignOut?: boolean }; status?: number } };
            const message = error?.response?.data?.error || 'Logout failed';
            if (error?.response?.status === 409 && error?.response?.data?.requiresSignOut) {
                setAuthToast({ message, type: "warning" });
                shouldAbortLogout = true;
            } else {
                setAuthToast({ message, type: "error" });
            }
        }

        if (shouldAbortLogout) return;

        clearClientSideSession();
        sessionStorage.setItem(FORCE_LOGOUT_FLAG, '1');
        clickTracker.destroy();
        setSessionEpoch((value) => value + 1);
        queryClient.setQueryData(["me"], null);
        queryClient.clear();
        navigate('/login', { replace: true });
    };

    return (
        <>
            <AuthContext.Provider value={{ user: user || null, login, googleLogin, logout, isLoading: hasAuthToken ? isLoading : false, refetchUser: refetch }}>
                {children}
            </AuthContext.Provider>
            {authToast && (
                <Toast
                    message={authToast.message}
                    type={authToast.type}
                    onClose={() => setAuthToast(null)}
                />
            )}
        </>
    );
};

export const useAuth = () => {
    const context = useContext(AuthContext);
    if (!context) throw new Error("useAuth must be used within an AuthProvider");
    return context;
};
