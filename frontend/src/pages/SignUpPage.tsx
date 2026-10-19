import { useState, FormEvent } from 'react';
import { signUp } from 'aws-amplify/auth';
import { useNavigate, Link } from 'react-router-dom';

function validatePassword(password: string): string | null {
  if (password.length < 8) return 'Password must be at least 8 characters.';
  if (!/[A-Z]/.test(password)) return 'Password must contain an uppercase letter.';
  if (!/[a-z]/.test(password)) return 'Password must contain a lowercase letter.';
  if (!/[0-9]/.test(password)) return 'Password must contain a digit.';
  if (!/[^A-Za-z0-9]/.test(password)) return 'Password must contain a special character.';
  return null;
}

export function SignUpPage(): JSX.Element {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const navigate = useNavigate();

  const handleSubmit = async (e: FormEvent): Promise<void> => {
    e.preventDefault();
    setError('');
    const pwdError = validatePassword(password);
    if (pwdError) { setError(pwdError); return; }
    setIsLoading(true);
    try {
      await signUp({ username: email, password, options: { userAttributes: { email } } });
      navigate('/verify', { state: { email } });
    } catch (err) {
      const message = (err as Error).message ?? '';
      if (message.includes('already') || message.includes('exists')) {
        setError('An account with this email address already exists.');
      } else {
        setError(message || 'Registration failed. Please try again.');
      }
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div style={{ maxWidth: 400, margin: '4rem auto', padding: '0 1rem' }}>
      <h1>Create Account</h1>
      <form onSubmit={handleSubmit}>
        <div>
          <label htmlFor="email">Email</label>
          <input
            id="email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            maxLength={254}
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
            style={{ display: 'block', width: '100%', marginBottom: '0.5rem' }}
          />
          <small>Min 8 chars, uppercase, lowercase, digit, special character</small>
        </div>
        {error && <p role="alert" style={{ color: 'red', marginTop: '0.5rem' }}>{error}</p>}
        <button type="submit" disabled={isLoading} style={{ width: '100%', marginTop: '1rem' }}>
          {isLoading ? 'Creating account...' : 'Create Account'}
        </button>
      </form>
      <p>Already have an account? <Link to="/signin">Sign In</Link></p>
    </div>
  );
}
