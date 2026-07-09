# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this project is

A workspace for building a website for "авторські тури" (curated/author-led tours — a luxury adventure travel product). There is **no application code, package.json, build system, or git repository yet** — the repo currently contains only design reference assets and a set of design-directive skills. New site code created here will be the actual deliverable.

The working language of the user is Ukrainian; site content will likely be Ukrainian unless specified otherwise.

## Repository layout

- `assets/Tourvia Travel Website Copier/` — a complete static export of the Webflow "Tourvia" template (luxury adventure/expedition travel agency site). This is the **primary design reference** for the tours website:
  - `index.html` (~56 KB) — full page markup
  - `css/tourvia-travel.webflow.shared.*.css` — the complete stylesheet
  - `js/` — GSAP, ScrollTrigger, SplitText, jQuery 3.5.1, and Webflow runtime chunks (the animation stack the reference relies on)
  - `images/`, `media/` — webp images (with responsive `-p-{width}` variants) and background videos (mp4 + webm pairs)
- `assets/13627553-uhd_3840_2160_24fps.mp4` — 4K stock video, likely intended as a hero background
- `.claude/rules/` — design skill directives (see below), indexed in `.claude/rules/llms.txt`

## Viewing the reference site

The Webflow export is fully self-contained static HTML. Serve it locally (opening via `file://` may break some script loading):

```bash
cd "assets/Tourvia Travel Website Copier" && python3 -m http.server 8000
```

Then open http://localhost:8000.

The reference page's section order (from `index.html`): `hero` (video background) → `home-about` → `home-destination` ("Most Popular destination") → `why` → `home-package` ("Our Exclusive tour packages") → `review` (client moments) → `activity` ("Crafted Experiences for The Discerning Travelers") → `cta` → `blog` → `footer`.

## Design system rules (`.claude/rules/`)

All rule files are auto-loaded as project instructions and are **binding** on any UI work in this repo. The most load-bearing constraints, common across the skills:

- **Fonts:** `Inter`, `Roboto`, `Open Sans` are banned. Use `Geist`, `Satoshi`, `Cabinet Grotesk`, or `Outfit`; distinctive modern serifs (`Fraunces`, `Instrument Serif`) only for editorial contexts.
- **Color:** No pure black `#000000`, no purple/neon "AI gradient" aesthetic, max one desaturated accent color, one gray family per project.
- **Layout:** No centered hero at high variance; no "3 equal cards" feature rows; CSS Grid over flexbox percentage math; `min-h-[100dvh]` instead of `h-screen`; contain content at ~1400px max-width; huge vertical section padding.
- **Motion:** GSAP/ScrollTrigger or spring physics (`stiffness: 100, damping: 20`); animate only `transform`/`opacity`; staggered reveals, never instant mounts.
- **Content:** No emojis anywhere in code or markup; no "John Doe"/"Acme" placeholder names; no AI clichés ("Elevate", "Seamless", "Unleash"); no lorem ipsum; use `picsum.photos/seed/{id}/...` for placeholder images, never Unsplash hotlinks.
- **Output discipline** (`output-skill`): full files always — no `// ...`, no "rest follows the same pattern", no skeletons in place of implementations.
- **Image-first workflow** (`image-to-code-skill`): for visually-driven website tasks, generate design reference images first, analyze them, then implement code to match — when image generation is available.

Which skill applies when is described in `.claude/rules/llms.txt` — e.g. `taste-skill`/`gpt-tasteskill` for premium frontend code, `redesign-skill` for auditing existing pages, `brandkit`/`imagegen-*` for image-generation-only tasks (no code).

## Working notes

- When implementing the tours site, reuse the Tourvia export as the visual/structural reference (section order, GSAP animation patterns, video-hero treatment, image handling with responsive webp variants) rather than copying its Webflow runtime markup wholesale — the skills in `.claude/rules/` govern the actual code style and stack.
- Before importing any third-party library into new code, check the (future) `package.json` first and emit the install command if missing — assumed dependencies are a hard failure per `taste-skill`.
