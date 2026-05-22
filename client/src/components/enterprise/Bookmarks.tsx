import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Bookmark, Plus, Trash2, ExternalLink } from 'lucide-react';

interface Bookmark {
  id: string;
  title: string;
  url: string;
  icon: string;
}

export function Bookmarks() {
  const [bookmarks, setBookmarks] = useState<Bookmark[]>([]);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ title: '', url: '', icon: '' });

  useEffect(() => {
    fetch('/api/enterprise/bookmarks').then(r => r.json()).then(d => setBookmarks(d.data || []));
  }, []);

  const handleAdd = async () => {
    await fetch('/api/enterprise/bookmarks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(form)
    });
    setOpen(false);
    setForm({ title: '', url: '', icon: '' });
    const res = await fetch('/api/enterprise/bookmarks');
    const d = await res.json();
    setBookmarks(d.data || []);
  };

  const handleDelete = async (id: string) => {
    await fetch(`/api/enterprise/bookmarks/${id}`, { method: 'DELETE' });
    setBookmarks(bookmarks.filter(b => b.id !== id));
  };

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="flex items-center gap-2">
          <Bookmark className="w-5 h-5" />
          Quick Links
        </CardTitle>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button size="sm" className="gap-1"><Plus className="w-4 h-4" />Add</Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle>Add Bookmark</DialogTitle></DialogHeader>
            <div className="space-y-4 pt-4">
              <Input placeholder="Title" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
              <Input placeholder="URL" value={form.url} onChange={(e) => setForm({ ...form, url: e.target.value })} />
              <Input placeholder="Icon (emoji)" value={form.icon} onChange={(e) => setForm({ ...form, icon: e.target.value })} />
              <Button onClick={handleAdd} disabled={!form.title || !form.url} className="w-full">Add</Button>
            </div>
          </DialogContent>
        </Dialog>
      </CardHeader>
      <CardContent>
        {bookmarks.length === 0 ? (
          <p className="text-muted-foreground text-center py-4">No bookmarks yet</p>
        ) : (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
            {bookmarks.map((b) => (
              <div key={b.id} className="group relative flex items-center gap-2 p-3 rounded-lg border hover:bg-muted/50 transition-colors">
                <a href={b.url} target="_blank" rel="noopener noreferrer" className="flex items-center gap-2 flex-1 min-w-0">
                  <span className="text-lg">{b.icon || '🔗'}</span>
                  <span className="truncate text-sm">{b.title}</span>
                  <ExternalLink className="w-3 h-3 text-muted-foreground" />
                </a>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6 opacity-0 group-hover:opacity-100"
                  onClick={() => handleDelete(b.id)}
                >
                  <Trash2 className="w-3 h-3 text-red-500" />
                </Button>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}