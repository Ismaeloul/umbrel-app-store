# IPTV diagnosis: root causes and fix plan

All findings below are based on 0.8.2. Verdicts marked "refuted" were dropped. Where two findings contradicted each other, I checked the code and noted the decision (marked **Resolved**).

---

## 1. Ranked root causes

### (1) Playback: stops, jumps ahead, stalls, jumps back, needs DIRECTO

| # | Root cause | Evidence | Weight |
|---|---|---|---|
| **P1** | **Undecodable joins in TS input.** Nothing in the relay checks for a TS packet boundary, PAT/PMT, keyframe (random-access point) or PTS continuity. This happens in two places: (a) when the provider's own source changes inside one connection (lab `ts-costura`, the owner's exact pattern), and (b) when `adopt()` splices a reconnect whose PCR jump is 5 s or less (relay.ts ~532-540). ffmpeg then copies non-keyframes with missing references (`-c:v copy -copyinkf`). Chrome raises `PIPELINE_ERROR_DECODE`, and the web `broken` handler calls `fail()`, a full rebuild. The new hls.js starts at `edge − 5·TD`, which is 20 s back when TD is 4. It lands on the same bad segment, and after 3/3 attempts the IPTV source is lost. | ts-costura (ffmpeg 8.1.2), p_cut_a / p_cut; control p_cut_key shows 0 errors | **Primary** |
| **P2** | **The relay hangs on reconnect.** `firstChunk()` (relay.ts:141-165) calls `body.pause()`. When `adopt()` calls it a second time because the first chunk had no PCR, it attaches `on('data')` to a stream that was explicitly paused, so it never flows. There is no timeout and no close handler. `reconnecting` stays true forever, and ffmpeg gets no more bytes. The web holds for 45 s, `ensure()` restarts ffmpeg, the new ffmpeg attaches to the wedged relay (`attach()` does not reconnect while `reconnecting`), and 20 s later `iptv_timeout` ends it with «Tu IPTV no responde». No component watches remux output progress. | ts-silencio, ts-colchon-grande, ts-panel-real (the channel dies in 3 of 3 runs), ts-corte on 8.1.2; `pruebas/rele-reconexion.ts sin-pcr`; Node pause semantics verified | **Primary** (turns any idle >10 s or provider cut into a lost channel) |
| **P3** | **A remux restart resets the output at the same URL.** `restart()` / `retarget()` delete the folder and relaunch ffmpeg with no `-start_number`, the same `init.mp4` and `MEDIA-SEQUENCE:0`. The old hls.js loads the new playlist through the long-poll before `stream.reopened` arrives, and `synchronizeToLiveEdge` seeks 30-58 s back. runtime.ts can then resume old buffered picture. After that, the SSE tears everything down with `reattach` + `resetVideo`, about 2.3 s of black. Triggers: a PCR jump over 5 s, any HLS media-sequence regression (no tolerance: see P7), or a variant switch. | ts-corte-pts (−30 s, 70 ms before the SSE), ts-corte-pts-gop6 (−58 s, 6.9 s of old picture), restart-nosse | **High** ("jumps back") |
| **P4** | **The web rebuffer hold fights hls.js.** Every `waiting` event calls `setHold` → `pause()`. While the video is paused, hls.js's gap controller exits early, so it never skips holes or nudges. `bufferAhead()` only counts the current range, so the hold never releases in front of a hole. It only ends when hls.js's `synchronizeToLiveEdge` jumps +10-14 s. Three things make it worse: (a) DIRECTO is short-circuited during a hold (T-133) and shows «Ya estabas en el directo»; (b) a stale `play()` promise in the controller's `'superseded'` branch can leave the player **paused for good** with `desiredPlaying=true`; (c) the 8 s `rebuild` target turns a real underrun into a paused hold of about 10 s. (c) is a trade-off, not a net loss. | skip20-web vs skip20-solo vs B-skip20 (fix validated), skip20-golive, restart-nosse (stuck paused) | **High** ("stops, then jumps ahead") |
| **P5** | **hls.js latency is set as counts × TARGETDURATION.** `liveSyncDurationCount 5` / `liveMaxLatencyDurationCount 10`. Every long remux segment raises TD to 3-10 for about 30 s: a key-less segment 0 at every (re)start, a splice, or an input gap under 10 s (which ffmpeg does not rebase). While TD is high, the latency target doubles and DIRECTO (`liveSyncPosition`) moves 20-30 s back. When TD drops again, `maxLatency` halves and hls.js jumps forward (+9.9 s in ts-costura). | ts-costura t=86.7, p_hlsfail, G-drop7, my own 8.4 s gap test (TD 10) | **High** (second forward jump, and DIRECTO pulling back) |
| **P6** | **The reconnect budget counts successful reconnects.** `TsSession.attempts` is never cleared when a reconnect succeeds, so the 4th drop within 60 s becomes `iptv_dropped` without a single try. The backoff also grows because of earlier successes. | ts_burst11 | Medium ("IPTV gives up / jumps to AceStream") |
| **P7** | **HLS-source relay (m3u8 channels only):** any media-sequence regression, such as a lagging CDN edge, causes a full remux restart (which then hits P3). The 15 s stale-playlist check only runs on the fetch-failure path. | hls_flap2 vs hls_flap2_nr | Medium-low (not the owner's TS path) |
| **P8** | **`aresample …:first_pts=0` pads silence from 0 to now on every audio filter-graph rebuild** (for example when audio changes 2.0 to 5.1). Thousands of AAC frames get squashed into one segment, with a CPU spike. It affects every origin. | Reproduced on 6.1 and 8.1.2 (5630 frames after 120 s) | Latent, high severity; not proven on the owner's channels |
| **P9** | Minor issues: a 410 `session_expired` gap during restart/retarget; the −30 s button is always undone by hls.js (the target is always past maxLatency); the web sends media `error` straight to `fail()` and never tries hls.js `recoverMediaError`. | code + back-web | Low (the last one is part of the P1 fix) |

**Refuted or dropped:**
- Connect watchdog 30 s vs preload 50 s: IPTV does emit `stream.stats`.
- Orphan reaper race: practically unreachable; the lab kills came from two lab instances running at once.
- "Bursty input causes periodic stalls": not reproduced (waiting=0).
- Raising `idleMs` or `-hls_time`: rejected.

**Fixes that were proposed and are rejected:**
- **`-dts_delta_threshold 1`** (proposed in server-input#0 and server-output#3). **Resolved: do not add it.** Tested on production ffmpeg 8.1.2 with the exact args: a gap in only one stream makes the correction apply to the whole file. An audio-only gap of 1.5 s leaves the stream **silent for the rest of the session**. The TD problem is fixed on the web side instead (P5), and gaps are prevented at the source (P1 gate).
- **Removing `-copyinkf`.** Rejected: it brings back the B-218 iOS audio-lead bug (about 1.1-2.1 s). The fix is to align the input to a keyframe in the relay.
- **ffmpeg `append_list`** as the way to keep the output continuous. Rejected: it produces one global `EXT-X-MAP` pointing at the wrong init, writes no `DISCONTINUITY-SEQUENCE`, and leaks files.
- **Resolved (P3), server-input#1 vs server-output#0:** use `-start_number` + `+discont_start` + a per-generation init file **without** `append_list`. The new playlist lists only the new generation under its own MAP, so the MAP objection does not apply. The one remaining gap is `EXT-X-DISCONTINUITY-SEQUENCE`, which `serveFile` has to inject (see B2 below). The lab fix run F-fix-none-40 shows a 3.8 s rebuffer instead of a 30 s jump back.

### (2) Opening a match shows only AceStream; IPTV appears only after Rebuscar

| # | Root cause | Evidence |
|---|---|---|
| **M1 (primary)** | **The preheat snapshot is reused without the IPTV layer.** At football/service.ts:498, `reusablePreheat` returns the stored snapshot on every entry that is not a Rebuscar, and it **never calls the IPTV layer**. Snapshots taken before IPTV or the guide were ready, or while IPTV was in another state, are served for up to 20 min. `onScanJobDone` (service.ts:768) also resets the TTL clock. Only `research=1` bypasses the snapshot, and it puts IPTV first. | Scratch tests A-E, H, 8/8 passing |
| **M2** | **"Gol Play" is treated as an internet platform.** `PLATFORM_RE` (names.ts:465) matches `\bplay\b`, so `iptvAskedChannel('GOL Play')` returns null. Gol Play matches get no IPTV candidate by name, and Rebuscar does not fix it. | Regex verified; agenda-sources.ts:741 emits the name |
| **M3 (secondary)** | **Match entry waits for the AceStream engine search**: up to 8 queries × 12 s, 24 s with the scanner falling back to the main engine, and more with AI embedding. The web gives up at 20 s and invents a `not_found` with **zero** sources and no `iptv` in `checked`. This only applies when no preheat is reusable. | Code |
| **M4** | After Rebuscar adds IPTV while an auto-started AceStream stream is playing, nothing happens: no switch and no offer (`rearm=false`). By design (D7) the right fix is a one-tap offer, not an automatic switch. | Code + scratch W1 |
| — | "No live refresh on `iptv.status`" is partly covered by M1. Clearing preheats on `iptv.status` is **rejected**: `resolve()` → `touch()` emits that event on nearly every entry. The channel-less guide path being unreachable is a missing feature, not the cause of this symptom. | |

### (3) Search quality

The IPTV section is mostly sound. What the owner most likely sees as "garbage":

1. **The AceStream section is ordered only by availability** (parse.ts:69), and the query goes to the engine exactly as typed. There is no relevance ranking and no handling of M+ / LaLiga spellings.
2. **Recall gaps:** there are no aliases for champions / champions league / la champions / ucl → Liga de Campeones ("la champions" returns 0). tve / rtve find no RTVE channel. The compact-join fallback matches "tve" to REAL MADRID **TV EN**. "a3" does not find Antena 3.
3. **Ranking:** "laliga tv" puts the generic LaLiga names ahead of M+ LaLiga TV. "laliga tv 2" puts Rakuten LA LIGA 2 first, through tier 0, because tier is compared before the platform penalty.
4. **An engine failure shows a red error card and a toast** next to IPTV rows that loaded fine. The library filter is a plain substring match, so "m+ laliga" misses "M. LALIGA 1".
5. **The search index is built lazily and synchronously:** a 0.1-0.3 s stall (on this host) on the first search after every sync. It does not affect playback.
6. Rows that look like duplicates: **do not** merge "X" with "X 1". The provider lists them as separate channels, and lista-real.test.ts pins that. At most, fold `DIRECTO … ᴿᴬᵂ` into its channel.

---

## 2. Fix plan (work packages)

**Parallel tracks.** Each track owns a disjoint set of files. Work inside one track is serial.

| Track | Owns |
|---|---|
| **A: relay** | `apps/server/src/modules/iptv/relay.ts`, new `iptv/ts-gate.ts`, `iptv/hls.ts` (parser additions), `relay.test.ts`, `IPTV_RELAY` in `packages/shared/src/constants/iptv.ts`, `apps/server/test/fake-iptv/provider.ts` |
| **B: remux output** | `modules/remux/{service,args,files,types}.ts`, `remux/*.test.ts`, `playback/service.ts` (restart/reopened only), the `stream.reopened` schema in shared |
| **C: web player** | `apps/web/src/player/{runtime,controller,constants}.ts`, `player/engines/{hls,types}.ts` and their tests, `packages/shared/src/constants/playback.ts` |
| **D: match entry** | `modules/football/{service,resolution,preheat}.ts`, `iptv/names.ts`, `iptv/match.test.ts`, `names.test.ts`, `apps/web/src/features/sources/session.ts` |
| **E: search** | `iptv/search.ts`, `modules/search/{routes,parse}.ts` (routes only), `iptv/service.ts` (prewarm), `apps/web/src/features/search/*`, `features/library/model.ts` |

**Cross-track contracts** (agree on these first):
- B adds `seamless?: boolean` to the `stream.reopened` payload. C reads it.
- A uses no shared constant except `IPTV_RELAY`.
- E reuses `IPTV_BROWSE.buildChunk`, so it does not touch shared constants.

**Suggested landing order:** A1 → B1 → C1 → A2 → B2 + C3 → C2 → D1 → D2 → E\*. D and E can start on day 1.

### Track A: relay (fixes P2, P1, P6, P7)

**A1. Relay reconnect hang and reconnect budget.** Smallest change, biggest effect.
- **Hang fix:**
  - `firstChunk()`: call `body.resume()` after attaching `on('data')`, resolve null on `'close'`, and add a timeout of `IPTV_RELAY.idleMs`. The timeout rejects with `iptv_dropped` ("reconexión sin datos") and removes all listeners.
  - Also give the whole PCR probe in `adopt()` one deadline, so `reconnect()` always exits and `reconnecting` always resets.
- **Budget fix:**
  - Add `adoptedAt` and `stableBytes`. In the `wire()` data handler, clear `attempts` once the new connection has streamed for `IPTV_RELAY.stableMs = 20 s` (new constant, must be greater than `idleMs`).
  - Add a long-window cap, e.g. 12 reconnects per 10 min, after which `nextVariant` or `emitDropped`.
- **Tests (relay.test.ts):**
  - The first reconnect chunk has no PCR and the second arrives later: reconnect completes. With no second chunk, it times out and `reconnecting` is false.
  - Cuts at 0/20/40/60 s with healthy streaming in between: no `dropped`, 5 opens, backoff 1 s each time.
  - Keep the existing "3 consecutive 503s → drop" test.
- **Lab:**
  - `pruebas/rele-reconexion.ts sin-pcr` must exit 0.
  - ts-silencio, ts-colchon-grande, ts-panel-real, ts-corte, ts_burst11 with `--ffmpeg-dir $IPTV_LAB_CACHE/ffmpeg-alpine/bin`. Before: hang → «Tu IPTV no responde». After: recovers.
- **Risks:** a provider that flaps forever (hence the long cap). Land A1 before or with A2: more "successful" reconnects without the gate means more corrupt splices. No effect on AceStream (relay only). iOS gets fewer `iptv_dropped` events.

**A2. TS resync gate.** Fixes P1; this is the main fix for `ts-costura`.
- **New pure module `iptv/ts-gate.ts`.** It works on packets.
  - It realigns to `0x47` and carries partial packets across chunks.
  - It caches PAT/PMT and learns the video PID, audio PIDs and stream type (0x1B H.264, 0x24 HEVC).
  - It tracks the last delivered video and audio PTS. It parses only PUSI packets and does not copy buffers.
  - Modes are `pass` and `waitRap`. In `waitRap` it:
    - drops video until a PUSI PES is a random-access point: RAI=1, or a NAL of type 5/7 (H.264) or 16-21 (HEVC) in the first 2-3 packets;
    - for reconnects, requires that PES's PTS to be greater than the last delivered one (33-bit wrap handled);
    - drops audio whose PTS is at or before the last delivered audio, and audio before the first video RAP;
    - re-emits the cached PAT/PMT **byte-identical**, then switches to `pass`.
- **relay.ts:**
  - Route `wire()` data and `adopt()` heads through `gate.push()`.
  - Enter `waitRap` on: every `adopt()` (both the splice and the jump branches), the initial head in the constructor (this also fixes the key-less segment 0 and TD 3-4 at startup), and inside a connection on a continuity-counter break on the video PID, `discontinuity_indicator=1`, or a video PTS going backwards or forwards by more than 1.5 s. For in-connection seams, accept the forward gap.
  - Fallback: if no RAP passes within 4 s of wall time or 8 MB, use the existing restart path (`clock.setTimeout`, cleared on teardown). Never await inside `adopt()`.
  - Reset the cached PAT/PMT on a variant switch.
- **Do not** change `args.ts`: no `dts_delta_threshold`, keep `-copyinkf`.
- **Tests:**
  - Unit tests for ts-gate on synthetic TS: mid-GOP start, PTS overlap, AUD/SEI/SPS/PPS/IDR split across packets, PTS wrap, a chunk starting mid-packet, no RAI (NAL fallback), a stream that never has a RAP (timeout path).
  - fake-iptv provider: opt-in modes `empalme:N[:prebuffer=S]` (mid-GOP, overlapping) and `cut-mid-packet`. Keep the shared `TsMuxer` defaults byte-identical, or AceStream fixtures change.
  - Integration test: ffmpeg decodes the output with `-xerror`, and PTS is monotonic.
- **Lab:** ts-costura, ts-corte-colchon4, ts-corte, ts-panel-real, ts-limpio (index0 should start on a keyframe, TD 2 from the start), ts-gop6. Pass criterion: no `PIPELINE_ERROR_DECODE`, no content going backwards.
- **Risks:**
  - Each join loses up to one GOP (2-6 s), which is a short skip ahead.
  - Open-GOP or intra-refresh streams never qualify as a RAP, so the 4 s fallback is essential.
  - CPU on Pi-class hardware.
  - iOS: the PAT/PMT must stay identical, or ffmpeg emits a new init without a discontinuity, which AVPlayer breaks on. iOS benefits: no more corrupt slices, no audio-lead regression.
  - AceStream is untouched.

**A3. HLS relay hardening.** Fixes P7; low priority.
- In `HlsSession.learn()`, a small regression (at most the window size) whose segment URIs are already known is a stale edge. Ignore it: keep the cache, don't touch `lastText`/`lastNewAt`/`lastSequence`, and escalate to a real restart after 3 in a row.
- Progress means the sequence or segment count advanced, not that the text changed.
- Run the stale check on the success path too, with a threshold of `max(15 s, 3×TD)`, skipped for ENDLIST. This needs `targetDuration` parsed in hls.ts.
- Restart only on a **backwards** jump of DISCONTINUITY-SEQUENCE.
- **Tests:** alternating N / N−2 gives no restart; a restart from 0 with new URIs gives exactly one; a playlist frozen for more than 15 s gives one drop; changing tokens with an advancing sequence gives nothing; ENDLIST gives nothing.
- **Lab:** hls_flap2 (expect g1 only), hls-reinicio, hls-congelada (12 s freezes must still recover), hls-limpio.

### Track B: remux output (fixes P3, P8, P2 safety net, P9)

**B1. Remove `first_pts=0`.** Trivial; can ship first.
- args.ts:127-128 becomes `aresample=async=1000:min_hard_comp=0.100` for every origin.
- Update pure.test.ts:89. Add an assertion that no live args contain `first_pts`.
- Update docs: comportamientos B-219, analisis/reproductor.md, cobertura/remux.md, CHANGELOG. Optionally add a 2.0→5.1 case to `pruebas/empalme-ffmpeg.ts`.
- **Do not** use `-reinit_filter 0`: it is fatal on a layout change.
- **Risk:** when audio starts later than video, audio now starts at its real PTS (about 0.2-1.5 s), so there is a small audio-only hole at startup. Check a late-audio clip in the lab (web) and on an iOS device. AceStream changes in the same way.

**B2. Continuous restart output.** Fixes P3. Every change here is gated on `origin==='iptv'`, except the numbering continuation, which is harmless on `retarget()`.
- **Keep numbering and use a per-generation init.**
  - Before `closeLocked` in `restart()`: `startNumber` = 1 + the highest `index(\d+).m4s` in the **directory listing** (not the playlist, which can lag behind the files).
  - `generation` = `current + 1`.
  - `buildRemuxArgs` gets `-start_number N`, `+discont_start` and `-hls_fmp4_init_filename init_<gen>.mp4`, but only when `generation > 1`. First starts stay byte-identical.
  - Widen `VIDEO_FILE_RE` to accept `init(?:_\d{1,6})?\.mp4`. `rewritePlaylist` already rewrites every `URI=` for /native.
- **No hole and no reset during the restart.**
  - Do not delete the directory between generations. Keep serving the old `index.m3u8` (frozen snapshot, bounded by `IPTV_REMUX_READY_MS`) and the old segments until the new playlist exists. Only then delete the old files.
  - Add a `replacing` set so that `serveFile` answers 503 + Retry-After (native: 404 + Retry-After, as today) instead of 410 during the swap. Clear it in `finally`.
- **Inject `#EXT-X-DISCONTINUITY-SEQUENCE`** in `serveFile` / `rewritePlaylist`: `gen−2` while the `DISCONTINUITY` tag is visible, `gen−1` once it has slid out. ffmpeg never writes it, and AVPlayer needs it (RFC 8216 §6.2.1).
- **playback/service.ts `restartIptv`:** emit `stream.reopened{reason:'remux_restart', seamless:true}` when B2 was applied. Optionally `readySegments=1` for these restarts.
- **Tests (remux/iptv.test.ts):**
  - Restart args contain `-start_number` greater than the previous maximum, `init_2.mp4` and `discont_start`. First-start args are unchanged.
  - The playlist is served during the swap (no 410/404).
  - The discontinuity sequence is injected and correct once the tag slides out.
  - `serveFile` accepts `init_2.mp4` and rejects traversal.
- **Lab:** ts-corte-pts, ts-corte-pts-gop6, hls-reinicio. Before: −30 / −58 s. After: no backward seek, a rebuffer of about 4 s or less.
- **Risks:**
  - AceStream `retarget()` shares the code path, so the gate is needed. Its viewers still reattach.
  - iOS: `Reproductor.swift` still calls `reenganchar` on every `stream.reopened`, so it stays correct. The continuing MEDIA-SEQUENCE is better for AVPlayer than today's reset. Test on a device before letting AVPlayer ride through a restart without reattaching.
  - Disk use goes up briefly while two generations coexist.
  - The orphan reaper and shutdown `rm` must still cover the directory.

**B3. Output-progress watchdog.** Safety net for P2.
- IPTV entries with viewers, ready and alive, whose playlist has not changed for `max(10 s, 3×TD)`: fire `RemuxListener.onStalled` once (debounced, reset on change).
- playback/service.ts reacts by forcing the **relay** to drop its upstream and reconnect. A remux-only restart is not enough. If there is still no progress about 10 s later, close with `iptv_dropped` so the web falls back to AceStream in about 20 s instead of 65 s.
- Route `ensure()`'s `isStalled` restart for IPTV through the same relay-aware path.
- **Tests:** fake clock, stale playlist → exactly one `onStalled`.
- **Risk:** only for `origin==='iptv'` (the engine watchdog owns AceStream). Scale the threshold with TD to avoid false positives on long-GOP channels.

### Track C: web player (fixes P5, P4, P1 web half, P3 web half, P9)

**C1. Latency in seconds for hls.js.** Fixes P5; small change, do it early.
- In `packages/shared/src/constants/playback.ts`, replace both count keys with `liveSyncDuration` / `liveMaxLatencyDuration`: low 6/16, balanced 10/22, stable 14/26. Sync equals today's count × 2 s. Max stays at least 4 s under the 30 s window.
- Remove the count keys completely: hls.js throws if both kinds are mixed.
- Update engines.test.ts:253-260. Add a test that `new Hls(hlsConfig(p))` from the **real** library does not throw for any of the three profiles.
- **Lab:** ts-costura (the +9.9 s jump at the TD 4→2 change should disappear), ts-limpio-10min, ts-gop6, hls-limpio (watch for more stalls with 6 s segments).
- **Risks:** AceStream's hls.js path gets the same latency at TD 2, with no change in behaviour. iOS is unaffected (it uses IOS_PLAYBACK_PROFILES).

**C2. Rebuffer hold, DIRECTO and controller race.** Fixes P4.
- runtime.ts `on('waiting')`:
  - Ignore the event if `paused` or `readyState >= 3`.
  - For `engineKind==='hls'`, wait `HLS_WAITING_GRACE_MS = 1500` (one deduped timer, cleared on `playing` and on teardown), then hold only if `currentTime` has not moved.
  - mpegts and native keep the immediate hold.
- Hole-aware hold: if a buffered range starts within `2×TD` ahead of the playhead, seek past the hole through the controller (so `seeking` is set) instead of holding.
- `waitBuffer`: no synchronous `check()` for rebuffers, which breaks the hold/release storms. Clear `bufferTimer` whenever the hold ends early.
- **controller.ts `playForCommand`:** a stale resolved play pauses only if `!desiredPlaying || holds.size || !isActive()`. Otherwise it returns without pausing. On `AbortError` with desired=true, no holds and paused, retry once on the next task (never for `NotAllowedError`).
- **Watchdog safety net:** if the player is paused with desired=true, no holds, not blocked and not busy for 2 ticks, call `requestPlay('watchdog')`.
- **runtime `goLive`:** during a rebuffer with `behind > LIVE_TOLERANCE_S` or a hole ahead, run `endRebuffer(conn,false)` and seek to `max(target, nextStart+0.1)`. Never show «Ya estabas» for `'held'`; show «Recuperando la imagen…» instead. Keep T-133 in the controller.
- **back():** clamp to `max(w.start+TD, w.end − maxLatency + 3)` using a new `engine.liveWindow()`, and report the real number of seconds. Do not change `packages/shared/live.ts`, which is mirrored in Directo.swift.
- **Tests:**
  - Port the webplayer E2 / E7 cases: no pause within 1.5 s if the playhead moves; buffered `[0,20]` and `[20.6,40]` seeks to about 20.7; E7 storm ends with `paused=false`.
  - DIRECTO during a hold with a hole: a seek past the hole and no «Ya estabas».
  - `back()` clamp.
  - FakeMedia `pause()` must reject pending play promises.
- **Lab / harness:** B-skip20, B-hipo9, B-hipoLento, skip20-golive, restart-nosse, back-web, ts-parones, ts-rafagas.
- **Risks:** AceStream in HLS mode and D5 `hls-fmp4` on desktop get the 1.5 s grace. Show a spinner right away, without pausing. mpegts AceStream is unchanged. iOS native never enters `startRebuffer`. The controller and watchdog changes do apply to Safari, so gate on `blocked` so they never loop without a user gesture.

**C3. Recover in place; don't rebuild on the same session.** P1 web half, P3 web half. Needs B2's `seamless` flag.
- Add `recoverInPlace()` to the engine interface. For hls: `recoverMediaError()` followed by `startLoad(nextFragStart(currentTime))`, i.e. resume **after** the bad fragment. Budget of 2 per 60 s, reset on `FRAG_BUFFERED` progress.
- runtime `broken` (on the `error` event only, hls only): try `recoverInPlace()` before `fail()`.
- For `fail()` / `reattach()` / `connect()` on the **same** remux session: capture `{sn, offset}` and give the new engine a `startPosition`. Use it only if `sn` is inside the new playlist's range, clamped to at least `edge − maxLatency + 2`; otherwise −1.
- `onReopened`: when `reason==='remux_restart' && seamless && isIptvSource() && engineKind==='hls' && same url`, notify only and do not reattach. AceStream `retargetRemux` (same `reason`) keeps reattaching.
- Defence against old servers: an IPTV-only `pLoader` that detects `MEDIA-SEQUENCE` going backwards before parsing, then `stopLoad` + `onReset` → reattach, deduped against the SSE.
- `changeMode` on hls: carry the position over, not a full rebuild.
- **Tests:** a media error calls `recoverInPlace` and not `fail`, and the budget runs out into `fail`. The carry-over position is used when the sn is in range and −1 when it is out of range. A seamless reopen does not destroy hls.js. A reopen for AceStream does reattach.
- **Lab:** ts-costura (should no longer go «2/3 → 3/3 → no responde»), ts-corte-pts, reconnect-web.
- **Risks:** a stream that is persistently undecodable must still reach `fail()` / `exhaust()` so AceStream fallback happens (hence the budget). Skipping to the next fragment loses up to one segment. iOS is unaffected (hls-only).

### Track D: match entry (fixes M1-M4)

**D1. Overlay live IPTV on the preheat snapshot.** Fixes M1; the main fix for symptom 2.
- `resolution.ts`: add `overlayIptv(core, channels, program, iptvLayer, applyLearned)`. It:
  - removes stale `iptv:` candidates and those whose `classify` is not `engine`;
  - adds `iptv.resolve()` candidates with score at least `RESOLUTION_EXACT_SCORE`;
  - runs `capIptv` and merges with `sourceOrder ['iptv','favorites','m3u','acestream']`, then applies learned rules;
  - puts `checked.unshift('iptv')` when the layer was consulted, and sets `candidate = candidates[0]`.
  - It must reuse the fresh-path helpers, so entry and Rebuscar give identical lists.
- football/service.ts:500-512: call it in the reuse branch.
- **Do not** invalidate on `iptv.status`.
- Optional: keep a separate `scanDoneAt` so `onScanJobDone` stops resetting the TTL. That changes preheat.test.ts:228; only ship it together with D3.
- **Tests (ported from the scratch B/C/H cases):**
  - Preheat before IPTV is active → IPTV first and `checked[0]==='iptv'`.
  - Preheat before the guide → the guide candidate appears.
  - IPTV paused after the preheat → no `iptv:` ids.
  - AceStream candidates and the preheat state are unchanged.
- **Risks:** entry now auto-starts IPTV more often, so it exposes symptom-1 bugs more. Ship it after A1/A2/C1 or together with them. iOS gets IPTV first on entry through the same response shape; check AVPlayer's auto-start.

**D2. Gol Play is a TV channel.** Fixes M2.
- names.ts: add `TV_CHANNEL_PLAY_RE = /^\s*gol\s*play\b/iu`, checked before `PLATFORM_RE` in `iptvAskedChannel`.
- **Tests:** `Gol Play`, `GOL PLAY HD`, `GOL PLAY HD --> NEW ERA` are not null. RTVE Play and LPF Play stay null. match.test: `['GOL Play']` → `ES: GOL PLAY` first. layer test: the agenda bonus applies.

**D3. Bound the entry resolve.** Fixes M3.
- One `AbortSignal.any([ctx.signal, deadline])` for the engine stage: 8 s when IPTV candidates exist, 12 s otherwise. Interactive resolves only; preheat keeps the long timeout.
- `fetchRaw` shares one budget between the scanner and the main engine, instead of 12 + 12.
- Race the AI stage against the deadline, or skip it when IPTV exists.
- Web session.ts: on a timeout or network error, show an error state with Reintentar, not a fabricated `not_found`. At minimum add `iptv` to `checked` when `iptvActive()`.
- **Risk:** aborts must not count as engine failures for health.

**D4. One-tap IPTV offer after Rebuscar.** Fixes M4.
- `showBackToast(id, text, label)` gets a label parameter.
- In `research()`, when not rearming and a new, untried IPTV entry exists while AceStream is on screen, show «Tu IPTV tiene este partido · Ver por IPTV». Never switch automatically (D7).
- **Test:** the toast appears, the hash is unchanged, and the action plays IPTV with `manualChosen`.

**D5 (optional, not the owner's bug).** Make channel-less matches openable from the agenda when IPTV is active, which enables the guide path. Five UI gates plus `research()`.

### Track E: search quality

**E1. `iptv/search.ts`.**
- Name aliases applied to the query key, as a second pass merged through the same `put`: `champions`, `champions league`, `la champions`, `ucl` → `liga de campeones` (exclude `champions tour`, hockey, cup). Bare `tve`/`rtve` → the RTVE family (la 1, la 2, teledeporte, 24h, clan). Bare `a3` (± hd) → `antena 3`.
- Compact-join fallback: accept a match only if it crosses into another word and the last word is fully matched, or at least 2 of its characters are, or the tail is digits.
- Ranking: `literalMiss` per **family** (optional words such as `tv` that the user typed and the family lacks), sorted before family length. When an optional word is typed, merge tiers 0 and 1.
- Optional: strip `DIRECTO` only when `ᴿᴬᵂ` is present. This changes that channel's id, so favorites need a relink.
- **Tests (search.test / lista-real.test):**
  - champions / la champions / ucl / m+ champions → M+ Liga de Campeones first, literal rows kept.
  - `tve` → no REAL MADRID TV EN. `rtve` → the RTVE family. `a3` → ANTENA 3 first.
  - `laliga tv` → the M. LALIGA family first. `laliga tv 2` → M. LALIGA 2 first.
  - `laliga` and `la liga` unchanged. Existing antena3 / la1 / mlaliga cases still pass.

**E2. AceStream relevance.**
- Add `rankForQuery(results, query)` in `search/routes.ts` (the v1 route only; do not change `parseAceSearchResults` or the legacy `/api/search`, which resolution and parity tests rely on).
- Tiers, reusing the IPTV fold and spelling rules on titles stripped of `--> LIST`: exact, family, prefix, all tokens, rest. Ties by availability; availability 0 goes down within its tier.
- Optional: fan out to a second query for `m+ …` → `movistar …` (at most 2 queries, skipped while the engine is streaming).

**E3. Web search screen.**
- When there are IPTV or library rows, an engine failure becomes a one-line note plus Reintentar inside the AceStream section, with no toast.
- `filterItems` (and server `libraryCandidates`) also match on the normalized key (a normalizer shared through `packages/shared`, minimum 3 characters).

**E4. Search-index prewarm.** `buildSearchIndexSteps` generator; `prepareSearch` chained after `prepareBrowse` using `setImmediate` chunks. Test that the chunked build equals the synchronous one.

**Risks for E:** none for playback, AceStream streaming or iOS playback. The response shapes are unchanged. iOS search results change order if it uses v1.

### Validation matrix

Run one lab instance at a time, with `IPTV_LAB_CACHE=/tmp/claude-0/iptv-lab-scratch/cache` and `--ffmpeg-dir $IPTV_LAB_CACHE/ffmpeg-alpine/bin`. Capture `resumen.json` before and after.

| Scenario | Must improve with |
|---|---|
| ts-costura | A2, C1, C3 |
| ts-silencio, ts-colchon-grande, ts-panel-real, ts-corte | A1 (+ B3) |
| ts-corte-colchon4 | A2 |
| ts-corte-pts, ts-corte-pts-gop6 | B2 + C3 |
| ts-parones, ts-rafagas | C2 |
| ts-limpio (TD 2 from the start) | A2 |
| ts-salto-pts | A2 in-connection trigger + C1 |

**No-regression set:** ts-limpio-10min, ts-irregular, ts-gop6, ts-50fps, hls-limpio, hls-lento, hls-reinicio, hls-congelada, plus a `--modo sola` run of each key scenario.

The existing AceStream e2e must stay green: the fake-engine `TsMuxer` defaults stay byte-identical. Before any release: an iOS device check of B1 (late-audio start) and B2 (restart without a new init or discontinuity-sequence error).

---

## 3. Resumen para el dueño (en castellano)

Hemos encontrado varias causas, y ninguna es culpa de tu proveedor ni de tu red.

1. A veces tu IPTV «pega» dos trozos de emisión, o se corta y vuelve. El programa junta esos trozos tal cual, sin esperar a una imagen completa. El navegador recibe imagen rota y da error.
2. Al dar ese error, el reproductor se reinicia entero, arranca unos 20 segundos más atrás y vuelve a caer en el mismo trozo roto. Por eso ves que se para, va hacia atrás y al final dice «Tu IPTV no responde».
3. Cuando la conexión con el proveedor se corta, hay un fallo que deja al programa esperando para siempre. La imagen se congela casi un minuto y luego se pierde el canal.
4. Cuando el programa tiene que rehacer el vídeo, lo rehace desde cero con la misma dirección. El reproductor se confunde y salta 30 segundos hacia atrás.
5. Cuando le faltan datos, el reproductor se pausa para esperar. Esa pausa le impide saltar un pequeño hueco, así que se queda parado unos 12 segundos y luego pega un salto hacia delante. Mientras tanto, el botón DIRECTO no hace nada.
6. Además, la distancia al directo depende del tamaño de los trozos de vídeo. Cuando ese tamaño cambia, el reproductor salta solo hacia delante o hacia atrás.
7. Al abrir un partido, el programa enseña una búsqueda guardada de antes, hecha cuando el IPTV aún no estaba listo. Por eso solo sale AceStream hasta que pulsas «Rebuscar».
8. El canal «Gol Play» se confundía con una web por la palabra «Play», así que nunca se buscaba en tu IPTV.
9. En el buscador, la parte de AceStream sale ordenada sin tener en cuenta lo que escribes. Y palabras como «champions», «tve» o «a3» no encuentran sus canales.
10. El arreglo va por partes, empezando por las más importantes: la conexión que se queda colgada, las uniones rotas y el comportamiento del reproductor. Después vendrán los partidos y el buscador.
11. Cada arreglo se prueba en un laboratorio que reproduce exactamente tus fallos, y se revisa que no rompa AceStream ni la futura app del iPhone.