/**
 * Install-page copy assist (ADR 0059 + dual-track CTAs).
 *
 * Whitelist-only: this file may be referenced as
 *   <script src="/scripts/install-copy.js" defer></script>
 * and must never decide installability, fetch, navigate, or rewrite the page.
 * It only copies text the page already printed (inline data-copy-text or a DOM id).
 */
;(() => {
  function textFrom(id) {
    const el = document.getElementById(id)
    if (!el) return ""
    const code = el.tagName === "CODE" ? el : el.querySelector("code")
    return ((code || el).textContent || "").trim()
  }

  async function copyText(text) {
    if (!text) return false
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(text)
        return true
      }
    } catch {
      /* fall through */
    }
    try {
      const ta = document.createElement("textarea")
      ta.value = text
      ta.setAttribute("readonly", "")
      ta.style.position = "fixed"
      ta.style.left = "-9999px"
      document.body.appendChild(ta)
      ta.select()
      const ok = document.execCommand("copy")
      document.body.removeChild(ta)
      return ok
    } catch {
      return false
    }
  }

  function onClick(ev) {
    const btn = ev.target && ev.target.closest ? ev.target.closest(".install-copy") : null
    if (!btn) return
    const inline = btn.getAttribute("data-copy-text")
    const id = btn.getAttribute("data-copy-from")
    const text = (inline && inline.trim()) || (id ? textFrom(id) : "")
    if (!text) return
    const restore =
      btn.getAttribute("data-copy-label") ||
      btn.getAttribute("aria-label") ||
      btn.textContent ||
      "Copy"
    const done = btn.getAttribute("data-copy-done") || "Copied"
    copyText(text).then((ok) => {
      btn.textContent = ok ? done : "Copy failed"
      window.setTimeout(() => {
        btn.textContent = restore
      }, 2200)
    })
  }

  document.addEventListener("click", onClick)
})()
