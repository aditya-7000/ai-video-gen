import React from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';

export default function Navbar() {
  const auth = useAuth();
  const { user, logout } = auth || {}; 
  const navigate = useNavigate();

  return (
    <nav className="bg-white shadow p-4 flex justify-between items-center">
      <Link to="/" className="font-bold text-lg">AI Video</Link>
      <div className="flex gap-4">
        {user ? (
          <>
            <Link to="/history" className="hover:underline">History</Link>
            <button
              className="text-red-500 hover:underline"
              onClick={() => { logout(); navigate('/login') }}>
              Logout
            </button>
          </>
        ) : (
          <>
            <Link to="/login" className="hover:underline">Login</Link>
            <Link to="/signup" className="hover:underline">Signup</Link>
          </>
        )}
      </div>
    </nav>
  );
}