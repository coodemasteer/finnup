/**
 * Server-side proxy for FastAPI Swagger UI docs.
 * Runs inside the container → can reach http://127.0.0.1:8080 directly.
 * Bypasses the Next.js rewrite proxy which does not forward HTML doc pages.
 */
export const dynamic = 'force-dynamic'

const FASTAPI = 'http://127.0.0.1:8080'

export async function GET() {
  try {
    const res = await fetch(`${FASTAPI}/api/docs`, {
      headers: { Accept: 'text/html' },
    })
    const html = await res.text()
    return new Response(html, {
      status: res.status,
      headers: { 'Content-Type': 'text/html; charset=utf-8' },
    })
  } catch {
    return new Response('<h1>FastAPI docs unavailable</h1><p>The backend may still be starting up. Refresh in a few seconds.</p>', {
      status: 503,
      headers: { 'Content-Type': 'text/html; charset=utf-8' },
    })
  }
}
