import { useState, useEffect, useCallback } from 'react';
import { openDB } from 'idb';

const DB_NAME = 'track-ai-offline';
const STORE_NAME = 'pending-actions';

const getDB = async () => {
  return openDB(DB_NAME, 1, {
    upgrade(db) {
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, { 
          keyPath: 'id', 
          autoIncrement: true 
        });
        store.createIndex('type', 'type');
        store.createIndex('status', 'status');
        store.createIndex('createdAt', 'createdAt');
      }
    },
  });
};

export const savePendingAction = async (action: Record<string, any>) => {
  const db = await getDB();
  const pendingAction = {
    ...action,
    status: 'pending',
    createdAt: new Date().toISOString(),
    retryCount: 0
  };
  return db.add(STORE_NAME, pendingAction);
};

export const getPendingActions = async () => {
  const db = await getDB();
  return db.getAll(STORE_NAME);
};

export const getPendingActionsByType = async (type: string) => {
  const db = await getDB();
  const index = db.transaction(STORE_NAME).store.index('type');
  return index.getAll(type);
};

export const deletePendingAction = async (id: number) => {
  const db = await getDB();
  return db.delete(STORE_NAME, id);
};

export const updatePendingAction = async (id: number, updates: Record<string, any>) => {
  const db = await getDB();
  const action = await db.get(STORE_NAME, id);
  if (action) {
    return db.put(STORE_NAME, { ...action, ...updates });
  }
};

export const syncPendingActions = async () => {
  const pendingActions = await getPendingActions();
  const results = { success: 0, failed: 0 };

  for (const action of pendingActions) {
    try {
      const response = await fetch(action.endpoint, {
        method: action.method,
        headers: {
          'Content-Type': 'application/json',
          ...action.headers
        },
        body: action.body ? JSON.stringify(action.body) : undefined
      });

      if (response.ok) {
        await deletePendingAction(action.id);
        results.success++;
      } else {
        await updatePendingAction(action.id, {
          retryCount: action.retryCount + 1,
          lastError: `HTTP ${response.status}`
        });
        results.failed++;
      }
    } catch (error: any) {
      await updatePendingAction(action.id, {
        retryCount: action.retryCount + 1,
        lastError: error.message
      });
      results.failed++;
    }
  }

  return results;
};

export const queueClockIn = async (userId: number | string, timestamp = new Date()) => {
  return savePendingAction({
    type: 'clock_in',
    method: 'POST',
    endpoint: '/api/attendance/clock-in',
    body: { userId, timestamp: timestamp.toISOString() },
    headers: {}
  });
};

export const queueClockOut = async (userId: number | string, timestamp = new Date()) => {
  return savePendingAction({
    type: 'clock_out',
    method: 'POST',
    endpoint: '/api/attendance/clock-out',
    body: { userId, timestamp: timestamp.toISOString() },
    headers: {}
  });
};

export const queueLeaveRequest = async (userId: number | string, leaveData: Record<string, any>) => {
  return savePendingAction({
    type: 'leave_request',
    method: 'POST',
    endpoint: '/api/leaves',
    body: leaveData,
    headers: {}
  });
};

export const isOnline = () => {
  return navigator.onLine;
};

export const setupOfflineListeners = (onStatusChange: (online: boolean) => void) => {
  const handleOnline = () => onStatusChange(true);
  const handleOffline = () => onStatusChange(false);

  window.addEventListener('online', handleOnline);
  window.addEventListener('offline', handleOffline);

  return () => {
    window.removeEventListener('online', handleOnline);
    window.removeEventListener('offline', handleOffline);
  };
};

export const checkAndSync = async () => {
  if (!isOnline()) return null;
  
  const pending = await getPendingActions();
  if (pending.length === 0) return null;
  
  return syncPendingActions();
};

export function useOfflineActions() {
  const [pending, setPending] = useState(false);
  const [pendingCount, setPendingCount] = useState(0);

  const updateCount = useCallback(async () => {
    const actions = await getPendingActions();
    setPendingCount(actions.length);
    setPending(actions.length > 0);
  }, []);

  useEffect(() => {
    updateCount();
    const interval = setInterval(updateCount, 30000);
    return () => clearInterval(interval);
  }, [updateCount]);

  const queueAction = useCallback(async (type: string, data?: Record<string, any>) => {
    await savePendingAction({ type, ...data });
    await updateCount();
  }, [updateCount]);

  const syncNow = useCallback(async () => {
    await checkAndSync();
    await updateCount();
  }, [updateCount]);

  return { pending, queueAction, syncNow, pendingCount };
}

if (typeof window !== 'undefined' && 'serviceWorker' in navigator) {
  window.addEventListener('online', () => {
    console.log('[Offline] Back online, syncing...');
    checkAndSync();
  });
}