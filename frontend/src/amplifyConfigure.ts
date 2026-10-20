import { Amplify } from 'aws-amplify';

export function configureAmplify(): void {
  Amplify.configure({
    Auth: {
      Cognito: {
        userPoolId: import.meta.env.VITE_USER_POOL_ID as string,
        userPoolClientId: import.meta.env.VITE_USER_POOL_CLIENT_ID as string,
        // Identity Pool is NOT configured here. The backend API Gateway uses a
        // Cognito User Pool JWT authorizer, not IAM/SigV4 credentials. Including
        // identityPoolId causes Amplify v6 to call GetCredentialsForIdentity on
        // every fetchAuthSession(), which fails with 400 if the token/provider
        // mapping doesn't match. The S3 upload uses a presigned URL from the
        // backend, so no AWS credentials are needed client-side.
        loginWith: { email: true },
      },
    },
  });
}
