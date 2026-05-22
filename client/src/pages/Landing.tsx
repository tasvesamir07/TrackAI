import { Link, useNavigate } from 'react-router-dom';
import { useEffect, useState } from 'react';
import { 
  CheckCircle2, 
  Users, 
  LayoutList, 
  Star, 
  Menu, 
  X, 
  ArrowRight, 
  Sparkles, 
  Shield, 
  BarChart3, 
  Zap, 
  Lock, 
  Layers 
} from 'lucide-react';
import api from '@/lib/api';
import OptimizedImage from '@/components/OptimizedImage';

interface PublicPlan {
  id: string;
  code: string;
  name: string;
  monthly_price: string | number;
  currency: string;
  trial_days: number;
  max_company_admins: number;
  max_project_managers: number;
  max_employees: number;
  is_popular?: boolean;
}

type PlanCode = 'FREE' | 'BASIC' | 'PRO' | 'ADVANCE';

const PLAN_ORDER: Array<{ code: PlanCode; name: string; isPopular?: boolean }> = [
  { code: 'FREE', name: 'Free' },
  { code: 'BASIC', name: 'Basic' },
  { code: 'PRO', name: 'Pro', isPopular: true },
  { code: 'ADVANCE', name: 'Advance' },
];

const PLAN_FALLBACK_BY_CODE: Record<PlanCode, PublicPlan> = {
  FREE: { id: 'fallback-free', code: 'FREE', name: 'Free', monthly_price: '19.99', trial_days: 7, max_company_admins: 1, max_project_managers: 1, max_employees: 15, currency: 'USD' },
  BASIC: { id: 'fallback-basic', code: 'BASIC', name: 'Basic', monthly_price: '44.99', trial_days: 0, max_company_admins: 1, max_project_managers: 2, max_employees: 25, currency: 'USD' },
  PRO: { id: 'fallback-pro', code: 'PRO', name: 'Pro', monthly_price: '79.99', trial_days: 0, max_company_admins: 2, max_project_managers: 5, max_employees: 50, currency: 'USD' },
  ADVANCE: { id: 'fallback-advance', code: 'ADVANCE', name: 'Advance', monthly_price: '119.99', trial_days: 0, max_company_admins: 3, max_project_managers: 5, max_employees: 100, currency: 'USD' },
};

const getFallbackPricingPlans = (): PublicPlan[] =>
  PLAN_ORDER.map(({ code }) => ({ ...PLAN_FALLBACK_BY_CODE[code] }));

const toSafeNumber = (value: unknown, fallback: number): number => {
  const numberValue = Number(value);
  return Number.isFinite(numberValue) ? numberValue : fallback;
};

