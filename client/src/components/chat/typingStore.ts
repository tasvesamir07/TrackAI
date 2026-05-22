import { useSyncExternalStore } from 'react';

type Listener = () => void;
type TypingMap = Map<string, Set<number>>;

class TypingStore {
    private listeners = new Set<Listener>();
    private map: TypingMap = new Map();

    subscribe = (listener: Listener) => {
        this.listeners.add(listener);
        return () => {
            this.listeners.delete(listener);
        };
    };

    getSnapshot = () => this.map;

    setTyping(conversationId: string, userId: number, isTyping: boolean) {
        const key = String(conversationId || '').trim();
        if (!key) return;

        const nextMap = new Map(this.map);
        const currentUsers = new Set(nextMap.get(key) || []);

        if (isTyping) {
            currentUsers.add(userId);
        } else {
            currentUsers.delete(userId);
        }

        if (currentUsers.size > 0) {
            nextMap.set(key, currentUsers);
        } else {
            nextMap.delete(key);
        }

        this.map = nextMap;
        this.emit();
    }

    clearConversation(conversationId: string) {
        const key = String(conversationId || '').trim();
        if (!key || !this.map.has(key)) return;
        const nextMap = new Map(this.map);
        nextMap.delete(key);
        this.map = nextMap;
        this.emit();
    }

    clearAll() {
        if (this.map.size === 0) return;
        this.map = new Map();
        this.emit();
    }

    private emit() {
        this.listeners.forEach((listener) => {
            try {
                listener();
            } catch {
                // Prevent one subscriber failure from breaking others
            }
        });
    }
}

export const typingStore = new TypingStore();

export const setTypingUser = (conversationId: string, userId: number, isTyping: boolean) => {
    typingStore.setTyping(conversationId, userId, isTyping);
};

export const clearTypingContext = (conversationId: string) => {
    typingStore.clearConversation(conversationId);
};

export const clearAllTyping = () => {
    typingStore.clearAll();
};

export const useTypingUsers = (conversationId: string) => {
    const snapshot = useSyncExternalStore(typingStore.subscribe, typingStore.getSnapshot, typingStore.getSnapshot);
    return snapshot.get(String(conversationId || '').trim()) || new Set<number>();
};
