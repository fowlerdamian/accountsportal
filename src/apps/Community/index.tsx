// Community — one profile per customer, built from Shopify orders, Dialpad calls
// and the shared inbox. Mounted at /community/* inside the portal Layout.
import { Routes, Route, Navigate } from 'react-router-dom';
import { TooltipProvider } from '@/components/ui/tooltip';
import { Toaster } from '@/components/ui/toaster';
import ContactList from './pages/ContactList';
import ContactShow from './pages/ContactShow';

export default function Community() {
  return (
    <TooltipProvider>
      <div className="h-full overflow-y-auto">
        <Routes>
          <Route index element={<ContactList />} />
          <Route path="contacts" element={<Navigate to="/community" replace />} />
          <Route path="contacts/:id" element={<ContactShow mode="show" />} />
          <Route path="contacts/:id/edit" element={<ContactShow mode="edit" />} />
          <Route path="*" element={<Navigate to="/community" replace />} />
        </Routes>
      </div>
      <Toaster />
    </TooltipProvider>
  );
}
