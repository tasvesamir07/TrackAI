import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { useAuth } from '@/context/AuthContext';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Eye, EyeOff, Network } from 'lucide-react';
import { GoogleOAuthProvider, useGoogleLogin } from '@react-oauth/google';

const loginSchema = z.object({
    identifier: z.string().min(1, 'Username or email is required'),
    password: z.string().min(1, 'Password is required'),
});

type LoginFormValues = z.infer<typeof loginSchema>;

function GoogleLoginSection({ setError, googleLogin }: { 
    setError: (err: string) => void, 
    googleLogin: (token: string, isAccessToken?: boolean) => Promise<void> 
}) {
    const [isGoogleLoading, setIsGoogleLoading] = useState(false);
    const googleAuth = useGoogleLogin({
        onSuccess: async (tokenResponse) => {
            try {
                setIsGoogleLoading(true);
                setError('');
                await googleLogin(tokenResponse.access_token, true);
            } catch (err: unknown) {
                const apiError = err as { response?: { data?: { error?: string } } };
                setError(apiError?.response?.data?.error || 'Google login failed');
            } finally {
                setIsGoogleLoading(false);
            }
        },
        onError: () => {
            setIsGoogleLoading(false);
            setError('Google login failed');
        },
    });

    return (
        <>
            <div className="relative my-6 flex items-center justify-center">
                <div className="absolute w-full border-t border-border"></div>
                <span className="relative px-3 bg-card text-muted-foreground text-sm font-medium">
                    Or continue with
                </span>
            </div>

            <button
                type="button"
                onClick={() => {
                    setIsGoogleLoading(true);
                    googleAuth();
                }}
                disabled={isGoogleLoading}
                className="w-full h-11 flex items-center justify-center gap-3 bg-background hover:bg-muted border border-border rounded-lg shadow-sm hover:shadow-md transition duration-200 active:scale-[0.98] disabled:opacity-70"
            >
                {!isGoogleLoading ? <svg className="w-5 h-5 scale-110" viewBox="0 0 24 24">
                    <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
                    <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
                    <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
                    <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
                </svg> : <div className="h-4 w-4 animate-spin rounded-full border-2 border-slate-400 border-t-slate-900" />}
                <span className="font-medium text-foreground">{isGoogleLoading ? 'Connecting Google...' : 'Sign in with Google'}</span>
            </button>
        </>
    );
}

