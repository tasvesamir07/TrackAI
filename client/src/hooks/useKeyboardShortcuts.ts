import { useEffect, useCallback, useState } from 'react';
import { useNavigate } from 'react-router-dom';

export interface KeyboardShortcut {
  key: string;
  description: string;
  action: () => void;
  category?: 'navigation' | 'search' | 'global' | 'custom';
  modifier?: 'ctrl' | 'meta' | 'shift' | 'alt';
}

const defaultShortcuts: KeyboardShortcut[] = [
  {
    key: 'k',
    description: 'Open search',
    action: () => {},
    category: 'search',
    modifier: 'ctrl',
  },
  {
    key: '?',
    description: 'Show keyboard shortcuts',
    action: () => {},
    category: 'global',
  },
  {
    key: 'Escape',
    description: 'Close modal/dialog',
    action: () => {},
    category: 'global',
  },
  {
    key: '\\',
    description: 'Toggle sidebar',
    action: () => {},
    category: 'navigation',
    modifier: 'ctrl',
  },
  {
    key: 'g',
    description: 'Go to Dashboard',
    action: () => {},
    category: 'navigation',
    modifier: 'ctrl',
  },
  {
    key: 'p',
    description: 'Go to Projects',
    action: () => {},
    category: 'navigation',
    modifier: 'ctrl',
  },
];

export function useKeyboardShortcuts(shortcuts: KeyboardShortcut[] = [], enabled = true) {
  const [showHelp, setShowHelp] = useState(false);
  const [keySequence, setKeySequence] = useState<string[]>([]);
  const navigate = useNavigate();

  const allShortcuts = [...defaultShortcuts, ...shortcuts].map(s => ({
    ...s,
    action: s.key === '?' ? () => setShowHelp(true) : s.action,
  }));

  const handleKeyDown = useCallback((event: KeyboardEvent) => {
    if (!enabled) return;

    const key = event.key.toLowerCase();
    const modifier = event.ctrlKey || event.metaKey ? 'ctrl' : 
                    event.shiftKey ? 'shift' : 
                    event.altKey ? 'alt' : undefined;

    if (keySequence.length > 0) {
      const sequence = [...keySequence, key].join('');
      const sequenceShortcut = allShortcuts.find(s => 
        s.key === sequence && s.modifier === 'ctrl'
      );
      
      if (sequenceShortcut) {
        event.preventDefault();
        sequenceShortcut.action();
        setKeySequence([]);
        return;
      }

      if (keySequence.length >= 2 || (key !== 'g' && key !== 'p')) {
        setKeySequence([]);
      }
    }

    if (key === 'g' && modifier === 'ctrl') {
      event.preventDefault();
      setKeySequence(['g']);
      return;
    }

    const matchingShortcut = allShortcuts.find(s => {
      if (s.key !== key) return false;
      if (s.modifier === 'ctrl' && !event.ctrlKey && !event.metaKey) return false;
      if (s.modifier === 'shift' && !event.shiftKey) return false;
      if (s.modifier === 'alt' && !event.altKey) return false;
      if (!s.modifier && (event.ctrlKey || event.metaKey || event.shiftKey || event.altKey)) return false;
      return true;
    });

    if (matchingShortcut) {
      event.preventDefault();
      matchingShortcut.action();
    }
  }, [enabled, keySequence, allShortcuts]);

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);

  const registerShortcut = useCallback((shortcut: KeyboardShortcut) => {
    allShortcuts.push(shortcut);
  }, []);

  return {
    showHelp,
    setShowHelp,
    shortcuts: allShortcuts,
    registerShortcut,
    keySequence,
  };
}

export function getNavigationShortcut(role?: string): KeyboardShortcut[] {
  const basePath = role === 'employee' ? '/dashboard' : 
                   role === 'moderator' ? '/project-manager' : 
                   role === 'SUPERADMIN' ? '/superadmin' : '/admin';

  return [
    {
      key: 'd',
      description: 'Go to Dashboard',
      action: () => window.location.href = basePath,
      category: 'navigation',
      modifier: 'ctrl',
    },
    {
      key: 'p',
      description: 'Go to Projects',
      action: () => window.location.href = '/projects',
      category: 'navigation',
      modifier: 'ctrl',
    },
    {
      key: 's',
      description: 'Go to Settings',
      action: () => window.location.href = '/settings',
      category: 'navigation',
      modifier: 'ctrl',
    },
    {
      key: 'm',
      description: 'Go to Messages',
      action: () => {
        const chatPath = role === 'employee' ? '/dashboard?tab=chat' : 
                         role === 'moderator' ? '/project-manager?tab=chat' : 
                         role === 'SUPERADMIN' ? '/superadmin' : '/admin?tab=chat';
        window.location.href = chatPath;
      },
      category: 'navigation',
      modifier: 'ctrl',
    },
  ];
}