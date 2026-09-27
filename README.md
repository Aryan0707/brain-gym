# B.R.A.I.N. — Brain Gym

A local trainer for **thinking capacity**, not a video feed. Every video must be paid for with a
written idea and an honest self-rating. Rating drives when you see it again (spaced repetition).
No accounts, no server, no data leaves the machine.

## Run it

```bash
cd ~/HermesWorkspace/brain-gym
./serve.sh          # starts a local server on :8791
```
Then open **http://localhost:8791** — or `./train.sh` which does both and opens the browser.

## The loop (3 reps a day)

1. **Watch** — one video, 2–20 minutes, nothing else on screen.
2. **Recall** — write the one idea in your own words. If you can't write it, you didn't get it.
3. **Rate** — 1–5 on "how well can I explain this right now?"
4. Rating schedules the next review: **1 / 2 / 4 / 9 / 21 days**. Weak items come back fast,
   mastered ones fade out. That is the whole product.

Miss a day and the streak resets. Watch without writing and nothing is logged.

## Sources: YouTube + Instagram

| Source | Count | How it got there |
|---|---|---|
| **YouTube** | 46 | Found via `yt-dlp` search, filtered to trusted channels, every ID machine-checked |
| **Instagram reels** | 13 | Real embed test in a browser — the reel's own `<video>` element had to render |

Reels play in a vertical 9:16 player. Instagram signs its CDN thumbnail URLs, so those expire —
reels show a **REEL** tile instead of a stale image.

### The honest problem with Instagram

Instagram has **no public search and no discovery API**, and its login wall blocks any automated
browsing. yt-dlp's `instagram:user` extractor is currently broken. So a reel library cannot be
built by crawling — it can only be built by pasting links.

What that means in practice:

- The 13 reels shipped here are **all English**. Hindi brain/thinking reels exist, but search
  engines barely index them and none were reachable without login.
- **Hindi reels are therefore your job** — and it is a 3-second job. In **Library**, paste any reel
  link, pick the module and `हिंदी`, hit **Add reel**. It is verified by playing immediately, joins
  your daily sessions, and gets the same spaced repetition as everything else.
- Reels you add are stored in your browser and re-appear after a reload. `✕` removes one.
- Some reels cannot be embedded — Instagram shows *"the link may be broken"*. That is Instagram's
  restriction on that post, not the app. Remove it and move on.

If you paste a batch of Hindi links into chat, I will verify them and file them with proper module,
language and recall prompts — which is cleaner than adding them one by one by hand.

## Which videos — the curation rule

Every one of the 46 was picked against four rules. Anything that failed was dropped.

| Rule | Why |
|---|---|
| **One idea per video** | A video with five ideas trains nothing. One idea + a written rep is what sticks. |
| **2–20 minutes** | Long enough to build a real concept, short enough that you actually finish it. |
| **Visual, not lecture** | You asked to *see* it. Diagrams, animation, demonstrations — not a talking head. |
| **Hindi or English only** | Hindi delivery (incl. Hinglish) or English delivery. No third language, ever. |

Sources were whitelisted to real educators, then every single video was machine-checked for
embeddability, so nothing in the app is a dead tile: TED-Ed, Crash Course, Veritasium,
3Blue1Brown, Kurzgesagt, Huberman Lab, Farnam Street, Sprouts, Sadhguru Hindi, Dr Sid Warrier
(neurologist), Khan Academy Hindi, The Lallantop, Ankur Warikoo.

## The six modules (brain capacity has six dials)

| Module | What it trains | Videos |
|---|---|---|
| **Think Clear** | Logic, fallacies, reasoning under pressure | 9 (5 hi / 4 en) |
| **Judge Better** | Cognitive bias — catching your own mind lying | 7 (3 hi / 4 en) |
| **Remember & Focus** | Memory encoding, attention span, neuroplasticity | 9 (4 hi / 5 en) |
| **Decide & Systems** | Mental models, inversion, feedback loops | 8 (4 hi / 4 en) |
| **See Numbers** | Bayes, probability, statistics that mislead, compounding | 8 (4 hi / 4 en) |
| **Speak Sharper** | Language as a thinking tool + spoken English | 5 (3 hi / 2 en) |

23 Hindi · 23 English. Balanced on purpose — switch the tab at the top and the whole app follows.

## Data

All progress lives in this browser's `localStorage` under `braingym.v1`.
**Progress → Export JSON** gives you a portable backup. Import restores it. Reset wipes it.

## Files

| File | Purpose |
|---|---|
| `index.html` `style.css` `app.js` | The app (vanilla JS, no build step, no CDN) |
| `library.json` | The curated 46-video library — the only thing you edit to add content |
| `build_lib.py` | Rebuilds `library.json` from search + verification |
| `verify_all_embeds.py` | Re-checks that every embed still plays |
| `serve.sh` / `train.sh` | Start the server / start it and open the app |

## Adding a video

Add an entry to the `C` list in `build_lib.py` (id, module, lang, why, prompt) and re-run it.
Keep it to one idea, Hindi or English, 2–20 minutes — and machine-check the embed before adding.

## Recall check (starter set)

Every rep now needs a fresh written idea before Finish unlocks. Three starter lessons have
caption-checked key points (`iKU6hhJM0-A`, `dItUGF8GdTw`, `Qt4f7QrfRRc`): write from memory, reveal
and lock the note, then mark only the points you actually recalled. This is a **self-check, not
AI grading**. Rating 5 with zero matched points becomes effective rating 1 (review today); one
point caps it at 2, two at 3, and all three leave the chosen rating intact. The notebook stores
the original text plus self-check result, and Progress separates self-checked recall from older
self-rated reps. Other videos and reels still require a fresh note but are explicitly marked
self-rated until their own source-backed answer keys are reviewed. No API key or backend is involved.

Run the browser regression tests with the local server on port 8791:

```bash
python3 -m unittest discover -s tests -v
```

---

## It's a real app now — installed on your iPhone

**Live: https://aryan0707.github.io/brain-gym/**

That URL is a genuine PWA over HTTPS: standalone display (no browser chrome), its own home-screen
icon, and an offline app shell. Repo: `github.com/Aryan0707/brain-gym` (public, static, no secrets —
the only published data is the video library; all progress stays on the device).

### Install on iPhone (once)

1. Open **https://aryan0707.github.io/brain-gym/** in **Safari** (must be Safari, not Chrome).
2. Tap **Share** → **Add to Home Screen** → **Add**.
3. Launch it from the icon. It opens full-screen with no address bar, like a native app.

### Layout

Built as an app shell, not a web page: fixed app bar, scrollable screen, thumb-reachable bottom tab
bar, safe-area insets for the home indicator, 44px+ touch targets, 16px inputs (so iOS never zooms
on focus), and the trainer as a full-screen push rather than a new page.

### Redeploying after an edit

```bash
cd ~/HermesWorkspace/brain-gym && ./deploy.sh
```

Copies the source into `dist/`, commits, tags `deploy-YYYYMMDD-HHMM`, pushes, and polls the live URL
until it returns 200. Rollback is one command (printed at the end of the script).

### Local development

```bash
./serve.sh        # http://localhost:8791  (service worker needs https/localhost)
```
