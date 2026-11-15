import { lazy, Suspense } from 'react';

const Workspace2 = lazy(() => import('./workspace2/Workspace2'));

/** The Studio: the workspace is the whole app, so there is nothing to choose between. */
export default function App() {
  return <Suspense fallback={<div className="loading-card" role="status">Loading…</div>}><Workspace2 active/></Suspense>;
}
