import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import axios from 'axios';
import { Users, FileText, Download, Trash2, Plus, LogOut, Calendar, Search, Shield, UserPlus, Filter, X, Menu, Settings, Clock } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { jsPDF } from 'jspdf';

const AdminDashboard = ({ setToken }) => {
    const API_URL = import.meta.env.VITE_API_URL || '';
    const [users, setUsers] = useState([]);
    const [logs, setLogs] = useState([]);
    const [date, setDate] = useState(new Date().toISOString().split('T')[0]);
    const [newUser, setNewUser] = useState({ username: '', password: '', role: 'WORKER' });
    const [loading, setLoading] = useState(false);
    const [msg, setMsg] = useState(null);
    const [sidebarOpen, setSidebarOpen] = useState(true);
    const navigate = useNavigate();

    useEffect(() => {
        const token = localStorage.getItem('token');
        const user = JSON.parse(localStorage.getItem('user'));
        if (!token) {
            navigate('/');
            return;
        }
        if (user?.role !== 'ADMIN') {
            navigate('/worker');
            return;
        }
        fetchUsers();
        fetchLogs();
    }, [date]);

    const fetchUsers = async () => {
        try {
            const res = await axios.get(`${API_URL}/api/users`, {
                headers: { Authorization: `Bearer ${localStorage.getItem('token')}` }
            });
            setUsers(res.data);
        } catch (err) { console.error(err); }
    };

    const fetchLogs = async () => {
        try {
            const res = await axios.get(`${API_URL}/api/work-logs?date=${date}`, {
                headers: { Authorization: `Bearer ${localStorage.getItem('token')}` }
            });
            setLogs(res.data);
        } catch (err) { console.error(err); }
    };

    const handleAddUser = async (e) => {
        e.preventDefault();
        try {
            await axios.post(`${API_URL}/api/auth/register`, newUser, {
                headers: { Authorization: `Bearer ${localStorage.getItem('token')}` }
            });
            setNewUser({ username: '', password: '', role: 'WORKER' });
            fetchUsers();
            setMsg({ type: 'success', text: 'Identity registered' });
            setTimeout(() => setMsg(null), 3000);
        } catch (err) { setMsg({ type: 'error', text: 'Registration failed' }); }
    };

    const handleDeleteUser = async (id) => {
        if (!confirm('Terminate this identity?')) return;
        try {
            await axios.delete(`${API_URL}/api/users/${id}`, {
                headers: { Authorization: `Bearer ${localStorage.getItem('token')}` }
            });
            fetchUsers();
        } catch (err) { console.error(err); }
    };

    const handleDeleteLog = async (id) => {
        if (!confirm('Redact this response?')) return;
        try {
            await axios.delete(`${API_URL}/api/work-logs/${id}`, {
                headers: { Authorization: `Bearer ${localStorage.getItem('token')}` }
            });
            fetchLogs();
        } catch (err) { console.error(err); }
    };

    const handleLogout = () => {
        localStorage.clear();
        setToken(null);
        navigate('/');
    };

    const downloadPDF = () => {
        const doc = new jsPDF();
        doc.setFillColor(248, 250, 252);
        doc.rect(0, 0, 210, 40, 'F');
        doc.setFontSize(28);
        doc.setTextColor(15, 23, 42);
        doc.setFont("helvetica", "bold");
        doc.text(`Work Activity Journal`, 20, 25);
        doc.setFontSize(10);
        doc.setTextColor(100, 116, 139);
        doc.text(`REGULAR REPORT • DATE: ${date}`, 20, 32);
        let yPos = 55;
        logs.forEach((log) => {
            if (yPos > 240) { doc.addPage(); yPos = 20; }
            doc.setDrawColor(240, 240, 240);
            doc.setLineWidth(0.1);
            doc.line(20, yPos - 5, 190, yPos - 5);
            doc.setFontSize(14);
            doc.setTextColor(14, 165, 233);
            doc.setFont("helvetica", "bold");
            doc.text(`${log.User?.username || 'Redacted'}`, 20, yPos + 5);
            yPos += 15;
            doc.setFontSize(10);
            doc.setTextColor(100, 100, 100);
            doc.text("TODAY'S TASK", 20, yPos);
            yPos += 6;
            doc.setFont("helvetica", "normal");
            doc.setTextColor(40, 40, 40);
            const todayLines = doc.splitTextToSize(log.description || "", 170);
            doc.text(todayLines, 25, yPos);
            yPos += (todayLines.length * 6) + 4;
            doc.setFontSize(10);
            doc.setTextColor(100, 100, 100);
            doc.text("TOMORROW/NEXT WORKING DAY'S TASK", 20, yPos);
            yPos += 6;
            const planLines = doc.splitTextToSize(log.planForTomorrow || "", 170);
            doc.text(planLines, 25, yPos);
            yPos += (planLines.length * 6) + 20;
        });
        doc.save(`Activity_Journal_${date}.pdf`);
    };

    return (
        <div className="flex h-screen bg-slate-50 text-slate-800 overflow-hidden w-full">
            {/* Sidebar Toggle */}
            <button
                onClick={() => setSidebarOpen(!sidebarOpen)}
                className="fixed bottom-8 left-8 z-[60] p-4 bg-blue-600 rounded-2xl shadow-2xl shadow-blue-500/40 text-white lg:hidden"
            >
                <Menu className="w-6 h-6" />
            </button>

            {/* Sidebar Identity Management */}
            <AnimatePresence>
                {sidebarOpen && (
                    <motion.aside
                        initial={{ x: -300, opacity: 0 }}
                        animate={{ x: 0, opacity: 1 }}
                        exit={{ x: -300, opacity: 0 }}
                        className="fixed lg:static w-[320px] sm:w-[380px] h-full border-r border-slate-200 bg-white/90 lg:bg-white/40 backdrop-blur-3xl flex flex-col z-50 shrink-0 shadow-2xl lg:shadow-none"
                    >
                        <div className="p-8 h-20 border-b border-slate-200 flex items-center gap-4">
                            <div className="w-10 h-10 bg-gradient-to-br from-indigo-600 to-purple-600 rounded-xl flex items-center justify-center text-white">
                                <Shield className="w-6 h-6" />
                            </div>
                            <h1 className="font-black text-xl tracking-tight">Security</h1>
                        </div>

                        <div className="p-8 flex-1 overflow-y-auto space-y-10 custom-scroll">
                            {/* New Identity */}
                            <section>
                                <h2 className="text-xs font-black uppercase tracking-[0.2em] text-slate-500 mb-6 flex items-center gap-2">
                                    <UserPlus className="w-4 h-4" /> Provisioning
                                </h2>
                                <form onSubmit={handleAddUser} className="space-y-4">
                                    <input
                                        type="text"
                                        placeholder="Identification"
                                        value={newUser.username}
                                        onChange={(e) => setNewUser({ ...newUser, username: e.target.value })}
                                        className="w-full px-5 py-4 bg-white border border-slate-200 rounded-2xl focus:border-blue-500/50 outline-none transition-all text-sm"
                                        required
                                    />
                                    <input
                                        type="password"
                                        placeholder="Credentials"
                                        value={newUser.password}
                                        onChange={(e) => setNewUser({ ...newUser, password: e.target.value })}
                                        className="w-full px-5 py-4 bg-white border border-slate-200 rounded-2xl focus:border-blue-500/50 outline-none transition-all text-sm"
                                        required
                                    />
                                    <div className="flex gap-3">
                                        <select
                                            value={newUser.role}
                                            onChange={(e) => setNewUser({ ...newUser, role: e.target.value })}
                                            className="flex-1 px-4 py-3 bg-slate-50 border border-slate-200 rounded-2xl text-xs font-bold uppercase tracking-widest outline-none"
                                        >
                                            <option value="WORKER">Worker</option>
                                            <option value="ADMIN">Admin</option>
                                        </select>
                                        <button type="submit" className="px-6 bg-blue-600 hover:bg-blue-500 text-white font-bold rounded-2xl transition-all shadow-lg shadow-blue-500/20">
                                            Deploy
                                        </button>
                                    </div>
                                    {msg && <p className={`text-[10px] font-bold uppercase text-center py-2 rounded-lg ${msg.type === 'error' ? 'text-red-400 bg-red-400/5 border-red-500/10' : 'text-emerald-400 bg-emerald-400/5 border-emerald-500/10'}`}>{msg.text}</p>}
                                </form>
                            </section>

                            {/* Registry List */}
                            <section>
                                <h2 className="text-xs font-black uppercase tracking-[0.2em] text-slate-500 mb-6 flex items-center gap-2">
                                    <Users className="w-4 h-4" /> Registry
                                </h2>
                                <div className="space-y-2">
                                    {users.map(u => (
                                        <div key={u.id} className="flex items-center justify-between p-3 bg-white border border-slate-100 rounded-xl group hover:shadow-sm transition-all">
                                            <div className="flex items-center gap-3">
                                                <div className="w-8 h-8 rounded-lg bg-slate-100 flex items-center justify-center text-[10px] font-black">{u.username[0].toUpperCase()}</div>
                                                <div>
                                                    <span className="text-xs font-bold text-slate-700 block">{u.username}</span>
                                                    <span className={`text-[8px] font-black tracking-[0.2em] uppercase px-2 py-0.5 rounded-md ${u.role === 'ADMIN' ? 'bg-purple-100 text-purple-600' : 'bg-slate-100 text-slate-500'}`}>
                                                        {u.role}
                                                    </span>
                                                </div>
                                            </div>
                                            {u.role !== 'ADMIN' && (
                                                <button onClick={() => handleDeleteUser(u.id)} className="opacity-0 group-hover:opacity-100 p-1.5 text-slate-600 hover:text-red-400 transition-all">
                                                    <Trash2 className="w-4 h-4" />
                                                </button>
                                            )}
                                        </div>
                                    ))}
                                </div>
                            </section>
                        </div>

                        <div className="p-8 border-t border-slate-200">
                            <button onClick={handleLogout} className="w-full flex items-center justify-center gap-3 py-4 bg-red-500/10 hover:bg-red-500/20 text-red-500 rounded-2xl border border-red-500/20 transition-all font-bold uppercase tracking-widest text-xs">
                                <LogOut className="w-4 h-4" /> Terminate Session
                            </button>
                        </div>
                    </motion.aside>
                )}
            </AnimatePresence>

            {/* Main Full Page Activity Archive */}
            <main className="flex-1 h-screen flex flex-col relative overflow-hidden">
                <header className="h-auto min-h-[5rem] lg:h-20 border-b border-slate-200 bg-white/60 backdrop-blur-xl px-6 lg:px-10 py-4 flex flex-col lg:flex-row items-start lg:items-center justify-between gap-4 lg:gap-0 z-10">
                    <div className="flex items-center gap-8">
                        <div>
                            <h2 className="text-xl lg:text-2xl font-black text-slate-900 tracking-tighter">Activity Stream</h2>
                            <p className="text-[9px] lg:text-[10px] text-slate-500 uppercase tracking-[0.4em] font-black mt-1">Operational Monitoring</p>
                        </div>
                    </div>

                    <div className="flex flex-wrap items-center gap-4 lg:gap-6 w-full lg:w-auto">
                        <div className="relative flex-1 lg:flex-none">
                            <Calendar className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-blue-500" />
                            <input
                                type="date"
                                value={date}
                                onChange={(e) => setDate(e.target.value)}
                                className="w-full lg:w-48 pl-12 pr-6 py-2.5 bg-white border border-slate-200 rounded-xl text-xs font-bold text-slate-900 outline-none focus:border-blue-500/50 transition-all cursor-pointer" />
                        </div>
                        <button
                            onClick={downloadPDF}
                            disabled={logs.length === 0}
                            className="flex-1 lg:flex-none flex items-center justify-center gap-2 px-6 lg:px-8 py-2.5 bg-blue-600 hover:bg-blue-500 text-white text-xs font-black uppercase tracking-widest rounded-xl transition-all shadow-lg shadow-blue-500/20 active:scale-95 disabled:opacity-20"
                        >
                            <Download className="w-4 h-4" /> Export
                        </button>
                    </div>
                </header>

                <div className="flex-1 overflow-y-auto p-12 custom-scroll bg-slate-50">
                    {logs.length === 0 ? (
                        <div className="h-full flex flex-col items-center justify-center text-center opacity-40">
                            <Search className="w-20 h-20 mb-6 text-slate-200" />
                            <h3 className="text-2xl font-black text-slate-900">Archives Vacant</h3>
                            <p className="mt-2 font-medium text-slate-500">No activity markers detected for the selected period.</p>
                        </div>
                    ) : (
                        <div className="max-w-[1200px] mx-auto space-y-12">
                            {logs.map((log, idx) => (
                                <motion.div
                                    key={log.id}
                                    initial={{ opacity: 0, y: 40 }}
                                    animate={{ opacity: 1, y: 0 }}
                                    transition={{ delay: idx * 0.05 }}
                                    className="relative grid grid-cols-12 gap-10 group"
                                >
                                    {/* Timeline Marker */}
                                    <div className="col-span-1 hidden md:flex flex-col items-center pt-2">
                                        <div className="w-12 h-12 rounded-2xl bg-white border border-slate-200 flex items-center justify-center font-black group-hover:border-blue-500/40 transition-all text-blue-500 shadow-sm">
                                            {idx + 1}
                                        </div>
                                        <div className="w-px flex-1 bg-gradient-to-b from-slate-200 to-transparent my-4" />
                                    </div>

                                    {/* Content Card */}
                                    <div className="col-span-12 md:col-span-11 p-6 md:p-10 bg-white border border-slate-200 rounded-[2rem] md:rounded-[3rem] hover:border-slate-300 transition-all flex flex-col gap-6 md:gap-8 shadow-sm">
                                        <div className="flex items-center justify-between gap-4">
                                            <div className="flex items-center gap-4 md:gap-6">
                                                <div className="w-10 h-10 md:w-14 md:h-14 bg-blue-600 rounded-full flex items-center justify-center text-sm md:text-xl font-black text-white shadow-xl shadow-blue-500/20 shrink-0">
                                                    {log.User?.username?.[0]?.toUpperCase()}
                                                </div>
                                                <div className="min-w-0">
                                                    <h3 className="text-lg md:text-2xl font-black text-slate-900 tracking-widest uppercase truncate">{log.User?.username}</h3>
                                                    <div className="flex items-center gap-3 mt-1">
                                                        <Clock className="w-3 h-3 text-slate-400" />
                                                        <span className="text-[10px] font-black text-slate-500 tracking-[0.2em]">{new Date(log.createdAt).toLocaleTimeString()}</span>
                                                    </div>
                                                </div>
                                            </div>
                                            <button onClick={() => handleDeleteLog(log.id)} className="p-3 md:p-4 bg-red-500/5 text-red-500/40 hover:text-red-500 hover:bg-red-500/10 rounded-2xl transition-all shrink-0"><Trash2 className="w-4 h-4 md:w-5 md:h-5" /></button>
                                        </div>

                                        <div className="grid grid-cols-1 md:grid-cols-2 gap-10">
                                            <div className="space-y-4">
                                                <h4 className="text-[10px] font-black text-blue-500 uppercase tracking-[0.4em]">Today's Task</h4>
                                                <div className="p-8 bg-slate-50 rounded-[2rem] border border-slate-100 text-slate-700 leading-relaxed font-medium">
                                                    {log.description}
                                                </div>
                                            </div>
                                            <div className="space-y-4">
                                                <h4 className="text-[10px] font-black text-purple-500 uppercase tracking-[0.4em]">Tomorrow/ Next Working Day's Task</h4>
                                                <div className="p-8 bg-slate-50 rounded-[2rem] border border-slate-100 text-slate-700 leading-relaxed font-medium">
                                                    {log.planForTomorrow}
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                </motion.div>
                            ))}
                        </div>
                    )}
                </div>
            </main>
        </div>
    );
};

export default AdminDashboard;
