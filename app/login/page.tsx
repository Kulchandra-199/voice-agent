'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

export default function LoginPage() {
  const [isLogin, setIsLogin] = useState(true);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    const endpoint = isLogin ? '/api/login' : '/api/signup';
    const backendUrl = process.env.NEXT_PUBLIC_BACKEND_URL || 'http://localhost:8080';

    try {
      const res = await fetch(`${backendUrl}${endpoint}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: email, password }),
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.error || 'Something went wrong');
        return;
      }

      // Store user info and token in localStorage
      localStorage.setItem('user', JSON.stringify({
        username: data.username || email,
        email: data.username || email,
        token: data.token
      }));

      // Redirect to home
      router.push('/');
    } catch (err) {
      setError('Failed to connect to server');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="login-container">
      <div className="login-box">
        <h1 className="login-title">{isLogin ? 'Welcome Back' : 'Create Account'}</h1>
        <p className="login-subtitle">
          {isLogin ? 'Sign in to continue to Aria' : 'Sign up to get started'}
        </p>

        <form onSubmit={handleSubmit} className="login-form">
          <div className="form-group">
            <label htmlFor="email">Email</label>
            <input
              type="email"
              id="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              required
            />
          </div>

          <div className="form-group">
            <label htmlFor="password">Password</label>
            <input
              type="password"
              id="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              minLength={6}
              required
            />
          </div>

          {error && <div className="error-message">{error}</div>}

          <button type="submit" className="submit-btn" disabled={loading}>
            {loading ? 'Please wait...' : isLogin ? 'Sign In' : 'Sign Up'}
          </button>
        </form>

        <p className="toggle-text">
          {isLogin ? "Don't have an account? " : 'Already have an account? '}
          <button
            type="button"
            onClick={() => setIsLogin(!isLogin)}
            className="toggle-btn"
          >
            {isLogin ? 'Sign Up' : 'Sign In'}
          </button>
        </p>
      </div>

      <style jsx>{`
        .login-container {
          min-height: 100vh;
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 20px;
          background: var(--background);
        }

        .login-box {
          width: 100%;
          max-width: 400px;
          padding: 40px;
          background: var(--card);
          border-radius: 16px;
          border: 1px solid var(--border);
        }

        .login-title {
          font-family: var(--font-inter);
          font-size: 28px;
          font-weight: 700;
          text-align: center;
          margin-bottom: 8px;
          color: var(--text-primary);
        }

        .login-subtitle {
          text-align: center;
          color: var(--text-secondary);
          margin-bottom: 32px;
          font-size: 14px;
        }

        .login-form {
          display: flex;
          flex-direction: column;
          gap: 20px;
        }

        .form-group {
          display: flex;
          flex-direction: column;
          gap: 8px;
        }

        .form-group label {
          font-size: 14px;
          font-weight: 500;
          color: var(--text-primary);
        }

        .form-group input {
          padding: 12px 16px;
          border: 1px solid var(--border);
          border-radius: 8px;
          background: var(--background);
          color: var(--text-primary);
          font-size: 14px;
          outline: none;
          transition: border-color 0.2s;
        }

        .form-group input:focus {
          border-color: var(--primary);
        }

        .form-group input::placeholder {
          color: var(--text-secondary);
        }

        .error-message {
          color: var(--error);
          font-size: 14px;
          text-align: center;
          padding: 12px;
          background: rgba(239, 68, 68, 0.1);
          border-radius: 8px;
        }

        .submit-btn {
          padding: 14px 24px;
          background: var(--primary);
          color: white;
          border: none;
          border-radius: 8px;
          font-size: 16px;
          font-weight: 600;
          cursor: pointer;
          transition: background 0.2s;
        }

        .submit-btn:hover:not(:disabled) {
          background: var(--primary-hover, #4f46e5);
        }

        .submit-btn:disabled {
          opacity: 0.6;
          cursor: not-allowed;
        }

        .toggle-text {
          text-align: center;
          margin-top: 24px;
          color: var(--text-secondary);
          font-size: 14px;
        }

        .toggle-btn {
          background: none;
          border: none;
          color: var(--primary);
          font-size: 14px;
          cursor: pointer;
          padding: 0;
          font-weight: 500;
        }

        .toggle-btn:hover {
          text-decoration: underline;
        }
      `}</style>
    </div>
  );
}