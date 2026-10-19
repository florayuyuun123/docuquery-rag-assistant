import axios from 'axios';
import { getAuthToken } from './authApi';
import type { ChatRecord } from '@docuquery/shared';

const API_URL = import.meta.env.VITE_API_URL as string;

export async function getChatHistory(): Promise<ChatRecord[]> {
  const token = await getAuthToken();
  const res = await axios.get(`${API_URL}/history`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  return (res.data.data ?? res.data.records ?? []) as ChatRecord[];
}