export default function Landing() {
  const navigate = useNavigate();
  const [pricingPlans, setPricingPlans] = useState<PublicPlan[]>(() => getFallbackPricingPlans());
  const [landingVideoUrl, setLandingVideoUrl] = useState('');
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);

  const scrollTo = (id: string) => {
    const el = document.getElementById(id);
    if (el) el.scrollIntoView({ behavior: 'smooth' });
    setIsMobileMenuOpen(false);
  };

  const goToCheckout = (planCode: string) => {
    navigate(`/checkout?plan=${encodeURIComponent(planCode)}`);
  };

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const checkoutState = String(params.get('checkout') || '').trim().toLowerCase();
    if (checkoutState !== 'cancel') return;

    window.history.replaceState({}, '', window.location.pathname);
    requestAnimationFrame(() => {
      const pricing = document.getElementById('pricing');
      if (pricing) {
        pricing.scrollIntoView({ behavior: 'smooth' });
      }
    });
  }, []);

  useEffect(() => {
    let isMounted = true;
    api.get('/saas/auth/plans')
      .then((res) => {
        if (!isMounted) return;
        const rawPlans = Array.isArray(res.data?.plans) ? res.data.plans : [];
        setLandingVideoUrl(String(res.data?.landing_video_url || '').trim());
        
        if (rawPlans.length > 0) {
          const processedPlans = rawPlans.map((p: Partial<PublicPlan>) => ({
            ...p,
            id: p.id ?? 'unknown',
            code: p.code ?? 'FREE',
            name: p.name ?? 'Free Plan',
            currency: p.currency ?? 'USD',
            monthly_price: p.monthly_price ?? 0,
            trial_days: toSafeNumber(p.trial_days, 0),
            max_company_admins: toSafeNumber(p.max_company_admins, 0),
            max_project_managers: toSafeNumber(p.max_project_managers, 0),
            max_employees: toSafeNumber(p.max_employees, 0),
          }));
          
          processedPlans.sort((a: PublicPlan, b: PublicPlan) => Number(a.monthly_price) - Number(b.monthly_price));
          setPricingPlans(processedPlans);
        } else {
          setPricingPlans(getFallbackPricingPlans());
        }
      })
      .catch(() => {
        if (!isMounted) return;
        setPricingPlans(getFallbackPricingPlans());
        setLandingVideoUrl('');
      });

    return () => {
      isMounted = false;
    };
  }, []);

  const formatPlanPrice = (value: string | number) => {
    const num = Number(value);
    if (!Number.isFinite(num)) return '$0.00';
    return `$${num.toFixed(2)}`;
  };

  const plural = (value: number, word: string) => `${value} ${word}${value === 1 ? '' : 's'}`;
  const resolvedLandingVideoUrl = (() => {
    const raw = String(landingVideoUrl || '').trim();
    if (!raw) return '';
    if (/^https?:\/\//i.test(raw)) return raw;
    if (!raw.startsWith('/')) return raw;
    const apiBase = String(import.meta.env.VITE_API_URL || '').trim().replace(/\/+$/, '');
    if (!apiBase) return raw;
    try {
      const origin = new URL(apiBase).origin;
      return `${origin}${raw}`;
    } catch {
      return raw;
    }
  })();

  return (
    <div className="min-h-screen bg-zinc-950 font-sans text-zinc-100 selection:bg-violet-500/30 selection:text-violet-200 overflow-x-hidden relative">
      {/* Grid overlay for futuristic vibe */}
      <div className="absolute inset-0 bg-[linear-gradient(to_right,#1f29370a_1px,transparent_1px),linear-gradient(to_bottom,#1f29370a_1px,transparent_1px)] bg-[size:4rem_4rem] [mask-image:radial-gradient(ellipse_60%_50%_at_50%_0%,#000_70%,transparent_100%)] pointer-events-none z-0" />
      
      {/* Glow Blobs */}
      <div className="absolute top-[-10%] left-[-15%] w-[60vw] h-[60vw] rounded-full bg-violet-600/10 blur-[150px] pointer-events-none z-0" />
      <div className="absolute top-[20%] right-[-10%] w-[50vw] h-[50vw] rounded-full bg-indigo-600/10 blur-[150px] pointer-events-none z-0" />
      <div className="absolute bottom-[20%] left-[-10%] w-[45vw] h-[45vw] rounded-full bg-cyan-600/10 blur-[150px] pointer-events-none z-0" />

      {/* Navbar */}
      <nav className="fixed top-0 left-0 right-0 z-50 bg-zinc-950/75 backdrop-blur-md border-b border-zinc-800/50 transition">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="h-9 w-9 rounded-xl bg-gradient-to-tr from-violet-600 to-indigo-500 flex items-center justify-center shadow-lg shadow-violet-500/20">
              <Sparkles className="w-5 h-5 text-white" />
            </div>
            <span className="text-xl font-bold tracking-tight bg-gradient-to-r from-white via-zinc-200 to-zinc-400 bg-clip-text text-transparent">
              Track AI EMS
            </span>
          </div>
          
          <div className="hidden md:flex items-center gap-8 text-sm font-medium text-zinc-400">
            <button onClick={() => scrollTo('features')} className="hover:text-white transition-colors cursor-pointer">Features</button>
            <button onClick={() => scrollTo('how-it-works')} className="hover:text-white transition-colors cursor-pointer">How it Works</button>
            <button onClick={() => scrollTo('pricing')} className="hover:text-white transition-colors cursor-pointer">Pricing</button>
          </div>

          <div className="hidden md:flex items-center gap-4">
            <Link to="/login" className="text-sm font-semibold text-zinc-300 hover:text-white transition-colors">
              Login
            </Link>
            <button
              type="button"
              onClick={() => goToCheckout('FREE')}
              className="rounded-full bg-gradient-to-r from-violet-600 to-indigo-600 hover:from-violet-500 hover:to-indigo-500 px-6 py-2.5 text-sm font-semibold text-white shadow-lg shadow-violet-500/25 hover:scale-[1.03] transition duration-200 active:scale-[0.98] cursor-pointer"
            >
              Start Free Trial
            </button>
          </div>

          {/* Mobile Menu Toggle */}
          <div className="flex md:hidden items-center gap-3">
            <button
              type="button"
              onClick={() => goToCheckout('FREE')}
              className="rounded-full bg-gradient-to-r from-violet-600 to-indigo-600 px-4 py-2 text-xs font-semibold text-white shadow-md shadow-violet-500/20"
            >
              Free Trial
            </button>
            <button 
              onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)} 
              className="p-1.5 text-zinc-400 hover:bg-zinc-900 rounded-lg transition-colors cursor-pointer"
              aria-label="Toggle menu"
            >
              {isMobileMenuOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
            </button>
          </div>
        </div>

        {/* Mobile Dropdown */}
        {isMobileMenuOpen && (
          <div className="md:hidden absolute top-16 left-0 right-0 bg-zinc-950 border-b border-zinc-800/80 shadow-2xl py-6 px-6 flex flex-col gap-4 z-40">
            <button onClick={() => scrollTo('features')} className="text-left font-medium text-zinc-300 hover:text-white py-2 cursor-pointer">Features</button>
            <button onClick={() => scrollTo('how-it-works')} className="text-left font-medium text-zinc-300 hover:text-white py-2 cursor-pointer">How it Works</button>
            <button onClick={() => scrollTo('pricing')} className="text-left font-medium text-zinc-300 hover:text-white py-2 cursor-pointer">Pricing</button>
            <div className="h-px bg-zinc-900 my-2" />
            <Link to="/login" className="font-semibold text-violet-400 hover:text-violet-300 py-2">
              Login to your account
            </Link>
          </div>
        )}
      </nav>

      {/* Hero Section */}
      <section className="relative pt-32 pb-24 lg:pt-48 lg:pb-36 overflow-hidden">
        <div className="mx-auto max-w-7xl px-6 relative z-10">
          <div className="text-center max-w-4xl mx-auto">
            {/* Tagline Badge */}
            <div className="inline-flex items-center gap-2 rounded-full border border-violet-500/30 bg-violet-500/10 px-4 py-1.5 text-xs font-semibold text-violet-300 mb-8 backdrop-blur-sm animate-pulse">
              <Sparkles className="w-3.5 h-3.5" />
              <span>SaaS Enterprise Employee Management System</span>
            </div>

            <h1 className="text-5xl lg:text-7xl font-extrabold tracking-tight text-white mb-6 leading-tight">
              Futuristic team operations <br className="hidden sm:inline" />
              <span className="text-transparent bg-clip-text bg-gradient-to-r from-violet-400 via-indigo-400 to-cyan-400">
                engineered for growth.
              </span>
            </h1>
            
            <p className="text-lg lg:text-xl text-zinc-400 mb-10 max-w-2xl mx-auto leading-relaxed">
              Unlock modular role dashboards, intelligent time tracking, and seamless cross-tier company automation. Start with a trial, scale seamlessly.
            </p>
            
            {/* Clean Quotes block */}
            <div className="max-w-xl mx-auto mb-12 relative">
              <div className="absolute -inset-0.5 bg-gradient-to-r from-violet-500 to-indigo-500 rounded-2xl blur-xs opacity-20 pointer-events-none" />
              <blockquote className="relative bg-zinc-900/60 backdrop-blur-md border border-zinc-800/40 p-5 rounded-2xl text-left flex items-start gap-4">
                <span className="text-4xl text-violet-500 font-serif leading-none select-none">“</span>
                <div>
                  <p className="italic text-zinc-300 text-sm md:text-base leading-relaxed">
                    "Efficiency is doing things right; effectiveness is doing the right things."
                  </p>
                  <span className="text-xs font-semibold text-zinc-500 block mt-2">— Peter Drucker</span>
                </div>
              </blockquote>
            </div>

            <div className="flex flex-col sm:flex-row gap-4 justify-center items-center">
              <button
                type="button"
                onClick={() => goToCheckout('FREE')}
                className="w-full sm:w-auto rounded-full bg-gradient-to-r from-violet-600 to-indigo-600 hover:from-violet-500 hover:to-indigo-500 px-8 py-4 text-base font-semibold text-white shadow-xl shadow-violet-950/50 hover:scale-[1.04] transition duration-200 active:scale-[0.98] cursor-pointer flex items-center justify-center gap-2"
              >
                <span>Start 7-Day Free Trial</span>
                <ArrowRight className="w-4 h-4" />
              </button>
              <button onClick={() => scrollTo('pricing')} className="w-full sm:w-auto rounded-full bg-zinc-900 border border-zinc-800 px-8 py-4 text-base font-semibold text-zinc-300 shadow-md hover:bg-zinc-800 hover:border-zinc-700 transition cursor-pointer">
                View Pricing
              </button>
            </div>
          </div>

          {/* Interactive Video Showcase */}
          <div className="mt-20 relative max-w-5xl mx-auto px-2">
            {/* Decorative frame elements to look like a high-end web mock */}
            <div className="absolute -inset-1 bg-gradient-to-r from-violet-500 via-indigo-500 to-cyan-500 rounded-3xl blur-md opacity-25 pointer-events-none" />
            <div className="relative rounded-2xl overflow-hidden border border-zinc-800 bg-zinc-950 shadow-2xl shadow-violet-950/20 aspect-video">
              
              {/* Window Header */}
              <div className="bg-zinc-900/90 border-b border-zinc-800/80 px-4 py-3 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="w-3 h-3 rounded-full bg-red-500/80" />
                  <div className="w-3 h-3 rounded-full bg-yellow-500/80" />
                  <div className="w-3 h-3 rounded-full bg-green-500/80" />
                </div>
                <div className="text-xs font-semibold text-zinc-500 font-mono tracking-wider">
                  TRACKAI-CONSOLE-PREVIEW.MP4
                </div>
                <div className="w-12" />
              </div>

              {/* Video Tag */}
              {resolvedLandingVideoUrl ? (
                <video
                  src={resolvedLandingVideoUrl}
                  autoPlay
                  loop
                  playsInline
                  controls
                  controlsList="nodownload"
                  onContextMenu={(e) => e.preventDefault()}
                  className="h-full w-full object-cover bg-zinc-950"
                />
              ) : (
                <div className="flex h-[400px] flex-col items-center justify-center border-t border-zinc-900 text-sm font-medium text-zinc-500 p-8 text-center">
                  <Zap className="w-12 h-12 text-zinc-700 mb-3 animate-bounce" />
                  <span>No intro video configured. Upload via Superadmin Console.</span>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Futuristic Mouse Scroll Guide */}
        <button
          type="button"
          aria-label="Scroll to explore"
          onClick={() => scrollTo('features')}
          className="absolute bottom-4 left-1/2 z-20 -translate-x-1/2 flex flex-col items-center gap-2 text-zinc-500 hover:text-white transition-colors cursor-pointer"
        >
          <span className="text-xs font-semibold tracking-wider uppercase opacity-80">Explore Features</span>
          <span className="landing-scroll-mouse" aria-hidden="true">
            <span className="landing-scroll-dot" />
          </span>
        </button>
      </section>

      {/* Features Section */}
      <section id="features" className="py-28 bg-zinc-950/40 relative border-t border-zinc-900">
        <div className="mx-auto max-w-7xl px-6 relative z-10">
          <div className="text-center mb-20 max-w-3xl mx-auto">
            <div className="inline-flex items-center gap-1.5 rounded-full bg-indigo-500/10 border border-indigo-500/20 px-3 py-1 text-xs font-medium text-indigo-400 mb-4">
              <Zap className="w-3.5 h-3.5" />
              <span>Optimized Workspaces</span>
            </div>
            <h2 className="text-4xl md:text-5xl font-extrabold text-white tracking-tight leading-tight">
              Everything your team <br />
              needs to perform at scale.
            </h2>
          </div>

          <div className="grid md:grid-cols-3 gap-8">
            <FeatureCard 
              icon={<Sparkles className="w-6 h-6 text-violet-400" />}
              title="Daily Task Alignment"
              desc="Align targets, log daily deliverables, and prioritize projects seamlessly so that your managers and teams run in perfect synchronization."
            />
            <FeatureCard 
              icon={<Users className="w-6 h-6 text-indigo-400" />}
              title="Granular Directory Suite"
              desc="Role-based hierarchies for Admins, Project Managers, and Employees. Control profile verification workflows and banking security details."
            />
            <FeatureCard 
              icon={<Layers className="w-6 h-6 text-cyan-400" />}
              title="Leave & GPS Workflows"
              desc="Log precise geo-coordinates upon clock-ins, configure department tags, and automate multi-tier approval flows for leaves and schedule changes."
            />
          </div>
        </div>
      </section>

      {/* How It Works Section */}
      <section id="how-it-works" className="py-28 bg-zinc-950 relative border-t border-zinc-900 overflow-hidden">
        <div className="mx-auto max-w-7xl px-6 relative z-10">
          <div className="text-center mb-20 max-w-3xl mx-auto">
            <div className="inline-flex items-center gap-1.5 rounded-full bg-cyan-500/10 border border-cyan-500/20 px-3 py-1 text-xs font-medium text-cyan-400 mb-4">
              <Lock className="w-3.5 h-3.5" />
              <span>Simple Architecture</span>
            </div>
            <h2 className="text-4xl md:text-5xl font-extrabold text-white tracking-tight">
              Get onboarded in minutes.
            </h2>
          </div>

          <div className="relative max-w-6xl mx-auto">
            {/* Mobile Vertical Line */}
            <div className="md:hidden absolute top-10 bottom-10 left-1/2 -translate-x-1/2 w-[2px] bg-zinc-800 z-0 overflow-hidden">
              <div className="absolute inset-x-[-8px] top-0 bottom-0 pointer-events-none">
                <div className="how-it-works-line-pulse-mobile" />
              </div>
            </div>

            {/* Connecting Line */}
            <div className="hidden md:block absolute top-10 left-[16.66%] right-[16.66%] h-[2px] bg-zinc-800 z-0 overflow-hidden">
              <div className="absolute inset-y-[-8px] left-0 right-0 pointer-events-none">
                <div className="how-it-works-line-pulse" />
              </div>
            </div>
            
            <div className="grid md:grid-cols-3 gap-12 relative z-10">
              <Step 
                num="1" 
                title="Create a Workspace" 
                desc="Establish your company profile, designate core operating hours, and configure specific department policies."
                glowDelay="0s"
              />
              <Step 
                num="2" 
                title="Onboard Corporate Roles" 
                desc="Invite executives, managers, and standard employees manually or import via high-performance CSV batch tools."
                glowDelay="1.45s"
              />
              <Step 
                num="3" 
                title="Monitor & Scale" 
                desc="Track real-time location metrics, generate PDF balance summaries, and modify plans instantly with Stripe integrations."
                glowDelay="2.9s"
              />
            </div>
          </div>
        </div>
      </section>

      {/* Testimonials */}
      <section className="py-28 bg-zinc-950/40 relative border-t border-zinc-900">
        <div className="mx-auto max-w-7xl px-6">
          <div className="text-center mb-20 max-w-3xl mx-auto">
            <div className="inline-flex items-center gap-1.5 rounded-full bg-violet-500/10 border border-violet-500/20 px-3 py-1 text-xs font-medium text-violet-400 mb-4">
              <BarChart3 className="w-3.5 h-3.5" />
              <span>Proven Results</span>
            </div>
            <h2 className="text-4xl md:text-5xl font-extrabold text-white tracking-tight">
              Loved by engineering teams.
            </h2>
          </div>

          <div className="grid md:grid-cols-3 gap-8">
            <TestimonialCard 
              quote="Track AI EMS restructured how we coordinate global operations. Having daily sync milestones built directly inside our time management was a game-changer."
              name="Sarah Jenkins"
              role="VP of Operations, TechFlow"
              img="https://images.unsplash.com/photo-1494790108377-be9c29b29330?auto=format&fit=crop&w=150&q=80"
            />
            <TestimonialCard 
              quote="We needed custom department codes and exact GPS clock-in logs for field technicians. This SaaS provided everything out-of-the-box."
              name="David Chen"
              role="HR Director, Elevate Partners"
              img="https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?auto=format&fit=crop&w=150&q=80"
            />
            <TestimonialCard 
              quote="The multi-tenant subscription tiers allowed us to trial the app for free and scale smoothly as we acquired more corporate users."
              name="Maria Rodriguez"
              role="CEO, BuildRight Inc."
              img="https://images.unsplash.com/photo-1573496359142-b8d87734a5a2?auto=format&fit=crop&w=150&q=80"
            />
          </div>
        </div>
      </section>

      {/* Pricing Section */}
      <section id="pricing" className="py-28 bg-zinc-950 relative border-t border-zinc-900">
        <div className="mx-auto max-w-7xl px-6 relative z-10">
          <div className="text-center mb-20 max-w-3xl mx-auto">
            <div className="inline-flex items-center gap-1.5 rounded-full bg-cyan-500/10 border border-cyan-500/20 px-3 py-1 text-xs font-medium text-cyan-400 mb-4">
              <Shield className="w-3.5 h-3.5" />
              <span>Flexible Subscriptions</span>
            </div>
            <h2 className="text-4xl md:text-5xl font-extrabold text-white tracking-tight">
              Enterprise levels for every scale.
            </h2>
          </div>

          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-8 max-w-7xl mx-auto items-stretch">
            {pricingPlans.map((plan) => {
              const code = String(plan.code || '').toUpperCase();
              const trialDays = Number(plan.trial_days || 0);
              return (
                <PricingCard
                  key={String(plan.id || code)}
                  name={String(plan.name || code)}
                  planCode={code}
                  price={formatPlanPrice(plan.monthly_price)}
                  sub={trialDays > 0 ? 'after trial' : '/mo'}
                  trial={trialDays > 0 ? `${trialDays}-day free trial` : undefined}
                  limits={[
                    plural(Number(plan.max_company_admins || 0), 'Admin'),
                    plural(Number(plan.max_project_managers || 0), 'Project Manager'),
                    plural(Number(plan.max_employees || 0), 'Employee'),
                  ]}
                  isPopular={plan.is_popular}
                  onChoosePlan={goToCheckout}
                />
              );
            })}
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="bg-zinc-950 text-zinc-500 py-16 border-t border-zinc-900 relative z-10">
        <div className="mx-auto max-w-7xl px-6 text-center">
          <div className="flex items-center justify-center gap-2 mb-6">
            <div className="h-8 w-8 rounded-lg bg-gradient-to-tr from-violet-600 to-indigo-500 flex items-center justify-center">
              <Sparkles className="w-4 h-4 text-white" />
            </div>
            <span className="text-lg font-bold text-white tracking-tight">Track AI EMS</span>
          </div>
          <div className="flex justify-center gap-8 mb-8 text-sm">
            <a href="#" className="hover:text-zinc-300 transition-colors">Terms of Service</a>
            <a href="#" className="hover:text-zinc-300 transition-colors">Privacy Policy</a>
            <a href="#" className="hover:text-zinc-300 transition-colors">Billing Policy</a>
          </div>
          <p className="text-xs text-zinc-600">© 2026 Track AI EMS. Engineered with extreme precision. All rights reserved.</p>
        </div>
      </footer>

      <style>{`
        .how-it-works-line-pulse {
          position: absolute;
          top: 50%;
          left: -160px;
          width: 160px;
          height: 14px;
          transform: translateY(-50%);
          border-radius: 999px;
          background: linear-gradient(90deg, rgba(167, 139, 250, 0) 0%, rgba(139, 92, 246, 0.85) 42%, rgba(99, 102, 241, 0.95) 70%, rgba(79, 70, 229, 0) 100%);
          filter: blur(1px);
          animation: howItWorksFlow 4.35s linear infinite;
        }

        .how-it-works-line-pulse-mobile {
          position: absolute;
          left: 50%;
          top: -120px;
          width: 14px;
          height: 120px;
          transform: translateX(-50%);
          border-radius: 999px;
          background: linear-gradient(180deg, rgba(167, 139, 250, 0) 0%, rgba(139, 92, 246, 0.85) 42%, rgba(99, 102, 241, 0.95) 70%, rgba(79, 70, 229, 0) 100%);
          filter: blur(1px);
          animation: howItWorksFlowMobile 4.35s linear infinite;
        }

        .how-it-works-node,
        .how-it-works-node-ring {
          animation-duration: 4.35s;
          animation-iteration-count: infinite;
          animation-timing-function: ease-in-out;
        }

        .how-it-works-node {
          animation-name: howItWorksNodeGlow;
        }

        .how-it-works-node-ring {
          animation-name: howItWorksNodeRing;
        }

        @keyframes howItWorksFlow {
          0% {
            left: -160px;
            opacity: 0;
          }
          6% {
            opacity: 1;
          }
          78% {
            opacity: 1;
          }
          92% {
            opacity: 0;
          }
          100% {
            left: calc(100% + 160px);
            opacity: 0;
          }
        }

        @keyframes howItWorksFlowMobile {
          0% {
            top: -120px;
            opacity: 0;
          }
          6% {
            opacity: 1;
          }
          78% {
            opacity: 1;
          }
          92% {
            opacity: 0;
          }
          100% {
            top: calc(100% + 120px);
            opacity: 0;
          }
        }

        @keyframes howItWorksNodeGlow {
          0%, 8%, 100% {
            transform: scale(1);
            box-shadow: 0 0 20px rgba(139, 92, 246, 0.1);
          }
          3% {
            transform: scale(1.1);
            box-shadow: 0 0 0 8px rgba(139, 92, 246, 0.15), 0 0 30px rgba(139, 92, 246, 0.4);
          }
        }

        @keyframes howItWorksNodeRing {
          0%, 9%, 100% {
            opacity: 0;
            transform: scale(0.9);
          }
          4% {
            opacity: 0.8;
            transform: scale(1.4);
          }
        }

        .landing-scroll-mouse {
          width: 24px;
          height: 38px;
          border-radius: 999px;
          border: 2px solid rgba(161, 161, 170, 0.4);
          display: inline-flex;
          justify-content: center;
          padding-top: 5px;
          background: rgba(24, 24, 27, 0.6);
          backdrop-filter: blur(4px);
        }

        .landing-scroll-dot {
          width: 5px;
          height: 5px;
          border-radius: 999px;
          background: #a78bfa;
          animation: landingScrollDot 1.4s ease-in-out infinite;
        }

        @keyframes landingScrollDot {
          0% {
            transform: translateY(0);
            opacity: 0;
          }
          20% {
            opacity: 1;
          }
          75% {
            transform: translateY(12px);
            opacity: 0;
          }
          100% {
            transform: translateY(0);
            opacity: 0;
          }
        }
      `}</style>
    </div>
  );
}

