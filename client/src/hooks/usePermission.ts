import { useQuery } from '@tanstack/react-query';
import api from '@/lib/api';

interface Permission {
    [module: string]: {
        [action: string]: boolean;
    };
}

interface RolePermissions {
    role: string;
    permissions: Permission;
    companyId: string | null;
}

interface UsePermissionOptions {
    enabled?: boolean;
}

export function useRolePermissions(options?: UsePermissionOptions) {
    return useQuery<RolePermissions>({
        queryKey: ['my-permissions'],
        queryFn: async () => {
            const res = await api.get('/permissions/my-role');
            return res.data;
        },
        enabled: options?.enabled !== false,
        staleTime: 60 * 1000,
        refetchOnWindowFocus: false,
    });
}

export function useHasPermission(module: string, action: string, options?: UsePermissionOptions) {
    return useQuery<{ hasPermission: boolean }>({
        queryKey: ['permission-check', module, action],
        queryFn: async () => {
            const res = await api.get('/permissions/check', {
                params: { module, action },
            });
            return res.data;
        },
        enabled: options?.enabled !== false,
        staleTime: 30 * 1000,
        refetchOnWindowFocus: false,
    });
}

export function useCanAccess(module: string, actions: string[], requireAll: boolean = false) {
    const { data, isLoading } = useRolePermissions();

    if (isLoading || !data) {
        return { canAccess: false, isLoading: true };
    }

    const userPermissions = data.permissions || {};
    const modulePerms = userPermissions[module] || {};

    if (requireAll) {
        const canAccess = actions.every(action => modulePerms[action] === true);
        return { canAccess, isLoading: false };
    } else {
        const canAccess = actions.some(action => modulePerms[action] === true);
        return { canAccess, isLoading: false };
    }
}

export function hasPermission(permissions: Permission | null | undefined, module: string, action: string): boolean {
    if (!permissions) return false;
    return permissions[module]?.[action] === true;
}

export function hasAnyPermission(permissions: Permission | null | undefined, checks: Array<{ module: string; action: string }>): boolean {
    if (!permissions) return false;
    return checks.some(check => permissions[check.module]?.[check.action] === true);
}

export function hasAllPermissions(permissions: Permission | null | undefined, checks: Array<{ module: string; action: string }>): boolean {
    if (!permissions) return false;
    return checks.every(check => permissions[check.module]?.[check.action] === true);
}