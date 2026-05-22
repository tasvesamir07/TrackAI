import { Skeleton } from '@/components/ui/skeleton';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { cn } from '@/lib/utils';

interface TableSkeletonProps {
  rows?: number;
  columns?: number;
  className?: string;
}

export function TableSkeleton({ rows = 5, columns = 4, className }: TableSkeletonProps) {
  return (
    <div className={cn('space-y-3', className)}>
      <div className="flex gap-4">
        {Array.from({ length: columns }).map((_, i) => (
          <Skeleton key={i} className="h-4 flex-1" />
        ))}
      </div>
      {Array.from({ length: rows }).map((_, rowIndex) => (
        <div key={rowIndex} className="flex gap-4">
          {Array.from({ length: columns }).map((_, colIndex) => (
            <Skeleton key={colIndex} className="h-10 flex-1" />
          ))}
        </div>
      ))}
    </div>
  );
}

interface CardSkeletonProps {
  className?: string;
}

export function CardSkeleton({ className }: CardSkeletonProps) {
  return (
    <Card className={cn('', className)}>
      <CardHeader>
        <Skeleton className="h-4 w-1/3" />
        <Skeleton className="h-3 w-1/2" />
      </CardHeader>
      <CardContent>
        <Skeleton className="h-20 w-full" />
      </CardContent>
    </Card>
  );
}

interface FormSkeletonProps {
  fields?: number;
  className?: string;
}

export function FormSkeleton({ fields = 3, className }: FormSkeletonProps) {
  return (
    <div className={cn('space-y-4', className)}>
      {Array.from({ length: fields }).map((_, i) => (
        <div key={i} className="space-y-2">
          <Skeleton className="h-4 w-1/4" />
          <Skeleton className="h-10 w-full" />
        </div>
      ))}
    </div>
  );
}

interface DashboardSkeletonProps {
  statCards?: number;
  charts?: number;
  className?: string;
}

export function DashboardSkeleton({ statCards = 4, charts = 2, className }: DashboardSkeletonProps) {
  return (
    <div className={cn('space-y-6', className)}>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {Array.from({ length: statCards }).map((_, i) => (
          <CardSkeleton key={i} />
        ))}
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {Array.from({ length: charts }).map((_, i) => (
          <Card key={i}>
            <CardHeader>
              <Skeleton className="h-5 w-1/3" />
            </CardHeader>
            <CardContent>
              <Skeleton className="h-64 w-full" />
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}

export function ListSkeleton({ count = 5, className }: { count?: number; className?: string }) {
  return (
    <div className={cn('space-y-3', className)}>
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="flex items-center gap-4">
          <Skeleton className="h-10 w-10 rounded-full" />
          <div className="space-y-2 flex-1">
            <Skeleton className="h-4 w-1/3" />
            <Skeleton className="h-3 w-1/2" />
          </div>
        </div>
      ))}
    </div>
  );
}

export function ChartSkeleton({ className }: { className?: string }) {
  return (
    <div className={cn('space-y-4', className)}>
      <div className="flex justify-between">
        <Skeleton className="h-8 w-1/4" />
        <Skeleton className="h-8 w-1/6" />
      </div>
      <Skeleton className="h-64 w-full" />
    </div>
  );
}