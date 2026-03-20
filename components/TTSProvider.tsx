'use client';

import dynamic from 'next/dynamic';

// Dynamic import with SSR disabled for the TTS component
const TTSProviderInner = dynamic(
  () => import('./TTSProviderInner').then((mod) => mod.TTSProviderInner),
  { ssr: false, loading: () => <div style={{ display: 'none' }} /> }
);

interface TTSProviderProps {
  children: React.ReactNode;
}

export default function TTSProvider({ children }: TTSProviderProps) {
  return <TTSProviderInner>{children}</TTSProviderInner>;
}