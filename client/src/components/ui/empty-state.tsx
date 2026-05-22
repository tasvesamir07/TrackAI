import type { LucideIcon } from 'lucide-react';
import { 
  FileX, 
  Users, 
  Calendar, 
  FolderOpen, 
  MessageSquare, 
  Bell, 
  Search, 
  Inbox,
  UserPlus,
  Briefcase,
  CheckCircle,
  Clock,
  TrendingUp,
  Settings,
  Building2,
  Shield,
  Ticket,
  FileText,
  Award,
  Sparkles,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

interface EmptyStateProps {
  icon?: LucideIcon;
  title: string;
  description?: string;
  action?: {
    label: string;
    onClick: () => void;
  };
  className?: string;
  variant?: 'default' | 'card' | 'minimal';
}

const defaultIcons: Record<string, LucideIcon> = {
  users: Users,
  employees: Users,
  calendar: Calendar,
  events: Calendar,
  folder: FolderOpen,
  projects: FolderOpen,
  message: MessageSquare,
  messages: MessageSquare,
  notification: Bell,
  notifications: Bell,
  search: Search,
  default: FileX,
  inbox: Inbox,
  addUser: UserPlus,
  invite: UserPlus,
  team: Users,
  tasks: CheckCircle,
  pending: Clock,
  analytics: TrendingUp,
  settings: Settings,
  company: Building2,
  security: Shield,
  support: Ticket,
  reports: FileText,
  recognition: Award,
  ai: Sparkles,
};

export function EmptyState({ 
  icon, 
  title, 
  description, 
  action, 
  className,
  variant = 'default'
}: EmptyStateProps) {
  const IconComponent = icon || FileX;

  if (variant === 'minimal') {
    return (
      <div className={cn(
        'flex flex-col items-center justify-center py-8 px-4 text-center',
        className
      )}>
        <IconComponent className="h-6 w-6 text-muted-foreground/50 mb-2" />
        <p className="text-sm text-muted-foreground">{title}</p>
      </div>
    );
  }

  return (
    <div className={cn(
      'flex flex-col items-center justify-center py-12 px-4 text-center',
      variant === 'card' && 'rounded-xl border border-dashed border-border bg-card/50 p-8',
      className
    )}>
      <div className={cn(
        'rounded-2xl p-4 mb-4',
        variant === 'card' ? 'bg-primary/10' : 'bg-primary-light/50 dark:bg-primary/10'
      )}>
        <IconComponent className="h-8 w-8 text-primary" />
      </div>
      <h3 className="text-lg font-semibold text-foreground mb-2">{title}</h3>
      {description && (
        <p className="text-sm text-muted-foreground max-w-sm mb-6 leading-relaxed">{description}</p>
      )}
      {action && (
        <Button onClick={action.onClick}>
          {action.label}
        </Button>
      )}
    </div>
  );
}

export function EmptyStateCard({
  type,
  title,
  description,
  action,
}: {
  type: keyof typeof defaultIcons;
  title: string;
  description?: string;
  action?: { label: string; onClick: () => void };
}) {
  const icon = defaultIcons[type] || defaultIcons.default;

  return (
    <div className="rounded-xl border border-dashed border-border bg-card/50 p-8">
      <EmptyState
        icon={icon}
        title={title}
        description={description}
        action={action}
        variant="default"
      />
    </div>
  );
}

export function createEmptyStateProps(context: 'employees' | 'projects' | 'tasks' | 'leaves' | 'messages' | 'notifications' | 'reports' | 'settings' | 'custom') {
  const configs = {
    employees: {
      icon: defaultIcons.users,
      title: 'No employees yet',
      description: 'Invite your first team member to get started with Track AI',
    },
    projects: {
      icon: defaultIcons.projects,
      title: 'No projects yet',
      description: 'Create your first project to start organizing work',
    },
    tasks: {
      icon: defaultIcons.tasks,
      title: 'No tasks found',
      description: 'Create a task or adjust your filters',
    },
    leaves: {
      icon: defaultIcons.calendar,
      title: 'No leave requests',
      description: 'Leave requests will appear here when submitted',
    },
    messages: {
      icon: defaultIcons.messages,
      title: 'No messages yet',
      description: 'Start a conversation with your team',
    },
    notifications: {
      icon: defaultIcons.notifications,
      title: 'All caught up!',
      description: 'You have no unread notifications',
    },
    reports: {
      icon: defaultIcons.reports,
      title: 'No reports available',
      description: 'Reports will appear here once generated',
    },
    settings: {
      icon: defaultIcons.settings,
      title: 'No settings configured',
      description: 'Configure your settings to get started',
    },
    custom: {
      icon: defaultIcons.default,
      title: 'No data',
      description: 'No items to display',
    },
  };
  return configs[context];
}

export default EmptyState;