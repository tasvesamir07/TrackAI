const ProgressiveLoadTestRunner = require('../utils/loadTestRunner');

const activeTests = new Map();

const sseClients = new Map();

const runLoadTest = async (req, res) => {
  try {
    const baseUrl = `${req.protocol}://${req.get('host')}`;

    const runner = new ProgressiveLoadTestRunner();

    const testRun = {
      runner,
      baseUrl,
      summary: null,
      startTime: Date.now(),
      steps: [],
    };

    runner.run(baseUrl, {
      onStepComplete: (step, allSteps) => {
        testRun.steps = [...allSteps];
        const sseList = sseClients.get(runner.testId) || [];
        for (const client of sseList) {
          try {
            client.write(`event: step\ndata: ${JSON.stringify(step)}\n\n`);
          } catch {
            // client disconnected
          }
        }
      },
      onComplete: (summary) => {
        testRun.summary = summary;
        const sseList = sseClients.get(runner.testId) || [];
        for (const client of sseList) {
          try {
            client.write(`event: complete\ndata: ${JSON.stringify(summary)}\n\n`);
            client.end();
          } catch {
            // client disconnected
          }
        }
        sseClients.delete(runner.testId);
      },
    }).catch((err) => {
      console.error('Load test runner error:', err);
      testRun.summary = { error: err.message };
      const sseList = sseClients.get(runner.testId) || [];
      for (const client of sseList) {
        try {
          client.write(`event: error\ndata: ${JSON.stringify({ error: err.message })}\n\n`);
          client.end();
        } catch {
          // client disconnected
        }
      }
      sseClients.delete(runner.testId);
    });

    activeTests.set(runner.testId, testRun);

    return res.json({
      testId: runner.testId,
      message: 'Load test started',
    });
  } catch (error) {
    console.error('Load test error:', error);
    return res.status(500).json({ error: 'Failed to start load test' });
  }
};

const streamLoadTest = async (req, res) => {
  const { testId } = req.params;

  const testRun = activeTests.get(testId);
  if (!testRun) {
    return res.status(404).json({ error: 'Test not found' });
  }

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no',
  });

  res.write(`event: connected\ndata: ${JSON.stringify({ testId })}\n\n`);

  if (testRun.steps.length > 0) {
    for (const step of testRun.steps) {
      res.write(`event: step\ndata: ${JSON.stringify(step)}\n\n`);
    }
  }

  if (testRun.summary) {
    res.write(`event: complete\ndata: ${JSON.stringify(testRun.summary)}\n\n`);
    res.end();
    return;
  }

  const clients = sseClients.get(testId) || [];
  clients.push(res);
  sseClients.set(testId, clients);

  // Keep SSE connection alive through proxies (e.g., Railway edge) to reduce idle 504 timeouts.
  const heartbeat = setInterval(() => {
    try {
      res.write(`event: ping\ndata: ${JSON.stringify({ ts: Date.now() })}\n\n`);
    } catch {
      // ignore write errors; close handler will clean up
    }
  }, 15000);

  req.on('close', () => {
    clearInterval(heartbeat);
    const list = sseClients.get(testId) || [];
    const idx = list.indexOf(res);
    if (idx !== -1) list.splice(idx, 1);
    if (list.length === 0) sseClients.delete(testId);
  });
};

const getTestStatus = async (req, res) => {
  const { testId } = req.params;
  const testRun = activeTests.get(testId);

  if (!testRun) {
    return res.status(404).json({ error: 'Test not found' });
  }

  return res.json({
    testId,
    isRunning: testRun.runner.isRunning,
    steps: testRun.steps,
    summary: testRun.summary,
    startTime: testRun.startTime,
    baseUrl: testRun.baseUrl,
  });
};

const getTestResult = async (req, res) => {
  const { testId } = req.params;
  const testRun = activeTests.get(testId);

  if (!testRun) {
    return res.status(404).json({ error: 'Test not found' });
  }

  if (testRun.runner.isRunning) {
    return res.status(409).json({ error: 'Test is still running', testId });
  }

  return res.json({
    data: testRun.summary,
  });
};

const stopLoadTest = async (req, res) => {
  const { testId } = req.body;

  if (testId) {
    const testRun = activeTests.get(testId);
    if (testRun) {
      testRun.runner.stop();
    }
  } else {
    for (const [, testRun] of activeTests) {
      testRun.runner.stop();
    }
  }

  return res.json({ success: true, message: 'Load test(s) stopped' });
};

module.exports = {
  runLoadTest,
  streamLoadTest,
  getTestStatus,
  getTestResult,
  stopLoadTest,
};
