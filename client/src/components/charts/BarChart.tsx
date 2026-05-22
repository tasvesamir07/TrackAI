import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell } from 'recharts';

interface BarChartProps {
  data: { name: string; value: number; color?: string }[];
  xKey?: string;
  yKey?: string;
  height?: number;
  showGrid?: boolean;
  showTooltip?: boolean;
  colors?: string[];
}

const DEFAULT_COLORS = [
  'hsl(225, 80%, 56%)',
  'hsl(173, 58%, 39%)',
  'hsl(43, 74%, 66%)',
  'hsl(280, 65%, 60%)',
  'hsl(340, 75%, 55%)',
];

export function DashboardBarChart({
  data,
  xKey = 'name',
  yKey = 'value',
  height = 300,
  showGrid = true,
  showTooltip = true,
  colors = DEFAULT_COLORS,
}: BarChartProps) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} margin={{ top: 10, right: 10, left: -10, bottom: 0 }}>
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
        {showTooltip && (
          <Tooltip
            contentStyle={{
              backgroundColor: 'hsl(var(--card))',
              border: '1px solid hsl(var(--border))',
              borderRadius: '8px',
              boxShadow: '0 4px 12px rgba(0,0,0,0.1)',
            }}
            labelStyle={{ color: 'hsl(var(--foreground))', fontWeight: 600 }}
          />
        )}
        <Bar dataKey={yKey} radius={[4, 4, 0, 0]}>
          {data.map((entry, index) => (
            <Cell key={`cell-${index}`} fill={entry.color || colors[index % colors.length]} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

export default DashboardBarChart;