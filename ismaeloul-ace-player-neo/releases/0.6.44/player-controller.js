/*
 * ACE NEO player controller
 *
 * The media element, the P2P recovery loop and the person watching the stream
 * all produce play/pause events.  This controller keeps those three sources
 * separate and serialises every user command so an older play() promise can
 * never undo a newer pause.
 */
(function exposeNeoPlayer(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.NeoPlayerCore = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function createNeoPlayerCore() {
  "use strict";

  const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

  function rangeValue(ranges, method, index) {
    try {
      const value = ranges[method](index);
      return Number.isFinite(value) ? value : null;
    } catch {
      return null;
    }
  }

  function readSeekWindow(media) {
    const ranges = media && media.seekable;
    if (!ranges || !ranges.length) return null;
    const current = Number.isFinite(media.currentTime) ? media.currentTime : 0;
    let selected = ranges.length - 1;
    for (let index = 0; index < ranges.length; index += 1) {
      const start = rangeValue(ranges, "start", index);
      const end = rangeValue(ranges, "end", index);
      if (start !== null && end !== null && current >= start - 0.25 && current <= end + 0.25) {
        selected = index;
        break;
      }
    }
    const start = rangeValue(ranges, "start", selected);
    const end = rangeValue(ranges, "end", selected);
    if (start === null || end === null || end <= start) return null;
    return { start, end, duration: end - start };
  }

  function waitForMedia(media, eventNames, timeoutMs, isCurrent) {
    return new Promise((resolve) => {
      let settled = false;
      const listeners = [];
      let timer = null;
      const finish = (reason) => {
        if (settled) return;
        settled = true;
        if (timer) clearTimeout(timer);
        for (const [eventName, listener] of listeners) media.removeEventListener(eventName, listener);
        resolve(reason);
      };
      for (const eventName of eventNames) {
        const listener = () => finish(eventName);
        listeners.push([eventName, listener]);
        media.addEventListener(eventName, listener, { once: true });
      }
      timer = setTimeout(() => finish("timeout"), timeoutMs);
      if (typeof isCurrent === "function" && !isCurrent()) finish("cancelled");
    });
  }

  class NeoPlayerController {
    constructor(media, options = {}) {
      if (!media) throw new TypeError("NeoPlayerController needs a media element");
      this.media = media;
      this.options = options;
      this.sessionKey = "";
      this.command = 0;
      this.holds = new Set();
      this.state = {
        desiredPlaying: false,
        busy: false,
        waiting: false,
        seeking: false,
        blocked: false,
        error: "",
        origin: "idle",
      };
      this.lastInternalPauseAt = 0;
      this.listeners = [];
      this.bindMediaEvents();
    }

    isDemo() {
      return Boolean(this.options.isDemo && this.options.isDemo());
    }

    isActive() {
      if (!this.sessionKey) return false;
      return this.options.isActive ? Boolean(this.options.isActive(this.sessionKey)) : true;
    }

    bindMediaEvents() {
      const listen = (name, handler) => {
        this.media.addEventListener(name, handler);
        this.listeners.push([name, handler]);
      };
      listen("playing", () => {
        this.state.busy = false;
        this.state.waiting = false;
        this.state.blocked = false;
        this.state.error = "";
        this.emit();
      });
      listen("play", () => this.emit());
      listen("pause", () => {
        const technicalPause = Date.now() - this.lastInternalPauseAt < 600;
        if (!technicalPause && !this.state.busy && !this.state.seeking && !this.holds.size) {
          this.state.desiredPlaying = false;
          this.state.origin = "native-pause";
        }
        this.emit();
      });
      listen("waiting", () => {
        if (this.state.desiredPlaying) this.state.waiting = true;
        this.emit();
      });
      listen("canplay", () => {
        if (!this.media.seeking) this.state.waiting = false;
        this.emit();
      });
      listen("seeking", () => {
        this.state.seeking = true;
        this.emit();
      });
      listen("seeked", () => {
        this.state.seeking = false;
        this.emit();
      });
      listen("ended", () => {
        this.state.desiredPlaying = false;
        this.state.busy = false;
        this.state.waiting = false;
        this.emit();
      });
      listen("error", () => {
        this.state.busy = false;
        this.state.waiting = false;
        this.state.error = "media-error";
        this.emit();
      });
      for (const name of ["timeupdate", "progress", "durationchange", "volumechange", "ratechange"]) {
        listen(name, () => this.emit());
      }
    }

    snapshot() {
      const active = this.isActive();
      const demo = this.isDemo();
      const actuallyPlaying = active && (demo
        ? this.state.desiredPlaying
        : !this.media.paused && !this.media.ended);
      let phase = "idle";
      if (active) {
        if (this.state.blocked) phase = "blocked";
        else if (this.state.seeking) phase = "seeking";
        else if (this.state.desiredPlaying && (this.holds.size || this.state.waiting)) phase = "buffering";
        else if (this.state.busy && this.state.desiredPlaying) phase = "starting";
        else if (actuallyPlaying) phase = "playing";
        else phase = "paused";
      }
      return {
        ...this.state,
        active,
        demo,
        actuallyPlaying,
        phase,
        held: this.holds.size > 0,
        holds: [...this.holds],
      };
    }

    emit() {
      if (typeof this.options.onState === "function") this.options.onState(this.snapshot());
    }

    setSession(sessionKey) {
      this.command += 1;
      this.sessionKey = String(sessionKey || "");
      this.holds.clear();
      Object.assign(this.state, {
        desiredPlaying: false,
        busy: false,
        waiting: false,
        seeking: false,
        blocked: false,
        error: "",
        origin: "session",
      });
      this.emit();
    }

    reset() {
      this.command += 1;
      this.sessionKey = "";
      this.holds.clear();
      Object.assign(this.state, {
        desiredPlaying: false,
        busy: false,
        waiting: false,
        seeking: false,
        blocked: false,
        error: "",
        origin: "reset",
      });
      this.pauseMedia();
      this.emit();
    }

    pauseMedia() {
      this.lastInternalPauseAt = Date.now();
      try { this.media.pause(); } catch {}
    }

    async playForCommand(command, origin) {
      if (command !== this.command || !this.state.desiredPlaying || !this.isActive() || this.holds.size) {
        return { ok: false, reason: "cancelled" };
      }
      if (this.isDemo()) {
        this.state.busy = false;
        this.state.waiting = false;
        this.emit();
        return { ok: true, reason: "demo" };
      }
      if (!this.media.paused && !this.media.ended) {
        this.state.busy = false;
        this.state.waiting = false;
        this.emit();
        return { ok: true, reason: "already-playing" };
      }
      this.state.busy = true;
      this.state.waiting = false;
      this.state.origin = origin;
      this.emit();
      try {
        const result = this.media.play();
        if (result && typeof result.then === "function") await result;
      } catch (error) {
        if (command !== this.command) return { ok: false, reason: "cancelled" };
        this.state.busy = false;
        if (error && error.name === "NotAllowedError") {
          this.state.desiredPlaying = false;
          this.state.blocked = true;
          this.pauseMedia();
          if (typeof this.options.onAutoplayBlocked === "function") this.options.onAutoplayBlocked(error);
        } else if (!error || error.name !== "AbortError") {
          this.state.error = error && error.name ? error.name : "play-failed";
          if (typeof this.options.onError === "function") this.options.onError(error);
        }
        this.emit();
        return { ok: false, reason: this.state.blocked ? "blocked" : "failed", error };
      }
      if (command !== this.command || !this.state.desiredPlaying || this.holds.size || !this.isActive()) {
        this.pauseMedia();
        return { ok: false, reason: "superseded" };
      }
      this.state.busy = false;
      this.state.waiting = false;
      this.state.blocked = false;
      this.state.error = "";
      this.emit();
      return { ok: true, reason: "playing" };
    }

    requestPlay(origin = "user") {
      if (!this.isActive()) return Promise.resolve({ ok: false, reason: "inactive" });
      this.state.desiredPlaying = true;
      this.state.blocked = false;
      this.state.error = "";
      this.state.origin = origin;
      const command = ++this.command;
      if (this.holds.size) {
        this.state.busy = false;
        this.emit();
        return Promise.resolve({ ok: true, reason: "held" });
      }
      return this.playForCommand(command, origin);
    }

    requestPause(origin = "user") {
      this.command += 1;
      this.state.desiredPlaying = false;
      this.state.busy = false;
      this.state.waiting = false;
      this.state.seeking = false;
      this.state.blocked = false;
      this.state.origin = origin;
      this.pauseMedia();
      this.emit();
      return { ok: true, reason: "paused" };
    }

    toggle(origin = "user") {
      const snapshot = this.snapshot();
      if (!snapshot.active) return Promise.resolve({ ok: false, reason: "inactive" });
      const shouldPause = snapshot.desiredPlaying && (snapshot.busy || snapshot.held || snapshot.actuallyPlaying);
      return shouldPause ? Promise.resolve(this.requestPause(origin)) : this.requestPlay(origin);
    }

    setHold(reason, active, options = {}) {
      const key = String(reason || "buffer");
      const resume = options.resume !== false;
      if (active) {
        this.holds.add(key);
        this.state.waiting = this.state.desiredPlaying;
        this.state.busy = false;
        if (!this.isDemo() && !this.media.paused) this.pauseMedia();
        this.emit();
        return Promise.resolve({ ok: true, reason: "held" });
      }
      this.holds.delete(key);
      if (!this.holds.size) this.state.waiting = false;
      this.emit();
      if (resume && !this.holds.size && this.state.desiredPlaying) return this.requestPlay(`resume-${key}`);
      return Promise.resolve({ ok: true, reason: "released" });
    }

    async seekTo(target, options = {}) {
      if (!this.isActive() || this.isDemo() || !Number.isFinite(target)) {
        return { ok: false, reason: "unavailable" };
      }
      const window = readSeekWindow(this.media);
      const destination = window ? clamp(target, window.start, window.end) : Math.max(0, target);
      const preservePlaying = options.playAfter !== undefined
        ? Boolean(options.playAfter)
        : this.state.desiredPlaying;
      this.state.desiredPlaying = preservePlaying;
      this.state.seeking = true;
      this.state.busy = preservePlaying;
      this.state.waiting = false;
      this.state.origin = options.origin || "timeline";
      const command = ++this.command;
      this.emit();
      try { this.media.currentTime = destination; }
      catch (error) {
        this.state.seeking = false;
        this.state.busy = false;
        this.state.error = "seek-failed";
        this.emit();
        return { ok: false, reason: "seek-failed", error };
      }
      if (Math.abs((Number(this.media.currentTime) || 0) - destination) > 0.2 || this.media.seeking) {
        await waitForMedia(this.media, ["seeked", "canplay"], options.timeoutMs || 1800,
          () => command === this.command);
      }
      if (command !== this.command) return { ok: false, reason: "cancelled" };
      this.state.seeking = false;
      this.state.busy = false;
      this.emit();
      if (preservePlaying) return this.playForCommand(command, options.origin || "timeline");
      this.pauseMedia();
      return { ok: true, reason: "seeked-paused" };
    }

    async goLive(targetInfo) {
      if (!this.isActive()) return { ok: false, reason: "inactive" };
      this.state.desiredPlaying = true;
      this.state.blocked = false;
      this.state.origin = "live";
      if (this.isDemo()) return this.requestPlay("live");
      const resolved = typeof targetInfo === "function" ? targetInfo() : targetInfo;
      const target = Number.isFinite(resolved) ? resolved : resolved && resolved.target;
      const behind = resolved && Number.isFinite(resolved.behind)
        ? resolved.behind
        : (Number.isFinite(target) ? Math.max(0, target - (Number(this.media.currentTime) || 0)) : 0);
      if (!Number.isFinite(target)) return this.requestPlay("live-no-target");
      if (behind <= (this.options.liveTolerance || 1.25)) return this.requestPlay("live-already");
      return this.seekTo(target, { playAfter: true, origin: "live", timeoutMs: 2200 });
    }

    destroy() {
      this.reset();
      for (const [name, handler] of this.listeners) this.media.removeEventListener(name, handler);
      this.listeners = [];
    }
  }

  return { NeoPlayerController, clamp, readSeekWindow, waitForMedia };
});
