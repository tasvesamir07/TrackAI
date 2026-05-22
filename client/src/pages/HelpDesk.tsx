import { useState } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Breadcrumb, BreadcrumbItem } from '@/components/Breadcrumb';
import { ThemeToggle } from '@/components/ui/ThemeToggle';
import api from '@/lib/api';
import { Ticket, Plus, Search, Clock, CheckCircle, AlertCircle, MessageCircle } from 'lucide-react';

interface Ticket {
  id: string;
  subject: string;
  description: string;
  category: string;
  priority: string;
  status: string;
  createdAt: string;
  assignedTo?: string;
}

export default function HelpDesk() {
  const [showNewTicket, setShowNewTicket] = useState(false);
  const [newTicket, setNewTicket] = useState({ subject: '', description: '', category: '', priority: 'medium' });

  const breadcrumbs: BreadcrumbItem[] = [
    { label: 'Dashboard', href: '/admin' },
    { label: 'Help Desk' },
  ];

  const { data: tickets, isLoading, refetch } = useQuery({
    queryKey: ['support-tickets'],
    queryFn: async () => {
      const response = await api.get('/support/tickets');
      return response.data.data || response.data;
    },
  });

  const createMutation = useMutation({
    mutationFn: (data: typeof newTicket) => api.post('/support/tickets', data),
    onSuccess: () => {
      setShowNewTicket(false);
      setNewTicket({ subject: '', description: '', category: '', priority: 'medium' });
      refetch();
    },
  });

  const handleCreateTicket = () => {
    createMutation.mutate(newTicket);
  };

  const getPriorityColor = (priority: string) => {
    switch (priority) {
      case 'urgent': return 'bg-red-100 text-red-700';
      case 'high': return 'bg-orange-100 text-orange-700';
      case 'medium': return 'bg-yellow-100 text-yellow-700';
      default: return 'bg-gray-100 text-gray-700';
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'open': return 'bg-blue-100 text-blue-700';
      case 'in_progress': return 'bg-yellow-100 text-yellow-700';
      case 'resolved': return 'bg-green-100 text-green-700';
      case 'closed': return 'bg-gray-100 text-gray-700';
      default: return 'bg-gray-100 text-gray-700';
    }
  };

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <Breadcrumb items={breadcrumbs} />
        <ThemeToggle />
      </div>

      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Help Desk</h1>
          <p className="text-muted-foreground">Submit and track support tickets</p>
        </div>
        <Dialog open={showNewTicket} onOpenChange={setShowNewTicket}>
          <DialogTrigger asChild>
            <Button className="gap-2">
              <Plus className="w-4 h-4" />
              New Ticket
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Create Support Ticket</DialogTitle>
              <DialogDescription>Describe your issue and we'll help you resolve it.</DialogDescription>
            </DialogHeader>
            <div className="space-y-4">
              <div className="space-y-2">
                <label className="text-sm font-medium">Subject</label>
                <Input
                  value={newTicket.subject}
                  onChange={(e) => setNewTicket({ ...newTicket, subject: e.target.value })}
                  placeholder="Brief description of the issue"
                />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">Category</label>
                <Select value={newTicket.category} onValueChange={(v) => setNewTicket({ ...newTicket, category: v })}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select category" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="technical">Technical Issue</SelectItem>
                    <SelectItem value="account">Account & Access</SelectItem>
                    <SelectItem value="feature">Feature Request</SelectItem>
                    <SelectItem value="billing">Billing</SelectItem>
                    <SelectItem value="other">Other</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">Priority</label>
                <Select value={newTicket.priority} onValueChange={(v) => setNewTicket({ ...newTicket, priority: v })}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="low">Low</SelectItem>
                    <SelectItem value="medium">Medium</SelectItem>
                    <SelectItem value="high">High</SelectItem>
                    <SelectItem value="urgent">Urgent</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">Description</label>
                <Textarea
                  value={newTicket.description}
                  onChange={(e) => setNewTicket({ ...newTicket, description: e.target.value })}
                  placeholder="Provide detailed information about the issue..."
                  rows={4}
                />
              </div>
              <Button onClick={handleCreateTicket} className="w-full" disabled={!newTicket.subject || !newTicket.category}>
                Submit Ticket
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      <Tabs defaultValue="all">
        <TabsList>
          <TabsTrigger value="all">All Tickets</TabsTrigger>
          <TabsTrigger value="open">Open</TabsTrigger>
          <TabsTrigger value="in_progress">In Progress</TabsTrigger>
          <TabsTrigger value="resolved">Resolved</TabsTrigger>
        </TabsList>

        <TabsContent value="all" className="mt-4">
          <div className="space-y-3">
            {(tickets as Ticket[])?.length === 0 ? (
              <Card>
                <CardContent className="py-12 text-center">
                  <Ticket className="w-12 h-12 mx-auto text-muted-foreground mb-4" />
                  <p className="text-muted-foreground">No tickets yet</p>
                  <Button variant="outline" className="mt-4" onClick={() => setShowNewTicket(true)}>
                    Create your first ticket
                  </Button>
                </CardContent>
              </Card>
            ) : (
              (tickets as Ticket[])?.map((ticket) => (
                <Card key={ticket.id} className="hover:shadow-md transition-shadow cursor-pointer">
                  <CardContent className="p-4">
                    <div className="flex items-start justify-between gap-4">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <h3 className="font-medium truncate">{ticket.subject}</h3>
                          <Badge className={getPriorityColor(ticket.priority)}>{ticket.priority}</Badge>
                          <Badge className={getStatusColor(ticket.status)}>{ticket.status.replace('_', ' ')}</Badge>
                        </div>
                        <p className="text-sm text-muted-foreground line-clamp-2">{ticket.description}</p>
                        <div className="flex items-center gap-4 mt-2 text-xs text-muted-foreground">
                          <span className="flex items-center gap-1">
                            <Clock className="w-3 h-3" />
                            {new Date(ticket.createdAt).toLocaleDateString()}
                          </span>
                          <span className="flex items-center gap-1">
                            <MessageCircle className="w-3 h-3" />
                            {ticket.category}
                          </span>
                        </div>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))
            )}
          </div>
        </TabsContent>

        {['open', 'in_progress', 'resolved'].map(status => (
          <TabsContent key={status} value={status} className="mt-4">
            <div className="space-y-3">
              {(tickets as Ticket[])?.filter(t => t.status === status || (status === 'open' && t.status === 'open')).map((ticket) => (
                <Card key={ticket.id}>
                  <CardContent className="p-4">
                    <h3 className="font-medium">{ticket.subject}</h3>
                    <p className="text-sm text-muted-foreground mt-1">{ticket.description}</p>
                  </CardContent>
                </Card>
              ))}
            </div>
          </TabsContent>
        ))}
      </Tabs>
    </div>
  );
}