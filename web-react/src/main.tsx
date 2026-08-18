import '@fontsource-variable/inter'; // self-hosted Inter — no Google Fonts CDN
import '@fontsource-variable/fraunces'; // display serif for document titles/headings
import '@fontsource-variable/geist'; // UI face for the chrome (sidebar, bars, menus)
import { createRoot } from 'react-dom/client';
import App from './App';
import { AuthScreen } from './components/auth/AuthScreen';
import { PublicView } from './components/public/PublicView';
import { AuthProvider, useAuth } from './store/auth';
import { WorkspaceProvider } from './store/workspace';
import './index.css';

// A deploy replaces every content-hashed chunk, so a tab left open across one
// asks for files that no longer exist and the lazily-loaded editor never
// arrives — the shell renders and the document body stays empty. Vite reports
// that as `vite:preloadError`; the fix is simply to be the new build, and the
// session flag is what stops a genuinely broken chunk from reloading forever.
window.addEventListener('vite:preloadError', (event) => {
  event.preventDefault();
  // Rate-limited rather than once-per-session: a chunk that is broken in the
  // new build would otherwise reload forever, while a second deploy an hour
  // later still has to be able to heal the same tab.
  const last = Number(sessionStorage.getItem('mn-build-reload') || 0);
  if (Date.now() - last < 60_000) return;
  sessionStorage.setItem('mn-build-reload', String(Date.now()));
  location.reload();
});

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
