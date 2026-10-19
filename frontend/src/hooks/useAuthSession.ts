import { getCurrentUser, signOut as amplifySignOut } from 'aws-amplify/auth';
import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';

interface AuthSession {
  isAuthenticated: boolean;
  isLoading: boolean;
  userId: string | null;
  signOut: () => Promise<void>;
}

export function useAuthSession(): AuthSession {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [userId, setUserId] = useState<string | null>(null);
  const navigate = useNavigate();

  useEffect(() => {
    getCurrentUser()
      .then((user) => {
        setIsAuthenticated(true);
        setUserId(user.userId);
      })
      .catch(() => {
        setIsAuthenticated(false);
        setUserId(null);
      })
      .finally(() => setIsLoading(false));
  }, []);

  const signOut = async (): Promise<void> => {
    await amplifySignOut();
    setIsAuthenticated(false);
    setUserId(null);
    navigate('/signin', { replace: true });
  };

  return { isAuthenticated, isLoading, userId, signOut };
}
