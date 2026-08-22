"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");

const manifest = fs.readFileSync(path.join(__dirname, "../umbrel-app.yml"), "utf8");
const releaseVersion = manifest.match(/^version:\s*"([^"]+)"/m)?.[1];
const { NeoPlayerController, readSeekWindow, resolveLiveTarget } = require(path.join(
  __dirname,
  "../releases",
  releaseVersion,
  "player-controller.js"
));

function ranges(entries) {
  return {
    length: entries.length,
    start(index) { return entries[index][0]; },
    end(index) { return entries[index][1]; },
  };
}

class FakeMedia extends EventTarget {
  constructor() {
    super();
    this.paused = true;
    this.ended = false;
    this.readyState = 4;
    this.seeking = false;
    this.seekable = ranges([[0, 120]]);
    this.buffered = ranges([[0, 120]]);
    this.playCalls = 0;
    this.pauseCalls = 0;
    this.playImpl = null;
    this._currentTime = 0;
  }

  get currentTime() { return this._currentTime; }
  set currentTime(value) {
    this._currentTime = value;
    this.seeking = true;
    this.dispatchEvent(new Event("seeking"));
  }

  play() {
    this.playCalls += 1;
    this.paused = false;
    this.dispatchEvent(new Event("play"));
    if (this.playImpl) return this.playImpl();
    this.dispatchEvent(new Event("playing"));
    return Promise.resolve();
  }

  pause() {
    this.pauseCalls += 1;
    this.paused = true;
    this.dispatchEvent(new Event("pause"));
  }

  finishSeek() {
    this.seeking = false;
    this.dispatchEvent(new Event("seeked"));
  }
}

function controllerFor(media, options = {}) {
  let active = "canal";
  const controller = new NeoPlayerController(media, {
    isActive: (key) => key === active,
    isDemo: () => false,
    ...options,
  });
  controller.setSession(active);
  return { controller, deactivate: () => { active = ""; } };
}

test("una pausa nueva gana a una promesa play anterior", async () => {
  const media = new FakeMedia();
  let resolvePlay;
  media.playImpl = () => new Promise((resolve) => { resolvePlay = resolve; });
  const { controller } = controllerFor(media);

  const pendingPlay = controller.requestPlay("button");
  controller.requestPause("button");
  resolvePlay();
  const result = await pendingPlay;

  assert.equal(result.reason, "superseded");
  assert.equal(media.paused, true);
  assert.equal(controller.snapshot().desiredPlaying, false);
});

test("el salto al directo espera seeked y llama play una sola vez", async () => {
  const media = new FakeMedia();
  media._currentTime = 40;
  const { controller } = controllerFor(media);
  controller.requestPause("button");

  const pending = controller.goLive({ target: 108, behind: 68 });
  assert.equal(media.currentTime, 108);
  assert.equal(media.playCalls, 0);
  assert.equal(controller.snapshot().phase, "seeking");
  assert.equal(controller.snapshot().followingLiveEdge, true);

  media.finishSeek();
  const result = await pending;
  assert.equal(result.ok, true);
  assert.equal(media.playCalls, 1);
  assert.equal(media.paused, false);
});

test("una pausa del usuario durante el rebuffer impide el auto-resume", async () => {
  const media = new FakeMedia();
  const { controller } = controllerFor(media);
  await controller.requestPlay("startup");
  assert.equal(media.playCalls, 1);

  await controller.setHold("rebuffer", true);
  assert.equal(controller.snapshot().desiredPlaying, true);
  assert.equal(controller.snapshot().followingLiveEdge, true);
  assert.equal(media.paused, true);

  controller.requestPause("button");
  assert.equal(controller.snapshot().followingLiveEdge, false);
  await controller.setHold("rebuffer", false, { resume: true });
  assert.equal(media.playCalls, 1);
  assert.equal(media.paused, true);
  assert.equal(controller.snapshot().phase, "paused");
});

test("un bloqueo de autoplay se refleja sin fingir que reproduce", async () => {
  const media = new FakeMedia();
  const error = new Error("blocked");
  error.name = "NotAllowedError";
  media.playImpl = () => Promise.reject(error);
  let blocked = 0;
  const { controller } = controllerFor(media, { onAutoplayBlocked: () => { blocked += 1; } });

  const result = await controller.requestPlay("startup");
  assert.equal(result.reason, "blocked");
  assert.equal(blocked, 1);
  assert.equal(controller.snapshot().phase, "blocked");
  assert.equal(controller.snapshot().desiredPlaying, false);
});

test("la ventana de directo usa el rango seekable que contiene la reproducción", () => {
  const media = new FakeMedia();
  media.seekable = ranges([[0, 20], [50, 110]]);
  media._currentTime = 72;
  assert.deepEqual(readSeekWindow(media), { start: 50, end: 110, duration: 60 });
});

test("el borde directo conserva el búfer de seguridad en vez de vaciarlo", () => {
  const window = { start: 0, end: 120, duration: 120 };
  assert.equal(resolveLiveTarget(window, 119, 8), 112);
  assert.equal(resolveLiveTarget(window, 104, 8), 104);
  assert.equal(resolveLiveTarget({ start: 20, end: 24, duration: 4 }, 24, 8), 20.5);
});

test("pulsar directo durante el rebuffer no vuelve a saltar", async () => {
  const media = new FakeMedia();
  media._currentTime = 108;
  const { controller } = controllerFor(media);
  await controller.requestPlay("startup");
  await controller.setHold("rebuffer", true);

  const before = media.currentTime;
  const result = await controller.goLive({ target: 116, behind: 8 });

  assert.equal(result.reason, "held");
  assert.equal(media.currentTime, before);
  assert.equal(controller.snapshot().followingLiveEdge, true);
  assert.equal(controller.snapshot().phase, "buffering");
});
