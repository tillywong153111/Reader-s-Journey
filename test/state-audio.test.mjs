import test from "node:test";
import assert from "node:assert/strict";

import { createInitialState, normalizeState } from "../src/lib/state.mjs";

test("initial state contains audio profile defaults", () => {
  const state = createInitialState();
  assert.equal(state.appMeta.schemaVersion, 4);
  assert.deepEqual(state.profile.audio, {
    masterEnabled: true,
    bgmEnabled: true,
    sfxEnabled: true,
    bgmVolume: 46,
    sfxVolume: 76,
    bgmBootstrapped: false
  });
});

test("normalizeState migrates legacy soundEnabled=false", () => {
  const state = normalizeState({
    profile: {
      soundEnabled: false
    }
  });

  assert.equal(state.profile.audio.masterEnabled, false);
  assert.equal(state.profile.audio.bgmEnabled, false);
  assert.equal(state.profile.audio.sfxEnabled, false);
});

test("normalizeState keeps explicit audio profile and clamps volume", () => {
  const state = normalizeState({
    profile: {
      audio: {
        masterEnabled: true,
        bgmEnabled: false,
        sfxEnabled: true,
        bgmVolume: 200,
        sfxVolume: -8,
        bgmBootstrapped: 1
      }
    }
  });

  assert.equal(state.profile.audio.masterEnabled, true);
  assert.equal(state.profile.audio.bgmEnabled, false);
  assert.equal(state.profile.audio.sfxEnabled, true);
  assert.equal(state.profile.audio.bgmVolume, 100);
  assert.equal(state.profile.audio.sfxVolume, 0);
  assert.equal(state.profile.audio.bgmBootstrapped, true);
});

test("normalizeState migrates legacy books with reflections timeline", () => {
  const state = normalizeState({
    books: [
      {
        title: "测试书",
        author: "作者",
        pages: 200,
        progress: 30,
        reflections: [
          {
            text: "第一条"
          },
          {
            text: "a".repeat(1400),
            createdAt: 10,
            updatedAt: 20,
            progressAt: 200
          }
        ]
      }
    ]
  });

  assert.equal(state.appMeta.schemaVersion, 4);
  assert.equal(Array.isArray(state.books[0].reflections), true);
  assert.equal(state.books[0].reflections.length, 2);
  assert.equal(state.books[0].reflections[0].text.length <= 1000, true);
  assert.equal(state.books[0].reflections[0].progressAt <= 100, true);
  assert.equal(Number.isFinite(state.books[0].updatedAt), true);
});
