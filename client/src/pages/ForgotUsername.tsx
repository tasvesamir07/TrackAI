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
import { ArrowLeft, UserCircle } from 'lucide-react';

const forgotUsernameSchema = z.object({
    email: z.string().email('Please enter a valid email address'),
});

type ForgotUsernameFormValues = z.infer<typeof forgotUsernameSchema>;

export default function ForgotUsername() {
    const navigate = useNavigate();
    const [error, setError] = useState('');

    const { register, handleSubmit, formState: { errors, isSubmitting } } = useForm<ForgotUsernameFormValues>({
        resolver: zodResolver(forgotUsernameSchema),
    });

    const onSubmit = async (data: ForgotUsernameFormValues) => {
        try {
            setError('');
            // Use the configured api instance
            const response = await api.post('/auth/forgot-username', {
                email: data.email.trim().toLowerCase()
            });



            navigate('/verify-username-otp', { state: { email: response.data.email || data.email } });
        } catch (err: unknown) {
            console.error('[ForgotUsername] Error:', err);
            setError((err as { response?: { data?: { error?: string } } }).response?.data?.error || 'Failed to process request. Please try again.');
        }
    };

    return (
        <div className="min-h-screen flex items-center justify-center p-4 bg-linear-to-br from-blue-500 via-blue-600 to-purple-600">
            <div className="w-full max-w-md">
                <Card className="border-0 shadow-2xl bg-card">
                    <CardHeader className="space-y-4 pb-6">
                        <div className="flex justify-center">
                            <div className="w-16 h-16 rounded-2xl bg-linear-to-br from-blue-500 to-purple-600 flex items-center justify-center shadow-lg">
                                <UserCircle className="w-8 h-8 text-white" strokeWidth={2} />
                            </div>
                        </div>
                        <div className="text-center space-y-2">
                            <CardTitle className="text-2xl font-bold text-foreground">
                                Forgot Username?
                            </CardTitle>
                            <CardDescription className="text-base text-muted-foreground">
                                Enter your registered email to receive a username recovery OTP
                            </CardDescription>
                        </div>
                    </CardHeader>

                    <CardContent className="pb-8">
                        <form onSubmit={handleSubmit(onSubmit)} className="space-y-5">
                            <div className="space-y-2">
                                <Label
                                    htmlFor="email"
                                    className="text-sm font-medium text-foreground"
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

                            <button
                                type="button"
                                onClick={() => navigate('/forgot-password')}
                                className="w-full flex items-center justify-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors mt-4"
                            >
                                <ArrowLeft size={16} />
                                Back to Forgot Password
                            </button>
                        </form>
                    </CardContent>
                </Card>
            </div>
        </div>
    );
}

