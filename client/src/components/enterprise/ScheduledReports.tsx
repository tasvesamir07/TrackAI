import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Calendar, Plus, Play, Trash2 } from 'lucide-react';

interface ScheduledReport {
  id: string;
  name: string;
  report_type: string;
  frequency: string;
  is_active: boolean;
  next_run_at: string;
}

export function ScheduledReports() {
  const [reports, setReports] = useState<ScheduledReport[]>([]);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ name: '', reportType: 'attendance', frequency: 'weekly', recipients: '' });

  useEffect(() => {
    fetch('/api/enterprise/scheduled-reports').then(r => r.json()).then(d => setReports(d.data || []));
  }, []);

  const handleCreate = async () => {
    await fetch('/api/enterprise/scheduled-reports', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...form, recipients: form.recipients.split(',').map(e => e.trim()) })
    });
    setOpen(false);
    const res = await fetch('/api/enterprise/scheduled-reports');
    const d = await res.json();
    setReports(d.data || []);
  };

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="flex items-center gap-2">
          <Calendar className="w-5 h-5" />
          Scheduled Reports
        </CardTitle>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button size="sm" className="gap-1"><Plus className="w-4 h-4" />Schedule</Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle>Schedule Report</DialogTitle></DialogHeader>
            <div className="space-y-4 pt-4">
              <Input placeholder="Report Name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
              <Select value={form.reportType} onValueChange={(v) => setForm({ ...form, reportType: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="attendance">Attendance</SelectItem>
                  <SelectItem value="leave">Leave</SelectItem>
                  <SelectItem value="payroll">Payroll</SelectItem>
                  <SelectItem value="projects">Projects</SelectItem>
                </SelectContent>
              </Select>
              <Select value={form.frequency} onValueChange={(v) => setForm({ ...form, frequency: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="daily">Daily</SelectItem>
                  <SelectItem value="weekly">Weekly</SelectItem>
                  <SelectItem value="monthly">Monthly</SelectItem>
                </SelectContent>
              </Select>
              <Input placeholder="Recipients (comma-separated emails)" value={form.recipients} onChange={(e) => setForm({ ...form, recipients: e.target.value })} />
              <Button onClick={handleCreate} disabled={!form.name} className="w-full">Schedule</Button>
            </div>
          </DialogContent>
        </Dialog>
      </CardHeader>
      <CardContent>
        {reports.length === 0 ? (
          <p className="text-muted-foreground text-center py-8">No scheduled reports</p>
        ) : (
          <div className="space-y-2">
            {reports.map((r) => (
              <div key={r.id} className="flex items-center justify-between p-4 rounded-lg border">
                <div>
                  <h4 className="font-medium">{r.name}</h4>
                  <p className="text-sm text-muted-foreground">{r.report_type} • {r.frequency}</p>
                  <p className="text-xs text-muted-foreground mt-1">Next: {new Date(r.next_run_at).toLocaleString()}</p>
                </div>
                <div className="flex items-center gap-2">
                  <Switch checked={r.is_active} />
                  <Button variant="ghost" size="icon"><Trash2 className="w-4 h-4 text-red-500" /></Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}