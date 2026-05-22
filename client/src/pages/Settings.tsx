import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import api from '@/lib/api';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useAuth } from '@/context/AuthContext';
import { ThemeToggle } from '@/components/ui/ThemeToggle';
import { Breadcrumb, BreadcrumbItem } from '@/components/Breadcrumb';
import { 
  Building2, 
  Clock, 
  CalendarDays, 
  Bell, 
  CreditCard, 
  Save, 
  Upload,
  Loader2,
  CheckCircle,
} from 'lucide-react';

interface CompanySettings {
  company_name: string;
  address: string;
  timezone: string;
  industry: string;
  company_size: string;
  business_email: string;
  phone_number: string;
  logo_url?: string;
}

interface WorkSchedule {
  start_time: string;
  end_time: string;
  break_duration: number;
  working_days: string[];
  weekend_days: string[];
}

interface LeaveSettings {
  paid_leave_days: number;
  allow_half_day: boolean;
  require_approval: boolean;
}

interface NotificationSettings {
  email_enabled: boolean;
  whatsapp_enabled: boolean;
  telegram_enabled: boolean;
  push_enabled: boolean;
}

interface SubscriptionInfo {
  plan_name: string;
  status: string;
  current_period_end: string;
  employees_used: number;
  employees_limit: number;
  features: string[];
}

const timezones = [
  'America/New_York',
  'America/Chicago',
  'America/Denver',
  'America/Los_Angeles',
  'Europe/London',
  'Europe/Paris',
  'Europe/Berlin',
  'Asia/Dubai',
  'Asia/Kolkata',
  'Asia/Singapore',
  'Asia/Tokyo',
  'Australia/Sydney',
];

const industries = [
  'Technology',
  'Healthcare',
  'Finance',
  'Retail',
  'Manufacturing',
  'Education',
  'Real Estate',
  'Consulting',
  'Media',
  'Other',
];

const companySizes = [
  '1-10',
  '11-50',
  '51-100',
  '101-500',
  '501-1000',
  '1000+',
];

const daysOfWeek = [
  { value: 'monday', label: 'Monday' },
  { value: 'tuesday', label: 'Tuesday' },
  { value: 'wednesday', label: 'Wednesday' },
  { value: 'thursday', label: 'Thursday' },
  { value: 'friday', label: 'Friday' },
  { value: 'saturday', label: 'Saturday' },
  { value: 'sunday', label: 'Sunday' },
];

