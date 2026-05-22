import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation } from '@tanstack/react-query';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Checkbox } from '@/components/ui/checkbox';
import { Progress } from '@/components/ui/progress';
import api from '@/lib/api';
import { cn } from '@/lib/utils';
import { Building2, Clock, Users, Bell, CheckCircle, ArrowRight, ArrowLeft } from 'lucide-react';

interface OnboardingData {
  step1: {
    companyName: string;
    industry: string;
    companySize: string;
    timezone: string;
  };
  step2: {
    startTime: string;
    endTime: string;
    breakDuration: number;
    workingDays: string[];
  };
  step3: {
    teamMembers: Array<{ name: string; email: string; role: string }>;
  };
  step4: {
    emailEnabled: boolean;
    whatsappNumber: string;
    telegramEnabled: boolean;
    pushEnabled: boolean;
  };
}

const timezones = [
  'America/New_York',
  'America/Chicago',
  'America/Los_Angeles',
  'Europe/London',
  'Europe/Paris',
  'Asia/Dubai',
  'Asia/Kolkata',
  'Asia/Singapore',
];

const industries = [
  'Technology',
  'Healthcare',
  'Finance',
  'Retail',
  'Manufacturing',
  'Education',
  'Other',
];

const companySizes = ['1-10', '11-50', '51-100', '101-500', '500+'];

const days = [
  { id: 'monday', label: 'Mon' },
  { id: 'tuesday', label: 'Tue' },
  { id: 'wednesday', label: 'Wed' },
  { id: 'thursday', label: 'Thu' },
  { id: 'friday', label: 'Fri' },
  { id: 'saturday', label: 'Sat' },
  { id: 'sunday', label: 'Sun' },
];

const roles = ['Employee', 'Project Manager', 'Admin'];

