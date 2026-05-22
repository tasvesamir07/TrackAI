import { useState, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Progress } from '@/components/ui/progress';
import { Loader2, Cpu, HardDrive, Database, Activity, Users, Clock } from 'lucide-react';
import api from '@/lib/api';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';

interface ServerMetrics {
  cpu: number;
  memory: number;
  disk: number;
  uptime: number;
  requestsPerSecond: number;
  avgResponseTime: number;
  activeConnections: number;
}

interface LiveUser {
  companyId: string;
  companyName: string;
  count: number;
  activePages: string[];
}

interface MetricsHistory {
  timestamp: string;
  cpu: number;
  memory: number;
  requests: number;
}

export function PerformanceMonitor() {
  const [metrics, setMetrics] = useState<ServerMetrics | null>(null);
  const [liveUsers, setLiveUsers] = useState<LiveUser[]>([]);
  const [metricsHistory, setMetricsHistory] = useState<MetricsHistory[]>([]);

  const { data: serverData, isLoading } = useQuery({
    queryKey: ['server-metrics'],
    queryFn: async () => {
      const response = await api.get('/superadmin/metrics/server');
      return response.data.data || response.data;
    },
    refetchInterval: 30000,
  });

  const { data: usersData } = useQuery({
    queryKey: ['live-users'],
    queryFn: async () => {
      const response = await api.get('/superadmin/metrics/users');
      return response.data.data || response.data;
    },
    refetchInterval: 15000,
  });

  useEffect(() => {
    if (serverData) {
      setMetrics(serverData);
      setMetricsHistory(prev => [...prev, {
        timestamp: new Date().toISOString(),
        cpu: serverData.cpu,
        memory: serverData.memory,
        requests: serverData.requestsPerSecond,
      }].slice(-60));
    }
  }, [serverData]);

  useEffect(() => {
    if (usersData) {
      setLiveUsers(usersData.companies || []);
    }
  }, [usersData]);

  if (isLoading || !metrics) {
    return (
      <Card>
        <CardContent className="flex items-center justify-center py-12">
          <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
        </CardContent>
      </Card>
    );
  }

  const getHealthColor = (value: number, thresholds: { good: number; warning: number }) => {
    if (value < thresholds.good) return 'text-green-500';
    if (value < thresholds.warning) return 'text-yellow-500';
    return 'text-red-500';
  };

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2">
                <Cpu className="w-4 h-4 text-muted-foreground" />
                <span className="text-sm">CPU</span>
              </div>
              <span className={`text-2xl font-bold ${getHealthColor(metrics.cpu, { good: 50, warning: 80 })}`}>
                {metrics.cpu}%
              </span>
            </div>
            <Progress value={metrics.cpu} className="h-2" />
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4">
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2">
                <HardDrive className="w-4 h-4 text-muted-foreground" />
                <span className="text-sm">Memory</span>
              </div>
              <span className={`text-2xl font-bold ${getHealthColor(metrics.memory, { good: 60, warning: 85 })}`}>
                {metrics.memory}%
              </span>
            </div>
            <Progress value={metrics.memory} className="h-2" />
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4">
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2">
                <Activity className="w-4 h-4 text-muted-foreground" />
                <span className="text-sm">Requests/sec</span>
              </div>
              <span className="text-2xl font-bold">{metrics.requestsPerSecond}</span>
            </div>
            <p className="text-xs text-muted-foreground">Avg: {metrics.avgResponseTime}ms</p>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4">
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2">
                <Users className="w-4 h-4 text-muted-foreground" />
                <span className="text-sm">Active</span>
              </div>
              <span className="text-2xl font-bold">{metrics.activeConnections}</span>
            </div>
            <div className="flex items-center gap-1 text-xs text-muted-foreground">
              <Clock className="w-3 h-3" />
              <span>Uptime: {Math.floor(metrics.uptime / 3600)}h</span>
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card>
          <CardHeader>
            <CardTitle>System Metrics History</CardTitle>
            <CardDescription>Last 5 minutes</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="h-[300px]">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={metricsHistory}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="timestamp" tick={{ fontSize: 10 }} tickFormatter={(v) => new Date(v).toLocaleTimeString()} />
                  <YAxis />
                  <Tooltip />
                  <Line type="monotone" dataKey="cpu" stroke="#8884d8" name="CPU %" />
                  <Line type="monotone" dataKey="memory" stroke="#82ca9d" name="Memory %" />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Live Users by Company</CardTitle>
            <CardDescription>Currently active users</CardDescription>
          </CardHeader>
          <CardContent>
            {liveUsers.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">
                No active users
              </div>
            ) : (
              <div className="space-y-3">
                {liveUsers.map((company, index) => (
                  <div key={index} className="flex items-center justify-between p-3 rounded-lg border">
                    <div>
                      <div className="font-medium">{company.companyName || 'Unknown'}</div>
                      <div className="text-xs text-muted-foreground">
                        {company.activePages?.join(', ') || 'Various pages'}
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="text-2xl font-bold">{company.count}</div>
                      <div className="text-xs text-muted-foreground">users</div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}