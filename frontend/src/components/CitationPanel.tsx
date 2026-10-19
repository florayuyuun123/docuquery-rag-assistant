import { useState } from 'react';
import type { Citation } from '@docuquery/shared';

interface Props { citations: Citation[]; }

export function CitationPanel({ citations }: Props): JSX.Element | null {
  const [expanded, setExpanded] = useState<number | null>(null);

  if (!citations.length) return null;

  return (
    <div style={{ marginTop: '1rem', borderTop: '1px solid #eee', paddingTop: '1rem' }}>
      <h4 style={{ marginBottom: '0.5rem' }}>Sources</h4>
      <ol>
        {citations.map((c, i) => (
          <li key={i} style={{ marginBottom: '0.5rem' }}>
            <button
              onClick={() => setExpanded(expanded === i ? null : i)}
              style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#0066cc', textDecoration: 'underline', padding: 0 }}
              aria-expanded={expanded === i}
            >
              {c.documentName} — {c.pageNumber != null ? `Page ${c.pageNumber}` : 'Page N/A'}
            </button>
            {expanded === i && (
              <blockquote style={{ marginTop: '0.5rem', padding: '0.75rem', background: '#f5f5f5', borderLeft: '3px solid #0066cc', fontSize: '0.9rem' }}>
                {c.chunkText}
              </blockquote>
            )}
          </li>
        ))}
      </ol>
    </div>
  );
}
