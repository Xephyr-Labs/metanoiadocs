import { AnimatePresence, motion } from 'framer-motion';
import { AlertCircle, AtSign, Eye, EyeOff, Loader2, Lock, Mail, User } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { cn } from '../../lib/cn';
import { useAuth } from '../../store/auth';
import { Logo } from '../brand/Logo';

type Mode = 'login' | 'signup';

function Field({
  icon: Icon,
  ...props
}: { icon: typeof User } & React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <div className="flex h-10 items-center gap-2.5 rounded-lg bg-surface px-3 ring-1 ring-inset ring-line transition-shadow focus-within:bg-canvas focus-within:ring-2 focus-within:ring-accent">
      <Icon size={16} className="shrink-0 text-faint" />
      <input
        {...props}
        className="h-full flex-1 bg-transparent text-[14px] text-ink outline-none placeholder:text-faint"
      />
    </div>
  );
}

export function AuthScreen() {
  const { login, signup } = useAuth();
  const [mode, setMode] = useState<Mode>('login');
  const [name, setName] = useState('');
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPw, setShowPw] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setError(null);
    setBusy(true);
    const res =
      mode === 'login' ? await login(username, password) : await signup(name, username, email, password);
    setBusy(false);
    if (!res.ok) setError(res.error ?? 'Something went wrong.');
    // On success the app swaps to the workspace automatically (user is set).
  };

  const switchMode = (m: Mode) => {
    setMode(m);
    setError(null);
  };

  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-canvas px-5">
      {/* soft ambient wash — restrained, single-accent */}
      <div
        aria-hidden
        className="pointer-events-none absolute -top-40 left-1/2 h-[420px] w-[720px] -translate-x-1/2 rounded-full opacity-[0.14] blur-3xl"
        style={{ background: 'radial-gradient(closest-side, var(--accent), transparent)' }}
      />

      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.24, ease: [0.16, 1, 0.3, 1] }}
        className="relative w-full max-w-[380px]"
      >
        <div className="mb-7 flex flex-col items-center gap-4 text-center">
          <Logo size={40} />
          <div>
            <h1 className="text-[22px] font-semibold tracking-tight text-ink">
              {mode === 'login' ? 'Welcome back' : 'Create your account'}
            </h1>
            <p className="mt-1 text-[13.5px] text-muted">
              {mode === 'login'
                ? 'Sign in to your Metanoia workspace.'
                : 'Invite only — use the email you were invited with.'}
            </p>
          </div>
        </div>

        <form onSubmit={submit} className="space-y-2.5">
          <AnimatePresence initial={false}>
            {mode === 'signup' && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                exit={{ opacity: 0, height: 0 }}
                transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
                className="overflow-hidden"
              >
                <div className="space-y-2.5 pb-2.5">
                  <Field
                    icon={User}
                    placeholder="Full name"
                    autoComplete="name"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                  />
                  <Field
                    icon={Mail}
                    type="email"
                    placeholder="Email"
                    autoComplete="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                  />
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          <Field
            icon={AtSign}
            placeholder={mode === 'login' ? 'Username or email' : 'Username'}
            autoComplete="username"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
          />

          <div className="flex h-10 items-center gap-2.5 rounded-lg bg-surface px-3 ring-1 ring-inset ring-line transition-shadow focus-within:bg-canvas focus-within:ring-2 focus-within:ring-accent">
            <Lock size={16} className="shrink-0 text-faint" />
            <input
              type={showPw ? 'text' : 'password'}
              placeholder="Password"
              autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="h-full flex-1 bg-transparent text-[14px] text-ink outline-none placeholder:text-faint"
            />
            <button
              type="button"
              onClick={() => setShowPw((s) => !s)}
              className="text-faint transition-colors hover:text-muted"
              aria-label={showPw ? 'Hide password' : 'Show password'}
            >
              {showPw ? <EyeOff size={16} /> : <Eye size={16} />}
            </button>
          </div>

          <AnimatePresence>
            {error && (
              <motion.div
                initial={{ opacity: 0, y: -4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -4 }}
                className="flex items-center gap-2 rounded-md bg-danger/10 px-3 py-2 text-[13px] text-danger"
              >
                <AlertCircle size={15} className="shrink-0" />
                {error}
              </motion.div>
            )}
          </AnimatePresence>

          {mode === 'login' && (
            <div className="flex justify-end pt-0.5">
              <button type="button" className="text-[12.5px] text-muted transition-colors hover:text-ink">
                Forgot password?
              </button>
            </div>
          )}

          <button
            type="submit"
            disabled={busy}
            className={cn(
              'mt-1 flex h-10 w-full items-center justify-center gap-2 rounded-lg bg-accent text-[14px] font-medium text-white',
              'transition-[filter] duration-120 hover:brightness-[0.94] active:brightness-90 disabled:opacity-70',
            )}
          >
            {busy && <Loader2 size={16} className="animate-spin" />}
            {busy ? 'Please wait…' : mode === 'login' ? 'Sign in' : 'Create account'}
          </button>
        </form>

        <p className="mt-5 text-center text-[13px] text-muted">
          {mode === 'login' ? 'Have an invitation?' : 'Already have an account?'}{' '}
          <button
            type="button"
            onClick={() => switchMode(mode === 'login' ? 'signup' : 'login')}
            className="font-medium text-accent hover:underline"
          >
            {mode === 'login' ? 'Accept invite' : 'Sign in'}
          </button>
        </p>

        <p className="mt-8 text-center text-[11.5px] leading-relaxed text-faint">
          Access is invite-only. Passwords are hashed (bcrypt); sessions are server-side.
        </p>
      </motion.div>
    </div>
  );
}
