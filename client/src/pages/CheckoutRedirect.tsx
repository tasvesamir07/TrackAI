import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import api from '@/lib/api';

type PlanCode = 'FREE' | 'BASIC' | 'PRO' | 'ADVANCE';

const VALID_PLAN_CODES: PlanCode[] = ['FREE', 'BASIC', 'PRO', 'ADVANCE'];

const resolvePlanCode = (searchParams: URLSearchParams): PlanCode | null => {
  const raw = String(searchParams.get('plan') || '').trim().toUpperCase();
  return VALID_PLAN_CODES.includes(raw as PlanCode) ? (raw as PlanCode) : null;
};

export default function CheckoutRedirect() {
  const [searchParams] = useSearchParams();
  const [error, setError] = useState('');
  const planCode = useMemo(() => resolvePlanCode(searchParams), [searchParams]);

  useEffect(() => {
    let cancelled = false;

    const run = async () => {
      if (!planCode) {
        setError('Invalid plan selected');
        return;
      }

      try {
        const res = await api.post('/billing/stripe/checkout-session', { planCode });
        const checkoutUrl = String(res?.data?.checkoutUrl || '').trim();
        if (!checkoutUrl) {
          throw new Error('Checkout URL missing');
        }
        window.location.replace(checkoutUrl);
      } catch (err: unknown) {
        if (cancelled) return;
        setError((err as { response?: { data?: { error?: string } }; message?: string })?.response?.data?.error || (err as Error)?.message || 'Failed to start Stripe checkout');
      }
    };

    run();
    return () => {
      cancelled = true;
    };
  }, [planCode]);

  return (
    <div className="min-h-screen bg-white flex items-center justify-center px-6">
      <div className="max-w-md text-center">
        {!error ? (
          <>
            <div className="mx-auto mb-5 h-10 w-10 animate-spin rounded-full border-4 border-blue-200 border-t-blue-600" />
            <h1 className="text-2xl font-semibold text-slate-900">Redirecting to Stripe...</h1>
            <p className="mt-3 text-slate-600">Preparing secure checkout for your selected plan.</p>
          </>
        ) : (
          <>
            <h1 className="text-2xl font-semibold text-slate-900">Checkout Failed</h1>
            <p className="mt-3 text-red-600">{error}</p>
            <a
              href="/#pricing"
              className="mt-6 inline-block rounded-lg bg-blue-600 px-5 py-2.5 font-semibold text-white hover:bg-blue-700 transition-colors"
            >
              Back to Pricing
            </a>
          </>
        )}
      </div>
    </div>
  );
}
