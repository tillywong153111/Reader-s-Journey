import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const SAMPLE_RATE = 44100;

function makeTone({ frequency, durationMs, gain = 0.2, attackMs = 8, releaseMs = 60 }) {
  const totalSamples = Math.max(1, Math.floor((SAMPLE_RATE * durationMs) / 1000));
  const attackSamples = Math.max(1, Math.floor((SAMPLE_RATE * attackMs) / 1000));
  const releaseSamples = Math.max(1, Math.floor((SAMPLE_RATE * releaseMs) / 1000));
  const samples = new Float32Array(totalSamples);

  for (let i = 0; i < totalSamples; i += 1) {
    const t = i / SAMPLE_RATE;
    let env = 1;
    if (i < attackSamples) {
      env = i / attackSamples;
    } else if (i > totalSamples - releaseSamples) {
      env = (totalSamples - i) / releaseSamples;
    }
    samples[i] = Math.sin(2 * Math.PI * frequency * t) * gain * Math.max(0, env);
  }
  return samples;
}

function concatSamples(parts) {
  const size = parts.reduce((acc, part) => acc + part.length, 0);
  const output = new Float32Array(size);
  let offset = 0;
  for (const part of parts) {
    output.set(part, offset);
    offset += part.length;
  }
  return output;
}

function silence(durationMs) {
  return new Float32Array(Math.floor((SAMPLE_RATE * durationMs) / 1000));
}

function floatToInt16(sample) {
  const clamped = Math.max(-1, Math.min(1, sample));
  return clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff;
}

