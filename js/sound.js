export class SoundManager {
  constructor(button) {
    this.button = button;
    this.enabled = true;
    this.context = null;
    button?.addEventListener('click', () => this.toggle());
    this._render();
  }

  async unlock() {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) return;
    if (!this.context) this.context = new AudioContextClass();
    if (this.context.state === 'suspended') await this.context.resume();
  }

  toggle() {
    this.enabled = !this.enabled;
    this._render();
  }

  suspend() { this.context?.suspend?.(); }
  resume() { if (this.enabled) this.context?.resume?.(); }

  coin() { this._tone(920, .06, 'sine', .05, 1280); }
  tick() { this._tone(520, .045, 'square', .022); }
  fall() { this._tone(210, .28, 'sine', .06, 76); }
  success() {
    this._tone(523, .1, 'sine', .045);
    window.setTimeout(() => this._tone(659, .1, 'sine', .045), 110);
    window.setTimeout(() => this._tone(784, .18, 'sine', .05), 220);
  }

  _tone(frequency, duration, type, volume, endFrequency = frequency) {
    if (!this.enabled || !this.context || this.context.state !== 'running') return;
    const now = this.context.currentTime;
    const oscillator = this.context.createOscillator();
    const gain = this.context.createGain();
    oscillator.type = type;
    oscillator.frequency.setValueAtTime(frequency, now);
    oscillator.frequency.exponentialRampToValueAtTime(Math.max(30, endFrequency), now + duration);
    gain.gain.setValueAtTime(.0001, now);
    gain.gain.exponentialRampToValueAtTime(volume, now + .012);
    gain.gain.exponentialRampToValueAtTime(.0001, now + duration);
    oscillator.connect(gain).connect(this.context.destination);
    oscillator.start(now);
    oscillator.stop(now + duration + .02);
  }

  _render() {
    if (!this.button) return;
    this.button.textContent = this.enabled ? '🔊' : '🔇';
    this.button.setAttribute('aria-label', this.enabled ? '关闭声音' : '开启声音');
    this.button.title = this.enabled ? '关闭声音' : '开启声音';
  }
}
