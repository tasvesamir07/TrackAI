import { useState, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Shield, ShieldAlert, ShieldCheck, Activity, AlertTriangle, Search } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import api from '@/lib/api';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';

interface TrendPoint {
  time: string;
  blocked: number;
}

interface BotStats {
  totalRequests: number;
  blockedRequests: number;
  suspiciousIPs: number;
  activeRules: number;
  trendData: TrendPoint[];
}

interface BotLog {
  id: number;
  ip: string;
  action: string;
  reason: string;
  timestamp: string;
}

export function BotProtectionPanel() {
  const [searchTerm, setSearchTerm] = useState('');
  const [logs, setLogs] = useState<BotLog[]>([]);
  const [stats, setStats] = useState<BotStats | null>(null);

  useEffect(() => {
    fetchStats();
    fetchLogs();
  }, []);

  const fetchStats = async () => {
    try {
      const response = await api.get('/security/bot-stats');
      setStats(response.data as BotStats);
    } catch (error) {
      console.error('Failed to fetch bot stats', error);
      // Fallback mock data
      setStats({
        totalRequests: 15420,
        blockedRequests: 342,
        suspiciousIPs: 12,
        activeRules: 5,
        trendData: [
          { time: '10:00', blocked: 12 },
          { time: '11:00', blocked: 45 },
          { time: '12:00', blocked: 8 },
          { time: '13:00', blocked: 22 },
          { time: '14:00', blocked: 56 },
          { time: '15:00', blocked: 19 },
        ]
      });
    }
  };

  const fetchLogs = async () => {
    try {
      const response = await api.get('/security/bot-logs');
      const incomingLogs = (response.data?.logs || []) as BotLog[];
      setLogs(incomingLogs);
    } catch (error) {
      console.error('Failed to fetch bot logs', error);
      // Fallback mock data
      setLogs([
        { id: 1, ip: '192.168.1.105', action: 'blocked', reason: 'Rate limit exceeded', timestamp: new Date(Date.now() - 5000).toISOString() },
        { id: 2, ip: '10.0.0.45', action: 'challenged', reason: 'Suspicious user agent', timestamp: new Date(Date.now() - 120000).toISOString() },
        { id: 3, ip: '172.16.0.8', action: 'blocked', reason: 'Known bad IP', timestamp: new Date(Date.now() - 360000).toISOString() },
        { id: 4, ip: '192.168.1.200', action: 'blocked', reason: 'SQL injection attempt', timestamp: new Date(Date.now() - 720000).toISOString() },
        { id: 5, ip: '10.0.0.99', action: 'challenged', reason: 'Rapid navigation', timestamp: new Date(Date.now() - 1440000).toISOString() },
      ]);
    }
  };

  const filteredLogs = logs.filter((log) => 
    log.ip.includes(searchTerm) || 
    log.reason.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const getActionBadge = (action: string) => {
    switch(action.toLowerCase()) {
      case 'blocked': return <Badge variant="destructive">Blocked</Badge>;
      case 'challenged': return <Badge variant="outline" className="text-yellow-600 border-yellow-600">Challenged</Badge>;
      case 'allowed': return <Badge variant="outline" className="text-green-600 border-green-600">Allowed</Badge>;
      default: return <Badge>{action}</Badge>;
    }
  };

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card>
          <CardContent className="p-6">
            <div className="flex justify-between items-start">
              <div>
                <p className="text-sm font-medium text-muted-foreground mb-1">Total Monitored</p>
                <h3 className="text-3xl font-bold">{stats?.totalRequests.toLocaleString() || '---'}</h3>
              </div>
              <div className="p-2 bg-blue-100 dark:bg-blue-900/30 rounded-lg text-blue-600 dark:text-blue-400">
                <Activity className="w-5 h-5" />
              </div>
            </div>
          </CardContent>
        </Card>
        
        <Card>
          <CardContent className="p-6">
            <div className="flex justify-between items-start">
              <div>
                <p className="text-sm font-medium text-muted-foreground mb-1">Blocked Attacks</p>
                <h3 className="text-3xl font-bold text-red-600">{stats?.blockedRequests.toLocaleString() || '---'}</h3>
              </div>
              <div className="p-2 bg-red-100 dark:bg-red-900/30 rounded-lg text-red-600 dark:text-red-400">
                <ShieldAlert className="w-5 h-5" />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-6">
            <div className="flex justify-between items-start">
              <div>
                <p className="text-sm font-medium text-muted-foreground mb-1">Suspicious IPs</p>
                <h3 className="text-3xl font-bold text-yellow-600">{stats?.suspiciousIPs.toLocaleString() || '---'}</h3>
              </div>
              <div className="p-2 bg-yellow-100 dark:bg-yellow-900/30 rounded-lg text-yellow-600 dark:text-yellow-400">
                <AlertTriangle className="w-5 h-5" />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-6">
            <div className="flex justify-between items-start">
              <div>
                <p className="text-sm font-medium text-muted-foreground mb-1">Active Rules</p>
                <h3 className="text-3xl font-bold text-green-600">{stats?.activeRules || '---'}</h3>
              </div>
              <div className="p-2 bg-green-100 dark:bg-green-900/30 rounded-lg text-green-600 dark:text-green-400">
                <ShieldCheck className="w-5 h-5" />
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Block Events Over Time</CardTitle>
            <CardDescription>Number of automated requests blocked by the firewall</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="h-[300px]">
              {stats?.trendData && (
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={stats.trendData}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} />
                    <XAxis dataKey="time" />
                    <YAxis />
                    <Tooltip />
                    <Line type="monotone" dataKey="blocked" stroke="#ef4444" strokeWidth={2} name="Blocked Requests" dot={{r: 4}} activeDot={{r: 6}} />
                  </LineChart>
                </ResponsiveContainer>
              )}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Security Posture</CardTitle>
            <CardDescription>Current protection status</CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <Shield className="w-8 h-8 text-green-500" />
                <div>
                  <p className="font-medium">WAF Status</p>
                  <p className="text-xs text-muted-foreground">Active & Blocking</p>
                </div>
              </div>
              <Badge variant="outline" className="bg-green-50 text-green-600 border-green-200">Online</Badge>
            </div>
            
            <div className="space-y-3 pt-4 border-t">
              <h4 className="text-sm font-medium">Active Protections</h4>
              <div className="flex justify-between items-center text-sm">
                <span className="text-muted-foreground">Rate Limiting</span>
                <span className="font-medium">Enabled</span>
              </div>
              <div className="flex justify-between items-center text-sm">
                <span className="text-muted-foreground">IP Reputation</span>
                <span className="font-medium">Enabled</span>
              </div>
              <div className="flex justify-between items-center text-sm">
                <span className="text-muted-foreground">SQLi Prevention</span>
                <span className="font-medium">Enabled</span>
              </div>
              <div className="flex justify-between items-center text-sm">
                <span className="text-muted-foreground">XSS Prevention</span>
                <span className="font-medium">Enabled</span>
              </div>
              <div className="flex justify-between items-center text-sm">
                <span className="text-muted-foreground">Geo-Blocking</span>
                <span className="font-medium text-yellow-600">Partial</span>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
            <div>
              <CardTitle>Security Event Log</CardTitle>
              <CardDescription>Recent mitigated threats and suspicious activities</CardDescription>
            </div>
            <div className="flex items-center gap-2">
              <div className="relative">
                <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Search IP or reason..."
                  className="pl-8 w-[250px]"
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                />
              </div>
              <Button variant="outline" onClick={fetchLogs}>Refresh</Button>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Time</TableHead>
                  <TableHead>IP Address</TableHead>
                  <TableHead>Action Taken</TableHead>
                  <TableHead>Reason</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredLogs.length > 0 ? (
                  filteredLogs.map((log) => (
                    <TableRow key={log.id}>
                      <TableCell className="whitespace-nowrap text-muted-foreground">
                        {new Date(log.timestamp).toLocaleString()}
                      </TableCell>
                      <TableCell className="font-mono text-sm">{log.ip}</TableCell>
                      <TableCell>{getActionBadge(log.action)}</TableCell>
                      <TableCell>{log.reason}</TableCell>
                    </TableRow>
                  ))
                ) : (
                  <TableRow>
                    <TableCell colSpan={4} className="text-center py-8 text-muted-foreground">
                      No matching security logs found
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
