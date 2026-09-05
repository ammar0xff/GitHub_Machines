# Product

## Register

product

## Users

- **The owner (Ammar)** — spins up a machine from a phone or laptop while away from a desk.
- **Developers** — want a throwaway Ubuntu/Windows/macOS box in seconds for a build, test, or script run; want to see exactly what is happening.
- **General users** — want a free machine with zero setup: click a big button, wait for "Ready", then use the links.

All of them are impatient and expect the app to tell them the truth about state (booting, running, expiring).

## Product Purpose

One-tap launcher into temporary GitHub Actions machines. Pick Ubuntu, Windows, or macOS; the app triggers the
workflow, tracks the run, and hands over the live access points — terminal, desktop — plus their URLs and a
way to stop the machine. Success looks like: tap once, ~60 seconds later a working machine link; nothing to install
on the client; a clearly ticking lifetime on every machine card.

## Brand Personality

Plain dev-tool: concise, technical, honest. Tone is calm and exact — statuses, run numbers, and URLs are shown
raw. Three words: precise, direct, utilitarian.

## Anti-references

- SaaS brochure landers: purple gradient blobs, glassy hero, three equal feature cards.
- Fake preview screenshots of consoles or desktops.
- Consumer-app cuteness: rounded cartoon mascots, confetti, gamified progress.
- Opaque spinners with no data; anything that hides what the machine is actually doing.

## Design Principles

1. **Show the truth.** Numbered run, step names, live status — the app is a cockpit over the Actions API, not a filter.
2. **One tap in, one tap out.** Start and Stop are the two primary actions; everything else is secondary.
3. **Links are the product.** Terminal/Desktop URLs are the deliverable — make them copyable and obvious at a glance.
4. **Respect the clock.** A 6-hour lifetime is the UX's heartbeat: expose countdown, warn near expiry, expire promptly.
5. **Zero-config default, full config when needed.** Prefill `ammar0xff/GitHub_Machines`; never require more than a token to start.

## Accessibility & Inclusion

- WCAG AA contrast on a dark theme; text ≥16px.
- All state changes conveyed textually + via `aria-live` (not color alone).
- Focus-visible rings everywhere; keyboard-navigable cards.
- Reduced-motion respected (no enforced animations).
- Touch targets ≥44px on every tappable control.