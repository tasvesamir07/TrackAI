import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { GripVertical, X, RotateCcw, LayoutGrid } from 'lucide-react';
import { cn } from '@/lib/utils';

interface Widget {
  id: string;
  title: string;
  component: React.ReactNode;
  visible: boolean;
  size: 'small' | 'medium' | 'large';
}

interface DashboardWidgetsProps {
  widgets: Widget[];
  onReorder: (from: number, to: number) => void;
  onToggle: (id: string) => void;
  onReset: () => void;
}

export function DashboardWidgets({ widgets: initialWidgets, onReorder, onToggle, onReset }: DashboardWidgetsProps) {
  const [widgets, setWidgets] = useState(initialWidgets);
  const [draggedIndex, setDraggedIndex] = useState<number | null>(null);

  useEffect(() => {
    const saved = localStorage.getItem('dashboard-widgets');
    if (saved) {
      try {
        const order = JSON.parse(saved);
        setWidgets(prev => {
          const sorted = [...prev].sort((a, b) => {
            const aIndex = order.indexOf(a.id);
            const bIndex = order.indexOf(b.id);
            return (aIndex === -1 ? 999 : aIndex) - (bIndex === -1 ? 999 : bIndex);
          });
          return sorted;
        });
      } catch {}
    }
  }, []);

  const handleDragStart = (index: number) => {
    setDraggedIndex(index);
  };

  const handleDragOver = (e: React.DragEvent, index: number) => {
    e.preventDefault();
    if (draggedIndex === null || draggedIndex === index) return;
    setWidgets(prev => {
      const newWidgets = [...prev];
      const [dragged] = newWidgets.splice(draggedIndex, 1);
      newWidgets.splice(index, 0, dragged);
      return newWidgets;
    });
    setDraggedIndex(index);
  };

  const handleDragEnd = () => {
    const order = widgets.map(w => w.id);
    localStorage.setItem('dashboard-widgets', JSON.stringify(order));
    setDraggedIndex(null);
    const from = initialWidgets.findIndex(w => w.id === widgets[draggedIndex!]?.id);
    const to = draggedIndex!;
    if (from !== to) onReorder(from, to);
  };

  const visibleWidgets = widgets.filter(w => w.visible);

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between pb-4">
        <CardTitle className="flex items-center gap-2 text-lg">
          <LayoutGrid className="w-5 h-5" />
          Dashboard Widgets
        </CardTitle>
        <Button variant="outline" size="sm" onClick={onReset} className="gap-1">
          <RotateCcw className="w-4 h-4" />
          Reset
        </Button>
      </CardHeader>
      <CardContent>
        <div className="space-y-3 mb-4">
          {widgets.map((widget, index) => (
            <div
              key={widget.id}
              draggable
              onDragStart={() => handleDragStart(index)}
              onDragOver={(e) => handleDragOver(e, index)}
              onDragEnd={handleDragEnd}
              className={cn(
                "flex items-center gap-3 p-3 rounded-lg border transition-all",
                draggedIndex === index ? "opacity-50 bg-muted" : "hover:bg-muted/50",
                !widget.visible && "opacity-50"
              )}
            >
              <GripVertical className="w-4 h-4 text-muted-foreground cursor-grab" />
              <span className="flex-1 font-medium">{widget.title}</span>
              <div className="flex items-center gap-2">
                <select
                  value={widget.size}
                  onChange={(e) => {
                    const newWidgets = [...widgets];
                    newWidgets[index] = { ...newWidgets[index], size: e.target.value as any };
                    setWidgets(newWidgets);
                  }}
                  className="text-xs border rounded px-2 py-1"
                >
                  <option value="small">S</option>
                  <option value="medium">M</option>
                  <option value="large">L</option>
                </select>
                <Switch
                  checked={widget.visible}
                  onCheckedChange={() => onToggle(widget.id)}
                />
              </div>
            </div>
          ))}
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 mt-6">
          {visibleWidgets.map((widget) => (
            <div
              key={widget.id}
              className={cn(
                "rounded-lg border bg-card",
                widget.size === 'large' && 'md:col-span-2 lg:col-span-2',
                widget.size === 'medium' && 'md:col-span-1',
                widget.size === 'small' && 'md:col-span-1'
              )}
            >
              <div className="p-3 border-b flex items-center justify-between">
                <h3 className="font-medium text-sm">{widget.title}</h3>
              </div>
              <div className="p-4">
                {widget.component}
              </div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

export const defaultWidgets: Widget[] = [
  {
    id: 'attendance',
    title: "Today's Attendance",
    component: <div className="text-center text-muted-foreground">12 of 15 present</div>,
    visible: true,
    size: 'small'
  },
  {
    id: 'tasks',
    title: 'My Tasks',
    component: <div className="text-center text-muted-foreground">5 tasks pending</div>,
    visible: true,
    size: 'medium'
  },
  {
    id: 'leave',
    title: 'Leave Requests',
    component: <div className="text-center text-muted-foreground">2 pending</div>,
    visible: true,
    size: 'small'
  },
  {
    id: 'announcements',
    title: 'Announcements',
    component: <div className="text-center text-muted-foreground">No new announcements</div>,
    visible: true,
    size: 'medium'
  },
  {
    id: 'team',
    title: 'Team Activity',
    component: <div className="text-center text-muted-foreground">View activity</div>,
    visible: true,
    size: 'medium'
  },
  {
    id: 'stats',
    title: 'Statistics',
    component: <div className="text-center text-muted-foreground">View stats</div>,
    visible: true,
    size: 'large'
  }
];