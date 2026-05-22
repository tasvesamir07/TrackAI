export function isGroupConversationId(value: number | string) {
    return typeof value === 'string' && value.startsWith('group-');
}

export function getGroupIdFromConversationId(value: number | string) {
    if (typeof value !== 'string' || !value.startsWith('group-')) return null;
    const parsed = Number.parseInt(value.replace('group-', ''), 10);
    return Number.isInteger(parsed) ? parsed : null;
}

export function getConversationRoomId(value: number | string, currentUserId?: number) {
    const groupId = getGroupIdFromConversationId(value);
    if (groupId) return `chat:group:${groupId}`;
    if (value === 'team') return 'chat:team';
    if (typeof value === 'number' && Number.isInteger(value) && Number.isInteger(currentUserId)) {
        const [a, b] = [value, Number(currentUserId)].sort((x, y) => x - y);
        return `chat:dm:${a}:${b}`;
    }
    return null;
}
