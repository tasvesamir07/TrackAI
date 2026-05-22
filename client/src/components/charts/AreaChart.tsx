import { AreaChart as RechartsAreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';

interface AreaChartProps {
  data: Record<string, unknown>[];
  dataKey: string;
  xKey?: string;
  color?: string;
  height?: number;
  showGrid?: boolean;
  gradient?: boolean;
}

export function DashboardAreaChart({
  data,
  dataKey,
  xKey = 'name',
  color = 'hsl(225, 80%, 56%)',
  height = 300,
  showGrid = true,
  gradient = true,
}: AreaChartProps) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <RechartsAreaChart data={data} margin={{ top: 10, right: 10, left: -10, bottom: 0 }}>
        <defs>
          {gradient && (
            <linearGradient id={`gradient-${dataKey}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor={color} stopOpacity={0.3} />
              <stop offset="95%" stopColor={color} stopOpacity={0} />
            </linearGradient>
          )}
        </defs>
        {showGrid && <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border) / 0.5)" />}
        <XAxis 
          dataKey={xKey} 
          tick={{ fontSize: 12, fill: 'hsl(var(--muted-foreground))' }}
          axisLine={{ stroke: 'hsl(var(--border))' }}
          tickLine={false}
        />
        <YAxis 
          tick={{ fontSize: 12, fill: 'hsl(var(--muted-foreground))' }}
          axisLine={false}
          tickLine={false}
        />
        <Tooltip
          contentStyle={{
            backgroundColor: 'hsl(var(--card))',
            border: '1px solid hsl(var(--border))',
            borderRadius: '8px',
            boxShadow: '0 4px 12px rgba(0,0,0,0.1)',
          }}
          labelStyle={{ color: 'hsl(var(--foreground))', fontWeight: 600 }}
        />
        <Area
          type="monotone"
          dataKey={dataKey}
          stroke={color}
          strokeWidth={2}
          fill={`url(#gradient-${dataKey})`}
        />
      </RechartsAreaChart>
    </ResponsiveContainer>
  );
}

export default DashboardAreaChart;