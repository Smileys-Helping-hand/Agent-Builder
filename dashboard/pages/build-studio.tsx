import Link from 'next/link';
import BuildStudioPanel from '../components/BuildStudioPanel';

export default function BuildStudioPage() {
  return (
    <>
      <div className="mx-auto max-w-6xl px-6 pt-6">
        <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-200">
          This build pipeline doesn&apos;t yet verify its own output (no install/typecheck/test check
          before a build is called done).{' '}
          <Link href="/" className="font-semibold underline decoration-dotted underline-offset-2 hover:text-amber-100">
            Use Autonomous Build
          </Link>{' '}
          on the main dashboard for a build that installs, tests, and repairs itself.
        </div>
      </div>
      <BuildStudioPanel />
    </>
  );
}
