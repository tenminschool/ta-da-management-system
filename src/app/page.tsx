import { redirect } from 'next/navigation';

export default async function RootPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;

  if (params.code || params.error) {
    return null;
  }

  redirect('/dashboard');
}
