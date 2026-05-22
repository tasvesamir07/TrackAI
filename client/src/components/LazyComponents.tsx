import { lazy, Suspense } from 'react';
import { Skeleton } from '@/components/ui/skeleton';

export const LazyGanttChart = lazy(() => import('@/components/projects/GanttChart').then(m => ({ default: m.GanttChart })));
export const LazyOrgChart = lazy(() => import('@/components/directory/OrgChart').then(m => ({ default: m.OrgChart })));
export const LazyWorldMap = lazy(() => import('@/components/analytics/WorldMap').then(m => ({ default: m.WorldMap })));
export const LazyClickHeatmap = lazy(() => import('@/components/ClickHeatmap').then(m => ({ default: m.ClickHeatmap })));
export const LazyPerformanceMonitor = lazy(() => import('@/components/admin/PerformanceMonitor').then(m => ({ default: m.PerformanceMonitor })));
export const LazyROICalculator = lazy(() => import('@/components/sales/ROICalculator').then(m => ({ default: m.ROICalculator })));

export function LazySkeleton({ className }: { className?: string }) {
  return <Skeleton className={className || "w-full h-64"} />;
}

export function LazyWrapper({ children, fallback = <LazySkeleton className="w-full h-64" /> }: { children: React.ReactNode; fallback?: React.ReactNode }) {
  return <Suspense fallback={fallback}>{children}</Suspense>;
}

export const LazyLoadWrapper = ({ 
  children, 
  height = 'h-64',
  width = 'w-full'
}: { 
  children: React.ReactNode; 
  height?: string;
  width?: string;
}) => (
  <Suspense fallback={<Skeleton className={`${height} ${width}`} />}>
    {children}
  </Suspense>
);