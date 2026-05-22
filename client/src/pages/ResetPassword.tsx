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
import { Eye, EyeOff, Lock, CheckCircle2 } from 'lucide-react';

const resetPasswordSchema = z.object({
    newPassword: z.string().min(6, 'Password must be at least 6 characters'),
    confirmPassword: z.string().min(6, 'Password must be at least 6 characters'),
}).refine((data) => data.newPassword === data.confirmPassword, {
    message: "Passwords don't match",
    path: ["confirmPassword"],
});

type ResetPasswordFormValues = z.infer<typeof resetPasswordSchema>;

export default function ResetPassword() {
    const navigate = useNavigate();
    const location = useLocation();
    const [error, setError] = useState('');
    const [success, setSuccess] = useState(false);
    const [showPassword, setShowPassword] = useState(false);
    const [showConfirmPassword, setShowConfirmPassword] = useState(false);
    const [countdown, setCountdown] = useState(3);
    const email = location.state?.email || '';
    const otp = location.state?.otp || '';

    useEffect(() => {
        if (!email || !otp) {
            navigate('/forgot-password');
        }
    }, [email, otp, navigate]);

    // Countdown timer for redirect
    useEffect(() => {
        if (success && countdown > 0) {
            const timer = setTimeout(() => {
                setCountdown(countdown - 1);
            }, 1000);
            return () => clearTimeout(timer);
        } else if (success && countdown === 0) {
            navigate('/login');
        }
    }, [success, countdown, navigate]);

    const { register, handleSubmit, watch, formState: { errors, isSubmitting } } = useForm<ResetPasswordFormValues>({
        resolver: zodResolver(resetPasswordSchema),
    });

    // eslint-disable-next-line react-hooks/incompatible-library
    const password = watch('newPassword');

    // Password strength indicator
    const getPasswordStrength = (pwd: string) => {
        if (!pwd) return { strength: 0, label: '', color: '' };

        let strength = 0;
        if (pwd.length >= 6) strength++;
        if (pwd.length >= 8) strength++;
        if (/[a-z]/.test(pwd) && /[A-Z]/.test(pwd)) strength++;
        if (/\d/.test(pwd)) strength++;
        if (/[^a-zA-Z0-9]/.test(pwd)) strength++;

        if (strength <= 2) return { strength, label: 'Weak', color: 'bg-red-500' };
        if (strength <= 3) return { strength, label: 'Medium', color: 'bg-yellow-500' };
        return { strength, label: 'Strong', color: 'bg-green-500' };
    };

    const passwordStrength = getPasswordStrength(password);

    const onSubmit = async (data: ResetPasswordFormValues) => {
        try {
            setError('');
            await api.post('/auth/reset-password', {
                email,
                otp,
                newPassword: data.newPassword
            });

            setSuccess(true);

            // Don't need setTimeout here anymore, useEffect handles it
        } catch (err: unknown) {
            setError((err as { response?: { data?: { error?: string } } }).response?.data?.error || 'Failed to reset password. Please try again.');
        }
    };

    if (success) {
        return (
            <div className="min-h-screen flex items-center justify-center p-4 bg-linear-to-br from-blue-500 via-blue-600 to-purple-600">
                <div className="w-full max-w-md">
                    <Card className="border-0 shadow-2xl bg-white">
                        <CardHeader className="space-y-4 pb-6">
                            <div className="flex justify-center">
                                <div className="w-16 h-16 rounded-2xl bg-linear-to-br from-green-500 to-emerald-600 flex items-center justify-center shadow-lg">
                                    <CheckCircle2 className="w-8 h-8 text-white" strokeWidth={2} />
                                </div>
                            </div>
                            <div className="text-center space-y-2">
                                <CardTitle className="text-2xl font-bold text-gray-900">
                                    Password Reset Successful!
                                </CardTitle>
                                <CardDescription className="text-base text-gray-600">
                                    Your password has been updated successfully
                                </CardDescription>
                            </div>
                        </CardHeader>

                        <CardContent className="pb-8">
                            <div className="bg-green-50 border border-green-200 rounded-lg p-4 mb-6">
                                <p className="text-sm text-green-800 text-center">
                                    ✅ You can now login with your new password
                                </p>
                            </div>
                            <p className="text-sm text-gray-600 text-center">
                                Redirecting to login page in {countdown} second{countdown !== 1 ? 's' : ''}...
                            </p>
                        </CardContent>
                    </Card>
                </div>
            </div>
        );
    }

    return (
        <div className="min-h-screen flex items-center justify-center p-4 bg-linear-to-br from-blue-500 via-blue-600 to-purple-600">
            <div className="w-full max-w-md">
                <Card className="border-0 shadow-2xl bg-white">
                    <CardHeader className="space-y-4 pb-6">
                        <div className="flex justify-center">
                            <div className="w-16 h-16 rounded-2xl bg-linear-to-br from-blue-500 to-purple-600 flex items-center justify-center shadow-lg">
                                <Lock className="w-8 h-8 text-white" strokeWidth={2} />
                            </div>
                        </div>
                        <div className="text-center space-y-2">
                            <CardTitle className="text-2xl font-bold text-gray-900">
                                Reset Password
                            </CardTitle>
                            <CardDescription className="text-base text-gray-600">
                                Enter your new password
                            </CardDescription>
                        </div>
                    </CardHeader>

                    <CardContent className="pb-8">
                        <form onSubmit={handleSubmit(onSubmit)} className="space-y-5">
                            <div className="space-y-2">
                                <Label
                                    htmlFor="newPassword"
                                    className="text-sm font-medium text-gray-700"
                                >
                                    New Password
                                </Label>
                                <div className="relative">
                                    <Input
                                        id="newPassword"
                                        type={showPassword ? 'text' : 'password'}
                                        {...register('newPassword')}
                                        placeholder="Enter new password"
                                        className="h-11 pr-10 border-gray-300 focus:border-blue-500 focus:ring-blue-500"
                                        autoComplete="new-password"
                                    />
                                    <button
                                        type="button"
                                        onClick={() => setShowPassword(!showPassword)}
                                        className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-700 transition-colors"
                                        tabIndex={-1}
                                    >
                                        {showPassword ? (
                                            <EyeOff size={18} />
                                        ) : (
                                            <Eye size={18} />
                                        )}
                                    </button>
                                </div>
                                {errors.newPassword && (
                                    <p className="text-sm text-red-600 mt-1">
                                        {errors.newPassword.message}
                                    </p>
                                )}

                                {/* Password Strength Indicator */}
                                {password && (
                                    <div className="space-y-1">
                                        <div className="flex gap-1">
                                            {[1, 2, 3, 4, 5].map((level) => (
                                                <div
                                                    key={level}
                                                    className={`h-1 flex-1 rounded-full transition-colors ${level <= passwordStrength.strength
                                                        ? passwordStrength.color
                                                        : 'bg-gray-200'
                                                        }`}
                                                />
                                            ))}
                                        </div>
                                        <p className="text-xs text-gray-600">
                                            Password strength: <span className="font-medium">{passwordStrength.label}</span>
                                        </p>
                                    </div>
                                )}
                            </div>

                            <div className="space-y-2">
                                <Label
                                    htmlFor="confirmPassword"
                                    className="text-sm font-medium text-gray-700"
                                >
                                    Confirm Password
                                </Label>
                                <div className="relative">
                                    <Input
                                        id="confirmPassword"
                                        type={showConfirmPassword ? 'text' : 'password'}
                                        {...register('confirmPassword')}
                                        placeholder="Confirm new password"
                                        className="h-11 pr-10 border-gray-300 focus:border-blue-500 focus:ring-blue-500"
                                        autoComplete="new-password"
                                    />
                                    <button
                                        type="button"
                                        onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                                        className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-700 transition-colors"
                                        tabIndex={-1}
                                    >
                                        {showConfirmPassword ? (
                                            <EyeOff size={18} />
                                        ) : (
                                            <Eye size={18} />
                                        )}
                                    </button>
                                </div>
                                {errors.confirmPassword && (
                                    <p className="text-sm text-red-600 mt-1">
                                        {errors.confirmPassword.message}
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

                            <Button
                                type="submit"
                                className="w-full h-11 bg-linear-to-r from-blue-600 to-purple-600 hover:from-blue-700 hover:to-purple-700 text-white font-medium shadow-md hover:shadow-lg transition duration-200"
                                disabled={isSubmitting}
                            >
                                {isSubmitting ? 'Resetting Password...' : 'Reset Password'}
                            </Button>
                        </form>
                    </CardContent>
                </Card>
            </div>
        </div>
    );
}
