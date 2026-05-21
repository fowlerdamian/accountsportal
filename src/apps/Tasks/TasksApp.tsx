import { Routes, Route, Navigate } from "react-router-dom";
import { TasksLayout } from "./components/TasksLayout";
import { TasksDashboard } from "./pages/TasksDashboard";
import { TasksKanban } from "./pages/TasksKanban";
import { TasksMatrix } from "./pages/TasksMatrix";

export default function TasksApp() {
  return (
    <TasksLayout>
      <Routes>
        <Route index element={<TasksDashboard />} />
        <Route path="kanban" element={<TasksKanban />} />
        <Route path="matrix" element={<TasksMatrix />} />
        <Route path="*"      element={<Navigate to="/tasks" replace />} />
      </Routes>
    </TasksLayout>
  );
}