function LoginContent() {
    const { login, googleLogin } = useAuth();
    const navigate = useNavigate();
    const [showPassword, setShowPassword] = useState(false);
    const [error, setError] = useState('');

    const { register, handleSubmit, formState: { errors, isSubmitting } } = useForm<LoginFormValues>({
        resolver: zodResolver(loginSchema),
    });

    const onSubmit = async (data: LoginFormValues) => {
        try {
            setError('');
            await login(data);
        } catch (err: unknown) {
            const apiError = err as { response?: { data?: { error?: string } }; message?: string };
            setError(apiError?.response?.data?.error || apiError?.message || 'Login failed');
        }
    };

    const googleClientId = String(import.meta.env.VITE_GOOGLE_CLIENT_ID || '').trim();

    return (
        <div className="relative min-h-screen flex items-center justify-center p-4 bg-background overflow-hidden font-sans">
            <div className="absolute inset-0 pointer-events-none overflow-hidden">
                <div className="absolute -top-[20%] -left-[10%] w-[50vw] h-[50vw] rounded-full bg-primary/10 blur-[120px]" />
                <div className="absolute top-[20%] -right-[10%] w-[60vw] h-[60vw] rounded-full bg-chart-4/10 blur-[130px]" />
            </div>

            <div className="relative z-10 w-full max-w-md">
                <button
                    type="button"
                    onClick={() => navigate('/')}
                    className="mb-4 inline-flex items-center gap-2 rounded-full border border-border bg-card/80 px-4 py-2 text-sm font-medium text-foreground shadow-sm backdrop-blur hover:bg-card hover:text-primary transition"
                >
                    <ArrowLeft className="h-4 w-4" />
                    Back
                </button>

                <div className="bg-card/85 backdrop-blur-xl border border-border/50 shadow-xl rounded-2xl p-8">
                    <div className="flex flex-col items-center mb-8 text-center space-y-4">
                        <div className="flex h-16 w-16 items-center justify-center rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-zinc-100 dark:bg-zinc-900 shadow-sm">
                            <Network className="w-8 h-8 text-zinc-700 dark:text-zinc-300" strokeWidth={2} />
                        </div>
                        <div>
                            <h1 className="text-3xl font-bold text-foreground tracking-tight bg-gradient-to-r from-foreground via-foreground/90 to-foreground/75 bg-clip-text text-transparent">Welcome Back</h1>
                            <p className="text-muted-foreground text-sm mt-1">Sign in to access your daily tasks</p>
                        </div>
                    </div>

                    <form onSubmit={handleSubmit(onSubmit)} className="space-y-5">
                        <div className="space-y-2">
                            <label htmlFor="identifier" className="block text-sm font-semibold text-foreground">
                                Username or Email
                            </label>
                            <input
                                id="identifier"
                                {...register('identifier')}
                                placeholder="name@company.com"
                                className="w-full h-11 px-4 bg-background border border-input rounded-lg text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:border-primary transition"
                                autoComplete="username"
                                autoCapitalize="off"
                                spellCheck={false}
                            />
                            {errors.identifier && (
                                <p className="text-sm text-error font-medium">{errors.identifier.message}</p>
                            )}
                        </div>

                        <div className="space-y-2">
                            <div className="flex items-center justify-between">
                                <label htmlFor="password" className="block text-sm font-semibold text-foreground">
                                    Password
                                </label>
                                <button
                                    type="button"
                                    onClick={() => navigate('/forgot-password')}
                                    className="text-sm text-primary hover:text-primary-hover font-medium transition-colors cursor-pointer"
                                >
                                    Forgot Password?
                                </button>
                            </div>
                            <div className="relative">
                                <input
                                    id="password"
                                    type={showPassword ? 'text' : 'password'}
                                    {...register('password')}
                                    placeholder="Enter your password"
                                    className="w-full h-11 pl-4 pr-10 bg-background border border-input rounded-lg text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:border-primary transition"
                                    autoComplete="current-password"
                                />
                                <button
                                    type="button"
                                    onClick={() => setShowPassword(!showPassword)}
                                    className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors focus:outline-none cursor-pointer"
                                    tabIndex={-1}
                                >
                                    {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                                </button>
                            </div>
                            {errors.password && (
                                <p className="text-sm text-error font-medium">{errors.password.message}</p>
                            )}
                        </div>

                        {error && (
                            <div className="p-3 bg-error-light border border-error/30 rounded-lg text-center">
                                <p className="text-sm text-error font-semibold">{error}</p>
                            </div>
                        )}

                        <button
                            type="submit"
                            disabled={isSubmitting}
                            className="flex h-11 w-full items-center justify-center rounded-lg bg-gradient-to-r from-violet-600 to-indigo-600 hover:from-violet-500 hover:to-indigo-500 font-semibold text-white shadow-md shadow-violet-500/10 hover:shadow-lg transition duration-200 active:scale-[0.98] disabled:opacity-70 cursor-pointer"
                        >
                            {isSubmitting ? 'Signing in...' : 'Sign In'}
                        </button>

                        {googleClientId && (
                            <GoogleLoginSection setError={setError} googleLogin={googleLogin} />
                        )}
                    </form>
                </div>

                <div className="mt-8 text-center text-sm font-medium text-muted-foreground space-y-1">
                    <p>Daily Task Reporting System</p>
                    <p>&copy; 2026 Track AI EMS</p>
                </div>
            </div>
        </div>
    );
}

export default function Login() {
    const googleClientId = String(import.meta.env.VITE_GOOGLE_CLIENT_ID || '').trim();

    return (
        <GoogleOAuthProvider clientId={googleClientId}>
            <LoginContent />
        </GoogleOAuthProvider>
    );
}
