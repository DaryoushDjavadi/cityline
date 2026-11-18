/** Node tests for the audio settings, the camera → audio scene sampler and the Bürger-Feed. */
import * as shared from "../shared/src/index.ts";
import { loadAudioSettings, saveAudioSettings, DEFAULT_AUDIO } from "../client/src/audio/settings.ts";
import { sampleAudioScene } from "../client/src/audio/scene.ts";
import { cityChatter } from "../client/src/ui/feed.ts";
import { buildLookCity } from "../client/src/render/lookCity.ts";

const store = new Map<string, string>();
(globalThis as unknown as { localStorage: Storage }).localStorage = {
  getItem: (key: string) => store.get(key) ?? null,
  setItem: (key: string, value: string) => void store.set(key, value),
  removeItem: (key: string) => void store.delete(key),
  clear: () => store.clear(),
  key: () => null,
  length: 0,
} as Storage;


let checks = 0;
function ok(cond: unknown, label: string): void {
  checks += 1;
  if (!cond) {
    console.error(`audio-tests FAIL: ${label}`);
    process.exit(1);
  }
}

// settings
ok(JSON.stringify(loadAudioSettings()) === JSON.stringify(DEFAULT_AUDIO), "defaults without storage");
store.set("cityline-audio", "{not json");
ok(loadAudioSettings().master === DEFAULT_AUDIO.master, "broken JSON falls back");
store.set("cityline-audio", JSON.stringify({ muted: true, master: 7, music: -1, musicOn: false, ui: "x" }));
const odd = loadAudioSettings();
ok(odd.muted === true && odd.master === 1 && odd.music === 0 && odd.musicOn === false && odd.ui === DEFAULT_AUDIO.ui, "values clamped / sanitized");
saveAudioSettings({ ...DEFAULT_AUDIO, ambienceOn: false, ambience: 0.25 });
const back = loadAudioSettings();
ok(back.ambienceOn === false && back.ambience === 0.25, "round trip");

// scene sampler
const { city, focusX, focusZ } = buildLookCity(9);
shared.refreshUtilities(city);
const near = sampleAudioScene(city, focusX, focusZ, 60, 40, true);
const far = sampleAudioScene(city, focusX, focusZ, 560, 40, true);
ok(near.zoom < 0.1 && far.zoom === 1, "zoom normalized from camera distance");
ok(near.homes > 0, `homes near the showcase focus (${near.homes})`);
ok(near.coast > 0, "showcase focus is near the coast");
for (const scene of [near, far]) {
  for (const key of ["traffic", "green", "coast", "harbor", "airport", "homes"] as const) {
    ok(scene[key] >= 0 && scene[key] <= 1, `${key} in 0..1`);
  }
  ok(scene.coastPan >= -1 && scene.coastPan <= 1, "coastPan in -1..1");
}
const offMap = sampleAudioScene(city, 1e6, 1e6, 200, 0, true);
ok(offMap.traffic === 0 && offMap.homes === 0, "off-map camera is silent city");
const empty = shared.createCity(64, 64);
const quiet = sampleAudioScene(empty, 0, 0, 120, 0, false);
ok(quiet.traffic === 0 && quiet.playing === false, "empty city has no traffic");

// feed
const meta = shared.buildMeta(city);
const seen = new Set<string>();
let previous = "";
for (let i = 0; i < 60; i += 1) {
  // Like the UI: recent set keeps growing; chatter must never dry up or repeat back-to-back.
  const line = cityChatter(city, meta, seen, previous);
  ok(line && line.text.length > 5 && line.who.includes(" "), `chatter returns a named line (#${i})`);
  ok(line!.text !== previous, "no back-to-back repeat");
  seen.add(line!.text);
  previous = line!.text;
}
const emptyMeta = shared.buildMeta(empty);
ok(cityChatter(empty, emptyMeta, new Set()) === null, "no chatter without residents");

console.log(`audio-tests ok (${checks} checks)`);
