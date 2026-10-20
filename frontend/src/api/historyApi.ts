import type { ChatRecord } from '@docuquery/shared';
import axios, { type AxiosResponse } from 'axios';

import { getAuthToken } from './authApi';

const API_URL = (import.meta.env.VITE_API_URL as string).replace(/\/$/, '');

export async function getChatHistory(): Promise<ChatRecord[]> {
  const token = await getAuthToken();
  const res = await axios.get(`${API_URL}/history`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const body = (res as AxiosResponse<{ data?: ChatRecord[]; records?: ChatRecord[] }>).data;
  return (body.data ?? body.records ?? []);
}
