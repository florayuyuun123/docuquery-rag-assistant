import { useState, FormEvent } from 'react';
import { confirmSignUp, resendSignUpCode } from 'aws-amplify/auth';
import { useNavigate, useLocation } from 'react-router-dom';

export function VerifyPage(): JSX.Element {
  const location = useLocation();
  const email = (location.state as { email?: string })?.email ?? '';
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [successMessage, setSuccessMessage] = useState('');
  const [resendCount, setResendCount] = useState(0);
  const [isLoading, setIsLoading] = useState(false);
  const navigate = useNavigate();

  const handleSubmit = async (e: FormEvent): Promise<void> => {
    e.preventDefault();
    setError('');
    setIsLoading(true);
    try {
      await confirmSignUp({ username: email, confirmationCode: code });
      navigate('/signin', { replace: true });
    } catch (err) {
      const msg = (err as Error).message ?? '';
      if (msg.includes('expired') || msg.includes('invalid')) {
        setError('The verification code is invalid or has expired. Please request a new one.');
      } else {
        setError(msg || 'Verification failed. Please try again.');
      }
    } finally {
      setIsLoading(false);
    }
  };

  const handleResend = async (): Promise<void> => {
    if (resendCount >= 3) { setError('Maximum resend attempts reached.'); return; }
    try {
      await resendSignUpCode({ username: email });
      setResendCount((c) => c + 1);
      setSuccessMessage(`Verification code resent (${resendCount + 1}/3 attempts used).`);
    } catch (err) {
      setError((err as Error).message ?? 'Failed to resend code.');
    }
  };

  return (
    <div style={{ maxWidth: 400, margin: '4rem auto', padding: '0 1rem' }}>
      <h1>Verify Email</h1>
      <p>Enter the verification code sent to <strong>{email}</strong>.</p>
      <form onSubmit={handleSubmit}>
        <input
          value={code}
          onChange={(e) => setCode(e.target.value)}
          placeholder="Verification code"
          required
          style={{ display: 'block', width: '100%', marginBottom: '1rem' }}
        />
        {error && <p role="alert" style={{ color: 'red' }}>{error}</p>}
        {successMessage && <p style={{ color: 'green' }}>{successMessage}</p>}
        <button type="submit" disabled={isLoading} style={{ width: '100%' }}>
          {isLoading ? 'Verifying...' : 'Verify'}
        </button>
      </form>
      <button
        onClick={() => void handleResend()}
        disabled={resendCount >= 3}
        style={{ marginTop: '1rem', background: 'none', border: 'none', cursor: 'pointer', color: 'blue' }}
      >
        Resend code {resendCount > 0 ? `(${resendCount}/3 used)` : ''}
      </button>
    </div>
  );
}
