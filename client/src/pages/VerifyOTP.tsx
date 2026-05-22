import { useState, useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { useNavigate, useLocation } from 'react-router-dom';
import api from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { ArrowLeft, ShieldCheck } from 'lucide-react';

const verifyOTPSchema = z.object({
    otp: z.string().length(6, 'OTP must be 6 digits').regex(/^\d+$/, 'OTP must contain only numbers'),
});

type VerifyOTPFormValues = z.infer<typeof verifyOTPSchema>;

export default function VerifyOTP() {
    const navigate = useNavigate();
    const location = useLocation();
    const [error, setError] = useState('');
    const [resendMessage, setResendMessage] = useState('');
    const [isResending, setIsResending] = useState(false);
    const [timeLeft, setTimeLeft] = useState(0);
    const email = location.state?.email || '';

    useEffect(() => {
        if (!email) {
            navigate('/forgot-password');
        }
    }, [email, navigate]);

    // Initialize timer from localStorage or set new expiration
    useEffect(() => {
        const storageKey = `otp_expiry_${email}`;
        const storedExpiry = localStorage.getItem(storageKey);

        if (storedExpiry) {
            const expiryTime = parseInt(storedExpiry, 10);
            const now = Date.now();
            const remaining = Math.max(0, Math.floor((expiryTime - now) / 1000));
            setTimeLeft(remaining);
        } else {
            // Set new expiration (15 minutes from now)
            const expiryTime = Date.now() + 15 * 60 * 1000;
            localStorage.setItem(storageKey, expiryTime.toString());
            setTimeLeft(15 * 60);
        }
    }, [email]);

    // Countdown timer
    useEffect(() => {
        if (timeLeft <= 0) return;

        const timer = setInterval(() => {
            setTimeLeft((prev) => {
                if (prev <= 1) {
                    clearInterval(timer);
                    return 0;
                }
                return prev - 1;
            });
        }, 1000);

        return () => clearInterval(timer);
    }, [timeLeft]);

    // Format time as MM:SS
    const formatTime = (seconds: number) => {
        const mins = Math.floor(seconds / 60);
        const secs = seconds % 60;
        return `${mins}:${secs.toString().padStart(2, '0')}`;
    };

    const { register, handleSubmit, formState: { errors, isSubmitting } } = useForm<VerifyOTPFormValues>({
        resolver: zodResolver(verifyOTPSchema),
    });

    const onSubmit = async (data: VerifyOTPFormValues) => {
        try {
            setError('');
            const response = await api.post('/auth/verify-otp', {
                email,
                otp: data.otp
            });

            if (response.data.verified) {
                // Clear the expiration from localStorage
                const storageKey = `otp_expiry_${email}`;
                localStorage.removeItem(storageKey);

                // Navigate to reset password page with email and OTP
                navigate('/reset-password', { state: { email, otp: data.otp } });
            }
        } catch (err: unknown) {
            setError((err as { response?: { data?: { error?: string } } }).response?.data?.error || 'Invalid or expired OTP. Please try again.');
        }
    };

    const handleResendOTP = async () => {
        try {
            setIsResending(true);
            setError('');
            setResendMessage('');

            await api.post('/auth/forgot-password', {
                username: location.state?.username,
                email: location.state?.email
            });

            // Reset expiration in localStorage
            const storageKey = `otp_expiry_${email}`;
            const expiryTime = Date.now() + 15 * 60 * 1000;
            localStorage.setItem(storageKey, expiryTime.toString());

            setResendMessage('New OTP sent successfully! Please check your email.');
            setTimeLeft(15 * 60); // Reset timer to 15 minutes
            setTimeout(() => setResendMessage(''), 5000);
        } catch {
            setError('Failed to resend OTP. Please try again.');
        } finally {
            setIsResending(false);
        }
    };

    return (
        <div className="min-h-screen flex items-center justify-center p-4 bg-linear-to-br from-blue-500 via-blue-600 to-purple-600">
            <div className="w-full max-w-md">
                <Card className="border-0 shadow-2xl bg-card">
                    <CardHeader className="space-y-4 pb-6">
                        <div className="flex justify-center">
                            <div className="w-16 h-16 rounded-2xl bg-linear-to-br from-blue-500 to-purple-600 flex items-center justify-center shadow-lg">
                                <ShieldCheck className="w-8 h-8 text-white" strokeWidth={2} />
                            </div>
                        </div>
                        <div className="text-center space-y-2">
                            <CardTitle className="text-2xl font-bold text-foreground">
                                Verify OTP
                            </CardTitle>
                            <CardDescription className="text-base text-muted-foreground">
                                Enter the 6-digit code sent to your email
                            </CardDescription>
                        </div>
                    </CardHeader>

                    <CardContent className="pb-8">
                        <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 mb-6">
                            <p className="text-sm text-blue-800 text-center">
                                <strong>{email}</strong>
                            </p>
                        </div>

                        <form onSubmit={handleSubmit(onSubmit)} className="space-y-5">
                            <div className="space-y-2">
                                <Label
                                    htmlFor="otp"
                                    className="text-sm font-medium text-foreground"
                                >
                                    OTP Code
                                </Label>
                                <Input
                                    id="otp"
                                    type="text"
                                    maxLength={6}
                                    {...register('otp')}
                                    placeholder="Enter 6-digit OTP"
                                    className="h-11 border-gray-300 focus:border-blue-500 focus:ring-blue-500 text-center text-2xl tracking-widest font-mono"
                                    autoComplete="one-time-code"
                                />
                                {errors.otp && (
                                    <p className="text-sm text-red-600 mt-1">
                                        {errors.otp.message}
                                    </p>
                                )}
                            </div>

                            {error && (
                                <div className="p-3 bg-red-50 border border-red-200 rounded-lg">
                                    <p className="text-sm text-red-600 text-center">
                                        {error}
                                    </p>
                                </div>
                            )}

                            {resendMessage && (
                                <div className="p-3 bg-green-50 border border-green-200 rounded-lg">
                                    <p className="text-sm text-green-600 text-center">
                                        {resendMessage}
                                    </p>
                                </div>
                            )}

                            <div className={`border rounded-lg p-3 ${timeLeft <= 60 ? 'bg-red-50 border-red-200' : 'bg-yellow-50 border-yellow-200'}`}>
                                <p className={`text-xs text-center font-medium ${timeLeft <= 60 ? 'text-red-800' : 'text-yellow-800'}`}>
                                    {timeLeft > 0 ? (
                                        <>â±ï¸ OTP expires in <span className="font-bold text-lg">{formatTime(timeLeft)}</span></>
                                    ) : (
                                        <>âŒ OTP has expired. Please resend.</>
                                    )}
                                </p>
                            </div>

                            <Button
                                type="submit"
                                className="w-full h-11 bg-linear-to-r from-blue-600 to-purple-600 hover:from-blue-700 hover:to-purple-700 text-white font-medium shadow-md hover:shadow-lg transition duration-200"
                                disabled={isSubmitting}
                            >
                                {isSubmitting ? 'Verifying...' : 'Verify OTP'}
                            </Button>

                            <div className="text-center">
                                <button
                                    type="button"
                                    onClick={handleResendOTP}
                                    disabled={isResending}
                                    className="text-sm text-blue-600 hover:text-blue-800 font-medium transition-colors disabled:opacity-50"
                                >
                                    {isResending ? 'Resending...' : 'Resend OTP'}
                                </button>
                            </div>

                            <button
                                type="button"
                                onClick={() => navigate('/login')}
                                className="w-full flex items-center justify-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors mt-4"
                            >
                                <ArrowLeft size={16} />
                                Back to Login
                            </button>
                        </form>
                    </CardContent>
                </Card>
            </div>
        </div>
    );
}