export default function Settings() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState('company');
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved'>('idle');

  const breadcrumbs: BreadcrumbItem[] = [
    { label: 'Dashboard', href: '/admin' },
    { label: 'Settings' },
  ];

  const { data: companyData, isLoading: companyLoading } = useQuery({
    queryKey: ['company-settings'],
    queryFn: async () => {
      const response = await api.get('/settings/company');
      return response.data.data || response.data;
    },
  });

  const { data: scheduleData, isLoading: scheduleLoading } = useQuery({
    queryKey: ['work-schedule'],
    queryFn: async () => {
      const response = await api.get('/admin/work-hours');
      return response.data.data || response.data;
    },
  });

  const { data: leaveData, isLoading: leaveLoading } = useQuery({
    queryKey: ['leave-settings'],
    queryFn: async () => {
      const response = await api.get('/admin/paid-leave-settings');
      return response.data.data || response.data;
    },
  });

  const { data: notificationData, isLoading: notificationLoading } = useQuery({
    queryKey: ['notification-settings'],
    queryFn: async () => {
      const response = await api.get('/admin/notification-settings');
      return response.data.data || response.data;
    },
  });

  const [companyForm, setCompanyForm] = useState<CompanySettings>({
    company_name: '',
    address: '',
    timezone: 'America/New_York',
    industry: '',
    company_size: '',
    business_email: '',
    phone_number: '',
  });

  const [scheduleForm, setScheduleForm] = useState<WorkSchedule>({
    start_time: '09:00',
    end_time: '17:00',
    break_duration: 60,
    working_days: ['monday', 'tuesday', 'wednesday', 'thursday', 'friday'],
    weekend_days: ['saturday', 'sunday'],
  });

  const [leaveForm, setLeaveForm] = useState<LeaveSettings>({
    paid_leave_days: 12,
    allow_half_day: true,
    require_approval: true,
  });

  const [notificationForm, setNotificationForm] = useState<NotificationSettings>({
    email_enabled: true,
    whatsapp_enabled: false,
    telegram_enabled: false,
    push_enabled: true,
  });

  useEffect(() => {
    if (companyData) {
      setCompanyForm(prev => ({ ...prev, ...companyData }));
    }
  }, [companyData]);

  useEffect(() => {
    if (scheduleData) {
      setScheduleForm(prev => ({ ...prev, ...scheduleData }));
    }
  }, [scheduleData]);

  useEffect(() => {
    if (leaveData) {
      setLeaveForm(prev => ({ ...prev, ...leaveData }));
    }
  }, [leaveData]);

  useEffect(() => {
    if (notificationData) {
      setNotificationForm(prev => ({ ...prev, ...notificationData }));
    }
  }, [notificationData]);

  const companyMutation = useMutation({
    mutationFn: (data: CompanySettings) => api.patch('/settings/company', data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['company-settings'] });
      setSaveStatus('saved');
      setTimeout(() => setSaveStatus('idle'), 2000);
    },
  });

  const scheduleMutation = useMutation({
    mutationFn: (data: WorkSchedule) => api.post('/admin/work-hours', data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['work-schedule'] });
      setSaveStatus('saved');
      setTimeout(() => setSaveStatus('idle'), 2000);
    },
  });

  const leaveMutation = useMutation({
    mutationFn: (data: LeaveSettings) => api.post('/admin/paid-leave-settings', data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['leave-settings'] });
      setSaveStatus('saved');
      setTimeout(() => setSaveStatus('idle'), 2000);
    },
  });

  const notificationMutation = useMutation({
    mutationFn: (data: NotificationSettings) => api.post('/admin/notification-settings', data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['notification-settings'] });
      setSaveStatus('saved');
      setTimeout(() => setSaveStatus('idle'), 2000);
    },
  });

  const handleSave = () => {
    setSaveStatus('saving');
    switch (activeTab) {
      case 'company':
        companyMutation.mutate(companyForm);
        break;
      case 'schedule':
        scheduleMutation.mutate(scheduleForm);
        break;
      case 'leave':
        leaveMutation.mutate(leaveForm);
        break;
      case 'notifications':
        notificationMutation.mutate(notificationForm);
        break;
    }
  };

  if (user?.role !== 'COMPANY_ADMIN' && user?.role !== 'admin') {
    return (
      <div className="p-6">
        <Card>
          <CardContent className="py-12 text-center">
            <p className="text-muted-foreground">You don't have permission to access this page.</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <Breadcrumb items={breadcrumbs} />
        <div className="flex items-center gap-2">
          <ThemeToggle />
        </div>
      </div>

      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Settings</h1>
          <p className="text-muted-foreground">Manage your company settings and preferences</p>
        </div>
        <Button 
          onClick={handleSave} 
          disabled={saveStatus === 'saving'}
          className="gap-2"
        >
          {saveStatus === 'saving' ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : saveStatus === 'saved' ? (
            <CheckCircle className="w-4 h-4" />
          ) : (
            <Save className="w-4 h-4" />
          )}
          {saveStatus === 'saving' ? 'Saving...' : saveStatus === 'saved' ? 'Saved!' : 'Save Changes'}
        </Button>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="grid w-full grid-cols-5 lg:w-auto lg:inline-flex">
          <TabsTrigger value="company" className="gap-2">
            <Building2 className="w-4 h-4" />
            <span className="hidden sm:inline">Company</span>
          </TabsTrigger>
          <TabsTrigger value="schedule" className="gap-2">
            <Clock className="w-4 h-4" />
            <span className="hidden sm:inline">Schedule</span>
          </TabsTrigger>
          <TabsTrigger value="leave" className="gap-2">
            <CalendarDays className="w-4 h-4" />
            <span className="hidden sm:inline">Leave</span>
          </TabsTrigger>
          <TabsTrigger value="notifications" className="gap-2">
            <Bell className="w-4 h-4" />
            <span className="hidden sm:inline">Notifications</span>
          </TabsTrigger>
          <TabsTrigger value="billing" className="gap-2">
            <CreditCard className="w-4 h-4" />
            <span className="hidden sm:inline">Billing</span>
          </TabsTrigger>
        </TabsList>

        <TabsContent value="company" className="mt-6">
          <Card>
            <CardHeader>
              <CardTitle>Company Information</CardTitle>
              <CardDescription>Basic information about your company</CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="space-y-2">
                  <Label htmlFor="company_name">Company Name</Label>
                  <Input
                    id="company_name"
                    value={companyForm.company_name}
                    onChange={(e) => setCompanyForm({ ...companyForm, company_name: e.target.value })}
                    placeholder="Your company name"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="business_email">Business Email</Label>
                  <Input
                    id="business_email"
                    type="email"
                    value={companyForm.business_email}
                    onChange={(e) => setCompanyForm({ ...companyForm, business_email: e.target.value })}
                    placeholder="contact@company.com"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="phone_number">Phone Number</Label>
                  <Input
                    id="phone_number"
                    value={companyForm.phone_number}
                    onChange={(e) => setCompanyForm({ ...companyForm, phone_number: e.target.value })}
                    placeholder="+1 234 567 8900"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="timezone">Timezone</Label>
                  <Select
                    value={companyForm.timezone}
                    onValueChange={(value) => setCompanyForm({ ...companyForm, timezone: value })}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {timezones.map((tz) => (
                        <SelectItem key={tz} value={tz}>{tz}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="industry">Industry</Label>
                  <Select
                    value={companyForm.industry}
                    onValueChange={(value) => setCompanyForm({ ...companyForm, industry: value })}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Select industry" />
                    </SelectTrigger>
                    <SelectContent>
                      {industries.map((ind) => (
                        <SelectItem key={ind} value={ind}>{ind}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="company_size">Company Size</Label>
                  <Select
                    value={companyForm.company_size}
                    onValueChange={(value) => setCompanyForm({ ...companyForm, company_size: value })}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Select size" />
                    </SelectTrigger>
                    <SelectContent>
                      {companySizes.map((size) => (
                        <SelectItem key={size} value={size}>{size} employees</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="address">Address</Label>
                <Textarea
                  id="address"
                  value={companyForm.address}
                  onChange={(e) => setCompanyForm({ ...companyForm, address: e.target.value })}
                  placeholder="Your company address"
                  rows={3}
                />
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="schedule" className="mt-6">
          <Card>
            <CardHeader>
              <CardTitle>Work Schedule</CardTitle>
              <CardDescription>Configure working hours and days</CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                <div className="space-y-2">
                  <Label htmlFor="start_time">Start Time</Label>
                  <Input
                    id="start_time"
                    type="time"
                    value={scheduleForm.start_time}
                    onChange={(e) => setScheduleForm({ ...scheduleForm, start_time: e.target.value })}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="end_time">End Time</Label>
                  <Input
                    id="end_time"
                    type="time"
                    value={scheduleForm.end_time}
                    onChange={(e) => setScheduleForm({ ...scheduleForm, end_time: e.target.value })}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="break_duration">Break Duration (minutes)</Label>
                  <Input
                    id="break_duration"
                    type="number"
                    value={scheduleForm.break_duration}
                    onChange={(e) => setScheduleForm({ ...scheduleForm, break_duration: parseInt(e.target.value) || 0 })}
                  />
                </div>
              </div>
              <div className="space-y-3">
                <Label>Working Days</Label>
                <div className="flex flex-wrap gap-2">
                  {daysOfWeek.map((day) => (
                    <Button
                      key={day.value}
                      variant={scheduleForm.working_days.includes(day.value) ? 'default' : 'outline'}
                      size="sm"
                      type="button"
                      onClick={() => {
                        const newDays = scheduleForm.working_days.includes(day.value)
                          ? scheduleForm.working_days.filter((d) => d !== day.value)
                          : [...scheduleForm.working_days, day.value];
                        setScheduleForm({ ...scheduleForm, working_days: newDays });
                      }}
                    >
                      {day.label}
                    </Button>
                  ))}
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="leave" className="mt-6">
          <Card>
            <CardHeader>
              <CardTitle>Leave Settings</CardTitle>
              <CardDescription>Configure leave policies and quotas</CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="space-y-2">
                <Label htmlFor="paid_leave_days">Annual Paid Leave Days</Label>
                <Input
                  id="paid_leave_days"
                  type="number"
                  value={leaveForm.paid_leave_days}
                  onChange={(e) => setLeaveForm({ ...leaveForm, paid_leave_days: parseInt(e.target.value) || 0 })}
                  className="max-w-xs"
                />
              </div>
              <div className="flex items-center justify-between">
                <div className="space-y-1">
                  <Label>Allow Half Day Leave</Label>
                  <p className="text-sm text-muted-foreground">Employees can take half-day leaves</p>
                </div>
                <Switch
                  checked={leaveForm.allow_half_day}
                  onCheckedChange={(checked) => setLeaveForm({ ...leaveForm, allow_half_day: checked })}
                />
              </div>
              <div className="flex items-center justify-between">
                <div className="space-y-1">
                  <Label>Require Approval</Label>
                  <p className="text-sm text-muted-foreground">All leave requests require manager approval</p>
                </div>
                <Switch
                  checked={leaveForm.require_approval}
                  onCheckedChange={(checked) => setLeaveForm({ ...leaveForm, require_approval: checked })}
                />
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="notifications" className="mt-6">
          <Card>
            <CardHeader>
              <CardTitle>Notification Settings</CardTitle>
              <CardDescription>Choose how you want to receive notifications</CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="flex items-center justify-between">
                <div className="space-y-1">
                  <Label>Email Notifications</Label>
                  <p className="text-sm text-muted-foreground">Receive notifications via email</p>
                </div>
                <Switch
                  checked={notificationForm.email_enabled}
                  onCheckedChange={(checked) => setNotificationForm({ ...notificationForm, email_enabled: checked })}
                />
              </div>
              <div className="flex items-center justify-between">
                <div className="space-y-1">
                  <Label>Push Notifications</Label>
                  <p className="text-sm text-muted-foreground">Receive browser push notifications</p>
                </div>
                <Switch
                  checked={notificationForm.push_enabled}
                  onCheckedChange={(checked) => setNotificationForm({ ...notificationForm, push_enabled: checked })}
                />
              </div>
              <div className="flex items-center justify-between">
                <div className="space-y-1">
                  <Label>WhatsApp Notifications</Label>
                  <p className="text-sm text-muted-foreground">Receive notifications via WhatsApp</p>
                </div>
                <Switch
                  checked={notificationForm.whatsapp_enabled}
                  onCheckedChange={(checked) => setNotificationForm({ ...notificationForm, whatsapp_enabled: checked })}
                />
              </div>
              <div className="flex items-center justify-between">
                <div className="space-y-1">
                  <Label>Telegram Notifications</Label>
                  <p className="text-sm text-muted-foreground">Receive notifications via Telegram</p>
                </div>
                <Switch
                  checked={notificationForm.telegram_enabled}
                  onCheckedChange={(checked) => setNotificationForm({ ...notificationForm, telegram_enabled: checked })}
                />
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="billing" className="mt-6">
          <Card>
            <CardHeader>
              <CardTitle>Billing & Subscription</CardTitle>
              <CardDescription>Manage your subscription and billing details</CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="p-4 rounded-lg bg-primary/10 border border-primary/20">
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="font-semibold">Pro Plan</h3>
                    <p className="text-sm text-muted-foreground">$29/user/month</p>
                  </div>
                  <Button variant="outline" size="sm">Upgrade</Button>
                </div>
              </div>
              <div className="space-y-4">
                <div className="flex items-center justify-between py-2 border-b">
                  <span className="text-muted-foreground">Employees Used</span>
                  <span className="font-medium">8 / 10</span>
                </div>
                <div className="flex items-center justify-between py-2 border-b">
                  <span className="text-muted-foreground">Storage Used</span>
                  <span className="font-medium">2.5 GB / 5 GB</span>
                </div>
                <div className="flex items-center justify-between py-2 border-b">
                  <span className="text-muted-foreground">API Calls This Month</span>
                  <span className="font-medium">12,000 / 50,000</span>
                </div>
                <div className="flex items-center justify-between py-2">
                  <span className="text-muted-foreground">Next Billing Date</span>
                  <span className="font-medium">June 15, 2026</span>
                </div>
              </div>
              <Button variant="outline" className="w-full">View Invoice History</Button>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}