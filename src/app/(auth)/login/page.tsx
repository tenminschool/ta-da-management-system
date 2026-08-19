import type { Metadata } from 'next';
import { Logo } from '@/components/logo';
import { LoginWithTenMS } from './components/login-with-tenms';
import { APP_NAME } from '@/constants';

export const metadata: Metadata = {
  title: `Sign in — ${APP_NAME}`,
};

export default function LoginPage() {
  return (
    <div className="space-y-8">
      <div className="flex items-center gap-2.5 lg:hidden">
        <Logo className="h-9 w-9" iconSize={18} />
        <span className="text-base font-semibold tracking-tight">
          {APP_NAME}
        </span>
      </div>

      <div className="space-y-2">
        <h1 className="text-2xl font-semibold tracking-tight">
          Sign in to your account
        </h1>
        <p className="text-sm text-muted-foreground">
          Welcome back. Continue with your 10 Minute School admin account.
        </p>
      </div>

      <LoginWithTenMS />
    </div>
  );
}