export default function Onboarding() {
  const navigate = useNavigate();
  const [currentStep, setCurrentStep] = useState(1);
  const [data, setData] = useState<OnboardingData>({
    step1: { companyName: '', industry: '', companySize: '', timezone: 'America/New_York' },
    step2: { startTime: '09:00', endTime: '17:00', breakDuration: 60, workingDays: ['monday', 'tuesday', 'wednesday', 'thursday', 'friday'] },
    step3: { teamMembers: [] },
    step4: { emailEnabled: true, whatsappNumber: '', telegramEnabled: false, pushEnabled: true },
  });

  const saveMutation = useMutation({
    mutationFn: async (stepData: Record<string, unknown>) => {
      const response = await api.post('/onboarding/step' + currentStep, stepData);
      return response.data;
    },
    onSuccess: () => {
      if (currentStep < 5) {
        setCurrentStep(currentStep + 1);
      } else {
        navigate('/admin');
      }
    },
  });

  const handleNext = () => {
    saveMutation.mutate(data['step' + currentStep as keyof OnboardingData] as unknown as Record<string, unknown>);
  };

  const handleBack = () => {
    setCurrentStep(currentStep - 1);
  };

  const addTeamMember = () => {
    setData({
      ...data,
      step3: {
        ...data.step3,
        teamMembers: [...data.step3.teamMembers, { name: '', email: '', role: 'Employee' }],
      },
    });
  };

  const removeTeamMember = (index: number) => {
    setData({
      ...data,
      step3: {
        ...data.step3,
        teamMembers: data.step3.teamMembers.filter((_, i) => i !== index),
      },
    });
  };

  const updateTeamMember = (index: number, field: string, value: string) => {
    const updated = [...data.step3.teamMembers];
    updated[index] = { ...updated[index], [field]: value };
    setData({ ...data, step3: { ...data.step3, teamMembers: updated } });
  };

  const steps = [
    { id: 1, title: 'Company Info', icon: Building2 },
    { id: 2, title: 'Work Schedule', icon: Clock },
    { id: 3, title: 'Add Team', icon: Users },
    { id: 4, title: 'Notifications', icon: Bell },
    { id: 5, title: 'Complete', icon: CheckCircle },
  ];

  return (
    <div className="min-h-screen bg-gradient-to-b from-background to-muted/30 py-8 px-4">
      <div className="max-w-2xl mx-auto">
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold mb-2">Welcome to Track AI</h1>
          <p className="text-muted-foreground">Let's get your company set up in just a few steps</p>
        </div>

        <div className="mb-8">
          <div className="flex items-center justify-between mb-4">
            {steps.map((step, index) => (
              <div key={step.id} className="flex items-center">
                <div className={cn(
                  'flex items-center justify-center w-10 h-10 rounded-full',
                  currentStep >= step.id ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground'
                )}>
                  <step.icon className="w-5 h-5" />
                </div>
                {index < steps.length - 1 && (
                  <div className={cn(
                    'w-12 h-1 mx-2',
                    currentStep > step.id ? 'bg-primary' : 'bg-muted'
                  )} />
                )}
              </div>
            ))}
          </div>
          <Progress value={(currentStep / 5) * 100} className="h-2" />
        </div>

        <Card>
          <CardHeader>
            <CardTitle>{steps[currentStep - 1].title}</CardTitle>
            <CardDescription>
              Step {currentStep} of 5
            </CardDescription>
          </CardHeader>
          <CardContent>
            {currentStep === 1 && (
              <div className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="companyName">Company Name</Label>
                  <Input
                    id="companyName"
                    value={data.step1.companyName}
                    onChange={(e) => setData({ ...data, step1: { ...data.step1, companyName: e.target.value } })}
                    placeholder="Enter your company name"
                  />
                </div>
                <div className="space-y-2">
                  <Label>Industry</Label>
                  <Select
                    value={data.step1.industry}
                    onValueChange={(value) => setData({ ...data, step1: { ...data.step1, industry: value } })}
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
                  <Label>Company Size</Label>
                  <Select
                    value={data.step1.companySize}
                    onValueChange={(value) => setData({ ...data, step1: { ...data.step1, companySize: value } })}
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
                <div className="space-y-2">
                  <Label>Timezone</Label>
                  <Select
                    value={data.step1.timezone}
                    onValueChange={(value) => setData({ ...data, step1: { ...data.step1, timezone: value } })}
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
              </div>
            )}

            {currentStep === 2 && (
              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label>Start Time</Label>
                    <Input
                      type="time"
                      value={data.step2.startTime}
                      onChange={(e) => setData({ ...data, step2: { ...data.step2, startTime: e.target.value } })}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>End Time</Label>
                    <Input
                      type="time"
                      value={data.step2.endTime}
                      onChange={(e) => setData({ ...data, step2: { ...data.step2, endTime: e.target.value } })}
                    />
                  </div>
                </div>
                <div className="space-y-2">
                  <Label>Break Duration (minutes)</Label>
                  <Input
                    type="number"
                    value={data.step2.breakDuration}
                    onChange={(e) => setData({ ...data, step2: { ...data.step2, breakDuration: parseInt(e.target.value) } })}
                  />
                </div>
                <div className="space-y-2">
                  <Label>Working Days</Label>
                  <div className="flex flex-wrap gap-2">
                    {days.map((day) => (
                      <Button
                        key={day.id}
                        type="button"
                        variant={data.step2.workingDays.includes(day.id) ? 'default' : 'outline'}
                        size="sm"
                        onClick={() => {
                          const newDays = data.step2.workingDays.includes(day.id)
                            ? data.step2.workingDays.filter(d => d !== day.id)
                            : [...data.step2.workingDays, day.id];
                          setData({ ...data, step2: { ...data.step2, workingDays: newDays } });
                        }}
                      >
                        {day.label}
                      </Button>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {currentStep === 3 && (
              <div className="space-y-4">
                <p className="text-sm text-muted-foreground">
                  Add your team members (optional - you can also invite them later)
                </p>
                {data.step3.teamMembers.map((member, index) => (
                  <div key={index} className="flex gap-2 items-end">
                    <div className="flex-1 space-y-2">
                      <Input
                        placeholder="Name"
                        value={member.name}
                        onChange={(e) => updateTeamMember(index, 'name', e.target.value)}
                      />
                    </div>
                    <div className="flex-1 space-y-2">
                      <Input
                        placeholder="Email"
                        type="email"
                        value={member.email}
                        onChange={(e) => updateTeamMember(index, 'email', e.target.value)}
                      />
                    </div>
                    <Select
                      value={member.role}
                      onValueChange={(value) => updateTeamMember(index, 'role', value)}
                    >
                      <SelectTrigger className="w-[140px]">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {roles.map((role) => (
                          <SelectItem key={role} value={role}>{role}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Button variant="ghost" size="icon" onClick={() => removeTeamMember(index)}>×</Button>
                  </div>
                ))}
                <Button variant="outline" onClick={addTeamMember} className="w-full">
                  + Add Team Member
                </Button>
              </div>
            )}

            {currentStep === 4 && (
              <div className="space-y-4">
                <div className="flex items-center justify-between p-4 border rounded-lg">
                  <div>
                    <Label>Email Notifications</Label>
                    <p className="text-sm text-muted-foreground">Receive updates via email</p>
                  </div>
                  <Switch
                    checked={data.step4.emailEnabled}
                    onCheckedChange={(checked) => setData({ ...data, step4: { ...data.step4, emailEnabled: checked } })}
                  />
                </div>
                <div className="flex items-center justify-between p-4 border rounded-lg">
                  <div>
                    <Label>Push Notifications</Label>
                    <p className="text-sm text-muted-foreground">Receive browser notifications</p>
                  </div>
                  <Switch
                    checked={data.step4.pushEnabled}
                    onCheckedChange={(checked) => setData({ ...data, step4: { ...data.step4, pushEnabled: checked } })}
                  />
                </div>
                <div className="flex items-center justify-between p-4 border rounded-lg">
                  <div>
                    <Label>Telegram Bot</Label>
                    <p className="text-sm text-muted-foreground">Connect Telegram for notifications</p>
                  </div>
                  <Switch
                    checked={data.step4.telegramEnabled}
                    onCheckedChange={(checked) => setData({ ...data, step4: { ...data.step4, telegramEnabled: checked } })}
                  />
                </div>
                <div className="space-y-2">
                  <Label>WhatsApp Number (optional)</Label>
                  <Input
                    placeholder="+1234567890"
                    value={data.step4.whatsappNumber}
                    onChange={(e) => setData({ ...data, step4: { ...data.step4, whatsappNumber: e.target.value } })}
                  />
                </div>
              </div>
            )}

            {currentStep === 5 && (
              <div className="text-center py-8">
                <div className="w-20 h-20 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
                  <CheckCircle className="w-10 h-10 text-green-500" />
                </div>
                <h2 className="text-2xl font-bold mb-2">You're All Set!</h2>
                <p className="text-muted-foreground mb-8">
                  Your company has been created successfully. Let's head to your dashboard.
                </p>
                <Button size="lg" onClick={() => navigate('/admin')}>
                  Go to Dashboard
                  <ArrowRight className="ml-2 w-4 h-4" />
                </Button>
              </div>
            )}
          </CardContent>
          {currentStep < 5 && (
            <CardFooter className="flex justify-between">
              <Button
                variant="outline"
                onClick={handleBack}
                disabled={currentStep === 1}
              >
                <ArrowLeft className="mr-2 w-4 h-4" />
                Back
              </Button>
              <Button onClick={handleNext} disabled={saveMutation.isPending}>
                {saveMutation.isPending ? 'Saving...' : currentStep === 4 ? 'Complete Setup' : 'Next'}
                <ArrowRight className="ml-2 w-4 h-4" />
              </Button>
            </CardFooter>
          )}
        </Card>
      </div>
    </div>
  );
}
