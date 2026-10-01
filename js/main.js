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

  // 完整手机号的后台提交将在接入用户指定的数据存储后启用。
  // 页面、游戏对象和浏览器存储中只保留脱敏值。
  input.value = '';
  startButton.disabled = true;
  await sound.unlock();
  await game.input.enable();
  game.input.setCalibration();
  game.start(maskedPhone);
});

document.getElementById('btn-restart').addEventListener('click', async () => {
  await sound.unlock();
  game.start(game.maskedPhone);
});

document.getElementById('btn-change-phone').addEventListener('click', () => {
  game.returnToStart();
  input.value = '';
  validate(false);
  window.setTimeout(() => input.focus(), 50);
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
