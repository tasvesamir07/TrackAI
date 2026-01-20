import React, { useState, useEffect } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import Login from './components/Login';
import WorkerDashboard from './components/WorkerDashboard';
import AdminDashboard from './components/AdminDashboard';
import './App.css';

function App() {
  const [token, setToken] = useState(localStorage.getItem('token'));

  return (
    <Router>
      <Routes>
        <Route path="/" element={!token ? <Login setToken={setToken} /> : <Navigate to={JSON.parse(localStorage.getItem('user'))?.role === 'ADMIN' ? '/admin' : '/worker'} />} />
        <Route path="/worker" element={<WorkerDashboard setToken={setToken} />} />
        <Route path="/admin" element={<AdminDashboard setToken={setToken} />} />
      </Routes>
    </Router>
  );
}

export default App;
