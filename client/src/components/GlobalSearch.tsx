import { useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useSearch, SearchResult } from '@/hooks/useSearch';
import { Search, User, FolderKanban, CheckSquare, Calendar, X, Command } from 'lucide-react';
import { Button } from '@/components/ui/button';

const resultTypeIcons: Record<string, React.ReactNode> = {
  employee: <User className="w-4 h-4" />,
  project: <FolderKanban className="w-4 h-4" />,
  task: <CheckSquare className="w-4 h-4" />,
  leave: <Calendar className="w-4 h-4" />,
};

const resultTypeLabels: Record<string, string> = {
  employee: 'Employee',
  project: 'Project',
  task: 'Task',
  leave: 'Leave',
};

function ResultGroup({ title, results, onSelect }: { title: string; results: SearchResult[]; onSelect: (result: SearchResult) => void }) {
  if (results.length === 0) return null;
  return (
    <div className="mb-3">
      <div className="text-xs font-medium text-muted-foreground px-3 py-1.5 uppercase tracking-wide">{title}</div>
      {results.map((result) => (
        <button
          key={`${result.type}-${result.id}`}
          className="w-full flex items-center gap-3 px-3 py-2.5 text-left hover:bg-accent/50 transition-colors"
          onClick={() => onSelect(result)}
        >
          <span className="flex-shrink-0 w-7 h-7 rounded-md bg-primary/10 text-primary flex items-center justify-center">
            {resultTypeIcons[result.type]}
          </span>
          <div className="flex-1 min-w-0">
            <div className="text-sm font-medium truncate">{result.title}</div>
            <div className="text-xs text-muted-foreground truncate">{result.subtitle}</div>
          </div>
          <span className="text-xs text-muted-foreground px-1.5 py-0.5 rounded bg-muted">{resultTypeLabels[result.type]}</span>
        </button>
      ))}
    </div>
  );
}

export function GlobalSearch() {
  const navigate = useNavigate();
  const {
    query,
    setQuery,
    results,
    employees,
    projects,
    tasks,
    leaves,
    isLoading,
    isOpen,
    openSearch,
    closeSearch,
    selectedIndex,
    setSelectedIndex,
    moveSelection,
    getSelectedResult,
    inputRef,
  } = useSearch();

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        if (isOpen) {
          closeSearch();
        } else {
          openSearch();
        }
      }
      if (!isOpen) return;
      if (e.key === 'Escape') {
        e.preventDefault();
        closeSearch();
      }
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        moveSelection('down');
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        moveSelection('up');
      }
      if (e.key === 'Enter') {
        e.preventDefault();
        const selected = getSelectedResult();
        if (selected) {
          navigate(selected.url);
          closeSearch();
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, openSearch, closeSearch, moveSelection, getSelectedResult, navigate]);

  const handleSelect = useCallback((result: SearchResult) => {
    navigate(result.url);
    closeSearch();
  }, [navigate, closeSearch]);

  useEffect(() => {
    const groupCounts = [employees.length, projects.length, tasks.length, leaves.length];
    let runningTotal = 0;
    for (let i = 0; i < groupCounts.length; i++) {
      if (selectedIndex < runningTotal + groupCounts[i]) {
        return;
      }
      runningTotal += groupCounts[i];
    }
  }, [selectedIndex, employees, projects, tasks, leaves]);

  if (!isOpen) {
    return (
      <Button
        variant="outline"
        className="relative h-9 w-64 justify-between text-muted-foreground hover:text-foreground cursor-pointer"
        onClick={openSearch}
      >
        <div className="flex items-center gap-2">
          <Search className="w-4 h-4" />
          <span className="text-sm">Search...</span>
        </div>
        <kbd className="pointer-events-none inline-flex h-5 select-none items-center gap-1 rounded border bg-muted px-1.5 font-mono text-[10px] font-medium text-muted-foreground">
          <span className="text-xs">⌘</span>K
        </kbd>
      </Button>
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-[15vh]">
      <div className="fixed inset-0 bg-background/80 backdrop-blur-sm" onClick={closeSearch} />
      <div className="relative w-full max-w-lg bg-background rounded-xl border shadow-2xl overflow-hidden animate-in">
        <div className="flex items-center border-b px-3">
          <Search className="w-5 h-5 text-muted-foreground mr-2" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search employees, projects, tasks..."
            className="flex-1 h-12 bg-transparent outline-none text-sm placeholder:text-muted-foreground"
          />
          {query && (
            <button onClick={() => setQuery('')} className="p-1 hover:bg-muted rounded">
              <X className="w-4 h-4 text-muted-foreground" />
            </button>
          )}
          <Button variant="ghost" size="sm" onClick={closeSearch} className="ml-2 h-8 px-2">
            <kbd className="text-xs text-muted-foreground">ESC</kbd>
          </Button>
        </div>
        <div className="max-h-[60vh] overflow-y-auto p-2">
          {isLoading && (
            <div className="flex items-center justify-center py-8">
              <div className="flex items-center gap-2 text-muted-foreground">
                <span className="animate-spin w-4 h-4 border-2 border-primary border-t-transparent rounded-full" />
                <span className="text-sm">Searching...</span>
              </div>
            </div>
          )}
          {!isLoading && query.length < 2 && (
            <div className="flex flex-col items-center justify-center py-8 text-center">
              <Command className="w-10 h-10 text-muted-foreground/50 mb-2" />
              <p className="text-sm text-muted-foreground">Type at least 2 characters to search</p>
              <p className="text-xs text-muted-foreground/70 mt-1">Search across employees, projects, tasks, and leaves</p>
            </div>
          )}
          {!isLoading && query.length >= 2 && results.length === 0 && (
            <div className="flex flex-col items-center justify-center py-8 text-center">
              <Search className="w-10 h-10 text-muted-foreground/50 mb-2" />
              <p className="text-sm text-muted-foreground">No results found for "{query}"</p>
              <p className="text-xs text-muted-foreground/70 mt-1">Try different keywords or check your spelling</p>
            </div>
          )}
          {!isLoading && results.length > 0 && (
            <>
              <ResultGroup title="Employees" results={employees} onSelect={handleSelect} />
              <ResultGroup title="Projects" results={projects} onSelect={handleSelect} />
              <ResultGroup title="Tasks" results={tasks} onSelect={handleSelect} />
              <ResultGroup title="Leaves" results={leaves} onSelect={handleSelect} />
            </>
          )}
        </div>
        <div className="flex items-center justify-between border-t px-3 py-2 bg-muted/30">
          <div className="flex items-center gap-4 text-xs text-muted-foreground">
            <span className="flex items-center gap-1">
              <kbd className="px-1.5 py-0.5 rounded bg-background border text-[10px]">↑↓</kbd> Navigate
            </span>
            <span className="flex items-center gap-1">
              <kbd className="px-1.5 py-0.5 rounded bg-background border text-[10px]">↵</kbd> Select
            </span>
            <span className="flex items-center gap-1">
              <kbd className="px-1.5 py-0.5 rounded bg-background border text-[10px]">esc</kbd> Close
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}