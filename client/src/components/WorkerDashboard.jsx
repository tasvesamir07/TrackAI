import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import axios from 'axios';
import { Calendar, Send, LogOut, CheckCircle2, LayoutDashboard, Clock, ArrowRight, Save, History, ClipboardList, Search, MessageSquare } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

const WorkerDashboard = ({ setToken }) => {
    const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:5000';
    const [activeTab, setActiveTab] = useState('submit'); // 'submit' or 'history'
    const todayDate = new Date().toISOString().split('T')[0];
    const [description, setDescription] = useState('');
    const [planForTomorrow, setPlanForTomorrow] = useState('');
    const [loading, setLoading] = useState(false);
    const [fetching, setFetching] = useState(true);
    const [exists, setExists] = useState(false);
    const [status, setStatus] = useState(null);
    const [historyLogs, setHistoryLogs] = useState([]);
    const [isEditing, setIsEditing] = useState(false);
    const navigate = useNavigate();
    const user = JSON.parse(localStorage.getItem('user'));

    useEffect(() => {
        if (!localStorage.getItem('token')) {
            navigate('/');
            return;
        }
        fetchTodayLog();
        fetchHistory();
    }, []);

    const fetchTodayLog = async () => {
        try {
            const res = await axios.get(`${API_URL}/api/work-logs?date=${todayDate}`, {
                headers: { Authorization: `Bearer ${localStorage.getItem('token')}` }
            });
            if (res.data && res.data.length > 0) {
                const myLog = res.data[0];
                setDescription(myLog.description);
                setPlanForTomorrow(myLog.planForTomorrow);
                setExists(true);
            }
        } catch (err) {
            console.error("Failed to fetch today's log", err);
        } finally {
            setFetching(false);
        }
    };

    const fetchHistory = async () => {
        try {
            const res = await axios.get(`${API_URL}/api/work-logs`, {
                headers: { Authorization: `Bearer ${localStorage.getItem('token')}` }
            });
            setHistoryLogs(res.data);
        } catch (err) {
            console.error("Failed to fetch history", err);
        }
    };

    const handleSubmit = async (e) => {
        e.preventDefault();
        setLoading(true);
        setStatus(null);
        try {
            await axios.post(`${API_URL}/api/work-logs`,
                { description, planForTomorrow },
                { headers: { Authorization: `Bearer ${localStorage.getItem('token')}` } }
            );
            setStatus({
                type: 'success',
                message: exists ? 'Submission updated successfully' : 'Submission successfully recorded'
            });
            setExists(true);
            setIsEditing(false);
            fetchHistory(); // Refresh history after submission
            setTimeout(() => setStatus(null), 5000);
        } catch (err) {
            setStatus({ type: 'error', message: 'Synchronization protocol failed' });
        } finally {
            setLoading(false);
        }
    };

    const handleLogout = () => {
        localStorage.clear();
        setToken(null);
        navigate('/');
    };

    if (fetching) return (
        <div className="min-h-screen bg-[#020617] flex items-center justify-center">
            <div className="w-8 h-8 border-4 border-blue-600/20 border-t-blue-600 rounded-full animate-spin" />
        </div>
    );

    return (
        <div className="min-h-screen bg-[#020617] text-slate-200 flex flex-col">
            {/* Navbar */}
            <nav className="border-b border-white/5 bg-slate-950/50 backdrop-blur-2xl sticky top-0 z-50">
                <div className="w-full px-4 lg:px-8 h-auto min-h-[5rem] py-4 lg:py-0 flex flex-col lg:flex-row items-center justify-between gap-4 lg:gap-0">
                    <div className="flex flex-col lg:flex-row items-center gap-4 lg:gap-6 w-full lg:w-auto">
                        <div className="flex items-center gap-4 self-start lg:self-auto">
                            <div className="w-10 h-10 bg-gradient-to-br from-blue-600 to-indigo-600 rounded-xl flex items-center justify-center shadow-lg shadow-blue-500/20 shrink-0">
                                <LayoutDashboard className="w-6 h-6 text-white" />
                            </div>
                            <div>
                                <h2 className="font-extrabold text-white text-lg lg:text-xl tracking-tight leading-none">Workspace</h2>
                                <p className="text-[9px] text-slate-500 uppercase tracking-[0.2em] mt-1 font-bold">Identity: {user?.username}</p>
                            </div>
                        </div>

                        {/* Tab Navigation */}
                        <div className="flex items-center w-full lg:w-auto bg-white/5 p-1 rounded-2xl border border-white/5">
                            <button
                                onClick={() => setActiveTab('submit')}
                                className={`flex-1 lg:flex-none flex items-center justify-center gap-2 px-4 lg:px-6 py-2.5 rounded-xl transition-all font-bold text-[10px] lg:text-xs uppercase tracking-widest ${activeTab === 'submit' ? 'bg-blue-600 text-white shadow-lg' : 'text-slate-500 hover:text-slate-300'} ${exists && !isEditing ? 'opacity-60' : ''}`}
                            >
                                <ClipboardList className="w-3.5 h-3.5 lg:w-4 lg:h-4" /> {exists && !isEditing ? 'Sent' : (isEditing ? 'Editing' : 'Submit')}
                            </button>
                            <button
                                onClick={() => setActiveTab('history')}
                                className={`flex-1 lg:flex-none flex items-center justify-center gap-2 px-4 lg:px-6 py-2.5 rounded-xl transition-all font-bold text-[10px] lg:text-xs uppercase tracking-widest ${activeTab === 'history' ? 'bg-blue-600 text-white shadow-lg' : 'text-slate-500 hover:text-slate-300'}`}
                            >
                                <History className="w-3.5 h-3.5 lg:w-4 lg:h-4" /> Response
                            </button>
                        </div>
                    </div>

                    <button onClick={handleLogout} className="w-full lg:w-auto flex items-center justify-center gap-3 px-5 py-2.5 bg-red-500/10 hover:bg-red-500/20 text-red-400 rounded-xl border border-red-500/10 transition-all font-bold text-[10px] uppercase tracking-widest">
                        <LogOut className="w-4 h-4" /> Logout
                    </button>
                </div>
            </nav>

            <main className="flex-1 overflow-y-auto p-8">
                <div className="max-w-6xl mx-auto w-full">
                    <AnimatePresence mode="wait">
                        {activeTab === 'submit' ? (
                            <motion.div
                                key="submit-tab"
                                initial={{ opacity: 0, x: -20 }}
                                animate={{ opacity: 1, x: 0 }}
                                exit={{ opacity: 0, x: 20 }}
                                transition={{ duration: 0.3 }}
                                className="glass-card rounded-[2rem] lg:rounded-[3rem] p-6 sm:p-10 md:p-16 relative overflow-hidden max-w-4xl mx-auto w-full"
                            >
                                <div className="flex flex-col md:flex-row md:items-center justify-between gap-6 mb-10 lg:mb-12">
                                    <div>
                                        <h1 className="text-3xl lg:text-4xl font-black text-white tracking-tight italic">
                                            {exists && !isEditing ? 'Session Secured' : (isEditing ? 'Modify Entry' : 'New Submission')}
                                        </h1>
                                        <p className="text-slate-400 mt-2 font-medium text-sm lg:text-base">Recording operations for the current session cycle</p>
                                    </div>
                                    <div className="self-start lg:self-auto px-5 py-2.5 lg:px-6 lg:py-3 bg-blue-600/10 border border-blue-500/30 rounded-2xl flex items-center gap-3">
                                        <Calendar className="w-4 h-4 lg:w-5 lg:h-5 text-blue-400" />
                                        <span className="text-xs lg:text-sm font-black text-blue-400 uppercase tracking-widest">{new Date().toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })}</span>
                                    </div>
                                </div>

                                {exists && !isEditing ? (
                                    <div className="flex flex-col items-center justify-center py-16 text-center">
                                        <div className="w-20 h-20 bg-emerald-500/10 border border-emerald-500/20 rounded-[2rem] flex items-center justify-center mb-8 shadow-2xl shadow-emerald-500/10">
                                            <CheckCircle2 className="w-10 h-10 text-emerald-500" />
                                        </div>
                                        <h2 className="text-3xl font-black text-white tracking-tight mb-3">Today's Submission Completed</h2>
                                        <p className="text-slate-500 max-w-sm mx-auto font-medium leading-relaxed italic">
                                            "You have already submitted your response for today. The entry is now formally synchronized and locked."
                                        </p>
                                        <button
                                            onClick={() => setActiveTab('history')}
                                            className="mt-12 px-10 py-4 bg-white/5 hover:bg-white/10 text-white rounded-2xl border border-white/10 transition-all font-black text-xs uppercase tracking-widest flex items-center gap-3 group"
                                        >
                                            View Response History <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
                                        </button>
                                    </div>
                                ) : (
                                    <form onSubmit={handleSubmit} className="space-y-12">
                                        <div className="space-y-10">
                                            <div className="space-y-4">
                                                <div className="flex items-center gap-2 mb-2">
                                                    <div className="w-2 h-2 rounded-full bg-blue-500 shadow-[0_0_10px_rgba(59,130,246,0.5)]" />
                                                    <label className="text-[10px] font-black uppercase tracking-[0.4em] text-slate-500">Achievements</label>
                                                </div>
                                                <textarea
                                                    value={description}
                                                    onChange={(e) => setDescription(e.target.value)}
                                                    className="w-full h-40 lg:h-48 p-6 lg:p-8 bg-slate-950/50 border border-white/5 rounded-[1.5rem] lg:rounded-[2rem] focus:ring-4 focus:ring-blue-500/10 focus:border-blue-500/50 outline-none transition-all resize-none text-slate-200 placeholder-slate-700 leading-relaxed text-base lg:text-lg"
                                                    placeholder="Detail your primary accomplishments..."
                                                    required
                                                />
                                            </div>

                                            <div className="space-y-4">
                                                <div className="flex items-center gap-2 mb-2">
                                                    <div className="w-2 h-2 rounded-full bg-purple-500 shadow-[0_0_10px_rgba(168,85,247,0.5)]" />
                                                    <label className="text-[10px] font-black uppercase tracking-[0.4em] text-slate-500">Strategic Next Steps</label>
                                                </div>
                                                <textarea
                                                    value={planForTomorrow}
                                                    onChange={(e) => setPlanForTomorrow(e.target.value)}
                                                    className="w-full h-48 p-8 bg-slate-950/50 border border-white/5 rounded-[2rem] focus:ring-4 focus:ring-purple-500/10 focus:border-purple-500/50 outline-none transition-all resize-none text-slate-200 placeholder-slate-700 leading-relaxed text-lg"
                                                    placeholder="Outline your planned initiatives..."
                                                    required
                                                />
                                            </div>
                                        </div>

                                        <AnimatePresence>
                                            {status && (
                                                <motion.div
                                                    initial={{ opacity: 0, height: 0, scale: 0.9 }}
                                                    animate={{ opacity: 1, height: 'auto', scale: 1 }}
                                                    exit={{ opacity: 0, height: 0, scale: 0.9 }}
                                                    className={`flex items-center gap-4 p-6 rounded-[1.5rem] border ${status.type === 'error' ? 'bg-red-500/10 text-red-400 border-red-500/20' : 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20'}`}
                                                >
                                                    {status.type === 'error' ? <Clock className="w-5 h-5" /> : <CheckCircle2 className="w-5 h-5" />}
                                                    <span className="font-bold text-sm tracking-tight">{status.message}</span>
                                                </motion.div>
                                            )}
                                        </AnimatePresence>

                                        <div className="flex gap-4">
                                            {isEditing && (
                                                <button
                                                    type="button"
                                                    onClick={() => setIsEditing(false)}
                                                    className="flex-1 py-6 bg-slate-900 text-slate-400 font-black text-lg rounded-[2rem] border border-white/5 hover:bg-slate-800 transition-all active:scale-[0.98]"
                                                >
                                                    Discard
                                                </button>
                                            )}
                                            <button
                                                type="submit"
                                                disabled={loading}
                                                className={`${isEditing ? 'flex-[2]' : 'w-full'} group py-6 bg-gradient-to-r from-blue-600 to-blue-500 hover:from-blue-500 hover:to-blue-400 text-white font-black text-lg rounded-[2rem] shadow-2xl shadow-blue-500/20 transition-all flex items-center justify-center gap-4 disabled:opacity-50 active:scale-[0.98]`}
                                            >
                                                {loading ? <div className="w-6 h-6 border-4 border-white/30 border-t-white rounded-full animate-spin" /> : (
                                                    <>
                                                        {isEditing ? 'Update Response' : 'Publish Submission'}
                                                        {isEditing ? <Save className="w-6 h-6" /> : <Send className="w-6 h-6 group-hover:translate-x-1 group-hover:-translate-y-1 transition-transform" />}
                                                    </>
                                                )}
                                            </button>
                                        </div>
                                    </form>
                                )}
                            </motion.div>
                        ) : (
                            <motion.div
                                key="history-tab"
                                initial={{ opacity: 0, x: 20 }}
                                animate={{ opacity: 1, x: 0 }}
                                exit={{ opacity: 0, x: -20 }}
                                transition={{ duration: 0.3 }}
                                className="space-y-8"
                            >
                                <div className="flex flex-col md:flex-row items-center justify-between gap-6 mb-4 px-4">
                                    <div>
                                        <h1 className="text-4xl font-black text-white tracking-tight italic">Response Archive</h1>
                                        <p className="text-slate-500 mt-2 font-medium">Tracking your operational trajectory across all session cycles</p>
                                    </div>
                                    <div className="bg-white/5 border border-white/10 px-6 py-3 rounded-2xl flex items-center gap-3">
                                        <History className="w-5 h-5 text-slate-400" />
                                        <span className="text-sm font-black text-white uppercase tracking-widest">{historyLogs.length} Records</span>
                                    </div>
                                </div>

                                {historyLogs.length === 0 ? (
                                    <div className="glass-card rounded-[3rem] p-24 text-center">
                                        <div className="w-20 h-20 bg-slate-900 rounded-[2rem] border border-white/5 flex items-center justify-center mx-auto mb-6">
                                            <Search className="w-10 h-10 text-slate-700" />
                                        </div>
                                        <h3 className="text-2xl font-black text-white tracking-tight">Archive Vacant</h3>
                                        <p className="text-slate-500 mt-2 font-medium italic">No historical data markers detected for this identity.</p>
                                    </div>
                                ) : (
                                    <div className="grid grid-cols-1 gap-8">
                                        {historyLogs.map((log, idx) => (
                                            <motion.div
                                                key={log.id}
                                                initial={{ opacity: 0, y: 20 }}
                                                animate={{ opacity: 1, y: 0 }}
                                                transition={{ delay: idx * 0.05 }}
                                                className="glass-card rounded-[2.5rem] p-10 hover:border-white/10 transition-all border border-white/5 group relative overflow-hidden"
                                            >
                                                <div className="absolute top-0 right-0 w-32 h-32 bg-blue-600/5 blur-3xl pointer-events-none" />

                                                <div className="flex flex-col md:flex-row md:items-center justify-between gap-6 mb-10 border-b border-white/5 pb-8">
                                                    <div className="flex items-center gap-5">
                                                        <div className="w-14 h-14 bg-slate-900 border border-white/5 rounded-2xl flex flex-col items-center justify-center text-blue-500 font-black leading-none">
                                                            <span className="text-[10px] uppercase tracking-tighter mb-1 opacity-50">Log</span>
                                                            <span className="text-xl">{historyLogs.length - idx}</span>
                                                        </div>
                                                        <div>
                                                            <h3 className="text-2xl font-black text-white tracking-tighter">{new Date(log.date).toLocaleDateString('en-GB', { day: '2-digit', month: 'long', year: 'numeric' })}</h3>
                                                            <div className="flex items-center gap-2 mt-1">
                                                                <Clock className="w-3.5 h-3.5 text-slate-600" />
                                                                <span className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">TS: {new Date(log.createdAt).toLocaleTimeString()}</span>
                                                            </div>
                                                        </div>
                                                    </div>
                                                    {log.date === todayDate && (
                                                        <div className="flex items-center gap-4">
                                                            <span className="px-5 py-2 bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 rounded-full text-[10px] font-black uppercase tracking-[0.2em]">Active Session</span>
                                                            <button
                                                                onClick={() => { setIsEditing(true); setActiveTab('submit'); }}
                                                                className="flex items-center gap-2 px-5 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-full text-[10px] font-black uppercase tracking-widest transition-all shadow-lg shadow-blue-500/20 active:scale-95"
                                                            >
                                                                <Save className="w-3 h-3" /> Edit Entry
                                                            </button>
                                                        </div>
                                                    )}
                                                </div>

                                                <div className="grid grid-cols-1 md:grid-cols-2 gap-10">
                                                    <div className="space-y-4">
                                                        <div className="flex items-center gap-2">
                                                            <MessageSquare className="w-3.5 h-3.5 text-blue-500" />
                                                            <h4 className="text-[10px] font-black text-slate-500 uppercase tracking-[0.3em]">Operational Status</h4>
                                                        </div>
                                                        <div className="p-8 bg-slate-950/80 rounded-[2rem] border border-white/5 text-slate-300 leading-relaxed font-medium italic">
                                                            "{log.description}"
                                                        </div>
                                                    </div>
                                                    <div className="space-y-4">
                                                        <div className="flex items-center gap-2">
                                                            <ArrowRight className="w-3.5 h-3.5 text-purple-500" />
                                                            <h4 className="text-[10px] font-black text-slate-500 uppercase tracking-[0.3em]">Forward Trajectory</h4>
                                                        </div>
                                                        <div className="p-8 bg-slate-950/80 rounded-[2rem] border border-white/5 text-slate-300 leading-relaxed font-medium italic">
                                                            "{log.planForTomorrow}"
                                                        </div>
                                                    </div>
                                                </div>
                                            </motion.div>
                                        ))}
                                    </div>
                                )}
                            </motion.div>
                        )}
                    </AnimatePresence>
                </div>
            </main>
        </div>
    );
};

export default WorkerDashboard;
