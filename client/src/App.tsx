import { BrowserRouter as Router, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { AuthProvider, useAuth } from '@/context/AuthContext';
import { ThemeProvider } from '@/context/ThemeContext';
import type { User, AppRole } from '@/types/auth';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { SocketProvider, useSocket } from '@/context/SocketContext';
import React, { Suspense, lazy } from 'react';
import Landing from '@/pages/Landing';
import CheckoutRedirect from '@/pages/CheckoutRedirect';
import Signup from '@/pages/Signup';
import Login from '@/pages/Login';
import { setupRoutePrefetching } from '@/lib/prefetch';

// Lazy load page components
const ForgotPassword = lazy(() => import('@/pages/ForgotPassword'));
const ForgotUsername = lazy(() => import('@/pages/ForgotUsername'));
const VerifyUsernameOTP = lazy(() => import('@/pages/VerifyUsernameOTP'));
const VerifyOTP = lazy(() => import('@/pages/VerifyOTP'));
const ResetPassword = lazy(() => import('@/pages/ResetPassword'));
const EmployeeDashboard = lazy(() => import('@/pages/EmployeeDashboard'));
const AdminDashboard = lazy(() => import('@/pages/AdminDashboard'));
const ModeratorDashboard = lazy(() => import('@/pages/ModeratorDashboard'));
const SuperadminDashboard = lazy(() => import('@/pages/SuperadminDashboard'));
const Profile = lazy(() => import('@/pages/Profile'));
const Projects = lazy(() => import('@/pages/Projects'));
const Settings = lazy(() => import('@/pages/Settings'));
const Directory = lazy(() => import('@/pages/Directory'));
const Pricing = lazy(() => import('@/pages/Pricing'));
const Onboarding = lazy(() => import('@/pages/Onboarding'));
const Reports = lazy(() => import('@/pages/Reports'));
const HelpDesk = lazy(() => import('@/pages/HelpDesk'));
const CallModal = lazy(() => import('@/components/CallModal'));
const VideoCallModal = lazy(() => import('@/components/VideoCallModal'));

const warmRoleRouteChunks = (role?: AppRole) => {
  const preloaders: Array<Promise<unknown>> = [
    import('@/pages/Profile'),
    import('@/pages/Projects'),
    import('@/pages/Settings'),
  ];

  if (role === 'employee') preloaders.push(import('@/pages/EmployeeDashboard'));
  if (role === 'moderator') preloaders.push(import('@/pages/ModeratorDashboard'));
  if (role === 'SUPERADMIN') preloaders.push(import('@/pages/SuperadminDashboard'));
  if (role === 'admin' || role === 'COMPANY_ADMIN') preloaders.push(import('@/pages/AdminDashboard'));

  return Promise.allSettled(preloaders);
};

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 300_000,
      gcTime: 600_000,
      refetchOnWindowFocus: false,
      refetchOnReconnect: false,
      retry: 1,
    },
    mutations: {
      retry: false,
    },
  },
});

