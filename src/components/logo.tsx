import Image from 'next/image';
import { cn } from '@/lib/utils';

interface LogoProps {
  variant?: 'default' | 'inverse';
  iconSize?: number;
  className?: string;
}

export function Logo({ iconSize = 32, className }: LogoProps) {
  return (
    <Image
      src="/logo.png"
      alt="10 Minute School"
      width={iconSize}
      height={iconSize}
      className={cn('shrink-0 rounded-lg object-contain', className)}
    />
  );
}
