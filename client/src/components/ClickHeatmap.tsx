import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import api from '@/lib/api';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { EmptyState } from '@/components/ui/empty-state';
import { Loader2 } from 'lucide-react';

interface HeatmapData {
  x: number;
  y: number;
  click_count: number;
  unique_clicks: number;
}

interface ClickHeatmapProps {
  pageUrl?: string;
  width?: number;
  height?: number;
}

export function ClickHeatmap({ pageUrl, width = 800, height = 600 }: ClickHeatmapProps) {
  const { data, isLoading } = useQuery({
    queryKey: ['click-analytics', pageUrl],
    queryFn: async () => {
      const params: Record<string, string> = {};
      if (pageUrl) params.page_url = pageUrl;
      const response = await api.get('/tracking/clicks', { params });
      return response.data.data || response.data;
    },
  });

  const heatmapData: HeatmapData[] = data?.heatmap || [];

  const maxClicks = useMemo(() => {
    return Math.max(...heatmapData.map(d => d.click_count), 1);
  }, [heatmapData]);

  const getColor = (count: number) => {
    const intensity = count / maxClicks;
    if (intensity < 0.2) return 'rgba(59, 130, 246, 0.1)';
    if (intensity < 0.4) return 'rgba(59, 130, 246, 0.3)';
    if (intensity < 0.6) return 'rgba(234, 179, 8, 0.5)';
    if (intensity < 0.8) return 'rgba(234, 88, 12, 0.7)';
    return 'rgba(220, 38, 38, 0.9)';
  };

  const topClicks = useMemo(() => {
    const elementMap = new Map<string, { selector: string; text: string; count: number }>();
    
    data?.clicks?.forEach((click: { element_selector: string; element_text: string; click_count: number }) => {
      const existing = elementMap.get(click.element_selector);
      if (existing) {
        existing.count += click.click_count;
      } else {
        elementMap.set(click.element_selector, {
          selector: click.element_selector,
          text: click.element_text || 'Unknown',
          count: click.click_count,
        });
      }
    });

    return Array.from(elementMap.values())
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);
  }, [data]);

  if (isLoading) {
    return (
      <Card>
        <CardContent className="flex items-center justify-center py-12">
          <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
        </CardContent>
      </Card>
    );
  }

  if (heatmapData.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Click Heatmap</CardTitle>
        </CardHeader>
        <CardContent>
          <EmptyState
            title="No click data yet"
            description="Click tracking data will appear here once users start interacting with the application"
          />
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Click Heatmap</CardTitle>
          {pageUrl && <p className="text-sm text-muted-foreground">{pageUrl}</p>}
        </CardHeader>
        <CardContent>
          <div 
            className="relative bg-muted/30 rounded-lg overflow-hidden"
            style={{ width, height }}
          >
            <div className="absolute inset-0 grid" style={{ 
              backgroundImage: 'linear-gradient(rgba(0,0,0,0.05) 1px, transparent 1px), linear-gradient(90deg, rgba(0,0,0,0.05) 1px, transparent 1px)',
              backgroundSize: '50px 50px'
            }} />
            
            {heatmapData.map((point, index) => (
              <div
                key={index}
                className="absolute rounded-full transition-all duration-300"
                style={{
                  left: point.x,
                  top: point.y,
                  width: 50,
                  height: 50,
                  transform: 'translate(-50%, -50%)',
                  backgroundColor: getColor(point.click_count),
                  opacity: 0.8,
                }}
                title={`Clicks: ${point.click_count}, Unique: ${point.unique_clicks}`}
              />
            ))}
          </div>
          
          <div className="flex items-center justify-center gap-4 mt-4">
            <div className="flex items-center gap-2">
              <div className="w-4 h-4 rounded" style={{ backgroundColor: 'rgba(59, 130, 246, 0.3)' }} />
              <span className="text-xs text-muted-foreground">Low</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-4 h-4 rounded" style={{ backgroundColor: 'rgba(234, 179, 8, 0.5)' }} />
              <span className="text-xs text-muted-foreground">Medium</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-4 h-4 rounded" style={{ backgroundColor: 'rgba(220, 38, 38, 0.9)' }} />
              <span className="text-xs text-muted-foreground">High</span>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Top Clicked Elements</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-2">
            {topClicks.map((item, index) => (
              <div
                key={index}
                className="flex items-center justify-between py-2 px-3 rounded hover:bg-accent/50"
              >
                <div className="flex-1 min-w-0">
                  <code className="text-xs bg-muted px-2 py-1 rounded block truncate">
                    {item.selector}
                  </code>
                  <p className="text-xs text-muted-foreground mt-1 truncate">
                    {item.text}
                  </p>
                </div>
                <span className="text-sm font-medium ml-4">{item.count}</span>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}