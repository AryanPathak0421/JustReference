import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';

export interface PublicStatus {
  siteName: string;
  support: { email: string | null; phone: string | null; address: string | null };
  social: Partial<Record<'facebook' | 'instagram' | 'linkedin' | 'youtube' | 'twitter', string>>;
  maintenance: { enabled: boolean; message: string };
}

/** Site name, support contacts and maintenance flag. Polled so a maintenance switch reaches open tabs. */
export const usePublicStatus = () =>
  useQuery({ queryKey: ['public-status'], queryFn: () => api.get<PublicStatus>('/public/status'), staleTime: 30_000, refetchInterval: 60_000 });
