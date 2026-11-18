import { Navigate, useLocation } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { useTileSettings } from '../hooks/useTileSettings.js'
import { appForPath } from '../config/apps.js'

// Signed-in staff only. Also enforces per-user app access: an app switched off
// for this user (Settings → Tile Access) is not just hidden from the dashboard,
// its URLs send them back there. /settings is never blocked — everyone needs
// their own profile page, and an admin must not be able to lock themselves out.
export default function ProtectedRoute({ children }) {
  const { user, loading } = useAuth()
  const { pathname } = useLocation()
  const { settings } = useTileSettings(user?.id)

  if (loading) return null
  if (!user) return <Navigate to="/login" replace />

  const app = appForPath(pathname)
  if (app && app.route !== '/settings') {
    if (settings === null) return null // access map still loading — never flash a blocked app
    if (settings[app.route] === false) return <Navigate to="/dashboard" replace />
  }
  return children
}
