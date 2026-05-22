import { useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Search, Book, FileText, Plus, ExternalLink, MoreVertical } from 'lucide-react';

export function KnowledgeBase() {
  const [searchTerm, setSearchTerm] = useState('');

  const articles = [
    { id: 1, title: 'Company Holiday Policy 2026', category: 'HR', reads: 142, lastUpdated: '2026-01-10' },
    { id: 2, title: 'Engineering Onboarding Guide', category: 'Engineering', reads: 89, lastUpdated: '2026-03-15' },
    { id: 3, title: 'Travel Expense Reimbursement', category: 'Finance', reads: 256, lastUpdated: '2025-11-20' },
    { id: 4, title: 'Performance Review Guidelines', category: 'Management', reads: 310, lastUpdated: '2026-04-05' },
  ];

  const filteredArticles = articles.filter(a => a.title.toLowerCase().includes(searchTerm.toLowerCase()));

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h2 className="text-2xl font-bold tracking-tight">Knowledge Base</h2>
          <p className="text-muted-foreground">Manage company wikis, policies, and onboarding documents.</p>
        </div>
        <Button>
          <Plus className="w-4 h-4 mr-2" />
          New Article
        </Button>
      </div>

      <div className="flex items-center gap-4">
        <div className="relative flex-1 max-w-lg">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search articles by title..."
            className="pl-8"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
          />
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {filteredArticles.map(article => (
          <Card key={article.id} className="hover:shadow-md transition-shadow">
            <CardHeader className="flex flex-row items-start justify-between space-y-0 pb-2">
              <div className="space-y-1">
                <CardTitle className="text-base font-semibold leading-tight line-clamp-2">
                  {article.title}
                </CardTitle>
                <div className="flex items-center text-xs text-muted-foreground">
                  <Book className="w-3 h-3 mr-1" />
                  {article.category}
                </div>
              </div>
              <Button variant="ghost" size="icon" className="-mt-2 -mr-2">
                <MoreVertical className="w-4 h-4" />
              </Button>
            </CardHeader>
            <CardContent>
              <div className="flex items-center justify-between text-xs text-muted-foreground mt-4">
                <span className="flex items-center">
                  <FileText className="w-3 h-3 mr-1" />
                  {article.reads} reads
                </span>
                <span>Updated: {new Date(article.lastUpdated).toLocaleDateString()}</span>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}