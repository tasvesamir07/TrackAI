import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { useNavigate } from 'react-router-dom';
import api from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { ArrowLeft, Mail } from 'lucide-react';

const forgotPasswordSchema = z.object({
    username: z.string().optional(),
    email: z.string().email('Please enter a valid email address'),
});

type ForgotPasswordFormValues = z.infer<typeof forgotPasswordSchema>;

export default function ForgotPassword() {
    const navigate = useNavigate();
    const [error, setError] = useState('');

    const { register, handleSubmit, formState: { errors, isSubmitting } } = useForm<ForgotPasswordFormValues>({
        resolver: zodResolver(forgotPasswordSchema),
    });

    const onSubmit = async (data: ForgotPasswordFormValues) => {
        try {
            setError('');
            // Use the configured api instance which already has /api base
            const response = await api.post('/auth/forgot-password', {
                username: data.username?.trim() || undefined,
                email: data.email.trim().toLowerCase()
            });



            // Navigate to OTP verification page with the email and username returned from backend
            navigate('/verify-otp', { 
                state: { 
                    email: response.data.email, 
                    username: response.data.username 
                } 
            });
        } catch (err: unknown) {
            console.error('[ForgotPassword] Error:', err);
            setError((err as { response?: { data?: { error?: string } } }).response?.data?.error || 'Failed to send OTP. Please try again.');
        }
    };

    return (
        <div className="min-h-screen flex items-center justify-center p-4 bg-linear-to-br from-blue-500 via-blue-600 to-purple-600">
            <div className="w-full max-w-md">
                <Card className="border-0 shadow-2xl bg-white">
                    <CardHeader className="space-y-4 pb-6">
                        <div className="flex justify-center">
                            <div className="w-16 h-16 rounded-2xl bg-linear-to-br from-blue-500 to-purple-600 flex items-center justify-center shadow-lg">
                                <Mail className="w-8 h-8 text-white" strokeWidth={2} />
                            </div>
                        </div>
                        <div className="text-center space-y-2">
                            <CardTitle className="text-2xl font-bold text-gray-900">
                                Forgot Password?
                            </CardTitle>
                            <CardDescription className="text-base text-gray-600">
                                Enter your registered email to receive a password reset OTP
                            </CardDescription>
                        </div>
                    </CardHeader>

                    <CardContent className="pb-8">
                        <form onSubmit={handleSubmit(onSubmit)} className="space-y-5">
                            <div className="space-y-2">
                                <Label
                                    htmlFor="username"
                                    className="text-sm font-medium text-gray-700"
                                >
                                    Username (Optional)
                                </Label>
                                <Input
                                    id="username"
                                    type="text"
                                    {...register('username')}
                                    placeholder="Enter your username if you remember"
                                    className="h-11 border-gray-300 focus:border-blue-500 focus:ring-blue-500"
                                    autoComplete="username"
                                />
                            </div>

                            <div className="space-y-2">
                                <Label
                                    htmlFor="email"
                                    className="text-sm font-medium text-gray-700"
                                >
                                    Email Address
                                </Label>
                                <Input
                                    id="email"
                                    type="email"
                                    {...register('email')}
                                    placeholder="Enter your registered email address"
                                    className="h-11 border-gray-300 focus:border-blue-500 focus:ring-blue-500"
                                    autoComplete="email"
                                />
                                {errors.email && (
                                    <p className="text-sm text-red-600 mt-1">
                                        {errors.email.message}
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
                                {isSubmitting ? 'Sending OTP...' : 'Send OTP'}
                            </Button>

                            <div className="flex flex-col gap-2 pt-2">
                                <button
                                    type="button"
                                    onClick={() => navigate('/forgot-username')}
                                    className="text-sm text-blue-600 hover:text-blue-800 font-medium transition-colors"
                                >
                                    Forgot Username?
                                </button>

                                <button
                                    type="button"
                                    onClick={() => navigate('/login')}
                                    className="w-full flex items-center justify-center gap-2 text-sm text-gray-600 hover:text-gray-900 transition-colors"
                                >
                                    <ArrowLeft size={16} />
                                    Back to Login
                                </button>
                            </div>
                        </form>
                    </CardContent>
                </Card>
            </div>
        </div>
    );
}
