import { GlobalSearch } from './GlobalSearch';
import { ThemeToggle } from './ui/ThemeToggle';
import { useAuth } from '@/context/AuthContext';
import { useSocket } from '@/context/SocketContext';
import { Bell } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useQuery } from '@tanstack/react-query';
import api from '@/lib/api';
import { useNavigate } from 'react-router-dom';

export function DashboardHeader() {
  const { user } = useAuth();
  useSocket();
  const navigate = useNavigate();
  
  const { data: notificationData } = useQuery({
    queryKey: ['notifications', 'unread'],
    queryFn: async () => {
      const response = await api.get('/activity/notifications');
      return response.data;
    },
    refetchInterval: 30000,
  });
  
  const notificationCount = notificationData?.unreadCount || 0;
  
  return (
    <header className="sticky top-0 z-40 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      <div className="flex h-14 items-center gap-4 px-4 lg:px-6">
        <div className="flex-1">
          <GlobalSearch />
        </div>
        
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="icon"
            className="relative h-9 w-9 rounded-md"
            onClick={() => navigate('/profile?tab=notifications')}
            title="Notifications"
          >
            <Bell className="w-4 h-4" />
            {notificationCount > 0 && (
              <span className="absolute -top-1 -right-1 flex h-4 w-4 items-center justify-center rounded-full bg-destructive text-[10px] text-destructive-foreground">
                {notificationCount > 9 ? '9+' : notificationCount}
              </span>
            )}
          </Button>
          
          <ThemeToggle />
          
          {user?.profile_picture ? (
            <Button
              variant="ghost"
              size="icon"
              className="h-9 w-9 rounded-full p-0"
              onClick={() => navigate('/profile')}
            >
              <img
                src={user.profile_picture}
                alt={user.full_name || user.username}
                className="h-9 w-9 rounded-full object-cover"
              />
            </Button>
          ) : (
            <Button
              variant="ghost"
              size="icon"
              className="h-9 w-9 rounded-full"
              onClick={() => navigate('/profile')}
            >
              <div className="h-9 w-9 rounded-full bg-primary flex items-center justify-center text-primary-foreground text-sm font-medium">
                {(user?.full_name || user?.username || 'U').charAt(0).toUpperCase()}
              </div>
            </Button>
          )}
        </div>
      </div>
    </header>
  );
}
