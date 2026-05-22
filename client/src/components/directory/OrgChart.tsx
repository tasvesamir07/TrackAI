import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Search, Award, ChevronDown, ChevronRight, ZoomIn, ZoomOut } from 'lucide-react';
import api from '@/lib/api';
import { cn } from '@/lib/utils';

interface OrgNode {
  id: string;
  name: string;
  title: string;
  department: string;
  profilePicture?: string;
  reportsTo?: string;
  children?: OrgNode[];
}

interface OrgChartProps {
  initialData?: OrgNode[];
}

export function OrgChart({ initialData }: OrgChartProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [expandedNodes, setExpandedNodes] = useState<Set<string>>(new Set());
  const [zoom, setZoom] = useState(1);

  const { data: orgData } = useQuery({
    queryKey: ['org-chart'],
    queryFn: async () => {
      const response = await api.get('/admin/org-chart');
      return response.data.data || response.data;
    },
  });

  const nodes: OrgNode[] = orgData || initialData || [];

  const toggleNode = (nodeId: string) => {
    setExpandedNodes(prev => {
      const newSet = new Set(prev);
      if (newSet.has(nodeId)) {
        newSet.delete(nodeId);
      } else {
        newSet.add(nodeId);
      }
      return newSet;
    });
  };

  const filteredNodes = searchQuery 
    ? nodes.filter(n => n.name.toLowerCase().includes(searchQuery.toLowerCase()) || n.department.toLowerCase().includes(searchQuery.toLowerCase()))
    : nodes;

  const renderNode = (node: OrgNode, level = 0) => {
    const hasChildren = node.children && node.children.length > 0;
    const isExpanded = expandedNodes.has(node.id);

    return (
      <div key={node.id} className="flex flex-col">
        <div 
          className={cn(
            'flex items-center gap-3 p-3 rounded-lg border bg-card hover:shadow-md transition-shadow cursor-pointer',
            'ml-' + (level * 12)
          )}
          style={{ marginLeft: level * 24 }}
        >
          {hasChildren && (
            <button onClick={() => toggleNode(node.id)} className="p-1 hover:bg-muted rounded">
              {isExpanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
            </button>
          )}
          {!hasChildren && <div className="w-6" />}
          
          <Avatar className="w-10 h-10">
            <AvatarImage src={node.profilePicture} />
            <AvatarFallback>{node.name.charAt(0)}</AvatarFallback>
          </Avatar>
          
          <div className="flex-1 min-w-0">
            <div className="font-medium">{node.name}</div>
            <div className="text-sm text-muted-foreground">{node.title}</div>
          </div>
          
          <Badge variant="secondary">{node.department}</Badge>
        </div>
        
        {hasChildren && isExpanded && (
          <div className="border-l-2 border-muted ml-4">
            {node.children!.map(child => renderNode(child, level + 1))}
          </div>
        )}
      </div>
    );
  };

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle>Organization Chart</CardTitle>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="icon" onClick={() => setZoom(z => Math.max(0.5, z - 0.1))}>
              <ZoomOut className="w-4 h-4" />
            </Button>
            <span className="text-sm">{Math.round(zoom * 100)}%</span>
            <Button variant="outline" size="icon" onClick={() => setZoom(z => Math.min(1.5, z + 0.1))}>
              <ZoomIn className="w-4 h-4" />
            </Button>
          </div>
        </div>
        <div className="relative mt-2">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            placeholder="Search employees..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-10"
          />
        </div>
      </CardHeader>
      <CardContent style={{ transform: `scale(${zoom})`, transformOrigin: 'top left' }}>
        <div className="space-y-2">
          {filteredNodes.map(node => renderNode(node))}
        </div>
      </CardContent>
    </Card>
  );
}

export function PeerRecognition() {
  const [selectedBadge, setSelectedBadge] = useState<string | null>(null);

  const badges = [
    { id: 'teamwork', label: 'Team Player', icon: '🤝', color: 'bg-blue-100' },
    { id: 'innovation', label: 'Innovation', icon: '💡', color: 'bg-purple-100' },
    { id: 'leadership', label: 'Leadership', icon: '⭐', color: 'bg-yellow-100' },
    { id: 'dedication', label: 'Dedication', icon: '🔥', color: 'bg-orange-100' },
    { id: 'helpfulness', label: 'Helpful', icon: '🤗', color: 'bg-green-100' },
  ];

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Award className="w-5 h-5" />
          Peer Recognition
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-3 gap-3">
          {badges.map((badge) => (
            <button
              key={badge.id}
              onClick={() => setSelectedBadge(badge.id)}
              className={cn(
                'p-4 rounded-lg border text-center hover:shadow-md transition-all',
                selectedBadge === badge.id ? 'border-primary ring-2 ring-primary/20' : ''
              )}
            >
              <div className="text-2xl mb-1">{badge.icon}</div>
              <div className="text-sm font-medium">{badge.label}</div>
            </button>
          ))}
        </div>
        
        {selectedBadge && (
          <div className="mt-4 p-4 bg-muted rounded-lg">
            <p className="text-sm text-muted-foreground">
              Select a colleague to recognize with the "{badges.find(b => b.id === selectedBadge)?.label}" badge.
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}