import { Routes, Route, Navigate } from "react-router-dom";
import ChannelLayout from "./components/ChannelLayout";
import Dashboard from "./pages/Dashboard";
import LeadList from "./pages/LeadList";
import LeadCallCard from "./pages/LeadCallCard";
import CallList from "./pages/CallList";
import CallCard from "./pages/CallCard";
import Pipeline from "./pages/Pipeline";
import Reports from "./pages/Reports";

export default function SalesSupport() {
  return (
    <div className="h-full overflow-y-auto">
      <Routes>
        {/* Root → dashboard */}
        <Route index element={<Dashboard />} />

        {/* Channel sub-routes */}
        {["trailbait", "fleetcraft", "aga"].map((ch) => (
          <Route key={ch} path={ch} element={<ChannelLayout channel={ch} />}>
            <Route index element={<Navigate to="leads" replace />} />
            <Route path="leads" element={<LeadList />} />
            <Route path="leads/:leadId" element={<LeadCallCard />} />
            {/* Legacy call list routes kept for compatibility */}
            <Route path="calls" element={<Navigate to="../leads" replace />} />
            <Route path="calls/:callId" element={<CallCard />} />
            <Route path="pipeline" element={<Pipeline />} />
            <Route path="reports" element={<Reports />} />
          </Route>
        ))}
      </Routes>
    </div>
  );
}
