import { openDB } from 'idb';

const DB_NAME = 'track-ai-offline-db';
const STORE_NAME = 'offline_checkins';

export const initDB = async () => {
    return openDB(DB_NAME, 1, {
        upgrade(db) {
            if (!db.objectStoreNames.contains(STORE_NAME)) {
                db.createObjectStore(STORE_NAME, { keyPath: 'id', autoIncrement: true });
            }
        },
    });
};

export const saveOfflineCheckin = async (data: Record<string, unknown>) => {
    const db = await initDB();
    await db.add(STORE_NAME, {
        ...data,
        timestamp: Date.now()
    });
};

export const getOfflineCheckins = async () => {
    const db = await initDB();
    return db.getAll(STORE_NAME);
};

export const clearOfflineCheckins = async () => {
    const db = await initDB();
    return db.clear(STORE_NAME);
};
