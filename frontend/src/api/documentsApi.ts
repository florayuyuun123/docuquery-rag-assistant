import axios, { type AxiosResponse } from 'axios';

import { getAuthToken } from './authApi';

// On 401, the session is invalid — redirect to sign-in instead of polling forever
function handleApiError(err: unknown): never {
  const status = (err as { response?: { status?: number } }).response?.status;
  if (status === 401) {
    window.location.href = '/signin';
  }
  throw err;
}

const API_URL = (import.meta.env.VITE_API_URL as string).replace(/\/$/, '');

export interface DocumentSummary {
  documentId: string;
  documentName: string;
  fileSize: number;
  contentType: string;
  status: 'uploaded' | 'processing' | 'ready' | 'failed';
  createdAt: string;
  updatedAt: string;
}

export async function requestUploadUrl(
  fileName: string,
  contentType: string,
  fileSize: number,
): Promise<{ presignedUrl: string; documentId: string }> {
  const token = await getAuthToken();
  const res = await axios.post(
    `${API_URL}/documents/upload-url`,
    { fileName, contentType, fileSize },
    { headers: { Authorization: `Bearer ${token}` } },
  );
  return (res as AxiosResponse<{ data: { presignedUrl: string; documentId: string } }>).data.data;
}

export async function listDocuments(): Promise<DocumentSummary[]> {
  try {
    const token = await getAuthToken();
    const res = await axios.get(`${API_URL}/documents`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    return ((res as AxiosResponse<{ data: { documents?: DocumentSummary[] } }>).data.data?.documents ?? []);
  } catch (err) {
    handleApiError(err);
  }
}

export async function deleteDocument(documentId: string): Promise<void> {
  const token = await getAuthToken();
  await axios.delete(`${API_URL}/documents/${documentId}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
}

export async function patchDocumentStatus(documentId: string, status: string): Promise<void> {
  const token = await getAuthToken();
  await axios.patch(
    `${API_URL}/documents/${documentId}/status`,
    { status },
    { headers: { Authorization: `Bearer ${token}` } },
  );
}
