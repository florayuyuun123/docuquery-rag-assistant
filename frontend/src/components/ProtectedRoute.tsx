import { Navigate, Outlet } from 'react-router-dom';
import { useAuthSession } from '../hooks/useAuthSession';

export function ProtectedRoute(): JSX.Element {
  const { isAuthenticated, isLoading } = useAuthSession();

  if (isLoading) {
    return <div style={{ padding: '2rem', textAlign: 'center' }}>Loading...</div>;
  }

  return isAuthenticated ? <Outlet /> : <Navigate to="/signin" replace />;
}
