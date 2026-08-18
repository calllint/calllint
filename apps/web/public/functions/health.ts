// Simple health check - no D1, no dependencies
export const onRequestGet = () => {
  return new Response(JSON.stringify({ status: "ok", timestamp: Date.now() }), {
    headers: { "Content-Type": "application/json" }
  })
}
