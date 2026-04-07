import { useAuth } from '@/hooks/useAuth';
import { useNavigate } from 'react-router-dom';
import { useIsMobile } from '@/hooks/use-mobile';
import { Menu } from 'lucide-react';

interface AppHeaderProps {
  onMenuClick?: () => void;
}

export function AppHeader({ onMenuClick }: AppHeaderProps) {
  const { teamMember, signOut } = useAuth();
  const navigate = useNavigate();
  const isMobile = useIsMobile();

  return (
    <header
      className="flex items-center justify-between px-4 md:px-6"
      style={{
        flexShrink: 0,
        height: '48px',
        background: '#0c0c0e',
        borderBottom: '1px solid #1e1e22',
      }}
    >
      {/* Left: hamburger (mobile) or wordmark accent bar */}
      <div className="flex items-center gap-3">
        {isMobile ? (
          <>
            <button
              onClick={onMenuClick}
              style={{ color: '#666', background: 'none', border: 'none', cursor: 'pointer', padding: '6px', marginLeft: '-6px' }}
            >
              <Menu size={18} />
            </button>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <div style={{ width: '4px', height: '18px', borderRadius: '2px', background: '#E8A838' }} />
              <span style={{ fontSize: '12px', fontWeight: 600, letterSpacing: '0.12em', textTransform: 'uppercase', color: '#E5E5E5' }}>
                Support Hub
              </span>
            </div>
          </>
        ) : (
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <div style={{ width: '4px', height: '18px', borderRadius: '2px', background: '#E8A838' }} />
            <span style={{ fontSize: '12px', fontWeight: 600, letterSpacing: '0.12em', textTransform: 'uppercase', color: '#E5E5E5' }}>
              Support Hub
            </span>
          </div>
        )}
      </div>

      {/* Right: user identity + sign out */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
        {teamMember && (
          <>
            <button
              onClick={() => navigate('/support/settings/profile')}
              style={{
                fontSize: '11px',
                fontFamily: '"JetBrains Mono", monospace',
                color: '#555',
                background: 'none',
                border: 'none',
                cursor: 'pointer',
                padding: 0,
                maxWidth: '200px',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
              title="Profile settings"
            >
              {teamMember.name}
            </button>
            <div
              style={{
                height: '28px',
                width: '28px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: '11px',
                fontWeight: 600,
                color: '#0c0c0e',
                backgroundColor: teamMember.avatar_colour,
                borderRadius: '3px',
                cursor: 'pointer',
                flexShrink: 0,
              }}
              onClick={() => navigate('/support/settings/profile')}
            >
              {teamMember.name.split(' ').map((n: string) => n[0]).join('')}
            </div>
          </>
        )}
        {teamMember && (
          <button
            onClick={signOut}
            style={{
              fontSize: '11px',
              fontWeight: 500,
              letterSpacing: '0.08em',
              textTransform: 'uppercase',
              color: '#666',
              background: 'none',
              border: '1px solid #282828',
              borderRadius: '4px',
              padding: '4px 10px',
              cursor: 'pointer',
              transition: 'color 120ms, border-color 120ms',
              fontFamily: 'inherit',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.color = '#E8A838';
              e.currentTarget.style.borderColor = 'rgba(232,168,56,0.4)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.color = '#666';
              e.currentTarget.style.borderColor = '#282828';
            }}
          >
            Sign out
          </button>
        )}
      </div>
    </header>
  );
}
