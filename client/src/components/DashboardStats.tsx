import { DashboardBarChart, DashboardLineChart, DashboardPieChart, StatCard } from '@/components/charts';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Users, Calendar, CheckCircle, AlertCircle } from 'lucide-react';

interface DashboardStatsProps {
  stats: {
    totalEmployees: number;
    activeEmployees: number;
    onLeave: number;
    pendingTasks: number;
    avgCheckInTime?: string;
    attendanceRate?: number;
  };
  isLoading?: boolean;
  chartData?: {
    weeklyAttendance: { name: string; value: number }[];
    departmentDistribution: { name: string; value: number; color?: string }[];
    monthlyTrend: { name: string; attendance: number; tasks: number }[];
  };
}

const COLORS = {
  primary: 'hsl(225, 80%, 56%)',
  success: 'hsl(173, 58%, 39%)',
  warning: 'hsl(43, 74%, 66%)',
  danger: 'hsl(0, 84%, 60%)',
  info: 'hsl(200, 65%, 55%)',
};

export function DashboardStats({ stats, isLoading, chartData }: DashboardStatsProps) {
  if (isLoading) {
    return (
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {[1, 2, 3, 4].map((i) => (
          <Card key={i} className="animate-pulse">
            <CardContent className="p-6">
              <div className="h-4 bg-muted rounded w-1/2 mb-4"></div>
              <div className="h-8 bg-muted rounded w-3/4"></div>
            </CardContent>
          </Card>
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          title="Total Employees"
          value={stats.totalEmployees}
          icon={Users}
          iconColor={COLORS.primary}
          iconBgColor="hsl(225, 80%, 56% / 0.1)"
        />
        <StatCard
          title="Active Now"
          value={stats.activeEmployees}
          icon={CheckCircle}
          iconColor={COLORS.success}
          iconBgColor="hsl(173, 58%, 39% / 0.1)"
          trend={stats.activeEmployees > 0 ? { value: Math.round((stats.activeEmployees / stats.totalEmployees) * 100), isPositive: true } : undefined}
        />
        <StatCard
          title="On Leave"
          value={stats.onLeave}
          icon={Calendar}
          iconColor={COLORS.warning}
          iconBgColor="hsl(43, 74%, 66% / 0.1)"
        />
        <StatCard
          title="Pending Tasks"
          value={stats.pendingTasks}
          icon={AlertCircle}
          iconColor={COLORS.danger}
          iconBgColor="hsl(0, 84%, 60% / 0.1)"
        />
      </div>

      {chartData && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-lg font-semibold">Weekly Attendance</CardTitle>
            </CardHeader>
            <CardContent>
              <DashboardBarChart
                data={chartData.weeklyAttendance}
                height={250}
                colors={[COLORS.primary, COLORS.success, COLORS.warning, COLORS.info]}
              />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-lg font-semibold">Department Distribution</CardTitle>
            </CardHeader>
            <CardContent>
              <DashboardPieChart
                data={chartData.departmentDistribution}
                height={250}
                innerRadius={50}
                outerRadius={90}
              />
            </CardContent>
          </Card>
        </div>
      )}

      {chartData?.monthlyTrend && (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg font-semibold">Monthly Trend</CardTitle>
          </CardHeader>
          <CardContent>
            <DashboardLineChart
              data={chartData.monthlyTrend}
              lines={[
                { dataKey: 'attendance', color: COLORS.primary, name: 'Attendance' },
                { dataKey: 'tasks', color: COLORS.success, name: 'Tasks' },
              ]}
              height={280}
            />
          </CardContent>
        </Card>
      )}
    </div>
  );
}

export default DashboardStats;