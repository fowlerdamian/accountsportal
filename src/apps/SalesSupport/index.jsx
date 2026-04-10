import { Routes, Route, Navigate } from "react-router-dom";
import ChannelLayout from "./components/ChannelLayout";
import Dashboard from "./pages/Dashboard";
import LeadList from "./pages/LeadList";
import CallList from "./pages/CallList";
import CallCard from "./pages/CallCard";
import Pipeline from "./pages/Pipeline";
import Reports from "./pages/Reports";

export default function SalesSupport() {
  return (
    <Routes>
      {/* Root → dashboard */}
      <Route index element={<Dashboard />} />

      {/* Channel sub-routes */}
      {["trailbait", "fleetcraft", "aga"].map((ch) => (
        <Route key={ch} path={ch} element={<ChannelLayout channel={ch} />}>
          <Route index element={<Navigate to="leads" replace />} />
          <Route path="leads" element={<LeadList />} />
          <Route path="calls" element={<CallList />} />
          <Route path="calls/:callId" element={<CallCard />} />
          <Route path="pipeline" element={<Pipeline />} />
          <Route path="reports" element={<Reports />} />
        </Route>
      ))}
    </Routes>
  );
}
