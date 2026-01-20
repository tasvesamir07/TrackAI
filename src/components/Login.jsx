import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import axios from 'axios';
import { Lock, User as UserIcon, Loader2, ArrowRight, Eye, EyeOff, ShieldCheck } from 'lucide-react';
import { motion } from 'framer-motion';

const Login = ({ setToken }) => {
    const [username, setUsername] = useState('');
    const [password, setPassword] = useState('');
    const [showPassword, setShowPassword] = useState(false);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    const navigate = useNavigate();

    const handleSubmit = async (e) => {
        e.preventDefault();
        setLoading(true);
        setError('');
        try {
            const API_URL = import.meta.env.VITE_API_URL || '';
            const res = await axios.post(`${API_URL}/api/auth/login`, { username, password });
            localStorage.setItem('token', res.data.token);
            localStorage.setItem('user', JSON.stringify(res.data.user));
            setToken(res.data.token);
            if (res.data.user.role === 'ADMIN') {
                navigate('/admin');
            } else {
                navigate('/worker');
            }
        } catch (err) {
            setError(err.response?.data?.error || 'Authentication failed');
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="min-h-screen flex flex-col md:flex-row bg-white overflow-hidden">
            {/* Left Side: Form */}
            <div className="w-full md:w-1/2 flex flex-col justify-center px-8 md:px-24 py-12 relative">
                <div className="max-w-[440px] w-full mx-auto">
                    {/* Logo Branding */}
                    <div className="flex items-center gap-3 mb-16">
                        <div className="w-12 h-12 bg-blue-600 rounded-xl flex items-center justify-center text-white shadow-lg shadow-blue-500/20">
                            <ShieldCheck className="w-7 h-7" />
                        </div>
                        <div>
                            <h2 className="text-2xl font-black text-slate-800 tracking-tighter leading-none">Work<span className="text-blue-600">Track</span></h2>
                            <p className="text-[10px] text-slate-500 font-bold uppercase tracking-widest mt-1">Operational Excellence</p>
                        </div>
                    </div>

                    <div className="mb-10">
                        <h1 className="text-4xl font-black text-slate-900 mb-3 tracking-tight">Sign In</h1>
                        <p className="text-slate-500 font-medium tracking-tight">Welcome back! Sign in to manage your daily workspace.</p>
                    </div>

                    <form onSubmit={handleSubmit} className="space-y-6">
                        <div className="space-y-2">
                            <label className="text-sm font-bold text-slate-700 ml-1">Username</label>
                            <div className="relative group">
                                <UserIcon className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400 group-focus-within:text-blue-500 transition-colors" />
                                <input
                                    type="text"
                                    value={username}
                                    onChange={(e) => setUsername(e.target.value)}
                                    className="w-full pl-12 pr-4 py-4 bg-slate-50 border border-slate-100 rounded-2xl focus:ring-4 focus:ring-blue-500/10 focus:border-blue-500/50 outline-none transition-all text-slate-900 placeholder-slate-400 font-medium"
                                    placeholder="Enter your username"
                                    required
                                />
                            </div>
                        </div>

                        <div className="space-y-2">
                            <label className="text-sm font-bold text-slate-700 ml-1">Password</label>
                            <div className="relative group">
                                <Lock className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400 group-focus-within:text-blue-500 transition-colors" />
                                <input
                                    type={showPassword ? "text" : "password"}
                                    value={password}
                                    onChange={(e) => setPassword(e.target.value)}
                                    className="w-full pl-12 pr-12 py-4 bg-slate-50 border border-slate-100 rounded-2xl focus:ring-4 focus:ring-blue-500/10 focus:border-blue-500/50 outline-none transition-all text-slate-900 placeholder-slate-400 font-medium"
                                    placeholder="Enter your password"
                                    required
                                />
                                <button
                                    type="button"
                                    onClick={() => setShowPassword(!showPassword)}
                                    className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 transition-colors"
                                >
                                    {showPassword ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
                                </button>
                            </div>
                        </div>

                        {error && (
                            <motion.div
                                initial={{ opacity: 0, scale: 0.95 }}
                                animate={{ opacity: 1, scale: 1 }}
                                className="px-4 py-3 bg-red-50 text-red-500 border border-red-100 rounded-xl text-sm font-bold text-center"
                            >
                                {error}
                            </motion.div>
                        )}

                        <button
                            type="submit"
                            disabled={loading}
                            className="w-full group py-4 bg-gradient-to-r from-blue-600 to-blue-400 hover:shadow-xl hover:shadow-blue-500/30 text-white font-black rounded-2xl transition-all disabled:opacity-50 flex items-center justify-center gap-3 active:scale-[0.98]"
                        >
                            {loading ? <Loader2 className="w-5 h-5 animate-spin" /> : (
                                <>
                                    Sign In
                                    <ArrowRight className="w-5 h-5 group-hover:translate-x-1 transition-transform" />
                                </>
                            )}
                        </button>
                    </form>

                    <div className="mt-20 flex flex-col items-center">
                        <p className="text-slate-400 text-xs font-bold uppercase tracking-widest">© 2026 WorkTrack Systems</p>
                    </div>
                </div>
            </div>

            {/* Right Side: Visual */}
            <div className="hidden md:flex md:w-1/2 bg-slate-50 items-center justify-center relative overflow-hidden">
                {/* Animated Background Elements */}
                <div className="absolute top-[-10%] right-[-10%] w-[80%] h-[80%] bg-blue-100/50 rounded-full blur-[120px]" />
                <div className="absolute bottom-[-10%] left-[-10%] w-[60%] h-[60%] bg-indigo-100/30 rounded-full blur-[100px]" />

                <div className="relative z-10 text-center px-12">
                    <div className="mb-12 relative inline-block">
                        <div className="absolute -inset-4 bg-blue-500/10 blur-2xl rounded-full animate-pulse" />
                        <div className="relative bg-white/80 backdrop-blur-md p-8 rounded-[3rem] border border-blue-100 shadow-xl">
                            <div className="bg-white rounded-3xl p-6 shadow-2xl space-y-4 w-72 transform rotate-2 border border-slate-50">
                                <div className="flex items-center gap-4">
                                    <div className="w-10 h-10 bg-emerald-50 text-emerald-600 rounded-xl flex items-center justify-center font-black">L</div>
                                    <div className="flex-1 space-y-2">
                                        <div className="h-2 w-20 bg-slate-100 rounded" />
                                        <div className="h-2 w-28 bg-slate-50 rounded" />
                                    </div>
                                </div>
                                <div className="h-32 bg-slate-50 rounded-2xl border border-slate-100 flex items-center justify-center">
                                    <div className="w-12 h-12 bg-blue-50 rounded-full flex items-center justify-center text-blue-500 font-black tracking-tighter">WT</div>
                                </div>
                            </div>
                        </div>

                        {/* Floating Badges */}
                        <motion.div
                            animate={{ y: [0, -10, 0] }}
                            transition={{ duration: 4, repeat: Infinity, ease: "easeInOut" }}
                            className="absolute -top-6 -right-16 bg-white rounded-2xl p-4 shadow-2xl border border-blue-50 flex items-center gap-3"
                        >
                            <div className="w-8 h-8 bg-blue-100 text-blue-600 rounded-full flex items-center justify-center"><ShieldCheck className="w-5 h-5" /></div>
                            <div className="text-left">
                                <p className="text-[10px] font-black text-slate-800 leading-none">Status: Secure</p>
                                <p className="text-[8px] text-emerald-500 font-bold">● Network Active</p>
                            </div>
                        </motion.div>
                    </div>

                    <h2 className="text-4xl font-black text-slate-900 mb-4 tracking-tight">Streamline Your Production</h2>
                    <p className="text-slate-500 text-lg font-medium max-w-[440px] mx-auto leading-relaxed">
                        Centralized daily tracking and future goal monitoring for modern high-performance teams.
                    </p>
                </div>

                <div className="absolute bottom-0 left-0 right-0 h-40 bg-gradient-to-t from-slate-100/50 to-transparent pointer-events-none" />
            </div>
        </div>
    );
};

export default Login;
