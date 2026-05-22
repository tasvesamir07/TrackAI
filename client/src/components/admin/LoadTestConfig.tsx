import { useState, useRef, useEffect, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { Play, Square, History, Download, Loader2 } from 'lucide-react';
import api from '@/lib/api';

interface StepResult {
  users: number;
  requests: number;
  successes: number;
  errors: number;
  avgResponse: number;
  p95: number;
  errorRate: number;
  status: 'pass' | 'warn' | 'fail';
}

interface TestSummary {
  testId: string;
  maxCapacity: number;
  totalSteps: number;
  totalDuration: number;
  steps: StepResult[];
  timestamp: string;
}

interface HistoryItem {
  maxCapacity: number;
  totalSteps: number;
  timestamp: string;
  testId: string;
}

const STEPS_LABELS: Record<string, string> = {
  pass: 'Pass',
  warn: 'Warning',
  fail: 'Fail',
};

const STEPS_COLORS: Record<string, string> = {
  pass: 'bg-green-500',
  warn: 'bg-yellow-500',
  fail: 'bg-red-500',
};

const STEPS_TEXT_COLORS: Record<string, string> = {
  pass: 'text-green-600',
  warn: 'text-yellow-600',
  fail: 'text-red-600',
};

const persistLoadTestHistory = (
  setHistory: React.Dispatch<React.SetStateAction<HistoryItem[]>>,
  historyItem: HistoryItem
) => {
  setHistory((prev) => {
    const deduped = prev.filter((item) => item.testId !== historyItem.testId);
    const next = [historyItem, ...deduped].slice(0, 10);
    localStorage.setItem('loadtest_history', JSON.stringify(next));
    return next;
  });
};

const STATUS_INDICATOR: Record<string, string> = {
  pass: '🟢',
  warn: '🟡',
  fail: '🔴',
};

export function LoadTestConfig() {
  const [isRunning, setIsRunning] = useState(false);
  const [steps, setSteps] = useState<StepResult[]>([]);
  const [summary, setSummary] = useState<TestSummary | null>(null);
  const [history, setHistory] = useState<HistoryItem[]>(() => {
    try {
      return JSON.parse(localStorage.getItem('loadtest_history') || '[]');
    } catch {
      return [];
    }
  });
  const [currentTestId, setCurrentTestId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const cleanup = useCallback(() => {
    if (pollingRef.current) {
      clearInterval(pollingRef.current);
      pollingRef.current = null;
    }
  }, []);

  useEffect(() => {
    return cleanup;
  }, [cleanup]);

  const startPolling = useCallback((testId: string) => {
    if (pollingRef.current) clearInterval(pollingRef.current);
    pollingRef.current = setInterval(async () => {
      try {
        const res = await api.get(`/loadtest/status/${testId}`);
        const data = res.data;
        if (data.steps && data.steps.length > 0) {
          setSteps(data.steps);
        }
        if (data.summary) {
          setSummary(data.summary);
          setIsRunning(false);
          cleanup();
          const historyItem: HistoryItem = {
            maxCapacity: data.summary.maxCapacity,
            totalSteps: data.summary.totalSteps,
            timestamp: data.summary.timestamp,
            testId: data.summary.testId,
          };
          persistLoadTestHistory(setHistory, historyItem);
        }
      } catch {
        // polling failed, try again
      }
    }, 2000);
  }, [cleanup]);

  const handleStartTest = async () => {
    setError(null);
    setSteps([]);
    setSummary(null);
    setIsRunning(true);

    try {
      const res = await api.post('/loadtest/run');
      const { testId } = res.data;
      setCurrentTestId(testId);
      // Use polling as the primary transport to avoid SSE 504 gateway timeout noise on Railway.
      startPolling(testId);
    } catch (err: unknown) {
      const error = err as { response?: { data?: { error?: string } } };
      setError(error?.response?.data?.error || 'Failed to start load test');
      setIsRunning(false);
    }
  };

  const handleStopTest = async () => {
    try {
      await api.post('/loadtest/stop', { testId: currentTestId });
    } catch {
      // stop best-effort
    }
    setIsRunning(false);
    cleanup();
  };

  const maxUsers = steps.length > 0 ? Math.max(...steps.map(s => s.users)) : 0;
  const maxRequests = steps.length > 0 ? Math.max(...steps.map(s => s.requests)) : 1;

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            Progressive Load Test
          </CardTitle>
          <CardDescription>
            Automatically tests this server's capacity by increasing concurrent users until failure
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-center gap-3">
            {!isRunning ? (
              <Button onClick={handleStartTest} className="gap-2" size="lg">
                <Play className="w-4 h-4" />
                Start Load Test
              </Button>
            ) : (
              <Button onClick={handleStopTest} variant="destructive" className="gap-2" size="lg">
                <Square className="w-4 h-4" />
                Stop Test
              </Button>
            )}
            {isRunning && (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="w-4 h-4 animate-spin" />
                Testing... {steps.length > 0 ? `${steps[steps.length - 1].users} users` : 'starting'}
              </div>
            )}
          </div>

          {error && (
            <div className="mt-4 p-3 rounded-lg bg-red-50 dark:bg-red-950 text-red-700 dark:text-red-300 text-sm">
              {error}
            </div>
          )}
        </CardContent>
      </Card>

      {steps.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Results</CardTitle>
            <CardDescription>
              Each row shows a load level with {STEP_DURATION_MS / 1000}s duration
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-12 gap-2 text-xs font-semibold text-muted-foreground uppercase tracking-wide px-2">
              <div className="col-span-2">Users</div>
              <div className="col-span-4">Success Rate</div>
              <div className="col-span-2 text-right">Avg Resp</div>
              <div className="col-span-2 text-right">Errors</div>
              <div className="col-span-2 text-right">Status</div>
            </div>

            {steps.map((step) => {
              const successRate = step.requests > 0
                ? Math.round((step.successes / step.requests) * 100)
                : 0;
              const barWidth = maxRequests > 0
                ? Math.round((step.requests / maxRequests) * 100)
                : 0;

              return (
                <div
                  key={step.users}
                  className={`grid grid-cols-12 gap-2 items-center p-3 rounded-lg border ${
                    step.status === 'fail'
                      ? 'bg-red-50 dark:bg-red-950/30 border-red-200 dark:border-red-800'
                      : step.status === 'warn'
                      ? 'bg-yellow-50 dark:bg-yellow-950/30 border-yellow-200 dark:border-yellow-800'
                      : 'bg-green-50 dark:bg-green-950/30 border-green-200 dark:border-green-800'
                  }`}
                >
                  <div className="col-span-2 font-bold text-sm">
                    {step.users}
                  </div>
                  <div className="col-span-4">
                    <div className="flex items-center gap-2">
                      <div className="flex-1 h-4 bg-muted rounded-full overflow-hidden">
                        <div
                          className={`h-full rounded-full transition-all duration-500 ${STEPS_COLORS[step.status]}`}
                          style={{ width: `${barWidth}%` }}
                        />
                      </div>
                      <span className="text-xs font-medium w-10 text-right">
                        {successRate}%
                      </span>
                    </div>
                  </div>
                  <div className="col-span-2 text-right text-sm">
                    {step.avgResponse}ms
                  </div>
                  <div className="col-span-2 text-right text-sm">
                    <span className={step.errorRate > 5 ? 'text-red-600 font-medium' : ''}>
                      {step.errorRate}%
                    </span>
                  </div>
                  <div className="col-span-2 text-right text-sm font-medium">
                    <span className={STEPS_TEXT_COLORS[step.status]}>
                      {STATUS_INDICATOR[step.status]} {STEPS_LABELS[step.status]}
                    </span>
                  </div>
                </div>
              );
            })}

            {isRunning && (
              <div className="flex items-center justify-center py-4 text-sm text-muted-foreground">
                <Loader2 className="w-4 h-4 animate-spin mr-2" />
                Running next step...
              </div>
            )}

            {summary && !isRunning && (
              <div className="mt-6 p-4 rounded-xl border bg-card">
                <h4 className="font-bold text-lg mb-3">Test Summary</h4>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  <div className="text-center p-3 rounded-lg bg-muted">
                    <div className="text-2xl font-bold">{summary.maxCapacity}</div>
                    <div className="text-xs text-muted-foreground">Max Capacity (users)</div>
                  </div>
                  <div className="text-center p-3 rounded-lg bg-muted">
                    <div className="text-2xl font-bold">{summary.totalSteps}</div>
                    <div className="text-xs text-muted-foreground">Levels Completed</div>
                  </div>
                  <div className="text-center p-3 rounded-lg bg-muted">
                    <div className="text-2xl font-bold">{(summary.totalDuration / 1000).toFixed(0)}s</div>
                    <div className="text-xs text-muted-foreground">Total Duration</div>
                  </div>
                  <div className="text-center p-3 rounded-lg bg-muted">
                    <div className="text-2xl font-bold">
                      {summary.steps.reduce((s, st) => s + st.requests, 0).toLocaleString()}
                    </div>
                    <div className="text-xs text-muted-foreground">Total Requests</div>
                  </div>
                </div>

                {summary.maxCapacity > 0 && (
                  <div className="mt-4 p-3 rounded-lg bg-blue-50 dark:bg-blue-950 text-blue-800 dark:text-blue-200 text-sm">
                    <strong>Result:</strong>{' '}
                    The server handles up to <strong>{summary.maxCapacity}</strong> concurrent users{' '}
                    {summary.maxCapacity >= 500
                      ? 'without breaking. Consider testing with higher limits.'
                      : 'before performance degrades beyond acceptable thresholds.'}
                  </div>
                )}

                {summary.maxCapacity === 0 && summary.steps.length > 0 && (
                  <div className="mt-4 p-3 rounded-lg bg-red-50 dark:bg-red-950 text-red-800 dark:text-red-200 text-sm">
                    <strong>Result:</strong> The server failed even at the lowest load level ({summary.steps[0]?.users} users). Immediate infrastructure review recommended.
                  </div>
                )}

                <Button
                  variant="outline"
                  className="mt-4 gap-2"
                  onClick={() => {
                    const blob = new Blob([JSON.stringify(summary, null, 2)], { type: 'application/json' });
                    const url = URL.createObjectURL(blob);
                    const a = document.createElement('a');
                    a.href = url;
                    a.download = `loadtest-${summary.testId}.json`;
                    a.click();
                    URL.revokeObjectURL(url);
                  }}
                >
                  <Download className="w-4 h-4" />
                  Export Results
                </Button>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {history.length > 0 && !isRunning && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-lg">
              <History className="w-4 h-4" />
              Test History
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {history.map((item, index) => (
                <div
                  key={item.testId || index}
                  className="flex items-center justify-between p-3 rounded-lg border hover:bg-muted/50 cursor-pointer"
                  onClick={() => {
                    setSteps(summary?.steps || []);
                  }}
                >
                  <div>
                    <div className="font-medium text-sm">
                      Max {item.maxCapacity} concurrent users
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {new Date(item.timestamp).toLocaleString()} &middot; {item.totalSteps} levels
                    </div>
                  </div>
                  <span className={`text-lg font-bold ${
                    item.maxCapacity >= 50 ? 'text-green-600' :
                    item.maxCapacity >= 20 ? 'text-yellow-600' : 'text-red-600'
                  }`}>
                    {item.maxCapacity}
                  </span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

const STEP_DURATION_MS = 10000;
