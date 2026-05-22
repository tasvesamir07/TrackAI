import { useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ThumbsUp, MessageSquare, Plus, Star } from 'lucide-react';
import { Input } from '@/components/ui/input';

export function FeatureVoting() {
  const [ideas, setIdeas] = useState([
    { id: 1, title: 'Dark Mode for Mobile App', description: 'Enable dark mode to save battery and reduce eye strain.', votes: 156, status: 'Planned' },
    { id: 2, title: 'Export Reports to Excel', description: 'Add ability to download attendance and task reports in .xlsx format.', votes: 89, status: 'Review' },
    { id: 3, title: 'Team Chat Gifs', description: 'Support Giphy integration in the team chat.', votes: 42, status: 'Backlog' },
  ]);

  const handleVote = (id: number) => {
    setIdeas(ideas.map(i => i.id === id ? { ...i, votes: i.votes + 1 } : i));
  };

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h2 className="text-2xl font-bold tracking-tight">Feature Voting</h2>
          <p className="text-muted-foreground">Shape the future of Track AI. Vote for upcoming features or suggest new ones.</p>
        </div>
        <Button>
          <Plus className="w-4 h-4 mr-2" />
          Suggest Feature
        </Button>
      </div>

      <div className="grid grid-cols-1 gap-4">
        {ideas.sort((a, b) => b.votes - a.votes).map(idea => (
          <Card key={idea.id} className="hover:shadow-sm transition-shadow">
            <CardContent className="p-6 flex items-start gap-6">
              <div className="flex flex-col items-center gap-1 p-2 border rounded-lg bg-slate-50 min-w-[60px]">
                <Button variant="ghost" size="icon" className="h-8 w-8 text-blue-600" onClick={() => handleVote(idea.id)}>
                  <ThumbsUp className="w-5 h-5" />
                </Button>
                <span className="font-bold text-lg">{idea.votes}</span>
              </div>
              <div className="flex-1 space-y-2">
                <div className="flex items-center justify-between">
                  <h3 className="font-bold text-lg">{idea.title}</h3>
                  <Badge variant={idea.status === 'Planned' ? 'default' : 'secondary'}>
                    {idea.status}
                  </Badge>
                </div>
                <p className="text-muted-foreground">{idea.description}</p>
                <div className="flex items-center gap-4 pt-2">
                  <span className="flex items-center text-sm text-muted-foreground">
                    <MessageSquare className="w-4 h-4 mr-1" />
                    12 comments
                  </span>
                  <span className="flex items-center text-sm text-muted-foreground">
                    <Star className="w-4 h-4 mr-1" />
                    Top Request
                  </span>
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}