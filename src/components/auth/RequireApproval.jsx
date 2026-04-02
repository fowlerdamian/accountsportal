
import { Navigate, Outlet } from "react-router-dom";
import { useAuth } from "../../hooks/useAuth"; 

export const RequireApproval = () => {
  const { user, roleData, loading } = useAuth();
  if (loading) return <div className="min-h-screen bg-[#0A0A0A]" />;
  if (!user) return <Navigate to="/login" replace />;
  if (roleData && !roleData.is_approved) {
    return (
      <div className="flex h-screen items-center justify-center bg-[#0A0A0A] p-6 text-white text-center">
        <div>
          <h1 className="text-3xl font-bold uppercase mb-4">Access Pending</h1>
          <p className="text-gray-400">An admin must approve your account before you can enter.</p>
        </div>
      </div>
    );
  }
  return <Outlet />;
};