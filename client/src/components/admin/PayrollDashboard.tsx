import { useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Search, Download, DollarSign, FileText, CheckCircle, Clock } from 'lucide-react';
import { Badge } from '@/components/ui/badge';

export function PayrollDashboard() {
  const [searchTerm, setSearchTerm] = useState('');

  // Mock data for UI demonstration
  const payrolls = [
    { id: 1, employee: 'Alice Johnson', role: 'Senior Developer', salary: '$8,500', status: 'Paid', date: '2026-05-01' },
    { id: 2, employee: 'Bob Smith', role: 'UI Designer', salary: '$6,200', status: 'Pending', date: '2026-06-01' },
    { id: 3, employee: 'Charlie Davis', role: 'Project Manager', salary: '$7,800', status: 'Paid', date: '2026-05-01' },
    { id: 4, employee: 'Diana Prince', role: 'QA Tester', salary: '$5,400', status: 'Processing', date: '2026-05-25' },
  ];

  const filteredPayrolls = payrolls.filter(p => p.employee.toLowerCase().includes(searchTerm.toLowerCase()));

  const getStatusBadge = (status: string) => {
    switch(status) {
      case 'Paid': return <Badge className="bg-green-100 text-green-800 hover:bg-green-100"><CheckCircle className="w-3 h-3 mr-1"/> Paid</Badge>;
      case 'Pending': return <Badge variant="outline" className="text-amber-600 border-amber-600"><Clock className="w-3 h-3 mr-1"/> Pending</Badge>;
      case 'Processing': return <Badge variant="secondary" className="text-blue-600 bg-blue-100"><Clock className="w-3 h-3 mr-1"/> Processing</Badge>;
      default: return <Badge>{status}</Badge>;
    }
  }

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card>
          <CardContent className="p-6 flex items-center justify-between">
            <div>
              <p className="text-sm text-muted-foreground font-medium">Next Payroll Run</p>
              <h3 className="text-2xl font-bold mt-1">May 25, 2026</h3>
            </div>
            <div className="p-3 bg-blue-50 text-blue-600 rounded-full">
              <Clock className="w-6 h-6" />
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-6 flex items-center justify-between">
            <div>
              <p className="text-sm text-muted-foreground font-medium">Total Monthly Payroll</p>
              <h3 className="text-2xl font-bold mt-1">$145,250</h3>
            </div>
            <div className="p-3 bg-green-50 text-green-600 rounded-full">
              <DollarSign className="w-6 h-6" />
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-6 flex items-center justify-between">
            <div>
              <p className="text-sm text-muted-foreground font-medium">Processed this Month</p>
              <h3 className="text-2xl font-bold mt-1">42 / 45</h3>
            </div>
            <div className="p-3 bg-purple-50 text-purple-600 rounded-full">
              <FileText className="w-6 h-6" />
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <div className="flex flex-col sm:flex-row justify-between sm:items-center gap-4">
            <div>
              <CardTitle>Payroll Management</CardTitle>
              <CardDescription>Manage employee salaries, bonuses, and generate payslips</CardDescription>
            </div>
            <div className="flex gap-2">
              <div className="relative">
                <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Search employees..."
                  className="pl-8 w-[250px]"
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                />
              </div>
              <Button>Run Payroll</Button>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Employee</TableHead>
                  <TableHead>Role</TableHead>
                  <TableHead>Base Salary</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Next/Last Pay Date</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredPayrolls.map((payroll) => (
                  <TableRow key={payroll.id}>
                    <TableCell className="font-medium">{payroll.employee}</TableCell>
                    <TableCell className="text-muted-foreground">{payroll.role}</TableCell>
                    <TableCell>{payroll.salary}</TableCell>
                    <TableCell>{getStatusBadge(payroll.status)}</TableCell>
                    <TableCell className="text-muted-foreground">{new Date(payroll.date).toLocaleDateString()}</TableCell>
                    <TableCell className="text-right">
                      <Button variant="ghost" size="sm">
                        <Download className="w-4 h-4 mr-2" />
                        Payslip
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}