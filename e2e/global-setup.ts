/** Stop if another project's server is on our port: tests fill in forms and must never touch a different app. */
export default async function globalSetup() {
  const base = process.env.E2E_BASE_URL ?? 'http://localhost:5173';
  const html = await (await fetch(base)).text();
  const health = await (await fetch(`${base}/api/v1/health`)).json().catch(() => null);
  if (!html.includes('JustReference') || health?.ok !== true) throw new Error(`${base} is not a running JustReference site (web and API). Nothing was tested.`);
}
