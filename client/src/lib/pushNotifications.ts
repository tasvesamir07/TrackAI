import api from '@/lib/api';

type BadgeNavigator = Navigator & {
    setAppBadge?: (count?: number) => Promise<void>;
    clearAppBadge?: () => Promise<void>;
};

const urlBase64ToUint8Array = (base64String: string): Uint8Array => {
    const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
    const normalized = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
    const rawData = atob(normalized);
    const outputArray = new Uint8Array(rawData.length);

    for (let i = 0; i < rawData.length; i += 1) {
        outputArray[i] = rawData.charCodeAt(i);
    }

    return outputArray;
};

const getPublicVapidKey = async (): Promise<string | null> => {
    const res = await api.get('/chat/push/public-key', {
        validateStatus: (status) => status === 200 || status === 204,
    });

    if (res.status !== 200) return null;
    const key = String(res.data?.publicKey || '').trim();
    return key || null;
};

const hasPushSupport = () => (
    typeof window !== 'undefined'
    && 'serviceWorker' in navigator
    && 'PushManager' in window
);

export const registerPushSubscription = async (): Promise<boolean> => {
    if (!hasPushSupport()) return false;
    if (!('Notification' in window) || Notification.permission !== 'granted') return false;

    const publicKey = await getPublicVapidKey();
    if (!publicKey) return false;

    const registration = await navigator.serviceWorker.ready;
    let subscription = await registration.pushManager.getSubscription();

    if (!subscription) {
        subscription = await registration.pushManager.subscribe({
            userVisibleOnly: true,
            applicationServerKey: urlBase64ToUint8Array(publicKey) as unknown as BufferSource,
        });
    }

    await api.post('/chat/push/subscribe', {
        subscription: subscription.toJSON(),
    });

    return true;
};

export const unregisterPushSubscription = async (): Promise<void> => {
    if (!hasPushSupport()) return;

    const registration = await navigator.serviceWorker.ready;
    const existing = await registration.pushManager.getSubscription();
    if (!existing) return;

    await api.post('/chat/push/unsubscribe', { endpoint: existing.endpoint }).catch(() => undefined);
    await existing.unsubscribe().catch(() => undefined);
};

export const syncAppIconBadge = async (count: number): Promise<void> => {
    if (typeof navigator === 'undefined') return;

    const badgeNavigator = navigator as BadgeNavigator;
    const safeCount = Number.isFinite(count) ? Math.max(0, Math.floor(count)) : 0;

    try {
        if (safeCount > 0) {
            if (typeof badgeNavigator.setAppBadge === 'function') {
                await badgeNavigator.setAppBadge(safeCount);
            }
            return;
        }

        if (typeof badgeNavigator.clearAppBadge === 'function') {
            await badgeNavigator.clearAppBadge();
            return;
        }

        if (typeof badgeNavigator.setAppBadge === 'function') {
            await badgeNavigator.setAppBadge(0);
        }
    } catch {
        // Badging is best-effort and unsupported on many browsers.
    }
};
