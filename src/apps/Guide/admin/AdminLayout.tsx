import { SidebarProvider, SidebarTrigger } from "@guide/components/ui/sidebar";
import { AdminSidebar } from "./AdminSidebar";
import { Outlet, Navigate } from "react-router-dom";
import { useAuth } from "@guide/contexts/AuthContext";
import { Loader2 } from "lucide-react";

export function AdminLayout() {
  const { user, userRole, loading } = useAuth();

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-muted/30">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!user) return <Navigate to="/login" replace />;

  // Only staff with an admin or editor role may enter the Guide admin area.
  if (userRole !== "admin" && userRole !== "editor") {
    return (
      <div className="min-h-screen flex items-center justify-center bg-muted/30">
        <div className="text-center space-y-2">
          <h1 className="text-lg font-semibold">Access denied</h1>
          <p className="text-sm text-muted-foreground">You don't have permission to access the Guide admin area. Contact an admin to be granted a role.</p>
        </div>
      </div>
    );
  }

  const initials = user?.user_metadata?.full_name
    ? user.user_metadata.full_name.split(" ").map((n: string) => n[0]).join("").toUpperCase()
    : user?.email?.substring(0, 2).toUpperCase() ?? "??";

  return (
    <SidebarProvider>
      <div className="flex w-full" style={{ minHeight: "calc(100dvh - var(--task-dock-h, 0px))" }}>
        <AdminSidebar />
        <div className="flex-1 flex flex-col min-w-0">
          <header className="h-14 flex items-center border-b bg-card px-3 sm:px-4 shrink-0">
            <SidebarTrigger className="mr-2 sm:mr-4" />
            <div className="flex-1" />
            <div className="flex items-center gap-2 sm:gap-3">
              <span className="text-sm text-muted-foreground hidden sm:inline">{user?.email}</span>
              <div className="w-8 h-8 rounded-full bg-primary flex items-center justify-center text-primary-foreground text-sm font-semibold">
                {initials}
              </div>
            </div>
          </header>
          <main className="flex-1 overflow-auto p-3 sm:p-6 bg-background">
            <Outlet />
          </main>
        </div>
      </div>
    </SidebarProvider>
  );
}
