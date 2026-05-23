import { type ReactNode } from 'react';

interface EmptyStateProps {
  emoji?: string;
  title: string;
  subtitle?: string;
  action?: ReactNode;
}

export default function EmptyState({ emoji = '📭', title, subtitle, action }: EmptyStateProps) {
  return (
    <div className="py-16 text-center">
      <div className="text-5xl mb-4">{emoji}</div>
      <h3 className="text-secondary font-bold text-lg mb-2">{title}</h3>
      {subtitle && <p className="text-muted text-sm mb-5 max-w-xs mx-auto leading-relaxed">{subtitle}</p>}
      {action && <div className="flex justify-center">{action}</div>}
    </div>
  );
}