function encodeWavMono(samples) {
  const dataSize = samples.length * 2;
  const buffer = Buffer.alloc(44 + dataSize);

  buffer.write("RIFF", 0);
  buffer.writeUInt32LE(36 + dataSize, 4);
  buffer.write("WAVE", 8);
  buffer.write("fmt ", 12);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(SAMPLE_RATE, 24);
  buffer.writeUInt32LE(SAMPLE_RATE * 2, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write("data", 36);
  buffer.writeUInt32LE(dataSize, 40);

  for (let i = 0; i < samples.length; i += 1) {
    buffer.writeInt16LE(Math.round(floatToInt16(samples[i])), 44 + i * 2);
  }
  return buffer;
}

function writeWav(path, samples) {
  writeFileSync(path, encodeWavMono(samples));
}

function normalizeBuffer(buffer, targetPeak = 0.85) {
  let max = 0;
  for (let i = 0; i < buffer.length; i += 1) {
    const value = Math.abs(buffer[i]);
    if (value > max) {
      max = value;
    }
  }
  if (max <= targetPeak) return buffer;
  const scale = targetPeak / max;
  for (let i = 0; i < buffer.length; i += 1) {
    buffer[i] *= scale;
  }
  return buffer;
}

function centsToRatio(cents) {
  return Math.pow(2, cents / 1200);
}

function addAmbientVoice(
  buffer,
  {
    frequency,
    gain,
    lfoHz,
    driftHz,
    phaseOffset = 0,
    harmonicMix = 0.18,
    detuneCents = 0
  }
) {
  const ratio = centsToRatio(detuneCents);
  const angularBase = (2 * Math.PI * frequency * ratio) / SAMPLE_RATE;
  const lfoPhase = phaseOffset * 0.63;
  const driftPhase = phaseOffset * 0.27;
  let phase = phaseOffset;

  for (let i = 0; i < buffer.length; i += 1) {
    const t = i / SAMPLE_RATE;
    const drift = 1 + 0.0028 * Math.sin(2 * Math.PI * driftHz * t + driftPhase);
    phase += angularBase * drift;
    if (phase > Math.PI * 2) {
      phase -= Math.PI * 2;
    }
    const fundamental = Math.sin(phase);
    const overtone = Math.sin(phase * 2 + phaseOffset * 0.41);
    const lfo = 0.82 + 0.18 * Math.sin(2 * Math.PI * lfoHz * t + lfoPhase);
    buffer[i] += (fundamental * (1 - harmonicMix) + overtone * harmonicMix) * gain * lfo;
  }
}

function addShimmerLayer(buffer, { frequency, gain, lfoHz, driftHz, phaseOffset = 0 }) {
  let phase = phaseOffset;
  const angularBase = (2 * Math.PI * frequency) / SAMPLE_RATE;
  for (let i = 0; i < buffer.length; i += 1) {
    const t = i / SAMPLE_RATE;
    const drift = 1 + 0.002 * Math.sin(2 * Math.PI * driftHz * t + phaseOffset * 0.12);
    phase += angularBase * drift;
    if (phase > Math.PI * 2) {
      phase -= Math.PI * 2;
    }
    const lfo = 0.52 + 0.48 * Math.sin(2 * Math.PI * lfoHz * t + phaseOffset * 0.91);
    const tone = Math.sin(phase) * 0.74 + Math.sin(phase * 1.5 + 0.8) * 0.26;
    buffer[i] += tone * gain * lfo;
  }
}

function applyGlobalEnvelope(buffer, fadeInMs, fadeOutMs) {
  const fadeInSamples = Math.max(1, Math.floor((SAMPLE_RATE * fadeInMs) / 1000));
  const fadeOutSamples = Math.max(1, Math.floor((SAMPLE_RATE * fadeOutMs) / 1000));
  const total = buffer.length;

  for (let i = 0; i < total; i += 1) {
    let env = 1;
    if (i < fadeInSamples) {
      env = i / fadeInSamples;
    } else if (i > total - fadeOutSamples) {
      env = (total - i) / fadeOutSamples;
    }
    const soft = Math.tanh(buffer[i] * 0.92);
    buffer[i] = soft * Math.max(0, env);
  }
}

function synthesizeBgm({
  rootHz,
  ratios,
  durationMs,
  padGain,
  droneGain,
  shimmerGain
}) {
  const totalSamples = Math.floor((SAMPLE_RATE * durationMs) / 1000);
  const buffer = new Float32Array(totalSamples);

  for (let i = 0; i < ratios.length; i += 1) {
    const baseFreq = rootHz * ratios[i];
    addAmbientVoice(buffer, {
      frequency: baseFreq,
      gain: padGain * 0.9,
      lfoHz: 0.0014 + i * 0.00035,
      driftHz: 0.0011 + i * 0.00028,
      phaseOffset: baseFreq * 0.017,
      harmonicMix: 0.08,
      detuneCents: -3
    });
    addAmbientVoice(buffer, {
      frequency: baseFreq,
      gain: padGain * 0.7,
      lfoHz: 0.0018 + i * 0.00032,
      driftHz: 0.0014 + i * 0.00026,
      phaseOffset: baseFreq * 0.023,
      harmonicMix: 0.06,
      detuneCents: 3
    });
  }

  addAmbientVoice(buffer, {
    frequency: rootHz * 0.5,
    gain: droneGain,
    lfoHz: 0.001,
    driftHz: 0.0009,
    phaseOffset: rootHz * 0.031,
    harmonicMix: 0.03,
    detuneCents: 0
  });

  addShimmerLayer(buffer, {
    frequency: rootHz * 4.5,
    gain: shimmerGain,
    lfoHz: 0.0028,
    driftHz: 0.0018,
    phaseOffset: rootHz * 0.012
  });

  applyGlobalEnvelope(buffer, 12000, 12000);
  return normalizeBuffer(buffer, 0.84);
}

function main() {
  const outputDir = resolve(process.cwd(), "src/assets/audio");
  mkdirSync(outputDir, { recursive: true });

  const entry = concatSamples([
    makeTone({ frequency: 740, durationMs: 90, gain: 0.16 }),
    silence(20),
    makeTone({ frequency: 988, durationMs: 120, gain: 0.2 })
  ]);

  const skill = concatSamples([
    makeTone({ frequency: 660, durationMs: 120, gain: 0.18 }),
    silence(20),
    makeTone({ frequency: 880, durationMs: 120, gain: 0.19 }),
    silence(20),
    makeTone({ frequency: 1175, durationMs: 160, gain: 0.2 })
  ]);

  const level = concatSamples([
    makeTone({ frequency: 523, durationMs: 120, gain: 0.17 }),
    silence(18),
    makeTone({ frequency: 659, durationMs: 120, gain: 0.18 }),
    silence(18),
    makeTone({ frequency: 784, durationMs: 140, gain: 0.19 }),
    silence(18),
    makeTone({ frequency: 1046, durationMs: 220, gain: 0.2 })
  ]);

  const tap = concatSamples([
    makeTone({ frequency: 1180, durationMs: 40, gain: 0.12, attackMs: 2, releaseMs: 24 }),
    silence(6),
    makeTone({ frequency: 920, durationMs: 46, gain: 0.1, attackMs: 2, releaseMs: 30 })
  ]);

  const bgmAstral = synthesizeBgm({
    rootHz: 196.0,
    ratios: [1, 1.25, 1.5, 2],
    durationMs: 72000,
    padGain: 0.024,
    droneGain: 0.022,
    shimmerGain: 0.0014
  });

  const bgmSanctum = synthesizeBgm({
    rootHz: 164.81,
    ratios: [1, 1.2, 1.5, 1.875],
    durationMs: 70000,
    padGain: 0.023,
    droneGain: 0.024,
    shimmerGain: 0.0012
  });

  writeWav(resolve(outputDir, "entry-success.wav"), entry);
  writeWav(resolve(outputDir, "skill-unlock.wav"), skill);
  writeWav(resolve(outputDir, "level-up.wav"), level);
  writeWav(resolve(outputDir, "ui-tap.wav"), tap);
  writeWav(resolve(outputDir, "bgm-astral-loop.wav"), bgmAstral);
  writeWav(resolve(outputDir, "bgm-sanctum-loop.wav"), bgmSanctum);

  console.log("Audio assets generated in src/assets/audio");
}

main();
