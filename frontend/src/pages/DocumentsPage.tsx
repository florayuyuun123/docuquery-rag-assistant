import { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';

import { listDocuments, deleteDocument, DocumentSummary } from '../api/documentsApi';
import { UploadZone } from '../components/UploadZone';
import { useAuthSession } from '../hooks/useAuthSession';

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

export function DocumentsPage(): JSX.Element {
  const [documents, setDocuments] = useState<DocumentSummary[]>([]);
  const [error, setError] = useState('');
  const [pollingActive, setPollingActive] = useState(true);
  const { signOut } = useAuthSession();

  const fetchDocs = useCallback(async (): Promise<void> => {
    try {
      const docs = await listDocuments();
      setDocuments(docs);
      setError('');
    } catch {
      setError('Failed to load documents. Please sign in again.');
      setPollingActive(false);
    }
  }, []);

  useEffect(() => {
    void fetchDocs();
    if (!pollingActive) return;
    const interval = setInterval(() => {
      void fetchDocs();
    }, 3000);
    return () => clearInterval(interval);
  }, [fetchDocs, pollingActive]);

  const handleDelete = async (documentId: string): Promise<void> => {
    try {
      await deleteDocument(documentId);
      setDocuments((d) => d.filter((doc) => doc.documentId !== documentId));
    } catch {
      setError('Failed to delete document. Please try again.');
    }
  };

  return (
    <div style={{ maxWidth: 800, margin: '2rem auto', padding: '0 1rem' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h1>My Documents</h1>
        <div>
          <Link to="/chat" style={{ marginRight: '1rem' }}>Chat</Link>
          <Link to="/history" style={{ marginRight: '1rem' }}>History</Link>
          <button onClick={() => void signOut()}>Sign Out</button>
        </div>
      </div>

      <UploadZone onUploadComplete={() => void fetchDocs()} />

      {error && <p role="alert" style={{ color: 'red' }}>{error}</p>}

      {documents.length === 0 ? (
        <p>No documents yet. Upload one above to get started.</p>
      ) : (
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr>
              {['Name', 'Size', 'Status', 'Uploaded', 'Actions'].map((h) => (
                <th key={h} style={{ textAlign: 'left', padding: '0.5rem', borderBottom: '1px solid #ddd' }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {documents.map((doc) => (
              <tr key={doc.documentId}>
                <td style={{ padding: '0.5rem' }}>{doc.documentName}</td>
                <td style={{ padding: '0.5rem' }}>{formatSize(doc.fileSize)}</td>
                <td style={{ padding: '0.5rem' }}>
                  <span style={{ color: doc.status === 'ready' ? 'green' : doc.status === 'failed' ? 'red' : 'orange' }}>
                    {doc.status}
                  </span>
                  {doc.status === 'failed' && (
                    <small style={{ display: 'block', color: 'red' }}>Processing failed — please retry upload</small>
                  )}
                </td>
                <td style={{ padding: '0.5rem' }}>{new Date(doc.createdAt).toLocaleDateString()}</td>
                <td style={{ padding: '0.5rem' }}>
                  <button
                    onClick={() => void handleDelete(doc.documentId)}
                    style={{ color: 'red', background: 'none', border: 'none', cursor: 'pointer' }}
                  >
                    Delete
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
