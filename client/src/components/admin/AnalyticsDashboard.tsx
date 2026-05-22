import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Activity, MousePointerClick, Globe, Users, Clock, ArrowUpRight, Monitor, Search } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import api from '@/lib/api';

interface RequestMetric {
  method: string;
  path: string;
  request_count: string | number;
  unique_users: string | number;
  avg_response_time: string | number;
  p95_response_time: string | number;
}

interface ClickMetric {
  element_text?: string | null;
  page_url: string;
  element_selector: string;
  click_count: string | number;
}

interface TrendPoint {
  bucket: string;
  request_count?: number | string;
  click_count?: number | string;
}

interface ClickAnalyticsResponse {
  clicks: ClickMetric[];
  heatmap: Array<Record<string, unknown>>;
  trend?: TrendPoint[];
}

interface RequestAnalyticsResponse {
  data: RequestMetric[];
  trend?: TrendPoint[];
}

export function AnalyticsDashboard() {
  const [dateRange, setDateRange] = useState('7d');
  const [searchTerm, setSearchTerm] = useState('');

  const { data: requestResponse, isLoading: reqLoading } = useQuery<RequestAnalyticsResponse>({
    queryKey: ['analytics-requests', dateRange],
    queryFn: async () => {
      const res = await api.get('/tracking/requests?limit=50&bucket=day');
      return res.data || { data: [], trend: [] };
    }
  });

  const { data: clickData, isLoading: clickLoading } = useQuery<ClickAnalyticsResponse>({
    queryKey: ['analytics-clicks', dateRange],
    queryFn: async () => {
      const res = await api.get('/tracking/clicks?limit=50&bucket=day');
      return res.data.data || { clicks: [], heatmap: [], trend: [] };
    }
  });

  const requestData = requestResponse?.data || [];

  const trendData = useMemo(() => {
    const requestTrend = requestResponse?.trend || [];
    const clickTrend = clickData?.trend || [];
    const buckets = new Map<string, { name: string; requests: number; clicks: number }>();

    for (const item of requestTrend) {
      const key = String(item.bucket || '');
      if (!key) continue;
      const name = new Date(key).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
      buckets.set(key, {
        name,
        requests: Number(item.request_count || 0),
        clicks: buckets.get(key)?.clicks || 0,
      });
    }

    for (const item of clickTrend) {
      const key = String(item.bucket || '');
      if (!key) continue;
      const name = new Date(key).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
      const prev = buckets.get(key);
      buckets.set(key, {
        name,
        requests: prev?.requests || 0,
        clicks: Number(item.click_count || 0),
      });
    }

    return Array.from(buckets.entries())
      .sort((a, b) => new Date(a[0]).getTime() - new Date(b[0]).getTime())
      .map(([, value]) => value);
  }, [requestResponse?.trend, clickData?.trend]);

  const filteredRequests = (requestData || []).filter((req) => 
    req.path.toLowerCase().includes(searchTerm.toLowerCase())
  );
  const clickRows = clickData?.clicks ?? [];

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h2 className="text-2xl font-bold tracking-tight">Analytics Console</h2>
          <p className="text-muted-foreground">Monitor platform usage, performance, and user engagement.</p>
        </div>
        <div className="flex gap-2">
          <select 
            value={dateRange}
            onChange={(e) => setDateRange(e.target.value)}
            className="rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm"
          >
            <option value="24h">Last 24 Hours</option>
            <option value="7d">Last 7 Days</option>
            <option value="30d">Last 30 Days</option>
            <option value="all">All Time</option>
          </select>
          <Button variant="outline">Export Report</Button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card>
          <CardContent className="p-6">
            <div className="flex justify-between items-start">
              <div>
                <p className="text-sm font-medium text-muted-foreground mb-1">Total API Requests</p>
                <h3 className="text-2xl font-bold">
                  {requestData?.reduce((acc: number, curr: RequestMetric) => acc + Number.parseInt(String(curr.request_count || 0), 10), 0).toLocaleString() || '0'}
                </h3>
              </div>
              <div className="p-2 bg-blue-100 dark:bg-blue-900/30 rounded-lg text-blue-600 dark:text-blue-400">
                <Globe className="w-5 h-5" />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-6">
            <div className="flex justify-between items-start">
              <div>
                <p className="text-sm font-medium text-muted-foreground mb-1">Total Clicks Tracked</p>
                <h3 className="text-2xl font-bold">
                  {clickData?.clicks?.reduce((acc: number, curr: ClickMetric) => acc + Number.parseInt(String(curr.click_count || 0), 10), 0).toLocaleString() || '0'}
                </h3>
              </div>
              <div className="p-2 bg-emerald-100 dark:bg-emerald-900/30 rounded-lg text-emerald-600 dark:text-emerald-400">
                <MousePointerClick className="w-5 h-5" />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-6">
            <div className="flex justify-between items-start">
              <div>
                <p className="text-sm font-medium text-muted-foreground mb-1">Avg Response Time</p>
                <h3 className="text-2xl font-bold">
                  {requestData?.length ? Math.round(requestData.reduce((acc: number, curr: RequestMetric) => acc + Number.parseFloat(String(curr.avg_response_time || 0)), 0) / requestData.length) : '0'}ms
                </h3>
              </div>
              <div className="p-2 bg-amber-100 dark:bg-amber-900/30 rounded-lg text-amber-600 dark:text-amber-400">
                <Clock className="w-5 h-5" />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-6">
            <div className="flex justify-between items-start">
              <div>
                <p className="text-sm font-medium text-muted-foreground mb-1">Unique Users Active</p>
                <h3 className="text-2xl font-bold">
                  {requestData?.reduce((acc: number, curr: RequestMetric) => Math.max(acc, Number.parseInt(String(curr.unique_users || 0), 10)), 0) || '0'}
                </h3>
              </div>
              <div className="p-2 bg-purple-100 dark:bg-purple-900/30 rounded-lg text-purple-600 dark:text-purple-400">
                <Users className="w-5 h-5" />
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card>
          <CardHeader>
            <CardTitle>Traffic Overview</CardTitle>
            <CardDescription>API requests and user clicks over time</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="h-[300px]">
              {trendData.length > 0 ? (
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={trendData}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} />
                    <XAxis dataKey="name" />
                    <YAxis yAxisId="left" />
                    <YAxis yAxisId="right" orientation="right" />
                    <Tooltip />
                    <Line yAxisId="left" type="monotone" dataKey="requests" stroke="#3b82f6" strokeWidth={2} name="API Requests" />
                    <Line yAxisId="right" type="monotone" dataKey="clicks" stroke="#10b981" strokeWidth={2} name="Clicks" />
                  </LineChart>
                </ResponsiveContainer>
              ) : (
                <div className="h-full flex items-center justify-center text-muted-foreground">
                  No trend data recorded yet
                </div>
              )}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Top Clicked Elements</CardTitle>
            <CardDescription>Most interacted UI components</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="h-[300px] overflow-auto pr-2">
              <div className="space-y-4">
                {clickRows.length > 0 ? clickRows.slice(0, 10).map((click: ClickMetric, i: number) => (
                  <div key={i} className="flex items-center justify-between">
                    <div className="flex items-center gap-3 overflow-hidden">
                      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-muted text-xs font-medium">
                        {i + 1}
                      </div>
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium">
                          {click.element_text || 'Unnamed Element'}
                        </p>
                        <p className="truncate text-xs text-muted-foreground">
                          {click.page_url} • {click.element_selector}
                        </p>
                      </div>
                    </div>
                    <div className="text-right shrink-0 ml-4">
                      <p className="text-sm font-bold">{Number.parseInt(String(click.click_count), 10).toLocaleString()}</p>
                      <p className="text-xs text-muted-foreground">clicks</p>
                    </div>
                  </div>
                )) : (
                  <div className="flex h-full items-center justify-center text-muted-foreground">
                    No click data recorded yet
                  </div>
                )}
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
            <div>
              <CardTitle>API Endpoint Performance</CardTitle>
              <CardDescription>Detailed latency and usage metrics per route</CardDescription>
            </div>
            <div className="relative">
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search endpoints..."
                className="pl-8 w-[250px]"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
              />
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Method</TableHead>
                  <TableHead>Path</TableHead>
                  <TableHead className="text-right">Requests</TableHead>
                  <TableHead className="text-right">Unique Users</TableHead>
                  <TableHead className="text-right">Avg Latency</TableHead>
                  <TableHead className="text-right">P95 Latency</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredRequests.length > 0 ? (
                  filteredRequests.map((req: RequestMetric, i: number) => (
                    <TableRow key={i}>
                      <TableCell>
                        <Badge variant={req.method === 'GET' ? 'secondary' : req.method === 'POST' ? 'default' : 'outline'}>
                          {req.method}
                        </Badge>
                      </TableCell>
                      <TableCell className="font-mono text-sm">{req.path}</TableCell>
                      <TableCell className="text-right">{Number.parseInt(String(req.request_count), 10).toLocaleString()}</TableCell>
                      <TableCell className="text-right">{req.unique_users}</TableCell>
                      <TableCell className="text-right">
                        <span className={Math.round(Number(req.avg_response_time)) > 500 ? 'text-red-500 font-medium' : ''}>
                          {Math.round(Number(req.avg_response_time))}ms
                        </span>
                      </TableCell>
                      <TableCell className="text-right font-medium">
                        {Math.round(Number(req.p95_response_time))}ms
                      </TableCell>
                    </TableRow>
                  ))
                ) : (
                  <TableRow>
                    <TableCell colSpan={6} className="text-center py-8 text-muted-foreground">
                      No endpoint data found
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