// Components

function FeatureCard({ icon, title, desc }: { icon: React.ReactNode, title: string, desc: string }) {
  return (
    <div className="bg-zinc-900/35 backdrop-blur-md rounded-2xl p-8 border border-zinc-800/60 hover:border-violet-500/40 hover:-translate-y-1 hover:shadow-xl hover:shadow-violet-950/5 transition-all duration-300 group relative overflow-hidden">
      <div className="absolute -inset-px bg-gradient-to-r from-violet-600/10 to-indigo-600/10 rounded-2xl opacity-0 group-hover:opacity-100 transition-opacity duration-300 pointer-events-none" />
      <div className="w-12 h-12 rounded-xl bg-zinc-800/80 flex items-center justify-center mb-6 group-hover:bg-violet-500/10 group-hover:scale-105 border border-zinc-700/50 group-hover:border-violet-500/30 transition-all duration-300">
        {icon}
      </div>
      <h3 className="text-xl font-bold text-white mb-3 group-hover:text-violet-300 transition-colors">{title}</h3>
      <p className="text-zinc-400 leading-relaxed text-sm">{desc}</p>
    </div>
  );
}

function Step({ num, title, desc, glowDelay }: { num: string, title: string, desc: string, glowDelay: string }) {
  return (
    <div className="text-center relative group">
      <div className="relative mx-auto mb-6 w-16 h-16">
        <div
          className="how-it-works-node-ring absolute inset-0 rounded-full bg-violet-500/20 pointer-events-none"
          style={{ animationDelay: glowDelay }}
        />
        <div
          className="how-it-works-node relative z-10 w-16 h-16 mx-auto bg-zinc-900 border border-zinc-800 shadow-xl rounded-full flex items-center justify-center text-xl font-bold text-violet-400 group-hover:border-violet-500/50 group-hover:text-violet-300 transition-colors"
          style={{ animationDelay: glowDelay }}
        >
          {num}
        </div>
      </div>
      <h3 className="text-xl font-bold text-white mb-3">{title}</h3>
      <p className="text-zinc-400 leading-relaxed text-sm max-w-xs mx-auto">{desc}</p>
    </div>
  );
}

