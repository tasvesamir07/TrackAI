import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { MessageSquare, Send, Lightbulb, Bug } from 'lucide-react';

interface FeedbackButtonProps {
  type?: 'general' | 'issue' | 'feature';
}

export function FeedbackButton({ type = 'general' }: FeedbackButtonProps) {
  const [open, setOpen] = useState(false);
  const [feedbackType, setFeedbackType] = useState(type);
  const [message, setMessage] = useState('');
  const [sent, setSent] = useState(false);

  const handleSubmit = () => {
    console.log('Feedback submitted:', { type: feedbackType, message });
    setSent(true);
    setTimeout(() => {
      setOpen(false);
      setSent(false);
      setMessage('');
    }, 2000);
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className="fixed bottom-4 right-4 gap-2 shadow-lg z-50"
        >
          <MessageSquare className="w-4 h-4" />
          Feedback
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Send Feedback</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="flex gap-2">
            <Button
              variant={feedbackType === 'issue' ? 'default' : 'outline'}
              size="sm"
              onClick={() => setFeedbackType('issue')}
              className="gap-1"
            >
              <Bug className="w-3 h-3" />
              Report Issue
            </Button>
            <Button
              variant={feedbackType === 'feature' ? 'default' : 'outline'}
              size="sm"
              onClick={() => setFeedbackType('feature')}
              className="gap-1"
            >
              <Lightbulb className="w-3 h-3" />
              Suggest Feature
            </Button>
          </div>
          <Textarea
            placeholder={feedbackType === 'issue' 
              ? 'Describe the issue you encountered...'
              : 'Describe your feature suggestion...'
            }
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            rows={4}
          />
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button onClick={handleSubmit} disabled={!message || sent} className="gap-2">
              <Send className="w-4 h-4" />
              {sent ? 'Sent!' : 'Send'}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}