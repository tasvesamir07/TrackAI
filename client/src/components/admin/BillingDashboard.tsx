import { useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { CreditCard, Zap, Shield, Check, ArrowRight, History } from 'lucide-react';

export function BillingDashboard() {
  const [plan] = useState('Professional');

  const invoices = [
    { id: 'INV-001', date: 'May 01, 2026', amount: '$499.00', status: 'Paid' },
    { id: 'INV-002', date: 'Apr 01, 2026', amount: '$499.00', status: 'Paid' },
    { id: 'INV-003', date: 'Mar 01, 2026', amount: '$499.00', status: 'Paid' },
  ];

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h2 className="text-2xl font-bold tracking-tight">Billing & Subscription</h2>
          <p className="text-muted-foreground">Manage your plan, payment methods, and billing history.</p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Current Plan</CardTitle>
            <CardDescription>You are currently on the {plan} plan.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="flex items-center justify-between p-4 bg-blue-50 border border-blue-100 rounded-xl">
              <div className="flex items-center gap-4">
                <div className="p-2 bg-blue-500 text-white rounded-lg">
                  <Zap className="w-6 h-6" />
                </div>
                <div>
                  <h4 className="font-bold">{plan} Plan</h4>
                  <p className="text-sm text-blue-600 font-medium">$499 / month • Next billing May 25, 2026</p>
                </div>
              </div>
              <Button>Upgrade Plan</Button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-4">
              <div className="space-y-3">
                <h5 className="text-sm font-bold uppercase tracking-wider text-muted-foreground">Included Features</h5>
                <ul className="space-y-2">
                  {[
                    'Up to 50 employees',
                    'Advanced analytics',
                    'Custom reporting',
                    'Priority support'
                  ].map((f, i) => (
                    <li key={i} className="flex items-center gap-2 text-sm">
                      <Check className="w-4 h-4 text-green-500" />
                      {f}
                    </li>
                  ))}
                </ul>
              </div>
              <div className="space-y-3">
                <h5 className="text-sm font-bold uppercase tracking-wider text-muted-foreground">Usage</h5>
                <div className="space-y-2">
                  <div className="flex justify-between text-sm">
                    <span>Employees</span>
                    <span className="font-medium">42 / 50</span>
                  </div>
                  <div className="w-full bg-slate-100 h-2 rounded-full overflow-hidden">
                    <div className="bg-blue-500 h-full w-[84%]" />
                  </div>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Payment Method</CardTitle>
            <CardDescription>How you pay for your subscription.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center gap-4 p-4 border rounded-xl">
              <CreditCard className="w-6 h-6 text-slate-400" />
              <div>
                <p className="font-bold">Visa ending in 4242</p>
                <p className="text-sm text-muted-foreground">Expires 12/28</p>
              </div>
            </div>
            <Button variant="outline" className="w-full">Update Card</Button>
            
            <div className="pt-4 space-y-2">
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Shield className="w-4 h-4 text-green-500" />
                Secure payments by Stripe
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Billing History</CardTitle>
          <CardDescription>Download past invoices for your records.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            {invoices.map((inv) => (
              <div key={inv.id} className="flex items-center justify-between p-4 border rounded-xl hover:bg-slate-50 transition-colors">
                <div className="flex items-center gap-4">
                  <History className="w-5 h-5 text-muted-foreground" />
                  <div>
                    <p className="font-bold">{inv.id}</p>
                    <p className="text-sm text-muted-foreground">{inv.date}</p>
                  </div>
                </div>
                <div className="flex items-center gap-6">
                  <span className="font-bold">{inv.amount}</span>
                  <Badge variant="outline" className="bg-green-50 text-green-600 border-green-100">Paid</Badge>
                  <Button variant="ghost" size="icon">
                    <ArrowRight className="w-4 h-4" />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}