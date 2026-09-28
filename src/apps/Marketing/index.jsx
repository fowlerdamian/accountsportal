import { Routes, Route } from "react-router-dom";
import Dashboard from "./pages/Dashboard";
import ModelBuilder from "./pages/ModelBuilder";

export default function Marketing() {
  return (
    <div className="h-full overflow-y-auto">
      <Routes>
        <Route index element={<Dashboard />} />
        <Route path="3d" element={<ModelBuilder />} />
      </Routes>
    </div>
  );
}
