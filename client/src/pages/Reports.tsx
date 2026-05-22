import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Breadcrumb, BreadcrumbItem } from '@/components/Breadcrumb';
import { ThemeToggle } from '@/components/ui/ThemeToggle';
import { Skeleton } from '@/components/ui/skeleton';
import api from '@/lib/api';
import { Download, FileText, Calendar, BarChart3, Users, Clock, TrendingUp } from 'lucide-react';

interface ReportTemplate {
  id: string;
  name: string;
  description: string;
  category: string;
  icon: string;
}

const templates: ReportTemplate[] = [
  { id: 'attendance', name: 'Monthly Attendance', description: 'Summary of employee attendance for the month', category: 'Attendance', icon: 'Calendar' },
  { id: 'leave', name: 'Leave Balance', description: 'Leave balance report for all employees', category: 'Leave', icon: 'Calendar' },
  { id: 'overtime', name: 'Overtime Report', description: 'Overtime hours worked by employees', category: 'Attendance', icon: 'Clock' },
  { id: 'late', name: 'Late Arrivals', description: 'Employees who arrived late this month', category: 'Attendance', icon: 'TrendingUp' },
  { id: 'project', name: 'Project Hours', description: 'Hours logged on projects by team', category: 'Projects', icon: 'BarChart3' },
  { id: 'payroll', name: 'Payroll Data', description: 'Payroll-ready data export', category: 'Payroll', icon: 'Users' },
];

export default function Reports() {
  const [selectedTemplate, setSelectedTemplate] = useState<string | null>(null);
  const [dateRange, setDateRange] = useState({ start: '', end: '' });
  const [department, setDepartment] = useState('all');

  const breadcrumbs: BreadcrumbItem[] = [
    { label: 'Dashboard', href: '/admin' },
    { label: 'Reports' },
  ];

  const { data: reportData, isLoading } = useQuery({
    queryKey: ['reports', selectedTemplate, dateRange, department],
    queryFn: async () => {
      if (!selectedTemplate) return null;
      const response = await api.get(`/reports/${selectedTemplate}`, {
        params: { start_date: dateRange.start, end_date: dateRange.end, department },
      });
      return response.data.data || response.data;
    },
    enabled: !!selectedTemplate,
  });

  const handleExport = (format: 'pdf' | 'excel' | 'csv') => {
    console.log('Exporting as', format);
  };

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <Breadcrumb items={breadcrumbs} />
        <ThemeToggle />
      </div>

      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Reports</h1>
          <p className="text-muted-foreground">Generate and export business reports</p>
        </div>
      </div>

      <Tabs defaultValue="templates">
        <TabsList>
          <TabsTrigger value="templates">Templates</TabsTrigger>
          <TabsTrigger value="custom">Custom Builder</TabsTrigger>
          <TabsTrigger value="history">History</TabsTrigger>
        </TabsList>

        <TabsContent value="templates" className="mt-6">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {templates.map((template) => (
              <Card 
                key={template.id} 
                className={`cursor-pointer hover:shadow-md transition-all ${selectedTemplate === template.id ? 'border-primary ring-2 ring-primary/20' : ''}`}
                onClick={() => setSelectedTemplate(template.id)}
              >
                <CardHeader className="pb-3">
                  <div className="flex items-center gap-2">
                    <div className="p-2 rounded-lg bg-primary/10">
                      <FileText className="w-5 h-5 text-primary" />
                    </div>
                    <CardTitle className="text-base">{template.name}</CardTitle>
                  </div>
                </CardHeader>
                <CardContent>
                  <p className="text-sm text-muted-foreground">{template.description}</p>
                  <Badge variant="secondary" className="mt-2">{template.category}</Badge>
                </CardContent>
              </Card>
            ))}
          </div>

          {selectedTemplate && (
            <Card className="mt-6">
              <CardHeader>
                <CardTitle>Generate Report</CardTitle>
                <CardDescription>Configure options for {templates.find(t => t.id === selectedTemplate)?.name}</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div className="space-y-2">
                    <Label>Start Date</Label>
                    <Input
                      type="date"
                      value={dateRange.start}
                      onChange={(e) => setDateRange({ ...dateRange, start: e.target.value })}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>End Date</Label>
                    <Input
                      type="date"
                      value={dateRange.end}
                      onChange={(e) => setDateRange({ ...dateRange, end: e.target.value })}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Department</Label>
                    <Select value={department} onValueChange={setDepartment}>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">All Departments</SelectItem>
                        <SelectItem value="engineering">Engineering</SelectItem>
                        <SelectItem value="sales">Sales</SelectItem>
                        <SelectItem value="marketing">Marketing</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                <div className="flex gap-2">
                  <Button onClick={() => {}}>Generate Report</Button>
                  <Button variant="outline" onClick={() => handleExport('pdf')} className="gap-2">
                    <Download className="w-4 h-4" />
                    PDF
                  </Button>
                  <Button variant="outline" onClick={() => handleExport('excel')} className="gap-2">
                    <Download className="w-4 h-4" />
                    Excel
                  </Button>
                  <Button variant="outline" onClick={() => handleExport('csv')} className="gap-2">
                    <Download className="w-4 h-4" />
                    CSV
                  </Button>
                </div>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        <TabsContent value="custom" className="mt-6">
          <Card>
            <CardHeader>
              <CardTitle>Custom Report Builder</CardTitle>
              <CardDescription>Build your own report with drag-and-drop fields</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="text-center py-12 text-muted-foreground">
                <BarChart3 className="w-12 h-12 mx-auto mb-4 opacity-50" />
                <p>Drag and drop fields to build your custom report</p>
                <p className="text-sm">Coming soon...</p>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="history" className="mt-6">
          <Card>
            <CardHeader>
              <CardTitle>Report History</CardTitle>
              <CardDescription>Previously generated reports</CardDescription>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Report</TableHead>
                    <TableHead>Generated</TableHead>
                    <TableHead>Period</TableHead>
                    <TableHead>Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  <TableRow>
                    <TableCell>Monthly Attendance</TableCell>
                    <TableCell>May 15, 2026</TableCell>
                    <TableCell>Apr 2026</TableCell>
                    <TableCell>
                      <Button variant="ghost" size="sm">
                        <Download className="w-4 h-4" />
                      </Button>
                    </TableCell>
                  </TableRow>
                  <TableRow>
                    <TableCell>Leave Balance</TableCell>
                    <TableCell>May 10, 2026</TableCell>
                    <TableCell>Q1 2026</TableCell>
                    <TableCell>
                      <Button variant="ghost" size="sm">
                        <Download className="w-4 h-4" />
                      </Button>
                    </TableCell>
                  </TableRow>
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}