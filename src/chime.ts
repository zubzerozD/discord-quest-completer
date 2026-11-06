//! Completion chime: plays a short pleasant tone via the Web Audio API
//! when a quest timer reaches 00:00. No audio file needed — it synthesises
//! a two-note ascending chime that is unobtrusive but audible even when
//! the user is in another app or fullscreen.
//!
//! Never throws: audio is best-effort, just like OS notifications.

let ctx: AudioContext | null = null;

function getContext(): AudioContext | null {
  try {
    if (!ctx || ctx.state === "closed") {
      ctx = new AudioContext();
    }
    if (ctx.state === "suspended") {
      void ctx.resume();
    }
    return ctx;
  } catch {
    return null;
  }
}

/**
 * Plays a two-note ascending chime (~0.5 s total).
 * Safe to call at any time; silently does nothing if audio is unavailable.
 */
export function playCompletionChime(): void {
  const audio = getContext();
  if (!audio) return;

  try {
    const now = audio.currentTime;

    // Shared gain envelope
    const gain = audio.createGain();
    gain.connect(audio.destination);
    gain.gain.setValueAtTime(0.18, now);
    gain.gain.linearRampToValueAtTime(0.18, now + 0.35);
    gain.gain.linearRampToValueAtTime(0, now + 0.55);

    // Note 1: E5 (659 Hz) — 0 to 0.25s
    const osc1 = audio.createOscillator();
    osc1.type = "sine";
    osc1.frequency.setValueAtTime(659.25, now);
    osc1.connect(gain);
    osc1.start(now);
    osc1.stop(now + 0.25);

    // Note 2: A5 (880 Hz) — 0.15s to 0.55s (overlaps slightly)
    const osc2 = audio.createOscillator();
    osc2.type = "sine";
    osc2.frequency.setValueAtTime(880, now);
    osc2.connect(gain);
    osc2.start(now + 0.15);
    osc2.stop(now + 0.55);
  } catch {
    // Audio synthesis is best-effort.
  }
}
