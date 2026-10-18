import Link from 'next/link';
export default function NotFound() { return <div className="card mx-auto max-w-md text-center"><h1 className="h1">404</h1><p className="muted my-3">Page not found.</p><Link className="btn-primary" href="/">Home</Link></div>; }
