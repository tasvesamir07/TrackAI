import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Calculator, TrendingDown, Clock, DollarSign } from 'lucide-react';

interface ROICalculatorProps {
  onCalculate?: (results: ROIResults) => void;
}

interface ROIResults {
  currentCost: number;
  trackAICost: number;
  savings: number;
  savingsPercent: number;
  timeSaved: number;
}

export function ROICalculator({ onCalculate }: ROICalculatorProps) {
  const [inputs, setInputs] = useState({
    employees: 50,
    attendanceHours: 5,
    leaveHours: 3,
    payrollHours: 10,
    hourlyRate: 25,
  });

  const [results, setResults] = useState<ROIResults | null>(null);

  const calculate = () => {
    const weeklyHours = inputs.attendanceHours + inputs.leaveHours + inputs.payrollHours;
    const monthlyHours = weeklyHours * 4;
    const currentCost = monthlyHours * inputs.hourlyRate * inputs.employees;
    
    const trackAIHours = 2;
    const trackAICost = (trackAIHours * inputs.hourlyRate * inputs.employees) + (inputs.employees * 5);
    const savings = currentCost - trackAICost;
    const savingsPercent = (savings / currentCost) * 100;
    const timeSaved = (weeklyHours - trackAIHours) * 4;

    const newResults = {
      currentCost: Math.round(currentCost),
      trackAICost: Math.round(trackAICost),
      savings: Math.round(savings),
      savingsPercent: Math.round(savingsPercent),
      timeSaved: Math.round(timeSaved),
    };

    setResults(newResults);
    onCalculate?.(newResults);
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Calculator className="w-5 h-5" />
          ROI Calculator
        </CardTitle>
        <CardDescription>Calculate your potential savings with Track AI</CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label>Number of Employees</Label>
            <Input
              type="number"
              value={inputs.employees}
              onChange={(e) => setInputs({ ...inputs, employees: parseInt(e.target.value) || 0 })}
            />
          </div>
          <div className="space-y-2">
            <Label>HR Hourly Rate ($)</Label>
            <Input
              type="number"
              value={inputs.hourlyRate}
              onChange={(e) => setInputs({ ...inputs, hourlyRate: parseInt(e.target.value) || 0 })}
            />
          </div>
          <div className="space-y-2">
            <Label>Hours/week on Attendance</Label>
            <Input
              type="number"
              value={inputs.attendanceHours}
              onChange={(e) => setInputs({ ...inputs, attendanceHours: parseInt(e.target.value) || 0 })}
            />
          </div>
          <div className="space-y-2">
            <Label>Hours/week on Leave Management</Label>
            <Input
              type="number"
              value={inputs.leaveHours}
              onChange={(e) => setInputs({ ...inputs, leaveHours: parseInt(e.target.value) || 0 })}
            />
          </div>
          <div className="space-y-2 md:col-span-2">
            <Label>Hours/month on Payroll</Label>
            <Input
              type="number"
              value={inputs.payrollHours}
              onChange={(e) => setInputs({ ...inputs, payrollHours: parseInt(e.target.value) || 0 })}
            />
          </div>
        </div>

        <Button onClick={calculate} className="w-full">
          Calculate Savings
        </Button>

        {results && (
          <div className="grid grid-cols-2 md:grid-cols-3 gap-4 pt-4 border-t">
            <div className="text-center p-4 bg-muted rounded-lg">
              <DollarSign className="w-6 h-6 mx-auto mb-2 text-muted-foreground" />
              <div className="text-2xl font-bold">${results.currentCost.toLocaleString()}</div>
              <div className="text-xs text-muted-foreground">Current Monthly Cost</div>
            </div>
            <div className="text-center p-4 bg-muted rounded-lg">
              <TrendingDown className="w-6 h-6 mx-auto mb-2 text-green-500" />
              <div className="text-2xl font-bold text-green-500">${results.savings.toLocaleString()}</div>
              <div className="text-xs text-muted-foreground">Monthly Savings ({results.savingsPercent}%)</div>
            </div>
            <div className="text-center p-4 bg-muted rounded-lg col-span-2 md:col-span-1">
              <Clock className="w-6 h-6 mx-auto mb-2 text-blue-500" />
              <div className="text-2xl font-bold text-blue-500">{results.timeSaved}h</div>
              <div className="text-xs text-muted-foreground">Hours Saved/Month</div>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}