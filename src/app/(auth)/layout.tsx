import { BrandPanel } from './components/brand-panel';

export default function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="grid min-h-screen bg-background lg:grid-cols-[1.1fr_1fr]">
      <BrandPanel />
      <main className="relative flex flex-col px-6 py-10 sm:px-12 lg:px-16">
        <div className="flex flex-1 items-center justify-center">
          <div className="w-full max-w-sm">{children}</div>
        </div>
        <p className="text-center text-xs text-muted-foreground lg:hidden">
          © {new Date().getFullYear()} · 10 Minute School
        </p>
      </main>
    </div>
  );
}
