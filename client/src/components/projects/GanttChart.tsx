import { useState, useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ChevronLeft, ChevronRight, ZoomIn, ZoomOut } from 'lucide-react';

interface GanttTask {
  id: string;
  name: string;
  startDate: Date;
  endDate: Date;
  progress: number;
  assignees: string[];
  dependencies?: string[];
}

interface GanttChartProps {
  tasks: GanttTask[];
  onTaskClick?: (taskId: string) => void;
  startDate?: Date;
  endDate?: Date;
}

export function GanttChart({ tasks, onTaskClick, startDate, endDate }: GanttChartProps) {
  const [viewMode, setViewMode] = useState<'day' | 'week' | 'month'>('week');
  const [scrollOffset, setScrollOffset] = useState(0);
  const [zoom, setZoom] = useState(1);

  const calculateStartDate = () => {
    if (startDate) return startDate;
    if (tasks.length === 0) return new Date();
    const earliest = new Date(Math.min(...tasks.map(t => t.startDate.getTime())));
    return new Date(earliest.getFullYear(), earliest.getMonth(), earliest.getDate() - 7);
  };

  const calculateEndDate = () => {
    if (endDate) return endDate;
    if (tasks.length === 0) return new Date();
    const latest = new Date(Math.max(...tasks.map(t => t.endDate.getTime())));
    return new Date(latest.getFullYear(), latest.getMonth(), latest.getDate() + 14);
  };

  const dateRange = useMemo(() => {
    const start = calculateStartDate();
    const end = calculateEndDate();
    const days: Date[] = [];
    const current = new Date(start);
    while (current <= end) {
      days.push(new Date(current));
      current.setDate(current.getDate() + 1);
    }
    return days;
  }, [tasks]);

  const dayWidth = 40 * zoom;
  const headerHeight = 40;
  const rowHeight = 50;

  const getTaskPosition = (task: GanttTask) => {
    const startOffset = Math.floor((task.startDate.getTime() - calculateStartDate().getTime()) / (1000 * 60 * 60 * 24));
    const duration = Math.floor((task.endDate.getTime() - task.startDate.getTime()) / (1000 * 60 * 60 * 24)) + 1;
    return { left: startOffset * dayWidth, width: duration * dayWidth };
  };

  const getDateLabel = (date: Date) => {
    if (viewMode === 'day') return date.getDate().toString();
    if (viewMode === 'week') return ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][date.getDay()];
    return date.getMonth() + 1 + '';
  };

  const isToday = (date: Date) => {
    const today = new Date();
    return date.toDateString() === today.toDateString();
  };

  const handleScroll = (direction: 'left' | 'right') => {
    const scrollAmount = 7 * dayWidth;
    setScrollOffset(prev => direction === 'left' ? prev - scrollAmount : prev + scrollAmount);
  };

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle>Project Timeline</CardTitle>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="icon" onClick={() => setZoom(z => Math.max(0.5, z - 0.25))}>
              <ZoomOut className="w-4 h-4" />
            </Button>
            <span className="text-sm">{Math.round(zoom * 100)}%</span>
            <Button variant="outline" size="icon" onClick={() => setZoom(z => Math.min(2, z + 0.25))}>
              <ZoomIn className="w-4 h-4" />
            </Button>
            <Button variant="outline" size="icon" onClick={() => handleScroll('left')}>
              <ChevronLeft className="w-4 h-4" />
            </Button>
            <Button variant="outline" size="icon" onClick={() => handleScroll('right')}>
              <ChevronRight className="w-4 h-4" />
            </Button>
          </div>
        </div>
        <div className="flex gap-2">
          {(['day', 'week', 'month'] as const).map((mode) => (
            <Button
              key={mode}
              variant={viewMode === mode ? 'default' : 'ghost'}
              size="sm"
              onClick={() => setViewMode(mode)}
            >
              {mode.charAt(0).toUpperCase() + mode.slice(1)}
            </Button>
          ))}
        </div>
      </CardHeader>
      <CardContent className="p-0">
        <div className="flex">
          <div className="w-48 flex-shrink-0 border-r bg-muted/30">
            <div className="h-10 border-b flex items-center px-4 font-medium">Task</div>
            {tasks.map((task) => (
              <div
                key={task.id}
                className="h-[50px] border-b flex items-center px-4 hover:bg-muted/50 cursor-pointer"
                onClick={() => onTaskClick?.(task.id)}
              >
                <div className="truncate text-sm">{task.name}</div>
              </div>
            ))}
          </div>
          <div className="flex-1 overflow-hidden">
            <div className="flex border-b" style={{ height: headerHeight }}>
              {dateRange.map((date, i) => (
                <div
                  key={i}
                  className={`flex-shrink-0 border-r flex items-center justify-center text-xs ${isToday(date) ? 'bg-primary/10 font-bold' : ''}`}
                  style={{ width: dayWidth }}
                >
                  {getDateLabel(date)}
                </div>
              ))}
            </div>
            <ScrollArea className="h-[400px]">
              <div className="relative" style={{ width: dateRange.length * dayWidth }}>
                {tasks.map((task, taskIndex) => {
                  const { left, width } = getTaskPosition(task);
                  return (
                    <div
                      key={task.id}
                      className="absolute border-b"
                      style={{
                        top: taskIndex * rowHeight,
                        left,
                        width,
                        height: rowHeight - 1,
                      }}
                    >
                      <div className="h-full flex items-center px-2">
                        <div className="relative h-6 w-full bg-primary/20 rounded overflow-hidden">
                          <div
                            className="absolute left-0 top-0 h-full bg-primary transition-all"
                            style={{ width: `${task.progress}%` }}
                          />
                          <span className="absolute inset-0 flex items-center justify-center text-xs">
                            {task.progress}%
                          </span>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </ScrollArea>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}