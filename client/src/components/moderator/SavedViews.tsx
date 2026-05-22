import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Search, Save, Filter, Star, Clock, MoreVertical } from 'lucide-react';
import { useState } from 'react';

export function SavedViews() {
  const [searchTerm, setSearchTerm] = useState('');
  const [savedViews] = useState([
    { id: 1, name: 'Active Engineering Tasks', filters: 'Dept: Engineering, Status: Active', lastUsed: '2 hours ago' },
    { id: 2, name: 'High Priority Overdue', filters: 'Priority: High, Status: Overdue', lastUsed: 'Yesterday' },
    { id: 3, name: 'Q2 Performance Reviews', filters: 'Category: Review, Date: Q2 2026', lastUsed: '3 days ago' },
  ]);

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h2 className="text-2xl font-bold tracking-tight">Saved Views & Filters</h2>
          <p className="text-muted-foreground">Quickly access your frequently used search criteria and team views.</p>
        </div>
        <Button>
          <Save className="w-4 h-4 mr-2" />
          Save Current View
        </Button>
      </div>

      <div className="flex items-center gap-2">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input 
            placeholder="Search saved views..." 
            className="pl-8" 
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
          />
        </div>
        <Button variant="outline">
          <Filter className="w-4 h-4 mr-2" />
          Filter
        </Button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {savedViews.map(view => (
          <Card key={view.id} className="hover:border-blue-300 transition-colors cursor-pointer group">
            <CardHeader className="pb-3 flex flex-row items-start justify-between space-y-0">
              <div className="space-y-1">
                <CardTitle className="text-base flex items-center gap-2">
                  <Star className="w-4 h-4 text-amber-400 fill-amber-400" />
                  {view.name}
                </CardTitle>
                <CardDescription className="text-xs line-clamp-1">{view.filters}</CardDescription>
              </div>
              <Button variant="ghost" size="icon" className="h-8 w-8 opacity-0 group-hover:opacity-100 transition-opacity">
                <MoreVertical className="w-4 h-4" />
              </Button>
            </CardHeader>
            <CardContent>
              <div className="flex items-center text-[10px] font-bold text-muted-foreground uppercase tracking-wider">
                <Clock className="w-3 h-3 mr-1" />
                Last used {view.lastUsed}
              </div>
            </CardContent>
          </Card>
        ))}
        
        <Card className="border-dashed border-2 flex items-center justify-center p-6 bg-slate-50/50 hover:bg-slate-50 transition-colors cursor-pointer">
          <div className="text-center">
            <div className="w-10 h-10 rounded-full bg-slate-200 flex items-center justify-center mx-auto mb-2 text-slate-500">
              <Plus className="w-6 h-6" />
            </div>
            <p className="text-sm font-medium text-slate-600">Create New View</p>
          </div>
        </Card>
      </div>
    </div>
  );
}

function Plus({ className }: any) {
  return <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6m0 0v6m0-6h6m-6 0H6" /></svg>;
}