class RootErrorBoundary extends React.Component<{ children: React.ReactNode }, { hasError: boolean }> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(): { hasError: boolean } {
    return { hasError: true };
  }

  componentDidCatch(error: unknown) {
    // Keep production visibility for fatal render crashes.
    console.error('[RootErrorBoundary] Render crash:', error);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen bg-slate-50 flex items-center justify-center px-6">
          <div className="max-w-md text-center">
            <h1 className="text-2xl font-bold text-slate-900">Something Went Wrong</h1>
            <p className="mt-3 text-slate-600">The page failed to render. Please refresh and try again.</p>
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="mt-6 rounded-lg bg-blue-600 px-5 py-2.5 text-white font-semibold hover:bg-blue-700 transition-colors"
            >
              Reload
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

const isAppRole = (role: unknown): role is AppRole =>
  role === 'admin' || role === 'moderator' || role === 'employee' || role === 'COMPANY_ADMIN' || role === 'SUPERADMIN';

interface BankDetails {
  bank_name?: string;
  account_holder_name?: string;
  account_number?: string;
  branch_name?: string;
  routing_number?: string;
}

const hasCompleteProfile = (user: User) => {
  if (!user) return false;
  const fullName = String(user.full_name || '').trim();
  const username = String(user.username || '').trim();
  const email = String(user.email || '').trim();
  const contact = String(user.contact_number || '').trim();
  const role = String(user.role || '');
  const isBankDetailsRequired = role === 'employee' || role === 'EMPLOYEE';

  let bank: BankDetails = {};
  const rawBank = user.bank_details;
  
  if (typeof rawBank === 'string' && rawBank.trim()) {
    try {
      bank = JSON.parse(rawBank);
    } catch {
      bank = {};
    }
  } else if (rawBank && typeof rawBank === 'object') {
    bank = rawBank as BankDetails;
  }

  const bankRequired = [
    String(bank?.bank_name || '').trim(),
    String(bank?.account_holder_name || '').trim(),
    String(bank?.account_number || '').trim(),
    String(bank?.branch_name || '').trim(),
    String(bank?.routing_number || '').trim(),
  ];

  return Boolean(fullName && username && email && contact && (!isBankDetailsRequired || bankRequired.every(Boolean)));
};

const getHomeRoute = (role?: AppRole) => {
  if (role === 'employee') return '/dashboard';
  if (role === 'admin') return '/admin';
  if (role === 'moderator') return '/project-manager';
  if (role === 'COMPANY_ADMIN') return '/admin';
  if (role === 'SUPERADMIN') return '/superadmin';
  return '/login';
};

const ProtectedRoute = ({
  children,
  roles,
  allowIncompleteProfile = false
}: {
  children: React.ReactNode,
  roles?: AppRole[],
  allowIncompleteProfile?: boolean
}) => {
  const { user, isLoading } = useAuth();
  const location = useLocation();

  if (isLoading) return <div className="h-screen flex items-center justify-center bg-zinc-950 text-white">Loading...</div>;
  if (!user) return <Navigate to="/login" replace />;
  if (!isAppRole(user.role)) return <Navigate to="/login" replace />;
  if (roles && !roles.includes(user.role)) return <Navigate to={getHomeRoute(user.role)} replace />;
  if (
    user.role === 'COMPANY_ADMIN' &&
    !allowIncompleteProfile &&
    !hasCompleteProfile(user) &&
    location.pathname !== '/profile'
  ) {
    return <Navigate to="/profile" replace />;
  }

  return children;
};

function AppRoutes() {
  const { user } = useAuth();
  const validUser = user && isAppRole(user.role) ? user : null;
  const [showBanner, setShowBanner] = React.useState(true);

  React.useEffect(() => {
    const cleanupPrefetch = setupRoutePrefetching();
    return () => {
      if (cleanupPrefetch) cleanupPrefetch();
    };
  }, []);

  React.useEffect(() => {
    if (!validUser) return;

    const timerId = window.setTimeout(() => {
      void warmRoleRouteChunks(validUser.role);
    }, 150);

    return () => window.clearTimeout(timerId);
  }, [validUser]);

  return (
    <>
      {validUser?.subscription_status === 'past_due' && showBanner && (
        <div className="bg-red-500 text-white px-4 py-2 flex items-center justify-between z-50 relative shadow-md">
          <span className="text-sm font-medium">
            ⚠️ Action Required: Your subscription is past due. You have a 3-day grace period to update your billing details to avoid service interruption.
          </span>
          <button 
            onClick={() => setShowBanner(false)} 
            className="text-white hover:text-red-200 transition p-1 rounded-full cursor-pointer"
          >
            ✕
          </button>
        </div>
      )}
      <Suspense fallback={<div className="h-screen flex items-center justify-center bg-zinc-950 text-white font-medium">Loading Page Chunks...</div>}>
        <Routes>
        <Route path="/" element={validUser ? <Navigate to={getHomeRoute(validUser.role)} replace /> : <Landing />} />
        <Route path="/checkout" element={<CheckoutRedirect />} />
        <Route path="/signup" element={validUser ? <Navigate to={getHomeRoute(validUser.role)} replace /> : <Signup />} />
        <Route path="/login" element={validUser ? <Navigate to={getHomeRoute(validUser.role)} replace /> : <Login />} />
        <Route path="/forgot-password" element={!validUser ? <ForgotPassword /> : <Navigate to={getHomeRoute(validUser.role)} replace />} />
        <Route path="/forgot-username" element={!validUser ? <ForgotUsername /> : <Navigate to={getHomeRoute(validUser.role)} replace />} />
        <Route path="/verify-username-otp" element={!validUser ? <VerifyUsernameOTP /> : <Navigate to={getHomeRoute(validUser.role)} replace />} />
        <Route path="/verify-otp" element={!validUser ? <VerifyOTP /> : <Navigate to={getHomeRoute(validUser.role)} replace />} />
        <Route path="/reset-password" element={!validUser ? <ResetPassword /> : <Navigate to={getHomeRoute(validUser.role)} replace />} />

        <Route path="/dashboard" element={
          <ProtectedRoute roles={['employee']}>
            <EmployeeDashboard />
          </ProtectedRoute>
        } />

        <Route path="/admin" element={
          <ProtectedRoute roles={['admin', 'COMPANY_ADMIN']}>
            <AdminDashboard />
          </ProtectedRoute>
        } />
        <Route path="/project-manager" element={
          <ProtectedRoute roles={['moderator']}>
            <ModeratorDashboard />
          </ProtectedRoute>
        } />
        <Route path="/moderator" element={<Navigate to="/project-manager" replace />} />
        <Route path="/superadmin" element={
          <ProtectedRoute roles={['SUPERADMIN']}>
            <SuperadminDashboard />
          </ProtectedRoute>
        } />

        <Route path="/profile" element={
          <ProtectedRoute allowIncompleteProfile>
            <Profile />
          </ProtectedRoute>
        } />

        <Route path="/projects" element={
          <ProtectedRoute>
            <Projects />
          </ProtectedRoute>
        } />

        <Route path="/settings" element={
          <ProtectedRoute roles={['admin', 'COMPANY_ADMIN']}>
            <Settings />
          </ProtectedRoute>
        } />

        <Route path="/directory" element={
          <ProtectedRoute>
            <Directory />
          </ProtectedRoute>
        } />

        <Route path="/pricing" element={<Pricing />} />

        <Route path="/onboarding" element={
          <ProtectedRoute roles={['COMPANY_ADMIN']} allowIncompleteProfile>
            <Onboarding />
          </ProtectedRoute>
        } />

        <Route path="/reports" element={
          <ProtectedRoute roles={['admin', 'COMPANY_ADMIN', 'moderator']}>
            <Reports />
          </ProtectedRoute>
        } />

        <Route path="/helpdesk" element={
          <ProtectedRoute>
            <HelpDesk />
          </ProtectedRoute>
        } />

        <Route path="*" element={<Navigate to={validUser ? getHomeRoute(validUser.role) : '/'} replace />} />
      </Routes>
    </Suspense>
    </>
  );
}

function GlobalCallHandler() {
  const { socket, outgoingCall, setOutgoingCall, teamCall, setTeamCall } = useSocket();
  const { user } = useAuth();

  if (!user || !socket) return null;

  const isTeamOutgoing = outgoingCall?.targetUsername === 'Team Chat';
  const directOutgoing = outgoingCall && !isTeamOutgoing ? outgoingCall : null;

  return (
    <Suspense fallback={null}>
      <VideoCallModal
        socket={socket}
        currentEmployeeId={user.id}
        currentEmployeeName={user.username}
        isOpen={Boolean(directOutgoing)}
        targetEmployee={directOutgoing ? {
          employeeId: directOutgoing.targetUserId,
          name: directOutgoing.targetUsername
        } : null}
        callType={directOutgoing?.callType || 'video'}
        onClose={() => {
          setOutgoingCall((current) => (current?.targetUsername === 'Team Chat' ? current : null));
        }}
      />

      {(teamCall || isTeamOutgoing) ? (
        <CallModal
          socket={socket}
          userId={user.id}
          username={user.username}
          profilePicture={user.profile_picture}
          incomingCall={null}
          outgoingCall={isTeamOutgoing ? outgoingCall : null}
          teamCall={teamCall}
          onClose={() => {
            setOutgoingCall(null);
            setTeamCall(null);
          }}
          onCallRejected={() => {
            setOutgoingCall(null);
            setTeamCall(null);
          }}
        />
      ) : null}
    </Suspense>
  );
}

function App() {
  return (
    <RootErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <ThemeProvider>
          <Router>
            <AuthProvider>
              <SocketProvider>
                <AppRoutes />
                <GlobalCallHandler />
              </SocketProvider>
            </AuthProvider>
          </Router>
        </ThemeProvider>
      </QueryClientProvider>
    </RootErrorBoundary>
  );
}

export default App;
