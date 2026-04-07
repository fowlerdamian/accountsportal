import { Navigate } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';

interface Props {
  children: React.ReactNode;
  requirePortalAccess?: boolean;
}

export function ProtectedRoute({ children, requirePortalAccess }: Props) {
  const { session, isLoading, isWarehouse } = useAuth();

  if (isLoading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-sm text-muted-foreground">Loading...</div>
      </div>
    );
  }

  if (!session) {
    return <Navigate to="/login" replace />;
  }

  // Warehouse users can only access /warehouse
  if (requirePortalAccess && isWarehouse) {
    return <Navigate to="/warehouse" replace />;
  }

  return <>{children}</>;
}
