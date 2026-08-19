'use client';

import { useSession } from '@/hooks/use-session';
import { VehicleRegistrationsPage } from '@/features/vehicle-registrations/vehicle-registrations';

export default function DeskVehiclesPage() {
  const { policy } = useSession();
  if (!policy) return null;
  return <VehicleRegistrationsPage policy={policy} />;
}
