export function LoadingState({ message = 'Loading…' }: { message?: string }) {
  return (
    <div role="status" aria-live="polite" className="rounded-xl border border-hairline bg-panel p-6 text-center text-sm text-body">
      {message}
    </div>
  );
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div role="alert" className="rounded-md border border-red-900 bg-red-950/40 p-6 text-center">
      <p className="text-sm font-medium text-red-200">Something went wrong</p>
      <p className="mt-1 text-sm text-red-300/80">{message}</p>
      {onRetry && (
        <button
          type="button"
          onClick={onRetry}
          className="mt-3 rounded-md bg-red-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-red-800"
        >
          Retry
        </button>
      )}
    </div>
  );
}

export function EmptyState({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="rounded-xl border border-dashed border-hairline bg-panel/50 p-6 text-center">
      <p className="text-sm font-medium text-ink">{title}</p>
      {hint && <p className="mt-1 text-sm text-muted">{hint}</p>}
    </div>
  );
}
