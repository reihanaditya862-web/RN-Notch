let context: AudioContext | null = null;

/**
 * A soft two-note chime (the focus timer ending). Generated, so no sound file
 * is shipped; quiet, so it never startles.
 */
export function playChime(): void {
  try {
    context ??= new AudioContext();
    const audio = context;
    const start = audio.currentTime + 0.02;
    [880, 1318.5].forEach((frequency, index) => {
      const oscillator = audio.createOscillator();
      const gain = audio.createGain();
      const at = start + index * 0.18;
      oscillator.type = "sine";
      oscillator.frequency.value = frequency;
      gain.gain.setValueAtTime(0, at);
      gain.gain.linearRampToValueAtTime(0.12, at + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.9);
      oscillator.connect(gain).connect(audio.destination);
      oscillator.start(at);
      oscillator.stop(at + 1);
    });
  } catch {
    // No audio device: the pop-up alone has to do.
  }
}
