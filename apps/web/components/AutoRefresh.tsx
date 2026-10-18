'use client';
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
/** Simple polling (v1). Can be replaced by WebSocket/SSE later. */
export function AutoRefresh({ seconds }: { seconds: number }) {
  const router = useRouter();
  useEffect(() => { const t = setInterval(() => router.refresh(), seconds * 1000); return () => clearInterval(t); }, [router, seconds]);
  return null;
}
