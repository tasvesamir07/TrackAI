import { Link, useLocation } from 'react-router-dom';
import { ChevronRight, Home } from 'lucide-react';

export interface BreadcrumbItem {
  label: string;
  href?: string;
  icon?: React.ReactNode;
}

interface BreadcrumbProps {
  items: BreadcrumbItem[];
  className?: string;
}

export function Breadcrumb({ items, className = '' }: BreadcrumbProps) {
  const location = useLocation();
  
  return (
    <nav aria-label="Breadcrumb" className={`flex items-center gap-1 text-sm ${className}`}>
      <Link
        to="/"
        className="flex items-center gap-1 text-muted-foreground hover:text-foreground transition-colors"
        title="Home"
      >
        <Home className="w-4 h-4" />
        <span className="sr-only">Home</span>
      </Link>
      
      {items.map((item, index) => (
        <div key={index} className="flex items-center gap-1">
          <ChevronRight className="w-4 h-4 text-muted-foreground/50" />
          {item.href && index < items.length - 1 ? (
            <Link
              to={item.href}
              className="flex items-center gap-1 text-muted-foreground hover:text-foreground transition-colors"
            >
              {item.icon}
              <span>{item.label}</span>
            </Link>
          ) : (
            <span className="flex items-center gap-1 text-foreground font-medium">
              {item.icon}
              <span>{item.label}</span>
            </span>
          )}
        </div>
      ))}
    </nav>
  );
}

export function usePageBreadcrumb(title: string, parentHref?: string): BreadcrumbItem[] {
  const location = useLocation();
  const path = location.pathname;
  
  const homeItem: BreadcrumbItem = { label: 'Home', href: '/' };
  
  if (path.startsWith('/admin') || path.startsWith('/superadmin')) {
    const role = path.includes('superadmin') ? 'Superadmin' : 'Admin';
    return [
      homeItem,
      { label: role, href: parentHref || path.split('?')[0] },
      { label: title }
    ];
  }
  
  if (path.startsWith('/dashboard')) {
    return [
      homeItem,
      { label: 'Dashboard' },
      { label: title }
    ];
  }
  
  if (path.startsWith('/projects')) {
    return [
      homeItem,
      { label: 'Projects', href: '/projects' },
      { label: title }
    ];
  }
  
  if (path.startsWith('/profile')) {
    return [
      homeItem,
      { label: 'Profile' },
      { label: title }
    ];
  }
  
  return [homeItem, { label: title }];
}