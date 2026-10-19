import { useState, useRef, DragEvent, ChangeEvent } from 'react';
import { requestUploadUrl, patchDocumentStatus } from '../api/documentsApi';

const SUPPORTED_TYPES = [
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'text/plain',
];
const MAX_SIZE = 20_971_520;

interface Props {
  onUploadComplete: (documentId: string) => void;
}

export function UploadZone({ onUploadComplete }: Props): JSX.Element {
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  const uploadFile = async (file: File): Promise<void> => {
    setError('');
    if (!SUPPORTED_TYPES.includes(file.type)) {
      setError('Unsupported file type. Please upload a PDF, DOCX, or TXT file.');
      return;
    }
    if (file.size > MAX_SIZE) {
      setError('File exceeds the 20 MB limit.');
      return;
    }

    setProgress(0);
    let documentId = '';
    try {
      const { presignedUrl, documentId: id } = await requestUploadUrl(file.name, file.type, file.size);
      documentId = id;

      await new Promise<void>((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.upload.onprogress = (e) => {
          if (e.lengthComputable) setProgress(Math.round((e.loaded / e.total) * 100));
        };
        xhr.onload = () =>
          xhr.status >= 200 && xhr.status < 300
            ? resolve()
            : reject(new Error(`Upload failed: ${xhr.status}`));
        xhr.onerror = () => reject(new Error('Network error during upload'));
        xhr.open('PUT', presignedUrl);
        xhr.setRequestHeader('Content-Type', file.type);
        xhr.send(file);
      });

      setProgress(null);
      onUploadComplete(documentId);
    } catch (err) {
      setProgress(null);
      setError((err as Error).message ?? 'Upload failed. Please try again.');
      if (documentId) await patchDocumentStatus(documentId, 'failed').catch(() => undefined);
    }
  };

  const handleDrop = (e: DragEvent): void => {
    e.preventDefault();
    const file = e.dataTransfer.files[0];
    if (file) void uploadFile(file);
  };

  const handleChange = (e: ChangeEvent<HTMLInputElement>): void => {
    const file = e.target.files?.[0];
    if (file) void uploadFile(file);
  };

  return (
    <div
      onDrop={handleDrop}
      onDragOver={(e) => e.preventDefault()}
      onClick={() => inputRef.current?.click()}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') inputRef.current?.click(); }}
      style={{
        border: '2px dashed #aaa',
        borderRadius: 8,
        padding: '2rem',
        textAlign: 'center',
        cursor: 'pointer',
        marginBottom: '1rem',
      }}
      role="button"
      tabIndex={0}
      aria-label="Upload document"
    >
      <input
        ref={inputRef}
        type="file"
        accept=".pdf,.docx,.txt"
        onChange={handleChange}
        style={{ display: 'none' }}
      />
      {progress !== null ? (
        <div>
          <progress value={progress} max={100} style={{ width: '100%' }} />
          <p>{progress}% uploaded</p>
        </div>
      ) : (
        <p>Drop a PDF, DOCX, or TXT file here, or click to browse (max 20 MB)</p>
      )}
      {error && <p role="alert" style={{ color: 'red' }}>{error}</p>}
    </div>
  );
}
