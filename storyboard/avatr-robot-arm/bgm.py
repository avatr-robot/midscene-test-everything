"""Synthesize a 92s ambient-electronic bed for the storyboard (A minor, 100 BPM).

Usage: uv run --with numpy python bgm.py vo/bgm.wav
"""
import sys
import wave

import numpy as np

SR = 44100
DUR = 93.5
BEAT = 60 / 100
N = int(SR * DUR)
t = np.arange(N) / SR
rng = np.random.default_rng(7)


def hz(midi):
    return 440.0 * 2 ** ((midi - 69) / 12)


# Am - F - C - G, two bars each
CHORDS = [[57, 60, 64], [53, 57, 60], [48, 52, 55], [55, 59, 62]]
CHORD_LEN = 8 * BEAT


def chord_at(sec):
    return CHORDS[int(sec // CHORD_LEN) % 4]


def auto(points):
    """Piecewise-linear automation curve from (time, gain) pairs."""
    xs, ys = zip(*points)
    return np.interp(t, xs, ys)


def lowpass(x, cutoff):
    a = np.exp(-2 * np.pi * cutoff / SR)
    y = np.empty_like(x)
    acc = 0.0
    for i, v in enumerate(x):  # one-pole; fine for a 92s render
        acc = (1 - a) * v + a * acc
        y[i] = acc
    return y


def saw(freq, length, harmonics=8):
    tt = np.arange(length) / SR
    return sum(np.sin(2 * np.pi * freq * k * tt) / k for k in range(1, harmonics + 1))


# --- pad: detuned additive saws per chord, crossfaded ---
pad = np.zeros(N)
fade = int(0.8 * SR)
start = 0.0
final_chord_at = 88.4
while start < DUR:
    seg_len = CHORD_LEN if start < final_chord_at - CHORD_LEN else DUR - start
    notes = chord_at(start) if seg_len == CHORD_LEN else CHORDS[0]
    a, b = int(start * SR), min(N, int((start + seg_len) * SR) + fade)
    length = b - a
    seg = np.zeros(length)
    for m in notes:
        for det in (-0.12, 0.12):
            seg += saw(hz(m) * 2 ** (det / 12), length, 6)
    env = np.ones(length)
    env[:fade] = np.linspace(0, 1, fade)
    env[-fade:] *= np.linspace(1, 0, fade)
    pad[a:b] += seg * env
    start += seg_len
pad = lowpass(pad, 900)

# --- arp: plucked chord tones on 8ths ---
arp = np.zeros(N)
pl = int(0.35 * SR)
pluck_env = np.exp(-np.arange(pl) / SR * 9)
step = BEAT / 2
for i in range(int(DUR / step)):
    s = i * step
    tones = chord_at(s)
    m = tones[[0, 1, 2, 1][i % 4]] + 12 + (12 if i % 8 >= 4 else 0)
    a = int(s * SR)
    b = min(N, a + pl)
    tt = np.arange(b - a) / SR
    arp[a:b] += (np.sin(2 * np.pi * hz(m) * tt) + 0.3 * np.sin(4 * np.pi * hz(m) * tt)) * pluck_env[: b - a]

# --- bass: root pulse on 8ths ---
bass = np.zeros(N)
bl = int(0.28 * SR)
bass_env = np.exp(-np.arange(bl) / SR * 7)
for i in range(int(DUR / step)):
    s = i * step
    a = int(s * SR)
    b = min(N, a + bl)
    tt = np.arange(b - a) / SR
    f = hz(chord_at(s)[0] - 12)
    bass[a:b] += np.tanh(2 * np.sin(2 * np.pi * f * tt)) * bass_env[: b - a]
bass = lowpass(bass, 400)

# --- drums ---
kick = np.zeros(N)
kl = int(0.35 * SR)
kt = np.arange(kl) / SR
kick_one = np.sin(2 * np.pi * np.cumsum(45 + 90 * np.exp(-kt * 30)) / SR) * np.exp(-kt * 9)
hat = np.zeros(N)
hl = int(0.05 * SR)
hat_one = np.diff(rng.standard_normal(hl + 1)) * np.exp(-np.arange(hl) / SR * 80)
for i in range(int(DUR / BEAT)):
    a = int(i * BEAT * SR)
    b = min(N, a + kl)
    kick[a:b] += kick_one[: b - a]
    h = int((i + 0.5) * BEAT * SR)
    e = min(N, h + hl)
    hat[h:e] += hat_one[: e - h]

# --- riser into the test loop, and soft impacts on scene changes ---
riser = np.zeros(N)
ra, rb = int(43.5 * SR), int(46 * SR)
noise = rng.standard_normal(rb - ra)
riser[ra:rb] = lowpass(noise, 3000) * np.linspace(0, 1, rb - ra) ** 2
impact = np.zeros(N)
il = int(2.5 * SR)
it = np.arange(il) / SR
impact_one = np.sin(2 * np.pi * 38 * it) * np.exp(-it * 2.2)
for s in (46.0, 76.0, 88.4):
    a = int(s * SR)
    b = min(N, a + il)
    impact[a:b] += impact_one[: b - a]

mix = (
    pad / np.abs(pad).max() * auto([(0, 0), (3, .55), (20, .5), (35, .42), (46, .5), (62, .55), (88.4, .6), (89.5, .75), (92, .6), (93.5, 0)])
    + arp / np.abs(arp).max() * auto([(0, 0), (8, 0), (9.5, .3), (20, .3), (21, .18), (35, .2), (37, .45), (46, .55), (62, .55), (63, .35), (65.8, .45), (76, .45), (76.5, .5), (83.5, .45), (84.5, .3), (88.4, .3), (90, .15), (93.5, 0)])
    + bass / np.abs(bass).max() * auto([(0, 0), (20, 0), (21, .4), (35, .5), (46, .7), (62, .7), (63, .25), (65.8, .5), (76, .55), (83.5, .55), (84.5, 0), (93.5, 0)])
    + kick / np.abs(kick).max() * auto([(0, 0), (35, 0), (35.1, .55), (46, .75), (62, .75), (62.1, 0), (65.8, 0), (65.9, .5), (76, .55), (76.1, .6), (83.5, .6), (83.6, 0), (93.5, 0)])
    + hat / np.abs(hat).max() * auto([(0, 0), (38.3, 0), (38.4, .18), (46, .25), (62, .25), (62.1, 0), (71.6, 0), (71.7, .2), (83.5, .22), (83.6, 0), (93.5, 0)])
    + riser / np.abs(riser).max() * .3
    + impact * .6
)
mix = np.tanh(mix * 0.9) * 0.8
pcm = (mix * 32767).astype(np.int16)
with wave.open(sys.argv[1] if len(sys.argv) > 1 else 'bgm.wav', 'wb') as w:
    w.setnchannels(1)
    w.setsampwidth(2)
    w.setframerate(SR)
    w.writeframes(pcm.tobytes())
print('ok')
