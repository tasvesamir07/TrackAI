import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip, Legend } from 'recharts';

interface PieChartProps {
  data: { name: string; value: number; color?: string }[];
  height?: number;
  showLegend?: boolean;
  innerRadius?: number;
  outerRadius?: number;
}

const DEFAULT_COLORS = [
  'hsl(225, 80%, 56%)',
  'hsl(173, 58%, 39%)',
  'hsl(43, 74%, 66%)',
  'hsl(280, 65%, 60%)',
  'hsl(340, 75%, 55%)',
  'hsl(30, 80%, 55%)',
  'hsl(200, 65%, 55%)',
];

export function DashboardPieChart({
  data,
  height = 300,
  showLegend = true,
  innerRadius = 60,
  outerRadius = 100,
}: PieChartProps) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <PieChart>
        <Pie
          data={data}
          cx="50%"
          cy="50%"
          innerRadius={innerRadius}
          outerRadius={outerRadius}
          paddingAngle={2}
          dataKey="value"
        >
          {data.map((entry, index) => (
            <Cell key={`cell-${index}`} fill={entry.color || DEFAULT_COLORS[index % DEFAULT_COLORS.length]} />
          ))}
        </Pie>
        <Tooltip
          contentStyle={{
            backgroundColor: 'hsl(var(--card))',
            border: '1px solid hsl(var(--border))',
            borderRadius: '8px',
            boxShadow: '0 4px 12px rgba(0,0,0,0.1)',
          }}
          labelStyle={{ color: 'hsl(var(--foreground))', fontWeight: 600 }}
        />
        {showLegend && (
          <Legend
            layout="vertical"
            align="right"
            verticalAlign="middle"
            formatter={(value) => <span style={{ color: 'hsl(var(--foreground))', fontSize: '12px' }}>{value}</span>}
          />
        )}
      </PieChart>
    </ResponsiveContainer>
  );
}

export default DashboardPieChart;