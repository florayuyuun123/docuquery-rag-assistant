import { fetchAuthSession } from 'aws-amplify/auth';

export async function getAuthToken(): Promise<string> {
  // forceRefresh: true ensures expired access tokens are refreshed from the
  // refresh token before being returned. Without this, a stale token from
  // a previous Amplify config can cause 401s on every API call.
  const session = await fetchAuthSession({ forceRefresh: true });
  const token = session.tokens?.accessToken?.toString();
  if (!token) throw new Error('No auth token available');
  return token;
}
