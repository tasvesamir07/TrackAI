import type { LucideIcon } from 'lucide-react';
import { TrendingUp, TrendingDown, Minus } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { cn } from '@/lib/utils';

interface StatCardProps {
  title: string;
  value: string | number;
  icon: LucideIcon;
  iconColor?: string;
  iconBgColor?: string;
  trend?: {
    value: number;
    isPositive: boolean;
    isNeutral?: boolean;
  };
  description?: string;
  className?: string;
}

export function StatCard({
  title,
  value,
  icon: Icon,
  iconColor = 'hsl(225, 80%, 56%)',
  iconBgColor = 'hsl(225, 80%, 56% / 0.1)',
  trend,
  description,
  className,
}: StatCardProps) {
  return (
    <Card className={cn('hover:shadow-md transition-shadow duration-200', className)}>
      <CardContent className="p-6">
        <div className="flex items-start justify-between">
          <div className="space-y-2">
            <p className="text-sm font-medium text-muted-foreground">{title}</p>
            <p className="text-3xl font-bold tracking-tight">{value}</p>
            {description && (
              <p className="text-xs text-muted-foreground">{description}</p>
            )}
            {trend && (
              <div className="flex items-center gap-1">
                {trend.isNeutral ? (
                  <Minus className="h-4 w-4 text-muted-foreground" />
                ) : trend.isPositive ? (
                  <TrendingUp className="h-4 w-4 text-emerald-500" />
                ) : (
                  <TrendingDown className="h-4 w-4 text-red-500" />
                )}
                <span
                  className={cn(
                    'text-sm font-medium',
                    trend.isNeutral && 'text-muted-foreground',
                    trend.isPositive && 'text-emerald-500',
                    !trend.isPositive && !trend.isNeutral && 'text-red-500'
                  )}
                >
                  {Math.abs(trend.value)}%
                </span>
                <span className="text-xs text-muted-foreground">vs last period</span>
              </div>
            )}
          </div>
          <div
            className="p-3 rounded-lg"
            style={{ backgroundColor: iconBgColor }}
          >
            <Icon className="h-5 w-5" style={{ color: iconColor }} />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

export default StatCard;