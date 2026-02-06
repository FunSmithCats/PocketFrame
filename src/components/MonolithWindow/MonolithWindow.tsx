import { TitleBar } from './TitleBar';
import type { ReactNode } from 'react';

interface MonolithWindowProps {
  children: ReactNode;
}

export function MonolithWindow({ children }: MonolithWindowProps) {
  return (
    <div className="h-screen flex flex-col bg-neutral-950 overflow-hidden">
      <TitleBar />
      <main className="flex-1 flex flex-row overflow-hidden">
        {children}
      </main>
    </div>
  );
}
