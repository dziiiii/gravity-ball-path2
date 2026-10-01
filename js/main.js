import { GravityBallGame } from './game.js';
import { SoundManager } from './sound.js';

const PHONE_PATTERN = /^1[3-9]\d{9}$/;
const canvas = document.getElementById('game-canvas');
const sound = new SoundManager(document.getElementById('sound-toggle'));
const game = new GravityBallGame(canvas, sound);

const form = document.getElementById('start-form');
const input = document.getElementById('phone-input');
const field = document.getElementById('phone-field');
const error = document.getElementById('phone-error');
const startButton = document.getElementById('btn-start');

function normalizedPhone() {
  return input.value.replace(/\D/g, '').slice(0, 11);
}

function validate(showError = false) {
  const valid = PHONE_PATTERN.test(normalizedPhone());
  startButton.disabled = !valid;
  field.classList.toggle('has-error', showError && !valid);
  error.hidden = !(showError && !valid);
  input.setAttribute('aria-invalid', String(showError && !valid));
  return valid;
}

input.addEventListener('input', () => {
  input.value = normalizedPhone();
  validate(false);
});
input.addEventListener('blur', () => validate(input.value.length > 0));

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (!validate(true)) {
    input.focus();
    return;
  }

  const phone = normalizedPhone();
  const maskedPhone = `${phone.slice(0, 3)}****${phone.slice(-4)}`;
  startButton.disabled = true;
  startButton.textContent = '正在确认今日资格…';

  try {
    const response = await fetch('./api/enter', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone }),
    });
    const result = await response.json();
    if (!response.ok || !result.allowed) throw new Error(result.error || '暂时无法开始，请稍后再试');
  } catch (requestError) {
    field.classList.add('has-error');
    error.hidden = false;
    error.textContent = requestError.message || '暂时无法开始，请稍后再试';
    startButton.textContent = '开始挑战';
    startButton.disabled = false;
    return;
  }

  input.value = '';
  startButton.textContent = '开始挑战';
  // iPhone 要求权限申请必须发生在点击事件的第一段调用中，不能放在音频异步操作之后。
  const motionEnabled = await game.input.enable();
  game.input.setCalibration();
  await sound.unlock();
  const controlHint = document.querySelector('#tilt-hint > p');
  if (controlHint) controlHint.textContent = motionEnabled ? '请保持手机平稳，正在校准重力…' : '重力感应未开启，请滑动屏幕控制';
  game.start(maskedPhone);
  if (motionEnabled) {
    window.setTimeout(() => {
      if (!controlHint || game.state !== 'playing') return;
      controlHint.textContent = game.input.hasOrientation ? '倾斜手机，控制小球' : '未检测到重力数据，请滑动屏幕控制';
    }, 1200);
  }
});

window.addEventListener('ballgame:finished', (event) => {
  fetch('./api/result', {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(event.detail),
  }).catch(() => {});
});

document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    game.pause();
    sound.suspend();
  } else {
    game.resume();
    sound.resume();
  }
});

window.__GAME__ = game;
window.__THREE_GAME_TEST_HOOKS__ = {
  setState(name) {
    if (name === 'active-play' || name === 'playing') {
      game.start('138****5678');
      return { ok: true, state: game.state };
    }
    if (name === 'game-over') {
      game.finish('fall');
      return { ok: true, state: game.state };
    }
    if (name === 'challenge-complete') {
      game.finish('timeout');
      return { ok: true, state: game.state };
    }
    return { ok: false, error: `unknown state ${name}` };
  },
  setTimeLeft(seconds) { game.timeLeft = Math.max(0, Number(seconds)); },
  collectCoin() { game.collectTestCoin(); },
};

window.__THREE_GAME_DIAGNOSTICS__ = {
  get state() { return game.state; },
  get score() { return game.score; },
  get distance() { return Math.floor(game.distance); },
  get timeLeft() { return game.timeLeft; },
  get maskedPhone() { return game.maskedPhone; },
};
