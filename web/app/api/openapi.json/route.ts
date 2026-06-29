/**
 * Server-side proxy for FastAPI OpenAPI schema (openapi.json).
 * Swagger UI fetches this from the browser — it must be reachable at the
 * public URL. This handler fetches it server-side from the internal FastAPI
 * port and returns it to the browser.
 */
export const dynamic = 'force-dynamic'

const FASTAPI = 'http://127.0.0.1:8080'

export async function GET() {
  try {
    const res = await fetch(`${FASTAPI}/api/openapi.json`, {
      headers: { Accept: 'application/json' },
    })
    const schema = await res.text()
    return new Response(schema, {
      status: res.status,
      headers: { 'Content-Type': 'application/json' },
    })
  } catch {
    return new Response(JSON.stringify({ error: 'FastAPI schema unavailable' }), {
      status: 503,
      headers: { 'Content-Type': 'application/json' },
    })
  }
}
