import '@fontsource-variable/inter'; // self-hosted Inter — no Google Fonts CDN
import { createRoot } from 'react-dom/client';
import App from './App';
import { AuthScreen } from './components/auth/AuthScreen';
import { PublicView } from './components/public/PublicView';
import { AuthProvider, useAuth } from './store/auth';
import { WorkspaceProvider } from './store/workspace';
import './index.css';

// Apply the saved "smaller text" preference before first paint (no flash).
if (localStorage.getItem('mn-text-size') === 'small') {
  document.documentElement.dataset.textSize = 'small';
}

// Auth gate: no session -> login/signup; otherwise the workspace. WorkspaceProvider
// mounts only when authenticated so per-user state starts fresh on login.
function Root() {
  const { user, loading } = useAuth();
  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-canvas">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-line border-t-accent" />
      </div>
    );
  }
  if (!user) return <AuthScreen />;
  return (
    <WorkspaceProvider>
      <App />
    </WorkspaceProvider>
  );
}

// No StrictMode: its intentional double-invoke of effects races BlockSuite's
// async web-component mount and can tear down the editor before it settles.
const shareMatch = location.pathname.match(/^\/share\/(.+)$/);
createRoot(document.getElementById('root')!).render(
  shareMatch ? (
    <PublicView token={decodeURIComponent(shareMatch[1])} />
  ) : (
    <AuthProvider>
      <Root />
    </AuthProvider>
  ),
);
