import { fetchAuthSession } from 'aws-amplify/auth';

export async function getAuthToken(): Promise<string> {
  // Amplify automatically refreshes the access token when it expires using
  // the refresh token — no forceRefresh needed. Using forceRefresh: true
  // causes a Cognito network call on every API request (including polling),
  // which adds latency and can cause 401s with stale sessions.
  const session = await fetchAuthSession();
  const token = session.tokens?.accessToken?.toString();
  if (!token) throw new Error('No auth token available');
  return token;
}
