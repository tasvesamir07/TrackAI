import { LineChart as RechartsLineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts';

interface LineChartProps {
  data: Record<string, unknown>[];
  lines: { dataKey: string; color: string; name?: string }[];
  xKey?: string;
  height?: number;
  showGrid?: boolean;
  showLegend?: boolean;
}

export function DashboardLineChart({
  data,
  lines,
  xKey = 'name',
  height = 300,
  showGrid = true,
  showLegend = false,
}: LineChartProps) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <RechartsLineChart data={data} margin={{ top: 10, right: 10, left: -10, bottom: 0 }}>
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
        {showLegend && <Legend />}
        {lines.map((line) => (
          <Line
            key={line.dataKey}
            type="monotone"
            dataKey={line.dataKey}
            name={line.name || line.dataKey}
            stroke={line.color}
            strokeWidth={2}
            dot={{ fill: line.color, strokeWidth: 2, r: 4 }}
            activeDot={{ r: 6, strokeWidth: 2 }}
          />
        ))}
      </RechartsLineChart>
    </ResponsiveContainer>
  );
}

export default DashboardLineChart;