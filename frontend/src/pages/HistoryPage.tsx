import type { ChatRecord } from '@docuquery/shared';
import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';

import { getChatHistory } from '../api/historyApi';
import { CitationPanel } from '../components/CitationPanel';
import { useAuthSession } from '../hooks/useAuthSession';

export function HistoryPage(): JSX.Element {
  const [records, setRecords] = useState<ChatRecord[]>([]);
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const { signOut } = useAuthSession();

  useEffect(() => {
    getChatHistory()
      .then(setRecords)
      .catch(() => setError('Chat history could not be loaded.'))
      .finally(() => setIsLoading(false));
  }, []);

  return (
    <div style={{ maxWidth: 800, margin: '2rem auto', padding: '0 1rem' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h1>Chat History</h1>
        <div>
          <Link to="/" style={{ marginRight: '1rem' }}>Documents</Link>
          <Link to="/chat" style={{ marginRight: '1rem' }}>Chat</Link>
          <button onClick={() => void signOut()}>Sign Out</button>
        </div>
      </div>

      {isLoading && <p>Loading history...</p>}
      {error && <p role="alert" style={{ color: 'orange' }}>{error}</p>}

      {!isLoading && !error && records.length === 0 && (
        <p>No chat history yet. <Link to="/chat">Ask your first question</Link></p>
      )}

      {records.map((record, i) => (
        <div
          key={`${record.sessionId}-${i}`}
          style={{ borderBottom: '1px solid #eee', paddingBottom: '1.5rem', marginBottom: '1.5rem' }}
        >
          <p style={{ color: '#888', fontSize: '0.85rem' }}>
            {new Date(record.createdAt).toLocaleString()}
          </p>
          <p><strong>Q:</strong> {record.question}</p>
          {record.isFallback ? (
            <p style={{ fontStyle: 'italic', color: '#555' }}>{record.answer}</p>
          ) : (
            <>
              <p><strong>A:</strong> {record.answer}</p>
              <CitationPanel citations={record.citations} />
            </>
          )}
        </div>
      ))}
    </div>
  );
}
