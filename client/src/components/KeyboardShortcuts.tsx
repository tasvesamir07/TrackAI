import { X, Command, Hash, ArrowRight, Search, Keyboard as KeyboardIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/context/AuthContext';

interface KeyboardShortcutsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

interface ShortcutGroup {
  title: string;
  shortcuts: { key: string; description: string; modifier?: string }[];
}

export function KeyboardShortcutsModal({ isOpen, onClose }: KeyboardShortcutsModalProps) {
  const { user } = useAuth();
  
  if (!isOpen) return null;

  const groups: ShortcutGroup[] = [
    {
      title: 'Search',
      shortcuts: [
        { key: 'Ctrl + K', description: 'Open global search' },
        { key: 'Ctrl + Shift + K', description: 'Search with AI (if enabled)' },
      ],
    },
    {
      title: 'Navigation',
      shortcuts: [
        { key: 'Ctrl + D', description: 'Go to Dashboard' },
        { key: 'Ctrl + P', description: 'Go to Projects' },
        { key: 'Ctrl + S', description: 'Go to Settings' },
        { key: 'Ctrl + M', description: 'Go to Messages' },
        { key: 'Ctrl + \\', description: 'Toggle sidebar' },
      ],
    },
    {
      title: 'Global',
      shortcuts: [
        { key: '?', description: 'Show keyboard shortcuts' },
        { key: 'Esc', description: 'Close modal or dialog' },
        { key: 'Tab', description: 'Navigate between fields' },
        { key: 'Enter', description: 'Submit form or confirm action' },
      ],
    },
    {
      title: 'Text Editing',
      shortcuts: [
        { key: 'Ctrl + C', description: 'Copy' },
        { key: 'Ctrl + V', description: 'Paste' },
        { key: 'Ctrl + Z', description: 'Undo' },
        { key: 'Ctrl + Shift + Z', description: 'Redo' },
      ],
    },
  ];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="fixed inset-0 bg-background/80 backdrop-blur-sm" onClick={onClose} />
      <div className="relative z-50 w-full max-w-2xl bg-background rounded-xl border shadow-2xl overflow-hidden animate-in">
        <div className="flex items-center justify-between border-b px-6 py-4">
          <div className="flex items-center gap-3">
            <KeyboardIcon className="w-5 h-5 text-primary" />
            <h2 className="text-lg font-semibold">Keyboard Shortcuts</h2>
          </div>
          <Button variant="ghost" size="icon" onClick={onClose}>
            <X className="w-4 h-4" />
          </Button>
        </div>
        
        <div className="p-6 grid grid-cols-1 md:grid-cols-2 gap-6 max-h-[60vh] overflow-y-auto">
          {groups.map((group) => (
            <div key={group.title}>
              <h3 className="text-sm font-medium text-muted-foreground mb-3">{group.title}</h3>
              <div className="space-y-2">
                {group.shortcuts.map((shortcut, index) => (
                  <div
                    key={index}
                    className="flex items-center justify-between py-1.5 px-2 rounded-md hover:bg-accent/50"
                  >
                    <span className="text-sm">{shortcut.description}</span>
                    <kbd className="pointer-events-none inline-flex h-6 select-none items-center gap-1 rounded-md border bg-muted px-2 font-mono text-xs font-medium text-muted-foreground">
                      {shortcut.key.split(' + ').map((key, i) => (
                        <span key={i}>
                          {i > 0 && <span className="text-muted-foreground/50 mx-0.5">+</span>}
                          {key.includes('Ctrl') && <Command className="w-3 h-3" />}
                          {key.includes('Shift') && <ArrowRight className="w-3 h-3" />}
                          {!key.includes('Ctrl') && !key.includes('Shift') && !key.includes('Alt') && (
                            <span className="uppercase">{key}</span>
                          )}
                        </span>
                      ))}
                    </kbd>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>

        <div className="border-t px-6 py-4 bg-muted/30">
          <p className="text-xs text-muted-foreground text-center">
            Press <kbd className="px-1.5 py-0.5 rounded bg-background border text-[10px]">?</kbd> anytime to show this dialog
          </p>
        </div>
      </div>
    </div>
  );
}