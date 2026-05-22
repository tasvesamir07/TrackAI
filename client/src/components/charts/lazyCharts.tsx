import { lazy, Suspense } from 'react';
import { Skeleton } from '@/components/ui/skeleton';

const LazyBarChart = lazy(() => import('./BarChart'));
const LazyLineChart = lazy(() => import('./LineChart'));
const LazyPieChart = lazy(() => import('./PieChart'));
const LazyAreaChart = lazy(() => import('./AreaChart'));

function ChartSkeleton({ height = 300 }: { height?: number }) {
  return <Skeleton className="w-full" style={{ height }} />;
}

export function LazyBarChartWrapper(props: React.ComponentProps<typeof LazyBarChart>) {
  return (
    <Suspense fallback={<ChartSkeleton height={props.height || 300} />}>
      <LazyBarChart {...props} />
    </Suspense>
  );
}

export function LazyLineChartWrapper(props: React.ComponentProps<typeof LazyLineChart>) {
  return (
    <Suspense fallback={<ChartSkeleton height={props.height || 300} />}>
      <LazyLineChart {...props} />
    </Suspense>
  );
}

export function LazyPieChartWrapper(props: React.ComponentProps<typeof LazyPieChart>) {
  return (
    <Suspense fallback={<ChartSkeleton height={props.height || 300} />}>
      <LazyPieChart {...props} />
    </Suspense>
  );
}

export function LazyAreaChartWrapper(props: React.ComponentProps<typeof LazyAreaChart>) {
  return (
    <Suspense fallback={<ChartSkeleton height={props.height || 300} />}>
      <LazyAreaChart {...props} />
    </Suspense>
  );
}

export default {
  LazyBarChart: LazyBarChartWrapper,
  LazyLineChart: LazyLineChartWrapper,
  LazyPieChart: LazyPieChartWrapper,
  LazyAreaChart: LazyAreaChartWrapper,
};