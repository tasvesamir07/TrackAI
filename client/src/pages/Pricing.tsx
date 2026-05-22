import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Check, X, Sparkles, Building2, Users, Shield, HeadphonesIcon, Mail } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { useQuery } from '@tanstack/react-query';
import api from '@/lib/api';
import { cn } from '@/lib/utils';

interface Plan {
  id: string;
  name: string;
  monthlyPrice: number;
  yearlyPrice: number;
  employeeLimit: number;
  features: string[];
  highlighted?: boolean;
}

const plans: Plan[] = [
  {
    id: 'free',
    name: 'Free',
    monthlyPrice: 0,
    yearlyPrice: 0,
    employeeLimit: 10,
    features: [
      'Up to 10 employees',
      'Basic attendance tracking',
      'Leave management',
      'Project management',
      'Team chat',
      'Email support',
    ],
  },
  {
    id: 'pro',
    name: 'Pro',
    monthlyPrice: 29,
    yearlyPrice: 290,
    employeeLimit: 100,
    highlighted: true,
    features: [
      'Up to 100 employees',
      'Advanced analytics',
      'AI-powered features',
      'Priority support',
      'Custom integrations',
      'Advanced reporting',
      'Payroll integration',
      'Attendance certificates',
    ],
  },
  {
    id: 'enterprise',
    name: 'Enterprise',
    monthlyPrice: -1,
    yearlyPrice: -1,
    employeeLimit: -1,
    features: [
      'Unlimited employees',
      'Dedicated account manager',
      'Custom SLA',
      'White-label options',
      'On-premise deployment',
      'Advanced security',
      'Custom training',
      '24/7 phone support',
    ],
  },
];

