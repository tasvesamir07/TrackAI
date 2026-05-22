import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import api from '@/lib/api';

export function HeatmapOverlay() {
  const [selectedPage, setSelectedPage] = useState<string>('');

  const { data: allClickData, isLoading: pagesLoading } = useQuery({
    queryKey: ['analytics-heatmap-pages'],
    queryFn: async () => {
      const res = await api.get('/tracking/clicks?limit=500');
      return res.data.data || { clicks: [], heatmap: [] };
    }
  });

  const pages = useMemo(() => {
    const pageSet = new Set<string>();
    (allClickData?.clicks || []).forEach((row: any) => {
      if (row?.page_url) pageSet.add(String(row.page_url));
    });
    (allClickData?.heatmap || []).forEach((row: any) => {
      if (row?.page_url) pageSet.add(String(row.page_url));
    });
    return Array.from(pageSet).sort();
  }, [allClickData]);

  useEffect(() => {
    if (!selectedPage && pages.length > 0) {
      setSelectedPage(pages[0]);
    } else if (selectedPage && pages.length > 0 && !pages.includes(selectedPage)) {
      setSelectedPage(pages[0]);
    }
  }, [pages, selectedPage]);

  const { data: clickData, isLoading: heatmapLoading } = useQuery({
    queryKey: ['analytics-heatmap', selectedPage],
    enabled: Boolean(selectedPage),
    queryFn: async () => {
      const res = await api.get(`/tracking/clicks?page_url=${encodeURIComponent(selectedPage)}&limit=500`);
      return res.data.data || { clicks: [], heatmap: [] };
    }
  });

  const heatmapPoints = clickData?.heatmap || [];

  // Find max clicks to normalize heatmap colors
  const maxClicks = Math.max(...heatmapPoints.map((p: any) => p.click_count || 1), 1);
  const minX = heatmapPoints.length > 0 ? Math.min(...heatmapPoints.map((p: any) => Number(p.x) || 0)) : 0;
  const maxX = heatmapPoints.length > 0 ? Math.max(...heatmapPoints.map((p: any) => Number(p.x) || 0)) : 1;
  const minY = heatmapPoints.length > 0 ? Math.min(...heatmapPoints.map((p: any) => Number(p.y) || 0)) : 0;
  const maxY = heatmapPoints.length > 0 ? Math.max(...heatmapPoints.map((p: any) => Number(p.y) || 0)) : 1;
  const xSpan = Math.max(maxX - minX, 1);
  const ySpan = Math.max(maxY - minY, 1);

  const isLoading = pagesLoading || heatmapLoading;

  return (
    <Card className="flex flex-col h-full min-h-[600px]">
      <CardHeader className="flex flex-row items-center justify-between">
        <div>
          <CardTitle>Page Heatmap</CardTitle>
          <CardDescription>Visualize click density across your application pages</CardDescription>
        </div>
        <div className="w-[250px]">
          <Select value={selectedPage} onValueChange={setSelectedPage}>
            <SelectTrigger>
              <SelectValue placeholder="Select a page" />
            </SelectTrigger>
            <SelectContent>
              {pages.map(page => (
                <SelectItem key={page} value={page}>{page}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </CardHeader>
      <CardContent className="flex-1">
        <div className="relative w-full h-[600px] border rounded-lg bg-slate-50 overflow-hidden">
          {isLoading && (
            <div className="absolute inset-0 flex items-center justify-center bg-white/50 backdrop-blur-sm z-50">
              Loading heatmap data...
            </div>
          )}

          {!isLoading && selectedPage && heatmapPoints.length === 0 && (
            <div className="absolute inset-0 flex items-center justify-center">
              <p className="text-muted-foreground">No click data available for this page.</p>
            </div>
          )}

          {!isLoading && !selectedPage && (
            <div className="absolute inset-0 flex items-center justify-center">
              <p className="text-muted-foreground">No tracked pages yet. Interact with the app first.</p>
            </div>
          )}

          {!isLoading && heatmapPoints.map((point: any, i: number) => {
            // Normalize intensity between 0.3 and 1.0 based on click count
            const intensity = 0.3 + (0.7 * (point.click_count / maxClicks));
            const x = ((Number(point.x) - minX) / xSpan) * 100;
            const y = ((Number(point.y) - minY) / ySpan) * 100;

            return (
              <div
                key={i}
                className="absolute w-8 h-8 -ml-4 -mt-4 rounded-full blur-[2px]"
                style={{
                  left: `${x}%`,
                  top: `${y}%`,
                  backgroundColor: `rgba(239, 68, 68, ${intensity})`,
                  boxShadow: `0 0 20px 10px rgba(239, 68, 68, ${intensity * 0.5})`
                }}
                title={`Clicks: ${point.click_count} | Unique: ${point.unique_clicks}`}
              />
            );
          })}
        </div>
        <div className="mt-4 flex items-center justify-between text-sm text-muted-foreground">
          <p>Total recorded points: {heatmapPoints.length}</p>
          <div className="flex items-center gap-2">
            <span>Low</span>
            <div className="w-32 h-3 rounded-full bg-gradient-to-r from-red-500/30 to-red-500/90" />
            <span>High Density</span>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
