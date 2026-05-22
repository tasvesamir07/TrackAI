import { useState, useEffect, useCallback, useRef } from 'react';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Search, X, Users, FileText, Calendar, Clock, Settings, Home, MessageSquare } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { cn } from '@/lib/utils';
import { useAuth } from '@/context/AuthContext';

interface SearchResult {
  id: string;
  type: 'user' | 'task' | 'project' | 'leave' | 'page' | 'message';
  title: string;
  subtitle?: string;
  icon: React.ReactNode;
  url: string;
}

const mockResults: SearchResult[] = [
  { id: '1', type: 'page', title: 'Dashboard', subtitle: 'Main dashboard', icon: <Home className="w-4 h-4" />, url: '/dashboard' },
  { id: '2', type: 'page', title: 'Employees', subtitle: 'Manage employees', icon: <Users className="w-4 h-4" />, url: '/employees' },
  { id: '3', type: 'page', title: 'Projects', subtitle: 'View projects', icon: <FileText className="w-4 h-4" />, url: '/projects' },
  { id: '4', type: 'page', title: 'Leave Requests', subtitle: 'Leave management', icon: <Calendar className="w-4 h-4" />, url: '/leaves' },
  { id: '5', type: 'page', title: 'Time Logs', subtitle: 'Check in/out', icon: <Clock className="w-4 h-4" />, url: '/timelog' },
  { id: '6', type: 'page', title: 'Settings', subtitle: 'App settings', icon: <Settings className="w-4 h-4" />, url: '/settings' },
  { id: '7', type: 'page', title: 'Messages', subtitle: 'Chat with team', icon: <MessageSquare className="w-4 h-4" />, url: '/messages' },
];

const typeLabels = {
  user: 'Employee',
  task: 'Task',
  project: 'Project',
  leave: 'Leave',
  page: 'Page',
  message: 'Message'
};

const typeColors = {
  user: 'bg-blue-100 text-blue-700',
  task: 'bg-green-100 text-green-700',
  project: 'bg-purple-100 text-purple-700',
  leave: 'bg-yellow-100 text-yellow-700',
  page: 'bg-gray-100 text-gray-700',
  message: 'bg-pink-100 text-pink-700'
};

export function CommandK() {
  const { user } = useAuth();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const navigate = useNavigate();
  const inputRef = useRef<HTMLInputElement>(null);

  const results = query.length > 0 
    ? mockResults.filter(r => 
        r.title.toLowerCase().includes(query.toLowerCase()) ||
        r.subtitle?.toLowerCase().includes(query.toLowerCase())
      )
    : mockResults;

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        setOpen(true);
      }
      if (e.key === 'Escape') {
        setOpen(false);
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, []);

  useEffect(() => {
    setSelectedIndex(0);
  }, [query]);

  const handleSelect = useCallback((result: SearchResult) => {
    setOpen(false);
    setQuery('');
    
    let targetUrl = result.url;
    if (result.url === '/messages') {
      const role = user?.role;
      targetUrl = role === 'employee' ? '/dashboard?tab=chat' :
                  role === 'moderator' ? '/project-manager?tab=chat' :
                  role === 'SUPERADMIN' ? '/superadmin' : '/admin?tab=chat';
    } else if (result.url === '/employees') {
      const role = user?.role;
      targetUrl = role === 'employee' ? '/dashboard?tab=team' :
                  role === 'SUPERADMIN' ? '/superadmin' : '/admin?tab=users';
    }
    
    navigate(targetUrl);
  }, [navigate, user]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIndex(prev => (prev + 1) % results.length);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIndex(prev => (prev - 1 + results.length) % results.length);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (results[selectedIndex]) {
        handleSelect(results[selectedIndex]);
      }
    }
  }, [results, selectedIndex, handleSelect]);

  useEffect(() => {
    if (open) {
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  }, [open]);

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="flex items-center gap-2 px-3 py-1.5 text-sm text-muted-foreground bg-muted/50 rounded-md border hover:bg-muted transition-colors"
      >
        <Search className="w-4 h-4" />
        <span className="hidden sm:inline">Search...</span>
        <kbd className="hidden sm:inline-flex h-5 items-center gap-1 rounded border bg-muted px-1.5 font-mono text-xs text-muted-foreground">
          <span className="text-xs">⌘</span>K
        </kbd>
      </button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="p-0 gap-0 max-w-xl overflow-hidden">
          <div className="flex items-center border-b px-3 gap-2">
            <Search className="w-4 h-4 text-muted-foreground shrink-0" />
            <input
              ref={inputRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Search anything..."
              className="flex h-11 w-full rounded-md bg-transparent py-3 text-sm outline-none placeholder:text-muted-foreground disabled:cursor-not-allowed disabled:opacity-50"
            />
            {query && (
              <button onClick={() => setQuery('')}>
                <X className="w-4 h-4 text-muted-foreground hover:text-foreground" />
              </button>
            )}
          </div>

          <div className="max-h-[400px] overflow-y-auto p-1">
            {results.length === 0 ? (
              <div className="py-12 text-center text-muted-foreground">
                <Search className="w-8 h-8 mx-auto mb-2 opacity-50" />
                <p>No results found</p>
              </div>
            ) : (
              <div className="space-y-0.5">
                {results.map((result, index) => (
                  <button
                    key={result.id}
                    onClick={() => handleSelect(result)}
                    className={cn(
                      "w-full flex items-center gap-3 px-3 py-2 rounded-md text-left transition-colors",
                      index === selectedIndex ? "bg-muted" : "hover:bg-muted/50"
                    )}
                  >
                    <div className="w-8 h-8 rounded-md bg-muted flex items-center justify-center text-muted-foreground shrink-0">
                      {result.icon}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">{result.title}</p>
                      {result.subtitle && (
                        <p className="text-xs text-muted-foreground truncate">{result.subtitle}</p>
                      )}
                    </div>
                    <span className={cn("text-xs px-2 py-0.5 rounded-full shrink-0", typeColors[result.type])}>
                      {typeLabels[result.type]}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="flex items-center justify-between px-3 py-2 border-t text-xs text-muted-foreground">
            <div className="flex items-center gap-2">
              <kbd className="px-1.5 py-0.5 rounded bg-muted border">↑↓</kbd>
              <span>Navigate</span>
            </div>
            <div className="flex items-center gap-2">
              <kbd className="px-1.5 py-0.5 rounded bg-muted border">↵</kbd>
              <span>Select</span>
            </div>
            <div className="flex items-center gap-2">
              <kbd className="px-1.5 py-0.5 rounded bg-muted border">esc</kbd>
              <span>Close</span>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}