'use client';
export default function Error({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <div role="alert" className="card mx-auto max-w-md"><h1 className="h2">Something went wrong</h1><p className="muted my-2">{error.digest ? `Reference: ${error.digest}` : error.message}</p><button className="btn-primary" onClick={reset}>Retry</button></div>;
}
