import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Sparkles, Bug, Zap, ArrowRight } from 'lucide-react';

export function Changelog() {
  const updates = [
    {
      version: 'v2.4.0',
      date: 'May 21, 2026',
      type: 'Major',
      changes: [
        { icon: <Zap className="w-4 h-4 text-amber-500" />, text: 'New Analytics Console for Superadmins' },
        { icon: <Sparkles className="w-4 h-4 text-purple-500" />, text: 'Introduced Feature Voting and Heatmaps' },
        { icon: <Bug className="w-4 h-4 text-green-500" />, text: 'Fixed overlapping sidebar on mobile devices' },
      ]
    },
    {
      version: 'v2.3.5',
      date: 'May 15, 2026',
      type: 'Patch',
      changes: [
        { icon: <Bug className="w-4 h-4 text-green-500" />, text: 'Resolved issue with late sign-out calculations' },
        { icon: <Zap className="w-4 h-4 text-amber-500" />, text: 'Improved dashboard load times by 40%' },
      ]
    }
  ];

  return (
    <div className="space-y-6 max-w-4xl">
      <div>
        <h2 className="text-2xl font-bold tracking-tight">What's New</h2>
        <p className="text-muted-foreground">Stay up to date with the latest improvements and features in Track AI.</p>
      </div>

      <div className="space-y-8 relative before:absolute before:inset-0 before:ml-5 before:-translate-x-px before:h-full before:w-0.5 before:bg-gradient-to-b before:from-transparent before:via-slate-200 before:to-transparent">
        {updates.map((update, i) => (
          <div key={i} className="relative flex items-baseline gap-6 pb-2">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-white border shadow-sm z-10">
              <div className="h-2 w-2 rounded-full bg-blue-500" />
            </div>
            <div className="flex flex-col gap-2 w-full">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <h3 className="text-lg font-bold">{update.version}</h3>
                  <Badge variant="outline">{update.type}</Badge>
                </div>
                <time className="text-sm text-muted-foreground font-medium">{update.date}</time>
              </div>
              <Card>
                <CardContent className="p-4">
                  <ul className="space-y-3">
                    {update.changes.map((change, j) => (
                      <li key={j} className="flex items-start gap-3 text-sm">
                        <div className="mt-0.5">{change.icon}</div>
                        <span className="text-slate-700 leading-relaxed">{change.text}</span>
                      </li>
                    ))}
                  </ul>
                </CardContent>
              </Card>
            </div>
          </div>
        ))}
      </div>
      
      <div className="text-center pt-4">
        <Button variant="ghost" className="text-blue-600 hover:text-blue-700 hover:bg-blue-50">
          View Full Archive <ArrowRight className="w-4 h-4 ml-2" />
        </Button>
      </div>
    </div>
  );
}

function Button({ children, variant, className, onClick }: any) {
    const variants: any = {
        ghost: "bg-transparent",
        outline: "border border-slate-200"
    };
    return (
        <button 
            onClick={onClick}
            className={`px-4 py-2 rounded-lg font-medium transition-colors inline-flex items-center justify-center ${variants[variant || 'outline']} ${className}`}
        >
            {children}
        </button>
    );
}