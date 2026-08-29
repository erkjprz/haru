// Answers with whatever build is actually running on the server right now, so
// ServiceWorkerRegister can compare it against the build id baked into its own already-loaded
// JS bundle and reload once a real deploy has happened. The installed PWA can sit backgrounded
// across a deploy with no navigation to trigger Next's own client-side update check, so this is
// read at request time rather than baked into a cacheable static file.
//
// Reads NEXT_PUBLIC_BUILD_ID (the exact same value next.config.ts computed and baked into the
// client bundle for this build) rather than recomputing VERCEL_GIT_COMMIT_SHA's fallback
// independently -- those two fallbacks would otherwise diverge whenever it's unset (client
// bundle: Date.now() at config-load time; this route: a separately-evaluated Date.now()), and
// the two could never match, turning every visibility/pageshow check into a false "update".
export const dynamic = "force-dynamic";

export async function GET() {
  const buildId = process.env.NEXT_PUBLIC_BUILD_ID ?? "dev";
  return Response.json({ buildId }, { headers: { "Cache-Control": "no-store" } });
}
