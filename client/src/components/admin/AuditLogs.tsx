import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Input } from '@/components/ui/input';
import { Search, ShieldAlert, Activity, LogIn, Lock } from 'lucide-react';
import api from '@/lib/api';

export function AuditLogs() {
  const [searchTerm, setSearchTerm] = useState('');

  const { data: logs, isLoading } = useQuery({
    queryKey: ['audit-logs'],
    queryFn: async () => {
      const res = await api.get('/security/audit-logs');
      return res.data.logs || [];
    }
  });

  const getActionIcon = (action: string) => {
    const a = action.toLowerCase();
    if (a.includes('login') || a.includes('auth')) return <LogIn className="w-4 h-4 text-blue-500" />;
    if (a.includes('security') || a.includes('password')) return <Lock className="w-4 h-4 text-amber-500" />;
    if (a.includes('delete') || a.includes('remove')) return <ShieldAlert className="w-4 h-4 text-red-500" />;
    return <Activity className="w-4 h-4 text-slate-500" />;
  };

  const filteredLogs = (logs || []).filter((log: any) => 
    (log.action || '').toLowerCase().includes(searchTerm.toLowerCase()) ||
    (log.username || '').toLowerCase().includes(searchTerm.toLowerCase()) ||
    (log.ip_address || '').includes(searchTerm)
  );

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
          <div>
            <CardTitle>System Audit Logs</CardTitle>
            <CardDescription>Track administrative actions and security events</CardDescription>
          </div>
          <div className="relative">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search logs..."
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
                <TableHead>Timestamp</TableHead>
                <TableHead>User</TableHead>
                <TableHead>Action</TableHead>
                <TableHead>IP Address</TableHead>
                <TableHead>Details</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow>
                  <TableCell colSpan={5} className="h-24 text-center">Loading audit logs...</TableCell>
                </TableRow>
              ) : filteredLogs.length > 0 ? (
                filteredLogs.map((log: any, i: number) => (
                  <TableRow key={log.id || i}>
                    <TableCell className="whitespace-nowrap text-sm text-muted-foreground">
                      {new Date(log.created_at).toLocaleString()}
                    </TableCell>
                    <TableCell className="font-medium">{log.username || 'System'}</TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        {getActionIcon(log.action)}
                        <span className="text-sm font-medium">{log.action}</span>
                      </div>
                    </TableCell>
                    <TableCell className="font-mono text-xs">{log.ip_address || '---'}</TableCell>
                    <TableCell className="text-sm text-muted-foreground max-w-[200px] truncate" title={log.details}>
                      {log.details || 'No details'}
                    </TableCell>
                  </TableRow>
                ))
              ) : (
                <TableRow>
                  <TableCell colSpan={5} className="h-24 text-center text-muted-foreground">
                    No audit logs found matching your criteria.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  );
}