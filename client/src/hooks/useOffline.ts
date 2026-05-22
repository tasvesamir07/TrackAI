import { useState, useEffect, useCallback } from 'react';
import { 
  isOnline, 
  setupOfflineListeners,
  checkAndSync,
  queueClockIn,
  queueClockOut,
  getPendingActions
} from '@/lib/offlineManager';

export function useOfflineSupport() {
  const [online, setOnline] = useState(true);
  const [pendingCount, setPendingCount] = useState(0);
  const [syncing, setSyncing] = useState(false);

  useEffect(() => {
    setOnline(isOnline());
    
    const cleanup = setupOfflineListeners((status) => {
      setOnline(status);
      if (status) {
        handleSync();
      }
    });

    return cleanup;
  }, []);

  const updatePendingCount = useCallback(async () => {
    const pending = await getPendingActions();
    setPendingCount(pending.length);
  }, []);

  useEffect(() => {
    updatePendingCount();
  }, [updatePendingCount]);

  const handleSync = useCallback(async () => {
    if (!online || syncing) return;
    
    setSyncing(true);
    try {
      const results = await checkAndSync();
      if (results) {
        console.log('[Offline] Sync results:', results);
      }
    } catch (error) {
      console.error('[Offline] Sync failed:', error);
    } finally {
      setSyncing(false);
      await updatePendingCount();
    }
  }, [online, syncing, updatePendingCount]);

  const clockInOffline = useCallback(async (userId: number | string) => {
    await queueClockIn(userId);
    await updatePendingCount();
    
    if (online) {
      await handleSync();
    }
  }, [online, handleSync, updatePendingCount]);

  const clockOutOffline = useCallback(async (userId: number | string) => {
    await queueClockOut(userId);
    await updatePendingCount();
    
    if (online) {
      await handleSync();
    }
  }, [online, handleSync, updatePendingCount]);

  return {
    online,
    pendingCount,
    syncing,
    sync: handleSync,
    clockInOffline,
    clockOutOffline
  };
}

export function useOfflineIndicator() {
  const { online, pendingCount } = useOfflineSupport();
  
  if (online && pendingCount === 0) return null;
  
  return {
    isOffline: !online,
    hasPendingActions: pendingCount > 0,
    pendingCount
  };
}