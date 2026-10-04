import { useQuery } from '@tanstack/react-query';
import { profile } from './mockDb';
export function useAuth() {
  const { data } = useQuery({ queryKey: ['profile',profile.id], queryFn: async () => ({ ...profile }) });
  return { profile: data };
}
