# ADR 0007: Every gate/threshold added is set at the measured baseline, not an aspirational target

## Status
Accepted (applied as a cross-cutting principle, not a single decision)

## Context
This backlog added several enforced gates: backend JaCoCo coverage, frontend Vitest coverage, jsx-a11y
lint severity, Trivy/ZAP scan pass/fail behavior. Each needed a threshold. Setting an aspirational
number (e.g. "80% coverage") on day one against an unmeasured or known-low actual baseline would make
the very first real run fail.

## Decision
Every threshold was set at or below the ACTUAL measured baseline at the time it was added — for the
frontend coverage gate, this meant literally running `npx vitest run --coverage` and discovering the
real number (0.5%) was far below an initially-drafted 15% guess, and correcting the threshold down
before finalizing (see `docs/TESTING.md`). Backend coverage and the Trivy/ZAP scans couldn't be
measured the same way in this environment (no reachable Maven Central / running Docker) — those are
documented as reasoned estimates with an explicit instruction to measure and correct on first real run,
the same correction the frontend number already went through.

## Consequences
- **Positive**: every gate added in this backlog either passes on day one against real measured
  numbers, or is explicitly marked as needing that measurement before being trusted — never a gate that
  looks rigorous but would immediately fail or immediately no-op.
- **Positive**: establishes a real ratchet mechanism (raise the threshold as real work closes the gap)
  rather than a static, eventually-ignored number.
- **Negative**: the current thresholds are, by design, low — they represent "don't regress from here,"
  not "this is well-tested." Anyone reading a passing CI badge should read the actual number, not
  assume "passing" means "well-covered."
