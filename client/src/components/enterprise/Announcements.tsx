import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Bell, Plus, Pin, Clock } from 'lucide-react';

interface Announcement {
  id: string;
  title: string;
  content: string;
  priority: string;
  is_pinned: boolean;
  starts_at: string;
  ends_at: string;
  created_at: string;
}

export function Announcements() {
  const [announcements, setAnnouncements] = useState<Announcement[]>([]);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ title: '', content: '', priority: 'normal', isPinned: false });

  useEffect(() => {
    fetch('/api/enterprise/announcements').then(r => r.json()).then(d => setAnnouncements(d.data || []));
  }, []);

  const handleCreate = async () => {
    await fetch('/api/enterprise/announcements', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(form)
    });
    setOpen(false);
    const res = await fetch('/api/enterprise/announcements');
    const d = await res.json();
    setAnnouncements(d.data || []);
  };

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="flex items-center gap-2">
          <Bell className="w-5 h-5" />
          Announcements
        </CardTitle>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button size="sm" className="gap-1"><Plus className="w-4 h-4" />New</Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle>Create Announcement</DialogTitle></DialogHeader>
            <div className="space-y-4 pt-4">
              <Input placeholder="Title" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
              <Textarea placeholder="Content" value={form.content} onChange={(e) => setForm({ ...form, content: e.target.value })} rows={4} />
              <Select value={form.priority} onValueChange={(v) => setForm({ ...form, priority: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="low">Low</SelectItem>
                  <SelectItem value="normal">Normal</SelectItem>
                  <SelectItem value="high">High</SelectItem>
                  <SelectItem value="urgent">Urgent</SelectItem>
                </SelectContent>
              </Select>
              <div className="flex items-center gap-2">
                <Switch checked={form.isPinned} onCheckedChange={(v) => setForm({ ...form, isPinned: v })} />
                <Label>Pin to top</Label>
              </div>
              <Button onClick={handleCreate} className="w-full">Publish</Button>
            </div>
          </DialogContent>
        </Dialog>
      </CardHeader>
      <CardContent className="space-y-3">
        {announcements.length === 0 ? (
          <p className="text-muted-foreground text-center py-8">No announcements yet</p>
        ) : (
          announcements.map((a) => (
            <div key={a.id} className={`p-4 rounded-lg border ${a.is_pinned ? 'bg-yellow-50 border-yellow-200' : 'bg-background'}`}>
              <div className="flex items-start justify-between gap-2">
                <div className="flex items-center gap-2">
                  {a.is_pinned && <Pin className="w-4 h-4 text-yellow-600" />}
                  <h4 className="font-medium">{a.title}</h4>
                  <span className={`text-xs px-2 py-0.5 rounded ${a.priority === 'urgent' ? 'bg-red-100 text-red-700' : 'bg-gray-100'}`}>{a.priority}</span>
                </div>
              </div>
              <p className="text-sm text-muted-foreground mt-2">{a.content}</p>
              <div className="flex items-center gap-1 mt-2 text-xs text-muted-foreground">
                <Clock className="w-3 h-3" />
                {new Date(a.created_at).toLocaleDateString()}
              </div>
            </div>
          ))
        )}
      </CardContent>
    </Card>
  );
}