import { useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Check, X, Eye, Clock, User, ClipboardList } from 'lucide-react';

export function ApprovalWorkflows() {
  const [approvals, setApprovals] = useState([
    { id: 1, type: 'Leave Request', requester: 'Alice Johnson', details: 'Medical Leave (3 days)', status: 'Pending', date: '2026-05-20' },
    { id: 2, type: 'Timesheet', requester: 'Bob Smith', details: 'Week 20 - 40 hours', status: 'Pending', date: '2026-05-21' },
    { id: 3, type: 'Expense', requester: 'Charlie Davis', details: 'Client Lunch - $120', status: 'Pending', date: '2026-05-19' },
    { id: 4, type: 'Project Milestone', requester: 'Project Alpha', details: 'Phase 1 Completion', status: 'Pending', date: '2026-05-21' },
  ]);

  const handleAction = (id: number, action: 'approve' | 'reject') => {
    setApprovals(approvals.filter(a => a.id !== id));
    // In a real app, this would call an API
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Approval Workflows</CardTitle>
        <CardDescription>Review and approve pending requests from your team</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Type</TableHead>
                <TableHead>Requester</TableHead>
                <TableHead>Details</TableHead>
                <TableHead>Submitted</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {approvals.length > 0 ? (
                approvals.map((a) => (
                  <TableRow key={a.id}>
                    <TableCell>
                      <div className="flex items-center gap-2 font-medium">
                        <ClipboardList className="w-4 h-4 text-muted-foreground" />
                        {a.type}
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <User className="w-4 h-4 text-muted-foreground" />
                        {a.requester}
                      </div>
                    </TableCell>
                    <TableCell className="text-muted-foreground">{a.details}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {new Date(a.date).toLocaleDateString()}
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline" className="text-amber-600 border-amber-600">
                        <Clock className="w-3 h-3 mr-1" />
                        {a.status}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-2">
                        <Button variant="ghost" size="icon" className="h-8 w-8 text-green-600" onClick={() => handleAction(a.id, 'approve')}>
                          <Check className="w-4 h-4" />
                        </Button>
                        <Button variant="ghost" size="icon" className="h-8 w-8 text-red-600" onClick={() => handleAction(a.id, 'reject')}>
                          <X className="w-4 h-4" />
                        </Button>
                        <Button variant="ghost" size="icon" className="h-8 w-8">
                          <Eye className="w-4 h-4" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))
              ) : (
                <TableRow>
                  <TableCell colSpan={6} className="h-24 text-center text-muted-foreground">
                    All clear! No pending approvals.
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