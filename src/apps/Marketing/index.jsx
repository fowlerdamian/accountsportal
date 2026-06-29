import { Routes, Route } from "react-router-dom";
import Dashboard from "./pages/Dashboard";

export default function Marketing() {
  return (
    <div className="h-full overflow-y-auto">
      <Routes>
        <Route index element={<Dashboard />} />
      </Routes>
    </div>
  );
}
