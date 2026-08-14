# Gate 2.4-B — five-second panel runbook

**Who this is for.** The human operator running the sessions. Gate 2.4-B is the one gate
an agent cannot close: its threshold is "≥90% of **humans** name the target / consequence /
action within five seconds", and no code can produce that number honestly. `scripts/phase-2.4-panel.ts`
therefore measures nothing — it administers the session and transcribes what you type.
ADR 0053 §4 is the boundary: code never writes a response, and `--record` refuses without a
TTY so no CI run or agent can manufacture a panel.

**Where the gate stands right now** (measured 2026-08-14, after the ADR 0079 reseat):

```
pnpm eval:phase-2.4:panel:validate
  → panel store OK — 10 response(s), schema calllint.five-second-panel.v0
      fresh: 7 · stale: 3 (stale responses do not count toward Gate 2.4-B)
      - 7 @ mcp-registry/ac.tandem-docs-mcp — PAGE NO LONGER SERVED
      - 8 @ mcp-registry/ac.inference.sh-mcp — PAGE NO LONGER SERVED
      - 10 @ mcp-registry/io.github.calllint-calllint — PAGE NO LONGER SERVED
```

So the panel needs **three more participants**, not ten. The structural precondition is
already 100% and the three recognition rates are already 100% on the seven fresh responses
— but 7 < `minPanelResponses` 10, so the gate reports `PENDING_HUMAN_PANEL`, which is the
honest answer and not a failure.

---

## Before you start

```bash
export PATH="/c/nvm4w/nodejs:$PATH"    # this machine's default node is v16, too old
pnpm eval:phase-2.4:panel              # prints how far the panel is from the floor
```

which today prints:

```
participants: 7 (need ≥ 10)
responses:    7
stale:        3 response(s) do not count:
  7 @ mcp-registry/ac.tandem-docs-mcp — PAGE_GONE: PAGE REMOVED
  8 @ mcp-registry/ac.inference.sh-mcp — PAGE_GONE: PAGE REMOVED
  10 @ mcp-registry/io.github.calllint-calllint — PAGE_GONE: PAGE REMOVED
  target       100.0% (need ≥ 90%)
  consequence  100.0% (need ≥ 90%)
  action       100.0% (need ≥ 90%)
→ PENDING_HUMAN_PANEL: 3 more participants needed before the 90% claim can be made at all.
```

**Pick a slug that is not already recorded.** A participant may not be recorded twice for
the same page (`validate` rejects the duplicate), and each session needs a *fresh*
participant. Any served page works:

```bash
ls apps/web/public/install/mcp-registry | head
```

Already used: `ai.agenticshelf-mcp` · `ai.agentic-news-mcp` · `ai.adadvisor-mcp-server` ·
`ai.1325-mcp` · `agency.lona-trading` · `ag.hood-name-service` · `ai.adeu-adeu` (and three
pages that no longer exist).

**Recruit three people who have not seen these pages.** Anyone who has watched a previous
session already knows the answers, and their recognition is not evidence.

---

## Running one session

```bash
pnpm eval:phase-2.4:panel:record mcp-registry/ai.aarna-atars-mcp
```

The script will:

1. **Serve the committed tree** on an ephemeral loopback port. This matters: since PR P-4b
   the page carries `<link rel="stylesheet" href="/styles/tokens.css">`, a *rooted*
   reference. Opened as a `file://` path it 404s and the page renders with no visual
   hierarchy at all — recognition measured against that artifact is not evidence about the
   shipped page. Do not open the HTML file directly; use the URL the script prints.
2. **Preflight** — it verifies the served bytes match the committed page and that every
   stylesheet actually resolves, then refuses to record if not. It also prints the three
   answers extracted from *that* page as your grading key.
3. **Ask for a participant id.** Use initials or a pseudonym — never a real name.
4. **Print the protocol and wait.** You run the actual test here.
5. **Ask you to grade each of the three questions** `y`/`n`. It re-asks on anything else;
   nothing is defaulted, because this is the measurement.
6. **Append and re-validate** the store, then print the updated status.

### The protocol you administer

1. Open the printed URL, with the page not yet visible to the participant.
2. Show it for **five seconds**, then hide it.
3. Ask, in this order, and only after hiding the page:
   - "What would be installed?"
   - "What is the most important thing it would be able to do?"
   - "What would you do next?"
4. Grade against the key the script printed. **Accept paraphrase. Reject a right guess the
   page does not support** — a participant who says "probably needs an API key" without the
   page saying so has not recognized anything.

Do not read the page aloud, do not scroll, and do not answer follow-up questions before all
three have been asked. Each of those leaks an answer into a later question.

### If something goes wrong

- **`refusing to record without an interactive terminal`** — you piped the command or ran it
  from a non-TTY. Run it directly in a terminal. This refusal is deliberate.
- **`refusing to record — … did not resolve` / `served bytes differ from the committed page`**
  — the preflight caught an artifact that is not what a user sees. Do not work around it; the
  session would not be evidence.
- **`already has a recorded session for …`** — that participant/page pair exists. Use a
  different page or a different participant.
- **A session you want to discard** — nothing is written until you have graded all three, so
  Ctrl-C before that point records nothing. After it is written, remove the response by hand
  and say why in the commit message; do not re-grade it.

### Running the three back-to-back

`--record` starts and stops its own server each time. If you would rather keep one origin up for
all three participants, run this in a second terminal first:

```bash
pnpm eval:phase-2.4:panel -- --serve      # prints the origin, Ctrl-C to stop
pnpm eval:phase-2.4:panel:record <slug> --base http://127.0.0.1:<port>
```

`--base` also accepts `https://calllint.com`, which shows the participant the deployed page and
proves the deploy still matches the committed bytes — the preflight compares them, so a drifted
deploy refuses the session rather than recording it.

---

## After the sessions

```bash
pnpm eval:phase-2.4:panel:validate    # integrity + how many are fresh
pnpm eval:phase-2.4:write             # regenerate human-five-second-test.json
pnpm eval:phase-2.4                   # confirm the artifact is not stale
```

Then commit **both** the store and the derived artifact. The store is the human record; the
artifact is what the gate reads.

At ten fresh responses the gate decides on its own — `PASSED` only if all three recognition
rates are ≥90%. If a rate lands below 90%, that is a real finding about the page, and the
fix is the page, not the panel.

---

## Why a response can stop counting

Freshness compares the **measured surface** of the page — the three graded answers, the
stylesheet references, and the question-bearing sections — not the whole page (ADR 0079).
Three exclusion reasons, and they are distinct on purpose (ADR 0077's lesson was that one
absence read by two mechanisms produces the wrong diagnosis):

| Reason | Means | What to do |
| --- | --- | --- |
| `PAGE_GONE` | the page is no longer served | nothing; the record is true, the world moved. Run a session on a served page instead. |
| `SURFACE_CHANGED` | the page a participant saw is not the page we serve | re-run that session. Recognition is evidence about one subject. |
| `UNKNOWN_BASIS` | recorded before ADR 0079, no surface digest | `pnpm eval:phase-2.4:panel:reseat` |

`reseat` recovers a basis **only** from bytes whose sha256 already equals the response's
recorded `shownDigest`, found in git history. It never reads the working tree and refuses
rather than crediting a response from today's page. A rebake that moves only the contract
digest no longer voids anything — that is the whole point of 0079 — but a restyle or a
reworded answer still does.
