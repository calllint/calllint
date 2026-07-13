# ADR 0038: Public Trust Index Boundaries

**Status**: Accepted
**Date**: 2026-07-13
**Phase**: G (Automated Trust Gateway Core, v1.3.0) — Milestone G0 (locks the boundary before Phase I builds it)
**Related**: [0035 Automated Trust Gateway & Authority Manifest](./0035-automated-trust-gateway-authority-manifest.md), [0034 Evidence Provider Envelope](./0034-evidence-provider-envelope.md)

## Context

Phase I (v1.5.0, gated) builds a small Public Trust Index and a Partner API/Widget so a
directory or install entry-point can show CallLint authority evidence without running
CallLint — the platform-embedding lever that is the only realistic 100× path. That
surface is public and reputational, so its boundaries must be ADR-locked **now**, before
any page or endpoint exists, so no Phase-I implementation can quietly cross them.

## Decision

### 1. The Registry is an *input*, never the truth and never the only store

An external registry (Official MCP Registry, directories) is a *source of candidates*.
CallLint re-resolves each candidate to its own immutable `calllint.artifact.v1` identity
and re-derives evidence/authority. A registry entry is never treated as ground truth and
is never CallLint's only copy of what it evaluated (raw snapshots are retained).

### 2. "Observed at digest" language — never "certified", never "verified safe"

Every public page and API response describes a finding as **observed at a specific
artifact digest and timestamp** under stated completeness. Forbidden phrasings, anywhere:
"certified safe", "verified safe", "CallLint approved", "NVIDIA verified", "guaranteed",
or any wording implying a safety guarantee or a third-party partnership/endorsement. This
extends the receipt boundary (a receipt proves *what was approved*, not that a target is
safe) to the public surface. `SAFE` remains "no blockers observed under current evidence."

### 3. Pages never trigger a scan

A page view or API request reads a pre-computed, cached result only. It **never** starts a
resolution, fetch, scan, or evidence collection as a side effect. Ingestion (Registry
cursor → snapshot → resolve → scan → evidence → authority → page) is a separate,
rate-limited, offline-style pipeline decoupled from serving. This prevents the public
surface from becoming an amplification/DoS or SSRF vector.

### 4. No private evidence; no scan side-effects in the API

The Partner API exposes only public, digest-addressed artifact/authority data. It never
serves private baselines, org policies, or any customer evidence, and no endpoint has a
scan side-effect. Responses are CDN-cacheable, ETag'd, rate-limited, and schema-versioned;
every verdict carries its artifact digest.

### 5. Reproducible, sourced, correctable, PII-free

Each page is reproducible (states the pinned command), names its sources, states
completeness, is timestamped, carries a correction/dispute link, and contains no PII.
Maintainer claims (GitHub OAuth / DNS well-known / repo `calllint.json` / signed
challenge) grant a "Verified Publisher" label and drift notifications — never an implied
CallLint endorsement of safety.

### 6. Scope discipline (kill gate honored at the ADR level)

The Index starts **small** (100–1,000 opt-in / Registry / claimed-maintainer resources),
not an internet-wide crawl. If 10,000 pages yield < 200 effective preparings/month, page
growth stops — SEO is not the channel. This ADR forbids mass-generating Trust pages as an
SEO play dressed up as evidence.

## Non-negotiables locked by this ADR

- Registry is input, not truth, not the only store; raw snapshots retained.
- "Observed at digest …" only; never "certified/verified safe" or any partnership claim.
- Pages/API never trigger a scan; serving is decoupled from ingestion.
- No private evidence and no scan side-effects on the public API.
- Every page reproducible, sourced, completeness-stated, timestamped, correction-linked,
  PII-free.
- Index stays small and kill-gated; no internet-wide crawl, no SEO page-farm.

## Consequences

### Positive
- The public surface can be embedded by partners without ever misrepresenting CallLint as
  a certifier, protecting the trust asset that is the entire moat.
- Decoupling serving from scanning makes the API safe to expose at CDN scale.

### Negative
- "Observed at digest" language is less marketable than "certified safe". This is
  deliberate and non-negotiable.

### Trade-offs
- Chose a **small, curated, opt-in Index** over a large crawled one (reproducible honest
  evidence over reach; growth is gated on conversion, not page count).

## Compliance / gate impact

Phase I may not begin until Phase G + ≥3 Tier-A hosts pass their gates. When it does, its
acceptance is bound to this ADR: no-cert language enforced by a copy guard, pages
read-cache-only, API carries digests, small cohort first. Any change to these boundaries
requires a new ADR.
