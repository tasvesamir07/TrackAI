import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, LineChart, Line } from 'recharts';
import { TrendingUp, Users, CheckCircle, AlertCircle } from 'lucide-react';

export function ModeratorKPIs() {
  const teamPerformanceData = [
    { name: 'Sprint 1', completed: 24, planned: 30 },
    { name: 'Sprint 2', completed: 28, planned: 28 },
    { name: 'Sprint 3', completed: 32, planned: 30 },
    { name: 'Sprint 4', completed: 25, planned: 35 },
  ];

  const velocityData = [
    { day: 'Mon', tasks: 5 },
    { day: 'Tue', tasks: 8 },
    { day: 'Wed', tasks: 12 },
    { day: 'Thu', tasks: 7 },
    { day: 'Fri', tasks: 15 },
  ];

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card>
          <CardContent className="p-6">
            <div className="flex items-center gap-4">
              <div className="p-3 bg-green-100 text-green-600 rounded-lg">
                <CheckCircle className="w-5 h-5" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground font-medium">Sprint Completion</p>
                <h3 className="text-2xl font-bold">88%</h3>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-6">
            <div className="flex items-center gap-4">
              <div className="p-3 bg-blue-100 text-blue-600 rounded-lg">
                <Users className="w-5 h-5" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground font-medium">Team Utilization</p>
                <h3 className="text-2xl font-bold">92%</h3>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-6">
            <div className="flex items-center gap-4">
              <div className="p-3 bg-purple-100 text-purple-600 rounded-lg">
                <TrendingUp className="w-5 h-5" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground font-medium">Avg Velocity</p>
                <h3 className="text-2xl font-bold">28.5</h3>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-6">
            <div className="flex items-center gap-4">
              <div className="p-3 bg-red-100 text-red-600 rounded-lg">
                <AlertCircle className="w-5 h-5" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground font-medium">Overdue Tasks</p>
                <h3 className="text-2xl font-bold">5</h3>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card>
          <CardHeader>
            <CardTitle>Sprint Completion vs. Plan</CardTitle>
            <CardDescription>Historical performance over the last 4 sprints</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="h-[300px]">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={teamPerformanceData}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} />
                  <XAxis dataKey="name" />
                  <YAxis />
                  <Tooltip />
                  <Bar dataKey="planned" fill="#e2e8f0" name="Planned" radius={[4, 4, 0, 0]} />
                  <Bar dataKey="completed" fill="#3b82f6" name="Completed" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Team Burn-up</CardTitle>
            <CardDescription>Daily task completion rate for the current week</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="h-[300px]">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={velocityData}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} />
                  <XAxis dataKey="day" />
                  <YAxis />
                  <Tooltip />
                  <Line type="monotone" dataKey="tasks" stroke="#8b5cf6" strokeWidth={2} dot={{ r: 4 }} activeDot={{ r: 6 }} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}