export default function Pricing() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [isYearly, setIsYearly] = useState(false);
  const [employeeCount, setEmployeeCount] = useState(10);

  const { data: subscriptionData } = useQuery({
    queryKey: ['current-subscription'],
    queryFn: async () => {
      const response = await api.get('/billing/subscription');
      return response.data.data || response.data;
    },
  });

  const currentPlan = subscriptionData?.plan_id || 'free';

  const calculatePrice = (plan: Plan) => {
    if (plan.monthlyPrice === -1) return 'Custom';
    if (plan.monthlyPrice === 0) return 'Free';
    
    const price = isYearly ? plan.yearlyPrice / 12 : plan.monthlyPrice;
    return `$${Math.round(price)}`;
  };

  const getPerUserPrice = (plan: Plan) => {
    if (plan.monthlyPrice === -1) return null;
    if (plan.monthlyPrice === 0) return null;
    return `$${isYearly ? Math.round(plan.yearlyPrice / 12 / employeeCount) : plan.monthlyPrice}/user`;
  };

  const handleSubscribe = (planId: string) => {
    if (!user) {
      navigate('/signup');
      return;
    }
    
    if (planId === 'enterprise') {
      navigate('/contact-sales');
      return;
    }

    navigate(`/checkout?plan=${planId}&billing=${isYearly ? 'yearly' : 'monthly'}`);
  };

  const getSavings = (plan: Plan) => {
    if (plan.monthlyPrice === 0 || plan.monthlyPrice === -1) return null;
    const monthlyTotal = plan.monthlyPrice * 12;
    const yearlyTotal = plan.yearlyPrice;
    return Math.round(((monthlyTotal - yearlyTotal) / monthlyTotal) * 100);
  };

  return (
    <div className="min-h-screen bg-gradient-to-b from-background to-muted/30 py-12 px-4">
      <div className="max-w-6xl mx-auto">
        <div className="text-center mb-12">
          <h1 className="text-4xl font-bold mb-4">Simple, Transparent Pricing</h1>
          <p className="text-xl text-muted-foreground mb-8">
            Choose the perfect plan for your team
          </p>

          <div className="flex items-center justify-center gap-4 mb-8">
            <span className={cn('text-sm', !isYearly && 'font-semibold')}>Monthly</span>
            <Switch
              checked={isYearly}
              onCheckedChange={setIsYearly}
            />
            <span className={cn('text-sm font-semibold', isYearly && 'text-primary')}>
              Yearly
            </span>
            {isYearly && (
              <span className="ml-2 px-3 py-1 bg-green-100 text-green-700 text-xs font-medium rounded-full">
                Save up to 20%
              </span>
            )}
          </div>

          <div className="flex items-center justify-center gap-4 max-w-sm mx-auto">
            <Label htmlFor="employees" className="text-muted-foreground">Number of employees:</Label>
            <Input
              id="employees"
              type="number"
              min="1"
              max="1000"
              value={employeeCount}
              onChange={(e) => setEmployeeCount(parseInt(e.target.value) || 1)}
              className="w-24 text-center"
            />
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
          {plans.map((plan) => (
            <Card 
              key={plan.id} 
              className={cn(
                'relative flex flex-col',
                plan.highlighted && 'border-primary shadow-lg shadow-primary/20'
              )}
            >
              {plan.highlighted && (
                <div className="absolute -top-4 left-1/2 -translate-x-1/2 px-4 py-1 bg-primary text-primary-foreground text-sm font-medium rounded-full flex items-center gap-1">
                  <Sparkles className="w-4 h-4" />
                  Most Popular
                </div>
              )}

              <CardHeader>
                <CardTitle className="text-2xl">{plan.name}</CardTitle>
                <CardDescription>
                  {plan.employeeLimit === -1 
                    ? 'Unlimited employees' 
                    : `Up to ${plan.employeeLimit} employees`}
                </CardDescription>
              </CardHeader>

              <CardContent className="flex-1">
                <div className="text-center mb-6">
                  <div className="text-4xl font-bold">
                    {calculatePrice(plan)}
                  </div>
                  {plan.monthlyPrice > 0 && (
                    <div className="text-muted-foreground mt-2">
                      {getPerUserPrice(plan)}/month per user
                    </div>
                  )}
                  {isYearly && getSavings(plan) && (
                    <div className="text-green-600 text-sm mt-1">
                      Save {getSavings(plan)}% with yearly billing
                    </div>
                  )}
                </div>

                <ul className="space-y-3">
                  {plan.features.map((feature, index) => (
                    <li key={index} className="flex items-start gap-2">
                      <Check className="w-5 h-5 text-green-500 flex-shrink-0 mt-0.5" />
                      <span className="text-sm">{feature}</span>
                    </li>
                  ))}
                </ul>
              </CardContent>

              <CardFooter>
                <Button 
                  className="w-full" 
                  variant={plan.highlighted ? 'default' : 'outline'}
                  onClick={() => handleSubscribe(plan.id)}
                  disabled={currentPlan === plan.id}
                >
                  {currentPlan === plan.id 
                    ? 'Current Plan' 
                    : plan.id === 'enterprise' 
                      ? 'Contact Sales' 
                      : 'Get Started'}
                </Button>
              </CardFooter>
            </Card>
          ))}
        </div>

        <div className="mt-16">
          <h2 className="text-2xl font-bold text-center mb-8">Frequently Asked Questions</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 max-w-4xl mx-auto">
            <div className="p-6 rounded-lg border bg-card">
              <h3 className="font-semibold mb-2">Can I change plans later?</h3>
              <p className="text-sm text-muted-foreground">
                Yes, you can upgrade or downgrade your plan at any time. Changes take effect immediately.
              </p>
            </div>
            <div className="p-6 rounded-lg border bg-card">
              <h3 className="font-semibold mb-2">What payment methods do you accept?</h3>
              <p className="text-sm text-muted-foreground">
                We accept all major credit cards, PayPal, and bank transfers for annual plans.
              </p>
            </div>
            <div className="p-6 rounded-lg border bg-card">
              <h3 className="font-semibold mb-2">Is there a free trial?</h3>
              <p className="text-sm text-muted-foreground">
                Yes, our Pro plan includes a 14-day free trial. No credit card required.
              </p>
            </div>
            <div className="p-6 rounded-lg border bg-card">
              <h3 className="font-semibold mb-2">What happens if I exceed my employee limit?</h3>
              <p className="text-sm text-muted-foreground">
                We'll notify you when you're close to the limit. You can upgrade or remove inactive employees.
              </p>
            </div>
          </div>
        </div>

        <div className="mt-16 text-center">
          <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-muted">
            <Mail className="w-4 h-4" />
            <span className="text-sm">Need help? Contact us at</span>
            <a href="mailto:sales@trackai.com" className="font-semibold text-primary">sales@trackai.com</a>
          </div>
        </div>
      </div>
    </div>
  );
}