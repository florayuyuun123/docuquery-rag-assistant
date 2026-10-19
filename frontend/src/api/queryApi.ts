import type { Citation } from '@docuquery/shared';
import axios, { type AxiosResponse } from 'axios';

import { getAuthToken } from './authApi';

const API_URL = import.meta.env.VITE_API_URL as string;

export interface QueryResponse {
  answer: string;
  citations: Citation[];
  sessionId: string;
  isFallback: boolean;
}

export async function sendQuery(question: string, sessionId?: string): Promise<QueryResponse> {
  const token = await getAuthToken();
  const res = await axios.post(
    `${API_URL}/query`,
    { question, sessionId },
    { headers: { Authorization: `Bearer ${token}` } },
  );
  return (res as AxiosResponse<{ data: QueryResponse }>).data.data;
}
