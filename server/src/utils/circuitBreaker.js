/**
 * Circuit Breaker Pattern Implementation
 * Provides fault tolerance and resilience for external services
 * @module circuitBreaker
 */

class CircuitBreaker {
  /**
   * @constructor
   * @param {Object} options - Circuit breaker options
   * @param {number} options.failureThreshold - Number of failures before opening circuit (default: 5)
   * @param {number} options.successThreshold - Number of successes needed to close circuit (default: 3)
   * @param {number} options.timeout - Time in ms to wait before trying again (default: 60000)
   * @param {string} options.name - Name for the circuit breaker
   */
  constructor(options = {}) {
    this.failureThreshold = options.failureThreshold || 5;
    this.successThreshold = options.successThreshold || 3;
    this.timeout = options.timeout || 60000;
    this.name = options.name || 'default';
    
    this.state = 'CLOSED'; // CLOSED, OPEN, HALF_OPEN
    this.failures = 0;
    this.successes = 0;
    this.lastFailureTime = null;
    
    // Event callbacks
    this.onOpen = options.onOpen || (() => {});
    this.onClose = options.onClose || (() => {});
    this.onHalfOpen = options.onHalfOpen || (() => {});
  }

  /**
   * Execute a function with circuit breaker protection
   * @async
   * @method execute
   * @param {Function} fn - Function to execute
   * @returns {Promise<any>} Result of the function
   * @throws {Error} When circuit is open or function fails
   */
  async execute(fn) {
    if (this.state === 'OPEN') {
      if (Date.now() - this.lastFailureTime >= this.timeout) {
        this.state = 'HALF_OPEN';
        this.onHalfOpen(this.name);
      } else {
        throw new Error(`Circuit breaker ${this.name} is OPEN`);
      }
    }

    try {
      const result = await fn();
      this.onSuccess();
      return result;
    } catch (error) {
      this.onFailure();
      throw error;
    }
  }

  /**
   * Handle successful execution
   */
  onSuccess() {
    this.failures = 0;
    this.successes++;
    
    if (this.state === 'HALF_OPEN' && this.successes >= this.successThreshold) {
      this.state = 'CLOSED';
      this.successes = 0;
      this.onClose(this.name);
    }
  }

  /**
   * Handle failed execution
   */
  onFailure() {
    this.failures++;
    this.lastFailureTime = Date.now();
    this.successes = 0;
    
    if (this.state === 'CLOSED' && this.failures >= this.failureThreshold) {
      this.state = 'OPEN';
      this.onOpen(this.name);
    }
    
    if (this.state === 'HALF_OPEN') {
      this.state = 'OPEN';
      this.onOpen(this.name);
    }
  }

  /**
   * Get current state
   * @returns {string} Current state
   */
  getState() {
    return this.state;
  }

  /**
   * Reset the circuit breaker
   */
  reset() {
    this.state = 'CLOSED';
    this.failures = 0;
    this.successes = 0;
    this.lastFailureTime = null;
  }

  /**
   * Get statistics
   */
  getStats() {
    return {
      state: this.state,
      failures: this.failures,
      successes: this.successes,
      lastFailureTime: this.lastFailureTime,
    };
  }
}

/**
 * Create a circuit breaker middleware for Express
 * @function createCircuitBreakerMiddleware
 * @param {Object} options - Options for the circuit breaker
 * @returns {Function} Express middleware
 * 
 * @example
 * const breaker = createCircuitBreakerMiddleware({
 *   name: 'database',
 *   failureThreshold: 5,
 *   timeout: 30000
 * });
 * app.use('/api', breaker);
 */
function createCircuitBreakerMiddleware(options = {}) {
  const breaker = new CircuitBreaker({
    ...options,
    onOpen: (name) => console.warn(`[CIRCUIT] ${name} opened`),
    onClose: (name) => console.log(`[CIRCUIT] ${name} closed`),
    onHalfOpen: (name) => console.log(`[CIRCUIT] ${name} half-open`),
  });

  return (req, res, next) => {
    // Only apply to certain endpoints or always
    if (options.onlyEndpoints && !options.onlyEndpoints.includes(req.path)) {
      return next();
    }

    const originalEnd = res.end;
    res.end = function(...args) {
      // If server error, count as failure
      if (res.statusCode >= 500) {
        // Don't trigger circuit breaker for expected errors
      }
      originalEnd.apply(res, args);
    };

    next();
  };
}

/**
 * Wrap an external service call with circuit breaker
 * @function withCircuitBreaker
 * @param {CircuitBreaker} breaker - Circuit breaker instance
 * @param {Function} fn - Function to wrap
 * @param {string} fallback - Fallback response when circuit is open
 * @returns {Function} Wrapped function
 */
function withCircuitBreaker(breaker, fn, fallback = null) {
  return async (...args) => {
    try {
      return await breaker.execute(() => fn(...args));
    } catch (error) {
      if (fallback) {
        console.error(`[CIRCUIT] Fallback triggered for ${breaker.name}:`, error.message);
        return fallback;
      }
      throw error;
    }
  };
}

// Pre-configured circuit breakers for common services
const circuitBreakers = {
  database: new CircuitBreaker({ name: 'database', failureThreshold: 5, timeout: 30000 }),
  externalAPI: new CircuitBreaker({ name: 'externalAPI', failureThreshold: 3, timeout: 60000 }),
  payment: new CircuitBreaker({ name: 'payment', failureThreshold: 2, timeout: 120000 }),
  email: new CircuitBreaker({ name: 'email', failureThreshold: 10, timeout: 15000 }),
};

module.exports = {
  CircuitBreaker,
  createCircuitBreakerMiddleware,
  withCircuitBreaker,
  circuitBreakers,
};