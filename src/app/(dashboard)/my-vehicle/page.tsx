'use client';

import { useSession } from '@/hooks/use-session';
import { VehicleRegisterPage } from '@/features/vehicle-register/vehicle-register';

export default function MyVehiclePage() {
  const { policy } = useSession();
  if (!policy) return null;
  return <VehicleRegisterPage policy={policy} />;
}
