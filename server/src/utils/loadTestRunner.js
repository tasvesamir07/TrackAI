const http = require('http');
const https = require('https');

const BASE_PROGRESSIVE_STEPS = [5, 10, 15, 20, 25, 30, 40, 50, 75, 100, 150, 200, 300, 500, 750, 1000];
const LOADTEST_MAX_USERS = Number.parseInt(process.env.LOADTEST_MAX_USERS || '5000', 10);

const buildProgressiveSteps = () => {
  const maxUsers = Number.isFinite(LOADTEST_MAX_USERS) && LOADTEST_MAX_USERS > 0 ? LOADTEST_MAX_USERS : 5000;
  const steps = [...BASE_PROGRESSIVE_STEPS];

  let current = steps[steps.length - 1];
  while (current < maxUsers) {
    // Increase aggressively enough to avoid extremely long test sessions.
    const next = Math.min(maxUsers, Math.ceil(current * 1.5 / 50) * 50);
    if (next <= current) break;
    steps.push(next);
    current = next;
  }

  return steps;
};

const STEP_DURATION_MS = 10000;

const INTERNAL_ENDPOINTS = [
  { path: '/api/auth/me', method: 'GET' },
  { path: '/api/superadmin/metrics/server', method: 'GET' },
  { path: '/api/superadmin/metrics/users', method: 'GET' },
  { path: '/api/superadmin/dashboard?view=compact', method: 'GET' },
];

const ERROR_RATE_THRESHOLD = 15;

const AVG_RESPONSE_THRESHOLD_MS = 3000;

class ProgressiveLoadTestRunner {
  constructor() {
    this.isRunning = false;
    this.testId = null;
    this.steps = [];
    this.currentStepIndex = -1;
    this.startTime = null;
    this.endTime = null;
    this.onStepComplete = null;
    this.onComplete = null;
  }

  async run(baseUrl, callbacks = {}) {
    this.isRunning = true;
    this.steps = [];
    this.currentStepIndex = -1;
    this.startTime = Date.now();
    this.endTime = null;
    this.testId = `loadtest_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
    this.onStepComplete = callbacks.onStepComplete || null;
    this.onComplete = callbacks.onComplete || null;

    const urlObj = new URL(baseUrl);
    const isHttps = urlObj.protocol === 'https:';
    const hostname = urlObj.hostname;
    const port = urlObj.port || (isHttps ? 443 : 80);

    const transport = { hostname, port, isHttps };

    const progressiveSteps = buildProgressiveSteps();
    for (let i = 0; i < progressiveSteps.length; i++) {
      if (!this.isRunning) break;

      const users = progressiveSteps[i];
      this.currentStepIndex = i;

      const stepResult = await this.runStep(transport, users);
      this.steps.push(stepResult);

      if (this.onStepComplete) {
        this.onStepComplete(stepResult, this.steps);
      }

      if (stepResult.status === 'fail') {
        break;
      }
    }

    this.isRunning = false;
    this.endTime = Date.now();
    this.currentStepIndex = -1;

    const maxCapacity = this.calculateMaxCapacity();

    const summary = {
      testId: this.testId,
      maxCapacity,
      totalSteps: this.steps.length,
      totalDuration: this.endTime - this.startTime,
      steps: this.steps,
      timestamp: new Date().toISOString(),
    };

    if (this.onComplete) {
      this.onComplete(summary);
    }

    return summary;
  }

  async runStep(transport, users) {
    const stepStart = Date.now();
    const endTime = stepStart + STEP_DURATION_MS;

    const results = {
      users,
      requests: 0,
      successes: 0,
      errors: 0,
      responseTimes: [],
      errorRate: 0,
      avgResponse: 0,
      p95: 0,
      status: 'pass',
    };

    const workers = [];
    for (let i = 0; i < users; i++) {
      workers.push(this.workerLoop(transport, endTime, results));
    }

    await Promise.all(workers);

    const elapsed = Date.now() - stepStart;
    results.avgResponse = results.responseTimes.length > 0
      ? Math.round(results.responseTimes.reduce((a, b) => a + b, 0) / results.responseTimes.length)
      : 0;

    const sorted = [...results.responseTimes].sort((a, b) => a - b);
    results.p95 = sorted.length > 0
      ? sorted[Math.floor(sorted.length * 0.95)] || 0
      : 0;

    results.errorRate = results.requests > 0
      ? Number(((results.errors / results.requests) * 100).toFixed(1))
      : 0;

    if (results.errorRate >= ERROR_RATE_THRESHOLD || results.avgResponse > AVG_RESPONSE_THRESHOLD_MS) {
      results.status = 'fail';
    } else if (results.errorRate > 5 || results.avgResponse > 1000) {
      results.status = 'warn';
    } else {
      results.status = 'pass';
    }

    return results;
  }

  async workerLoop(transport, endTime, results) {
    let endpointIndex = 0;

    while (this.isRunning && Date.now() < endTime) {
      const endpoint = INTERNAL_ENDPOINTS[endpointIndex % INTERNAL_ENDPOINTS.length];
      endpointIndex++;

      const start = Date.now();
      try {
        await this.makeRequest(transport, endpoint);
        results.successes++;
        results.responseTimes.push(Date.now() - start);
      } catch {
        results.errors++;
      }
      results.requests++;
    }
  }

  makeRequest(transport, endpoint) {
    return new Promise((resolve, reject) => {
      const client = transport.isHttps ? https : http;
      const options = {
        hostname: transport.hostname,
        port: transport.port,
        path: endpoint.path,
        method: endpoint.method,
        headers: {
          'User-Agent': 'TrackAI-LoadTest/1.0',
          'Accept': 'application/json',
        },
        timeout: 5000,
      };

      const req = client.request(options, (res) => {
        let data = '';
        res.on('data', (chunk) => { data += chunk; });
        res.on('end', () => {
          if (res.statusCode >= 200 && res.statusCode < 500) {
            resolve({ status: res.statusCode, data });
          } else {
            reject(new Error(`HTTP ${res.statusCode}`));
          }
        });
      });

      req.on('error', reject);
      req.on('timeout', () => {
        req.destroy();
        reject(new Error('TIMEOUT'));
      });
      req.end();
    });
  }

  calculateMaxCapacity() {
    let maxStable = 0;
    for (const step of this.steps) {
      if (step.status !== 'fail') {
        maxStable = Math.max(maxStable, step.users);
      }
    }
    return maxStable;
  }

  stop() {
    this.isRunning = false;
  }
}

module.exports = ProgressiveLoadTestRunner;
