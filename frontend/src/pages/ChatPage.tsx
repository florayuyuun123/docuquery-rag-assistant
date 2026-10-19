import { useState, FormEvent } from 'react';
import { Link } from 'react-router-dom';

import { sendQuery, QueryResponse } from '../api/queryApi';
import { CitationPanel } from '../components/CitationPanel';
import { useAuthSession } from '../hooks/useAuthSession';

export function ChatPage(): JSX.Element {
  const [question, setQuestion] = useState('');
  const [response, setResponse] = useState<QueryResponse | null>(null);
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [sessionId, setSessionId] = useState<string | undefined>(undefined);
  const { signOut } = useAuthSession();

  const handleSubmit = async (e: FormEvent): Promise<void> => {
    e.preventDefault();
    if (!question.trim()) return;
    setError('');
    setIsLoading(true);
    try {
      const result = await sendQuery(question, sessionId);
      setResponse(result);
      setSessionId(result.sessionId);
    } catch (err) {
      const status = (err as { response?: { status?: number } }).response?.status;
      if (status === 504) {
        setError('The request timed out. Please try again.');
      } else if (status === 502) {
        setError('The AI service is temporarily unavailable. Please try again.');
      } else if (!navigator.onLine) {
        setError('Connection error — check your network and try again.');
      } else {
        setError('An error occurred. Please try again.');
      }
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div style={{ maxWidth: 800, margin: '2rem auto', padding: '0 1rem' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h1>Ask a Question</h1>
        <div>
          <Link to="/" style={{ marginRight: '1rem' }}>Documents</Link>
          <Link to="/history" style={{ marginRight: '1rem' }}>History</Link>
          <button onClick={() => void signOut()}>Sign Out</button>
        </div>
      </div>

      <form onSubmit={(e) => { void handleSubmit(e); }} style={{ marginBottom: '1.5rem' }}>
        <textarea
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          placeholder="Ask a question about your documents..."
          rows={3}
          style={{ width: '100%', marginBottom: '0.5rem', padding: '0.5rem', fontSize: '1rem' }}
          aria-label="Question"
        />
        <button type="submit" disabled={isLoading || !question.trim()} style={{ padding: '0.5rem 1.5rem' }}>
          {isLoading ? 'Searching...' : 'Ask'}
        </button>
      </form>

      {error && (
        <p role="alert" style={{ color: 'red', padding: '0.75rem', background: '#fff0f0', borderRadius: 4 }}>
          {error}
        </p>
      )}

      {response && (
        <div style={{ background: '#f9f9f9', padding: '1.5rem', borderRadius: 8 }}>
          {response.isFallback ? (
            <p style={{ fontStyle: 'italic', color: '#555' }}>{response.answer}</p>
          ) : (
            <>
              <p style={{ lineHeight: 1.6 }}>{response.answer}</p>
              <CitationPanel citations={response.citations} />
            </>
          )}
        </div>
      )}
    </div>
  );
}
