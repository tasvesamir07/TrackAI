import type { LucideIcon } from 'lucide-react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

const badgeVariants = cva(
  'inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold transition-colors focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2',
  {
    variants: {
      variant: {
        default: 'border-transparent bg-primary text-primary-foreground hover:bg-primary/80',
        secondary: 'border-transparent bg-secondary text-secondary-foreground hover:bg-secondary/80',
        destructive: 'border-transparent bg-destructive text-destructive-foreground hover:bg-destructive/80',
        outline: 'text-foreground',
        success: 'border-transparent bg-emerald-100 text-emerald-700 hover:bg-emerald-200',
        warning: 'border-transparent bg-amber-100 text-amber-700 hover:bg-amber-200',
        info: 'border-transparent bg-blue-100 text-blue-700 hover:bg-blue-200',
        purple: 'border-transparent bg-purple-100 text-purple-700 hover:bg-purple-200',
        pink: 'border-transparent bg-pink-100 text-pink-700 hover:bg-pink-200',
        orange: 'border-transparent bg-orange-100 text-orange-700 hover:bg-orange-200',
      },
    },
    defaultVariants: {
      variant: 'default',
    },
  }
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return (
    <div className={cn(badgeVariants({ variant }), className)} {...props} />
  );
}

function BadgeWithIcon({
  icon: Icon,
  label,
  variant = 'default',
  className,
}: {
  icon: LucideIcon;
  label: string;
  variant?: VariantProps<typeof badgeVariants>['variant'];
  className?: string;
}) {
  return (
    <Badge variant={variant} className={cn('gap-1 py-1', className)}>
      <Icon className="h-3 w-3" />
      {label}
    </Badge>
  );
}

function StatusBadge({
  status,
  label,
}: {
  status: 'active' | 'inactive' | 'working' | 'break' | 'pending' | 'approved' | 'rejected';
  label?: string;
}) {
  const statusConfig = {
    active: { variant: 'success' as const, icon: undefined },
    inactive: { variant: 'secondary' as const, icon: undefined },
    working: { variant: 'info' as const, icon: undefined },
    break: { variant: 'warning' as const, icon: undefined },
    pending: { variant: 'orange' as const, icon: undefined },
    approved: { variant: 'success' as const, icon: undefined },
    rejected: { variant: 'destructive' as const, icon: undefined },
  };

  const config = statusConfig[status];
  const displayLabel = label || status.charAt(0).toUpperCase() + status.slice(1);

  return <Badge variant={config.variant}>{displayLabel}</Badge>;
}

function RoleBadge({ role }: { role: string }) {
  const roleConfig: Record<string, { variant: VariantProps<typeof badgeVariants>['variant']; label: string }> = {
    admin: { variant: 'purple', label: 'Admin' },
    COMPANY_ADMIN: { variant: 'purple', label: 'Company Admin' },
    moderator: { variant: 'info', label: 'Project Manager' },
    PROJECT_MANAGER: { variant: 'info', label: 'Project Manager' },
    employee: { variant: 'success', label: 'Employee' },
    EMPLOYEE: { variant: 'success', label: 'Employee' },
    SUPERADMIN: { variant: 'destructive', label: 'Super Admin' },
  };

  const config = roleConfig[role] || { variant: 'secondary', label: role };

  return <Badge variant={config.variant}>{config.label}</Badge>;
}

export { Badge, badgeVariants, BadgeWithIcon, StatusBadge, RoleBadge };