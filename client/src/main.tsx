import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import * as Sentry from '@sentry/react'
import './index.css'
import App from './App.tsx'
import { initAnalytics, trackPageView } from './lib/analytics'

if (import.meta.env.VITE_SENTRY_DSN) {
  Sentry.init({
    dsn: import.meta.env.VITE_SENTRY_DSN,
    integrations: [
      Sentry.browserTracingIntegration(),
      Sentry.replayIntegration({
        maskAllText: false,
        blockAllMedia: false,
      }),
    ],
    tracesSampleRate: 0.1,
    replaysSessionSampleRate: 0.1,
    replaysOnErrorSampleRate: 1,
    environment: import.meta.env.MODE,
  })
}

initAnalytics()

const originalPushState = window.history.pushState
window.history.pushState = function(...args) {
  originalPushState.apply(window.history, args)
  trackPageView(window.location.pathname)
}

const resolveBackendHealthUrl = () => {
  const raw = String(import.meta.env.VITE_API_URL || '').trim().replace(/\/+$/, '');
  if (!raw) return '/health';
  if (raw.endsWith('/api')) {
    return `${raw.slice(0, -4)}/health`;
  }
  return `${raw}/health`;
};

if (typeof window !== 'undefined' && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    // Warm backend immediately so Railway cold-start cost is paid before checkout clicks.
    fetch(resolveBackendHealthUrl(), {
      method: 'GET',
      credentials: 'include',
      cache: 'no-store',
    }).catch(() => undefined);

    // Disable SW for now to avoid stale chunk/app-shell mismatches causing blank screens after deploys.
    navigator.serviceWorker.getRegistrations()
      .then((registrations) => Promise.all(registrations.map((registration) => registration.unregister())))
      .catch(() => undefined);
  });
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
