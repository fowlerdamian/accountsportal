import { Routes, Route, Navigate } from "react-router-dom";
import { TasksLayout } from "./components/TasksLayout";
import { TasksDashboard } from "./pages/TasksDashboard";
import { TasksReporting } from "./pages/TasksReporting";

// Kanban + Matrix are now view modes inside TasksDashboard (mirrors the
// ProjectsList grid/kanban pattern). Old /tasks/kanban + /tasks/matrix URLs
// redirect to the dashboard for backwards-compat.

export default function TasksApp() {
  return (
    <TasksLayout>
      <Routes>
        <Route index element={<TasksDashboard />} />
        <Route path="reporting" element={<TasksReporting />} />
        <Route path="kanban" element={<Navigate to="/tasks" replace />} />
        <Route path="matrix" element={<Navigate to="/tasks" replace />} />
        <Route path="*"      element={<Navigate to="/tasks" replace />} />
      </Routes>
    </TasksLayout>
  );
}
