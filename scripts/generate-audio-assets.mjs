import { writeFileSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";

const SAMPLE_RATE = 44100;

function makeTone({ frequency, durationMs, gain = 0.2, attackMs = 8, releaseMs = 60 }) {
  const totalSamples = Math.floor((SAMPLE_RATE * durationMs) / 1000);
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

  writeWav(resolve(outputDir, "entry-success.wav"), entry);
  writeWav(resolve(outputDir, "skill-unlock.wav"), skill);
  writeWav(resolve(outputDir, "level-up.wav"), level);

  console.log("Audio assets generated in src/assets/audio");
}

main();