function TestimonialCard({ quote, name, role, img }: { quote: string, name: string, role: string, img: string }) {
  return (
    <div className="bg-zinc-900/30 backdrop-blur-md rounded-2xl p-8 border border-zinc-850 shadow-lg hover:border-zinc-800 transition duration-300 flex flex-col justify-between">
      <div>
        <div className="flex gap-1 mb-5 text-violet-400">
          {[1,2,3,4,5].map(i => <Star key={i} className="w-4 h-4 fill-current" />)}
        </div>
        <p className="text-zinc-300 italic mb-8 text-sm leading-relaxed">"{quote}"</p>
      </div>
      <div className="flex items-center gap-4 border-t border-zinc-800/40 pt-4">
        <OptimizedImage src={img} alt={name} className="w-11 h-11 rounded-full object-cover border border-zinc-800" />
        <div>
          <h4 className="font-bold text-white text-sm">{name}</h4>
          <p className="text-xs text-zinc-500">{role}</p>
        </div>
      </div>
    </div>
  );
}

function PricingCard({
  name,
  planCode,
  price,
  sub,
  trial,
  limits,
  isPopular,
  onChoosePlan
}: {
  name: string,
  planCode: string,
  price: string,
  sub: string,
  trial?: string,
  limits: string[],
  isPopular?: boolean,
  onChoosePlan: (planCode: string) => void
}) {
  return (
    <div
      className={`relative bg-zinc-900/40 backdrop-blur-lg rounded-3xl p-8 flex flex-col justify-between transition-all duration-300 ${
        isPopular 
          ? 'border-2 border-violet-600 shadow-2xl shadow-violet-900/10 lg:-mt-4 lg:mb-[-16px] scale-[1.02]' 
          : 'border border-zinc-800 shadow-lg hover:border-zinc-700'
      }`}
    >
      {isPopular && (
        <div className="absolute top-0 left-1/2 -translate-x-1/2 -translate-y-1/2">
          <div className="bg-gradient-to-r from-violet-600 to-indigo-600 text-white text-[10px] font-bold uppercase tracking-widest py-1.5 px-4 rounded-full shadow-lg shadow-violet-500/25">
            Most Popular
          </div>
        </div>
      )}
      
      <div>
        <h3 className={`text-xl font-bold mb-4 ${isPopular ? 'text-violet-400' : 'text-zinc-200'}`}>{name}</h3>
        
        <div className="mb-6 flex items-baseline">
          <span className="text-4xl font-extrabold text-white tracking-tight">{price}</span>
          <span className="text-zinc-500 text-sm ml-1.5">{sub}</span>
        </div>
        
        {trial ? (
          <div className="text-xs font-semibold bg-violet-500/10 border border-violet-500/20 text-violet-300 px-3 py-1.5 rounded-lg mb-8 text-center">
            {trial}
          </div>
        ) : (
          <div className="mb-8 pb-[34px] border-b border-zinc-800/40" />
        )}

        <ul className="space-y-4 mb-8">
          {limits.map((limit, i) => (
            <li key={i} className="flex items-center gap-3 text-zinc-300">
              <CheckCircle2 className={`w-4.5 h-4.5 shrink-0 ${isPopular ? 'text-violet-400' : 'text-zinc-500'}`} />
              <span className="text-sm">{limit}</span>
            </li>
          ))}
        </ul>
      </div>

      <button
        type="button"
        onClick={() => onChoosePlan(planCode)}
        className={`block w-full py-3 px-6 text-center rounded-xl font-semibold transition cursor-pointer text-sm ${
          isPopular 
            ? 'bg-gradient-to-r from-violet-600 to-indigo-600 text-white hover:from-violet-500 hover:to-indigo-500 shadow-md shadow-violet-500/10 hover:shadow-lg' 
            : 'bg-zinc-800 text-zinc-200 hover:bg-zinc-700 border border-zinc-700/40'
        }`}
      >
        Choose {name} Plan
      </button>
    </div>
  );
}
