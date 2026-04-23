import { signIn } from '@/auth';

export default function SignInPage() {
  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      minHeight: '100vh',
      backgroundColor: 'var(--bg)',
      color: 'var(--text-primary)',
      fontFamily: 'var(--font-geist-sans)',
    }}>
      <div style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: '2rem',
        padding: '3rem',
        backgroundColor: 'var(--surface)',
        borderRadius: '12px',
        border: '1px solid var(--border)',
      }}>
        <h1 style={{
          fontSize: '2rem',
          fontWeight: 700,
          color: 'var(--marquee-gold)',
          letterSpacing: '-0.02em',
        }}>
          Showbook
        </h1>
        <p style={{
          color: 'var(--text-secondary)',
          fontFamily: 'var(--font-geist-mono)',
          fontSize: '0.875rem',
        }}>
          Track your live show experiences
        </p>
        <form action={async () => {
          'use server';
          await signIn('google', { redirectTo: '/home' });
        }}>
          <button
            type="submit"
            style={{
              padding: '0.75rem 2rem',
              backgroundColor: 'var(--marquee-gold)',
              color: '#0C0C0C',
              border: 'none',
              borderRadius: '8px',
              fontSize: '0.875rem',
              fontWeight: 600,
              fontFamily: 'var(--font-geist-mono)',
              cursor: 'pointer',
              letterSpacing: '0.02em',
            }}
          >
            Sign in with Google
          </button>
        </form>
      </div>
    </div>
  );
}
