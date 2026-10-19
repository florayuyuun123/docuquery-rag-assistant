import { signIn } from 'aws-amplify/auth';
import { useState, FormEvent } from 'react';
import { useNavigate, Link } from 'react-router-dom';

export function SignInPage(): JSX.Element {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const navigate = useNavigate();

  const handleSubmit = async (e: FormEvent): Promise<void> => {
    e.preventDefault();
    setError('');
    setIsLoading(true);
    try {
      await signIn({ username: email, password });
      navigate('/', { replace: true });
    } catch (err) {
      const message = (err as Error).message ?? '';
      if (message.includes('locked') || message.includes('attempts')) {
        setError('Account is temporarily locked due to too many failed attempts. Please try again in 30 minutes.');
      } else {
        setError('Authentication failed. Please check your credentials.');
      }
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div style={{ maxWidth: 400, margin: '4rem auto', padding: '0 1rem' }}>
      <h1>Sign In</h1>
      <form onSubmit={(e) => { void handleSubmit(e); }}>
        <div>
          <label htmlFor="email">Email</label>
          <input
            id="email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            autoComplete="email"
            style={{ display: 'block', width: '100%', marginBottom: '1rem' }}
          />
        </div>
        <div>
          <label htmlFor="password">Password</label>
          <input
            id="password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            autoComplete="current-password"
            style={{ display: 'block', width: '100%', marginBottom: '1rem' }}
          />
        </div>
        {error && <p role="alert" style={{ color: 'red' }}>{error}</p>}
        <button type="submit" disabled={isLoading} style={{ width: '100%' }}>
          {isLoading ? 'Signing in...' : 'Sign In'}
        </button>
      </form>
      <p>Don&apos;t have an account? <Link to="/signup">Sign Up</Link></p>
    </div>
  );
}
