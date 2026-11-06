import { fetchAuthSession } from 'aws-amplify/auth';

export async function getAuthToken(): Promise<string> {
  const session = await fetchAuthSession();
  // API Gateway Cognito authorizer validates the ID token, not the access token.
  // Amplify v6 exposes tokens as JWT objects — use idToken which has the correct
  // audience (aud) claim matching the User Pool App Client ID.
  const token = session.tokens?.idToken?.toString();
  if (!token) throw new Error('No auth token available');
  return token;
}
