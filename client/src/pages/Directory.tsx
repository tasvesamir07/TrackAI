import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import api from '@/lib/api';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Breadcrumb, BreadcrumbItem } from '@/components/Breadcrumb';
import { ThemeToggle } from '@/components/ui/ThemeToggle';
import { EmptyState } from '@/components/ui/empty-state';
import { Skeleton } from '@/components/ui/skeleton';
import { VirtualList } from '@/components/VirtualList';
import { LazyLoadWrapper, LazyOrgChart } from '@/components/LazyComponents';
import { Search, Mail, MessageCircle, Grid, List } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';

interface Employee {
  id: string;
  full_name: string;
  username: string;
  email: string;
  role: string;
  department?: string;
  profile_picture?: string;
}

interface DirectoryProps {
  limit?: number;
  showSearch?: boolean;
}

export default function Directory({ limit = 50, showSearch = true }: DirectoryProps) {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [searchQuery, setSearchQuery] = useState('');
  const [departmentFilter, setDepartmentFilter] = useState('all');
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid');

  const handleChatNavigate = (employeeId: string) => {
    const role = user?.role;
    const basePath = role === 'employee' ? '/dashboard' : 
                     role === 'moderator' ? '/project-manager' : 
                     role === 'SUPERADMIN' ? '/superadmin' : '/admin';
    navigate(`${basePath}?tab=chat&user=${employeeId}`);
  };

  const breadcrumbs: BreadcrumbItem[] = [
    { label: 'Dashboard', href: user?.role === 'employee' ? '/dashboard' : user?.role === 'moderator' ? '/project-manager' : '/admin' },
    { label: 'Directory' },
  ];

  const { data: employeesData, isLoading } = useQuery({
    queryKey: ['directory', searchQuery, departmentFilter],
    queryFn: async () => {
      const params: Record<string, string> = {};
      if (searchQuery) params.search = searchQuery;
      if (departmentFilter !== 'all') params.department = departmentFilter;
      params.limit = String(limit);
      
      const response = await api.get('/settings/directory', { params });
      return response.data.data || response.data;
    },
  });

  const employees: Employee[] = employeesData?.employees || [];
  const departments = employeesData?.departments || [];

  const getInitials = (name: string) => {
    return name
      .split(' ')
      .map(n => n[0])
      .join('')
      .toUpperCase()
      .slice(0, 2);
  };

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <Breadcrumb items={breadcrumbs} />
        <ThemeToggle />
      </div>

      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Employee Directory</h1>
          <p className="text-muted-foreground">Browse and contact your team members</p>
        </div>
      </div>

      {showSearch && (
        <div className="flex flex-col sm:flex-row gap-4">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              placeholder="Search by name, email, or role..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-10"
            />
          </div>
          <Select value={departmentFilter} onValueChange={setDepartmentFilter}>
            <SelectTrigger className="w-full sm:w-[200px]">
              <SelectValue placeholder="All Departments" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Departments</SelectItem>
              {departments.map((dept: string) => (
                <SelectItem key={dept} value={dept}>{dept}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <div className="flex gap-1">
            <Button
              variant={viewMode === 'grid' ? 'default' : 'outline'}
              size="icon"
              onClick={() => setViewMode('grid')}
            >
              <Grid className="w-4 h-4" />
            </Button>
            <Button
              variant={viewMode === 'list' ? 'default' : 'outline'}
              size="icon"
              onClick={() => setViewMode('list')}
            >
              <List className="w-4 h-4" />
            </Button>
          </div>
        </div>
      )}

      {isLoading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <Card key={i} className="p-4">
              <div className="flex items-center gap-3">
                <Skeleton className="h-12 w-12 rounded-full" />
                <div className="space-y-2 flex-1">
                  <Skeleton className="h-4 w-24" />
                  <Skeleton className="h-3 w-32" />
                </div>
              </div>
              <div className="mt-4 flex gap-2">
                <Skeleton className="h-8 w-8 rounded" />
                <Skeleton className="h-8 w-8 rounded" />
              </div>
            </Card>
          ))}
        </div>
      ) : employees.length === 0 ? (
        <EmptyState
          icon={Search}
          title="No employees found"
          description={searchQuery || departmentFilter !== 'all'
            ? "Try adjusting your search or filter criteria"
            : "No employees have been added to your company yet"}
          action={!searchQuery && departmentFilter === 'all' ? {
            label: 'Add Employee',
            onClick: () => navigate('/admin?tab=users'),
          } : undefined}
        />
      ) : viewMode === 'grid' ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {employees.map((employee) => (
            <Card key={employee.id} className="hover:shadow-md transition-shadow cursor-pointer" onClick={() => navigate(`/profile?userId=${employee.id}`)}>
              <CardContent className="p-4">
                <div className="flex flex-col items-center text-center">
                  <Avatar className="w-20 h-20 mb-3">
                    <AvatarImage src={employee.profile_picture} alt={employee.full_name} />
                    <AvatarFallback className="text-lg">{getInitials(employee.full_name)}</AvatarFallback>
                  </Avatar>
                  <h3 className="font-semibold">{employee.full_name}</h3>
                  <p className="text-sm text-muted-foreground">{employee.role}</p>
                  {employee.department && (
                    <span className="text-xs text-muted-foreground mt-1">{employee.department}</span>
                  )}
                  <div className="flex gap-2 mt-4">
                    <Button variant="ghost" size="icon" onClick={(e) => { e.stopPropagation(); window.location.href = `mailto:${employee.email}`; }}>
                      <Mail className="w-4 h-4" />
                    </Button>
                    <Button variant="ghost" size="icon" onClick={(e) => { e.stopPropagation(); handleChatNavigate(employee.id); }}>
                      <MessageCircle className="w-4 h-4" />
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      ) : (
        <div className="space-y-2">
          {employees.map((employee) => (
            <Card key={employee.id} className="hover:shadow-md transition-shadow cursor-pointer" onClick={() => navigate(`/profile?userId=${employee.id}`)}>
              <CardContent className="p-4">
                <div className="flex items-center gap-4">
                  <Avatar className="w-12 h-12">
                    <AvatarImage src={employee.profile_picture} alt={employee.full_name} />
                    <AvatarFallback>{getInitials(employee.full_name)}</AvatarFallback>
                  </Avatar>
                  <div className="flex-1 min-w-0">
                    <h3 className="font-semibold">{employee.full_name}</h3>
                    <p className="text-sm text-muted-foreground">{employee.role} {employee.department && `• ${employee.department}`}</p>
                  </div>
                  <div className="flex gap-2">
                    <Button variant="ghost" size="icon" onClick={(e) => { e.stopPropagation(); window.location.href = `mailto:${employee.email}`; }}>
                      <Mail className="w-4 h-4" />
                    </Button>
                    <Button variant="ghost" size="icon" onClick={(e) => { e.stopPropagation(); handleChatNavigate(employee.id); }}>
                      <MessageCircle className="w-4 h-4" />
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}    </div>
  );
}