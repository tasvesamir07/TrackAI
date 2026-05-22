/**
 * Application Metrics System
 * Simple Prometheus-compatible metrics without external dependencies
 * @module metrics
 */

const metrics = {
  counters: new Map(),
  gauges: new Map(),
  histograms: new Map(),
  startTimes: new Map(),
};

/**
 * Counter metric - monotonically increasing value
 * @function counter
 * @param {string} name - Metric name
 * @param {Object} labels - Label values
 * @returns {number} Current value
 */
function counter(name, labels = {}) {
  const key = `${name}:${JSON.stringify(labels)}`;
  
  if (!metrics.counters.has(key)) {
    metrics.counters.set(key, 0);
  }
  
  const current = metrics.counters.get(key);
  metrics.counters.set(key, current + 1);
  
  return current + 1;
}

/**
 * Increment counter by value
 * @function incrementCounter
 */
function incrementCounter(name, value = 1, labels = {}) {
  const key = `${name}:${JSON.stringify(labels)}`;
  
  if (!metrics.counters.has(key)) {
    metrics.counters.set(key, 0);
  }
  
  const current = metrics.counters.get(key);
  metrics.counters.set(key, current + value);
  
  return current + value;
}

/**
 * Gauge metric - can go up and down
 * @function gauge
 * @param {string} name - Metric name
 * @param {number} value - Value to set
 * @param {Object} labels - Label values
 */
function gauge(name, value, labels = {}) {
  const key = `${name}:${JSON.stringify(labels)}`;
  metrics.gauges.set(key, value);
  
  return value;
}

/**
 * Set gauge value
 * @function setGauge
 */
function setGauge(name, value, labels = {}) {
  return gauge(name, value, labels);
}

/**
 * Increment gauge
 * @function incrementGauge
 */
function incrementGauge(name, value = 1, labels = {}) {
  const key = `${name}:${JSON.stringify(labels)}`;
  const current = metrics.gauges.get(key) || 0;
  return gauge(name, current + value, labels);
}

/**
 * Histogram metric - for measuring durations
 * @function histogram
 * @param {string} name - Metric name
 * @param {number} duration - Duration in milliseconds
 * @param {Object} labels - Label values
 */
function histogram(name, duration, labels = {}) {
  const key = `${name}:${JSON.stringify(labels)}`;
  
  if (!metrics.histograms.has(key)) {
    metrics.histograms.set(key, {
      count: 0,
      sum: 0,
      min: Infinity,
      max: 0,
      buckets: {},
    });
  }
  
  const hist = metrics.histograms.get(key);
  hist.count++;
  hist.sum += duration;
  hist.min = Math.min(hist.min, duration);
  hist.max = Math.max(hist.max, duration);
  
  // Add to bucket
  const bucketLabel = getBucket(duration);
  hist.buckets[bucketLabel] = (hist.buckets[bucketLabel] || 0) + 1;
  
  return duration;
}

/**
 * Start timing for histogram
 * @function startTimer
 * @returns {Function} Stop timer function
 */
function startTimer(name, labels = {}) {
  const startTime = Date.now();
  
  return () => {
    const duration = Date.now() - startTime;
    histogram(name, duration, labels);
  };
}

/**
 * Get bucket label for duration
 */
function getBucket(duration) {
  const buckets = [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10];
  for (const bucket of buckets) {
    if (duration <= bucket) return `<=${bucket}s`;
  }
  return '>10s';
}

/**
 * Get all metrics in Prometheus format
 * @function getMetrics
 */
function getMetrics() {
  let output = '';
  
  // Counters
  for (const [key, value] of metrics.counters) {
    const [name, labels] = parseKey(key);
    output += `# TYPE ${name} counter\n`;
    output += `${name}${labels} ${value}\n\n`;
  }
  
  // Gauges
  for (const [key, value] of metrics.gauges) {
    const [name, labels] = parseKey(key);
    output += `# TYPE ${name} gauge\n`;
    output += `${name}${labels} ${value}\n\n`;
  }
  
  // Histograms
  for (const [key, hist] of metrics.histograms) {
    const [name, labels] = parseKey(key);
    output += `# TYPE ${name} histogram\n`;
    output += `${name}_count${labels} ${hist.count}\n`;
    output += `${name}_sum${labels} ${hist.sum}\n`;
    
    for (const [bucket, count] of Object.entries(hist.buckets)) {
      output += `${name}_bucket${labels}{le="${bucket}"} ${count}\n`;
    }
    output += '\n';
  }
  
  return output;
}

/**
 * Parse metric key into name and labels
 */
function parseKey(key) {
  const [name, labelsStr] = key.split(':');
  const labels = labelsStr ? JSON.parse(labelsStr) : {};
  
  const labelStr = Object.entries(labels)
    .map(([k, v]) => `${k}="${v}"`)
    .join(',');
  
  return [name, labelStr ? `{${labelStr}}` : ''];
}

/**
 * Get metrics as JSON
 * @function getMetricsJSON
 */
function getMetricsJSON() {
  return {
    counters: Object.fromEntries(metrics.counters),
    gauges: Object.fromEntries(metrics.gauges),
    histograms: Object.fromEntries(
      Array.from(metrics.histograms).map(([k, v]) => [k, { ...v, buckets: v.buckets }])
    ),
  };
}

/**
 * Reset all metrics
 * @function resetMetrics
 */
function resetMetrics() {
  metrics.counters.clear();
  metrics.gauges.clear();
  metrics.histograms.clear();
  metrics.startTimes.clear();
}

/**
 * Get process metrics
 * @function getProcessMetrics
 */
function getProcessMetrics() {
  const memUsage = process.memoryUsage();
  const cpuUsage = process.cpuUsage();
  
  return {
    memory: {
      heapUsed: Math.round(memUsage.heapUsed / 1024 / 1024),
      heapTotal: Math.round(memUsage.heapTotal / 1024 / 1024),
      rss: Math.round(memUsage.rss / 1024 / 1024),
      external: Math.round(memUsage.external / 1024 / 1024),
    },
    cpu: {
      user: cpuUsage.user,
      system: cpuUsage.system,
    },
    uptime: process.uptime(),
    pid: process.pid,
  };
}

// Request counter middleware
function requestCounter(req, res, next) {
  const route = req.route?.path || req.path;
  incrementCounter('http_requests_total', 1, {
    method: req.method,
    route: route || 'unknown',
    status: 'pending',
  });
  
  res.on('finish', () => {
    incrementCounter('http_requests_total', 1, {
      method: req.method,
      route: route || 'unknown',
      status: res.statusCode,
    });
  });
  
  next();
}

// Response time histogram middleware
function responseTimeHistogram(req, res, next) {
  const stopTimer = startTimer('http_request_duration_seconds', {
    method: req.method,
    route: req.route?.path || req.path,
  });
  
  res.on('finish', stopTimer);
  next();
}

module.exports = {
  counter,
  incrementCounter,
  gauge,
  setGauge,
  incrementGauge,
  histogram,
  startTimer,
  getMetrics,
  getMetricsJSON,
  resetMetrics,
  getProcessMetrics,
  requestCounter,
  responseTimeHistogram,
};