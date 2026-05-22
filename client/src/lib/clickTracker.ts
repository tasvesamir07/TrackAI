import api from './api';

interface ClickEvent {
  page_url: string;
  element_selector: string;
  element_text?: string;
  x_position: number;
  y_position: number;
  session_id: string;
  timestamp: string;
}

class ClickTracker {
  private clickBuffer: ClickEvent[] = [];
  private sessionId: string;
  private flushInterval: NodeJS.Timeout | null = null;
  private maxBufferSize = 10;
  private flushIntervalMs = 5000;
  private isEnabled = false;
  private userId: string | null = null;
  private boundTrackClick = this.trackClick.bind(this);
  private boundOnVisibilityChange = this.onVisibilityChange.bind(this);
  private boundOnPageHide = this.onPageHide.bind(this);

  constructor() {
    this.sessionId = this.generateSessionId();
  }

  private generateSessionId(): string {
    return `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  init(userId?: string) {
    if (this.isEnabled) return;
    this.userId = userId || null;
    if (!this.userId) return;
    this.isEnabled = true;
    
    document.addEventListener('click', this.boundTrackClick, true);
    document.addEventListener('visibilitychange', this.boundOnVisibilityChange);
    window.addEventListener('pagehide', this.boundOnPageHide);
    
    this.flushInterval = setInterval(() => {
      this.flush();
    }, this.flushIntervalMs);
  }

  destroy() {
    this.isEnabled = false;
    document.removeEventListener('click', this.boundTrackClick, true);
    document.removeEventListener('visibilitychange', this.boundOnVisibilityChange);
    window.removeEventListener('pagehide', this.boundOnPageHide);
    
    if (this.flushInterval) {
      clearInterval(this.flushInterval);
      this.flushInterval = null;
    }
    
    this.flush();
  }

  private onVisibilityChange() {
    if (document.visibilityState === 'hidden') {
      this.flush();
    }
  }

  private onPageHide() {
    this.flush();
  }

  private getCssPath(element: Element): string {
    if (element.id) {
      return `#${element.id}`;
    }
    
    if (element.className && typeof element.className === 'string') {
      const classes = element.className.trim().split(/\s+/).filter(c => c);
      if (classes.length > 0) {
        return `${element.tagName.toLowerCase()}.${classes[0]}`;
      }
    }
    
    let path: string[] = [];
    let current: Element | null = element;
    
    while (current && current !== document.body) {
      let selector = current.tagName.toLowerCase();
      
      if (current.id) {
        selector += `#${current.id}`;
        path.unshift(selector);
        break;
      }
      
      const classes = current.className && typeof current.className === 'string'
        ? current.className.trim().split(/\s+/).filter(c => c)
        : [];
      
      if (classes.length > 0) {
        selector += `.${classes[0]}`;
      }
      
      const parent: Element | null = current.parentElement;
      if (parent) {
        const siblings = Array.from(parent.children).filter(
          (child: Element) => child.tagName === current!.tagName
        );
        if (siblings.length > 1) {
          const index = siblings.indexOf(current) + 1;
          selector += `:nth-child(${index})`;
        }
      }
      
      path.unshift(selector);
      current = parent;
    }
    
    return path.join(' > ');
  }

  private trackClick(event: MouseEvent) {
    if (!this.isEnabled) return;
    
    const target = event.target as Element;
    if (!target || target.tagName === 'HTML' || target.tagName === 'BODY') return;
    
    const selector = this.getCssPath(target);
    const text = target.textContent?.trim().slice(0, 100);
    
    const clickData: ClickEvent = {
      page_url: window.location.pathname,
      element_selector: selector,
      element_text: text,
      x_position: event.clientX,
      y_position: event.clientY,
      session_id: this.sessionId,
      timestamp: new Date().toISOString(),
    };
    
    this.clickBuffer.push(clickData);
    
    if (this.clickBuffer.length >= this.maxBufferSize) {
      this.flush();
    }
  }

  private async flush() {
    if (this.clickBuffer.length === 0) return;
    if (!this.isEnabled || !this.userId) {
      this.clickBuffer = [];
      return;
    }
    
    const clicks = [...this.clickBuffer];
    this.clickBuffer = [];
    
    try {
      await api.post('/tracking/click/batch', { clicks });
    } catch (error: any) {
      if (error?.response?.status === 401 || error?.response?.status === 403) {
        // Session is gone/invalid. Do not keep retrying stale click payloads.
        this.clickBuffer = [];
        return;
      }
      console.error('Failed to send click events:', error);
      this.clickBuffer = [...clicks, ...this.clickBuffer];
    }
  }

  async getAnalytics(pageUrl?: string) {
    const params: Record<string, string> = {};
    if (pageUrl) params.page_url = pageUrl;
    
    const response = await api.get('/tracking/clicks', { params });
    return response.data.data || response.data;
  }
}

export const clickTracker = new ClickTracker();

export default clickTracker;
