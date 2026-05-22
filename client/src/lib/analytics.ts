const POSTHOG_HOST = 'https://app.posthog.com'

let apiKey: string | null = null

export const initAnalytics = () => {
  apiKey = import.meta.env.VITE_POSTHOG_KEY || null
  if (!apiKey) {
    console.log('[Analytics] PostHog not configured - analytics disabled')
  }
}

export const captureEvent = (event: string, properties?: Record<string, unknown>) => {
  if (!apiKey) return

  const userId = localStorage.getItem('user_id')
  const companyId = localStorage.getItem('company_id')

  fetch(`${POSTHOG_HOST}/capture/`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      api_key: apiKey,
      event,
      distinctId: userId || 'anonymous',
      properties: {
        ...properties,
        company_id: companyId,
        timestamp: new Date().toISOString(),
      },
    }),
  }).catch(() => {})
}

export const identifyUser = (userId: string, properties?: Record<string, unknown>) => {
  if (!apiKey) return

  fetch(`${POSTHOG_HOST}/identify/`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      api_key: apiKey,
      distinctId: userId,
      properties: {
        ...properties,
        identified_at: new Date().toISOString(),
      },
    }),
  }).catch(() => {})
}

export const trackPageView = (pageName: string, properties?: Record<string, unknown>) => {
  captureEvent('page_view', { page: pageName, ...properties })
}

export const trackButtonClick = (buttonName: string, properties?: Record<string, unknown>) => {
  captureEvent('button_click', { button: buttonName, ...properties })
}

export const trackFormSubmit = (formName: string, properties?: Record<string, unknown>) => {
  captureEvent('form_submit', { form: formName, ...properties })
}

export const flushAnalytics = async () => {
  // fetch-based analytics don't need flushing
}
