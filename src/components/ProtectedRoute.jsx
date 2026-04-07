import { Navigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'

function LoadingScreen() {
  return (
    <div
      className="min-h-screen flex items-center justify-center"
      style={{ background: '#080808' }}
    >
      <div
        className="w-7 h-7 rounded-full border-2 animate-spin"
        style={{ borderColor: '#E8A838', borderTopColor: 'transparent' }}
      />
    </div>
  )
}

export default function ProtectedRoute({ children }) {
  const { user, loading } = useAuth()

  // TODO: re-enable auth wall
  // if (loading) return <LoadingScreen />
  // if (!user)   return <Navigate to="/login" replace />
  return children
}
