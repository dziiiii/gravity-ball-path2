import * as THREE from 'three';
import { InputController } from './input.js';

const CONFIG = {
  duration: 60, roadWidth: 8, roadLength: 520, ballRadius: .42,
  gravity: 22, moveAcceleration: 20, friction: 1.9, maxSpeed: 15,
  forwardBias: 1.45, holeRadius: .94, coinRadius: .47,
};
const COLORS = { sky: 0x98afc3, road: 0xebe4d8, rail: 0xe8dfd0, hole: 0x080a0d, ball: 0xf7f4ef };

function radialTexture(inner = .4, outer = .5, size = 96) {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const context = canvas.getContext('2d');
  const gradient = context.createRadialGradient(size / 2, size / 2, size * .08, size / 2, size / 2, size * .5);
  gradient.addColorStop(0, `rgba(0,0,0,${inner})`);
  gradient.addColorStop(.55, `rgba(0,0,0,${outer * .55})`);
  gradient.addColorStop(1, 'rgba(0,0,0,0)');
  context.fillStyle = gradient;
  context.fillRect(0, 0, size, size);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function coinFaceTexture() {
  const size = 512;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const context = canvas.getContext('2d');
  const gradient = context.createRadialGradient(215, 175, 20, 256, 256, 245);
  gradient.addColorStop(0, '#ffffff');
  gradient.addColorStop(.42, '#dfe5e7');
  gradient.addColorStop(.75, '#aeb7bb');
  gradient.addColorStop(1, '#e9edee');
  context.fillStyle = gradient;
  context.beginPath(); context.arc(256, 256, 252, 0, Math.PI * 2); context.fill();
  context.strokeStyle = '#838e93'; context.lineWidth = 15; context.stroke();
  context.strokeStyle = 'rgba(255,255,255,.75)'; context.lineWidth = 5;
  context.beginPath(); context.arc(256, 256, 220, 0, Math.PI * 2); context.stroke();
  context.fillStyle = '#5d686d'; context.textAlign = 'center'; context.textBaseline = 'middle';
  context.font = '900 244px Arial, sans-serif'; context.fillText('1', 256, 235);
  context.font = '800 74px "PingFang SC", "Microsoft YaHei", sans-serif'; context.fillText('元', 256, 376);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  return texture;
}

export class GravityBallGame {
  constructor(canvas, sound) {
    this.canvas = canvas;
    this.sound = sound;
    this.input = new InputController();
    this.state = 'idle';
    this.score = 0;
    this.distance = 0;
    this.timeLeft = CONFIG.duration;
    this.maskedPhone = '';
    this.paused = false;
    this._lastTickSecond = CONFIG.duration;
    this._clock = new THREE.Clock();
    this._coinAnim = 0;
    this._initRenderer();
    this._initScene();
    this._buildWorld();
    this._bindUi();
    this._resize();
    window.addEventListener('resize', () => this._resize());
    window.addEventListener('orientationchange', () => window.setTimeout(() => this._resize(), 120));
    window.visualViewport?.addEventListener('resize', () => this._resize());
    this._loop = this._loop.bind(this);
    requestAnimationFrame(this._loop);
  }

  _initRenderer() {
    this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.setSize(innerWidth, innerHeight, false);
    this.renderer.setClearColor(COLORS.sky, 1);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.08;
  }

  _initScene() {
    this.scene = new THREE.Scene();
    this.scene.fog = new THREE.Fog(COLORS.sky, 13, 72);
    this.camera = new THREE.PerspectiveCamera(58, innerWidth / innerHeight, .1, 125);
    this.camera.position.set(0, 5, -7.2);
    this.camera.lookAt(0, .55, 4);
    this.scene.add(new THREE.HemisphereLight(0xc9d8e8, 0xd9cfc0, .9));
    this.scene.add(new THREE.AmbientLight(0xe8eef6, .35));
    const sun = new THREE.DirectionalLight(0xfff0dc, 1.35);
    sun.position.set(8, 16, -4); sun.castShadow = true; sun.shadow.mapSize.set(1536, 1536);
    sun.shadow.camera.near = 1; sun.shadow.camera.far = 50; sun.shadow.camera.left = -12; sun.shadow.camera.right = 12; sun.shadow.camera.top = 14; sun.shadow.camera.bottom = -14;
    sun.shadow.bias = -.00025; sun.shadow.normalBias = .04; sun.shadow.radius = 1.5;
    this.scene.add(sun); this.sun = sun;
    const fill = new THREE.DirectionalLight(0xb7c9dc, .42); fill.position.set(-10, 8, 10); this.scene.add(fill);
  }

  _buildWorld() {
    this.world = new THREE.Group(); this.scene.add(this.world);
    const road = new THREE.Mesh(new THREE.BoxGeometry(CONFIG.roadWidth, .35, CONFIG.roadLength), new THREE.MeshStandardMaterial({ color: COLORS.road, roughness: .88, metalness: .03 }));
    road.position.set(0, -.18, CONFIG.roadLength / 2 - 10); road.receiveShadow = true; this.world.add(road);
    const railMaterial = new THREE.MeshStandardMaterial({ color: COLORS.rail, roughness: .8, emissive: 0xcfc3b0, emissiveIntensity: .2 });
    for (const side of [-1, 1]) {
      const rail = new THREE.Mesh(new THREE.BoxGeometry(.32, .42, CONFIG.roadLength), railMaterial);
      rail.position.set(side * (CONFIG.roadWidth / 2 - .21), .05, CONFIG.roadLength / 2 - 10); this.world.add(rail);
    }

    this.holes = [];
    const holeShadow = radialTexture(.58, .78, 128);
    let z = 12; let index = 0;
    while (z < CONFIG.roadLength - 18) {
      const pattern = index % 5;
      const positions = pattern === 0 ? [-1.4] : pattern === 1 ? [1.3] : pattern === 2 ? [-1.8, 1.6] : pattern === 3 ? [0] : [-2.15, 0, 2.05];
      for (const rawX of positions) {
        const x = clampX(rawX); const holeZ = z + (positions.length > 1 ? Math.sin(index * 1.7) * .4 : 0);
        const shadow = new THREE.Mesh(new THREE.PlaneGeometry(2.55, 2.55), new THREE.MeshBasicMaterial({ map: holeShadow, transparent: true, opacity: .56, depthWrite: false }));
        shadow.rotation.x = -Math.PI / 2; shadow.position.set(x, .012, holeZ); this.world.add(shadow);
        const hole = new THREE.Mesh(new THREE.CircleGeometry(CONFIG.holeRadius, 40), new THREE.MeshBasicMaterial({ color: COLORS.hole }));
        hole.rotation.x = -Math.PI / 2; hole.position.set(x, .02, holeZ); this.world.add(hole);
        const core = new THREE.Mesh(new THREE.CircleGeometry(CONFIG.holeRadius * .68, 32), new THREE.MeshBasicMaterial({ color: 0x020304 }));
        core.rotation.x = -Math.PI / 2; core.position.set(x, .024, holeZ); this.world.add(core);
        const rim = new THREE.Mesh(new THREE.TorusGeometry(CONFIG.holeRadius, .055, 10, 40), new THREE.MeshStandardMaterial({ color: 0xb7ac99, roughness: .9 }));
        rim.rotation.x = -Math.PI / 2; rim.position.set(x, .034, holeZ); this.world.add(rim);
        this.holes.push({ x, z: holeZ, r: CONFIG.holeRadius });
      }
      z += Math.max(8.8, 12.5 - index * .035) + (index % 3) * 1.4; index += 1;
    }

    this.coins = [];
    const faceTexture = coinFaceTexture();
    const coinMaterials = [
      new THREE.MeshStandardMaterial({ color: 0xaab3b6, roughness: .28, metalness: .88 }),
      new THREE.MeshStandardMaterial({ map: faceTexture, roughness: .3, metalness: .48 }),
      new THREE.MeshStandardMaterial({ map: faceTexture.clone(), roughness: .3, metalness: .48 }),
    ];
    const coinGeometry = new THREE.CylinderGeometry(CONFIG.coinRadius, CONFIG.coinRadius, .12, 36);
    const coinShadow = radialTexture(.32, .46, 64);
    let coinZ = 6; let coinIndex = 0;
    while (coinZ < CONFIG.roadLength - 10) {
      const x = clampX(((coinIndex % 5) - 2) * 1.13);
      const group = new THREE.Group();
      const body = new THREE.Mesh(coinGeometry, coinMaterials); body.rotation.x = Math.PI / 2; body.castShadow = true; group.add(body);
      const ridge = new THREE.Mesh(new THREE.TorusGeometry(CONFIG.coinRadius * .98, .024, 8, 42), coinMaterials[0]); ridge.rotation.x = Math.PI / 2; group.add(ridge);
      const shadow = new THREE.Mesh(new THREE.PlaneGeometry(1.05, .54), new THREE.MeshBasicMaterial({ map: coinShadow, transparent: true, opacity: .28, depthWrite: false }));
      shadow.rotation.x = -Math.PI / 2; shadow.position.y = -.52; group.add(shadow);
      group.position.set(x, .65, coinZ); this.world.add(group);
      this.coins.push({ mesh: group, x, z: coinZ, taken: false, collecting: 0 });
      coinZ += 6.2 + (coinIndex % 4) * .65; coinIndex += 1;
    }

    this.ball = new THREE.Mesh(new THREE.SphereGeometry(CONFIG.ballRadius, 36, 28), new THREE.MeshStandardMaterial({ color: COLORS.ball, roughness: .28, metalness: .05 }));
    this.ball.castShadow = true; this.ball.receiveShadow = true; this.ball.position.set(0, CONFIG.ballRadius, 0); this.world.add(this.ball);
    this.ballBlob = new THREE.Mesh(new THREE.PlaneGeometry(1.13, 1.13), new THREE.MeshBasicMaterial({ map: radialTexture(.42, .55), transparent: true, opacity: .42, depthWrite: false }));
    this.ballBlob.rotation.x = -Math.PI / 2; this.ballBlob.position.y = .015; this.world.add(this.ballBlob);
    this.vel = new THREE.Vector3();
  }

  _bindUi() {
    const id = value => document.getElementById(value);
    this.ui = {
      startOverlay: id('start-overlay'), overOverlay: id('over-overlay'), hudTop: id('hud-top'), hudBottom: id('hud-bottom'),
      playerPhone: id('player-phone'), hudPhone: id('hud-phone'), tiltHint: id('tilt-hint'), timerPill: id('timer-pill'),
      time: id('time-value'), dist: id('dist-value'), score: id('score-value'), discountScore: id('discount-score'), discountYuan: id('discount-yuan'),
      feedback: id('coin-feedback'), overTitle: id('over-title'), overPhone: id('over-phone'), overTime: id('over-time'),
      overDist: id('over-dist'), overScore: id('over-score'), overDiscount: id('over-discount'), resultBadge: id('result-badge'),
    };
  }

  start(maskedPhone) {
    if (!maskedPhone) return;
    this.maskedPhone = maskedPhone; this.score = 0; this.distance = 0; this.timeLeft = CONFIG.duration;
    this.elapsed = 0; this.fallTime = 0; this._deathHole = null; this._lastTickSecond = CONFIG.duration;
    this.vel.set(0, 0, 0); this.ball.position.set(0, CONFIG.ballRadius, 0); this.ball.rotation.set(0, 0, 0); this.ball.scale.setScalar(1); this.ball.visible = true;
    this.ballBlob.visible = true; this.ballBlob.material.opacity = .42; this.ballBlob.scale.setScalar(1);
    for (const coin of this.coins) { coin.taken = false; coin.collecting = 0; coin.mesh.visible = true; coin.mesh.scale.setScalar(1); }
    this.state = 'playing'; this.paused = false; this._hideHintTime = 0;
    this.ui.startOverlay.hidden = true; this.ui.overOverlay.hidden = true; this.ui.hudTop.hidden = false; this.ui.hudBottom.hidden = false; this.ui.playerPhone.hidden = false; this.ui.tiltHint.hidden = false; this.ui.tiltHint.classList.remove('is-hidden');
    this.ui.hudPhone.textContent = maskedPhone; this.ui.timerPill.classList.remove('is-urgent');
    this._updateHud(); this._clock.getDelta();
  }

  finish(reason) {
    if (this.state !== 'playing') return;
    this.elapsed = Math.min(CONFIG.duration, Math.max(0, CONFIG.duration - this.timeLeft));
    if (reason === 'fall') {
      this.state = 'falling'; this.fallTime = 0; this.vel.set(0, -.6, 0); this.sound?.fall();
      window.setTimeout(() => { if (this.state === 'falling') this._showResult(false); }, 900);
    } else {
      this.state = 'finished'; this.timeLeft = 0; this.vel.set(0, 0, 0); this.sound?.success(); this._showResult(true);
    }
  }

  _showResult(success) {
    this.state = 'finished';
    const used = success ? CONFIG.duration : Math.max(1, Math.min(59, Math.ceil(this.elapsed)));
    this.ui.overTitle.textContent = success ? '挑战完成' : '掉进坑里了';
    this.ui.resultBadge.textContent = success ? '挑战成功' : '本局结束';
    this.ui.resultBadge.classList.toggle('failure', !success);
    this.ui.overPhone.textContent = this.maskedPhone; this.ui.overTime.textContent = String(used);
    this.ui.overDist.textContent = String(Math.floor(this.distance)); this.ui.overScore.textContent = String(this.score); this.ui.overDiscount.textContent = String(this.score);
    this.ui.overOverlay.hidden = false; this.ui.hudTop.hidden = true; this.ui.hudBottom.hidden = true; this.ui.playerPhone.hidden = true; this.ui.tiltHint.classList.add('is-hidden');
    window.dispatchEvent(new CustomEvent('ballgame:finished', { detail: {
      outcome: success ? 'completed' : 'fell', score: this.score,
      distance: Math.floor(this.distance), duration: used,
    } }));
  }

  returnToStart() {
    this.state = 'idle'; this.maskedPhone = ''; this.vel.set(0, 0, 0);
    this.ui.overOverlay.hidden = true; this.ui.startOverlay.hidden = false; this.ui.hudTop.hidden = true; this.ui.hudBottom.hidden = true; this.ui.playerPhone.hidden = true;
  }

  pause() { if (this.state === 'playing') this.paused = true; }
  resume() { if (this.state === 'playing' && this.paused) { this.paused = false; this._clock.getDelta(); } }
  collectTestCoin() { if (this.state === 'playing') this._collectCoin(this.coins.find(coin => !coin.taken)); }

  _collectCoin(coin) {
    if (!coin || coin.taken) return;
    coin.taken = true; coin.collecting = .22; this.score += 1; this._pop = .18;
    this.ui.feedback.classList.remove('show'); void this.ui.feedback.offsetWidth; this.ui.feedback.classList.add('show');
    this.sound?.coin(); this._updateHud();
  }

  _simulate(dt) {
    this.elapsed += dt; this.timeLeft = Math.max(0, CONFIG.duration - this.elapsed);
    const shownSecond = Math.ceil(this.timeLeft);
    if (shownSecond <= 10 && shownSecond > 0 && shownSecond !== this._lastTickSecond) this.sound?.tick();
    this._lastTickSecond = shownSecond;
    if (this.timeLeft <= 0) { this.finish('timeout'); return; }

    const input = this.input.vector;
    const difficulty = 1 + Math.min(.28, this.distance / 900);
    this.vel.x += input.x * CONFIG.moveAcceleration * dt;
    this.vel.z += (input.z * CONFIG.moveAcceleration + CONFIG.forwardBias * difficulty) * dt;
    this.vel.x -= this.vel.x * CONFIG.friction * dt; this.vel.z -= this.vel.z * CONFIG.friction * dt;
    const speed = Math.hypot(this.vel.x, this.vel.z); const maxSpeed = CONFIG.maxSpeed * difficulty;
    if (speed > maxSpeed) { this.vel.x = this.vel.x / speed * maxSpeed; this.vel.z = this.vel.z / speed * maxSpeed; }
    this.ball.position.x += this.vel.x * dt; this.ball.position.z += this.vel.z * dt;
    const limit = CONFIG.roadWidth / 2 - CONFIG.ballRadius - .25;
    if (this.ball.position.x > limit) { this.ball.position.x = limit; this.vel.x *= -.25; }
    if (this.ball.position.x < -limit) { this.ball.position.x = -limit; this.vel.x *= -.25; }
    this.ball.rotation.x += this.vel.z * dt / CONFIG.ballRadius; this.ball.rotation.z -= this.vel.x * dt / CONFIG.ballRadius;
    this.distance = Math.max(this.distance, this.ball.position.z);
    for (const hole of this.holes) {
      const dx = this.ball.position.x - hole.x; const dz = this.ball.position.z - hole.z;
      if (dx * dx + dz * dz < (hole.r * .91) ** 2) { this._deathHole = hole; this.finish('fall'); return; }
    }
    for (const coin of this.coins) {
      if (coin.taken) continue;
      const dx = this.ball.position.x - coin.x; const dz = this.ball.position.z - coin.z;
      if (dx * dx + dz * dz < (CONFIG.ballRadius + CONFIG.coinRadius + .34) ** 2) this._collectCoin(coin);
    }
    if (this._pop > 0) { this._pop = Math.max(0, this._pop - dt); this.ball.scale.setScalar(1 + this._pop * 1.55); } else this.ball.scale.setScalar(1);
    this._hideHintTime += dt; if (this._hideHintTime > 4.5) this.ui.tiltHint.classList.add('is-hidden');
    this._updateHud();
  }

  _updateFall(dt) {
    this.fallTime += dt; const hole = this._deathHole;
    if (hole) { const slide = 1 - Math.exp(-9 * dt); this.ball.position.x += (hole.x - this.ball.position.x) * slide; this.ball.position.z += (hole.z - this.ball.position.z) * slide; }
    this.vel.y = Math.max(-6, this.vel.y - CONFIG.gravity * .42 * dt); this.ball.position.y += this.vel.y * dt;
    const sink = Math.min(1, Math.max(0, (CONFIG.ballRadius - this.ball.position.y) / (CONFIG.ballRadius * 1.35)));
    this.ball.scale.setScalar(1 - sink * .22); this.ball.rotation.x += dt * 1.2 * (1 - sink);
    this.ballBlob.material.opacity = .42 * (1 - sink); this.ballBlob.scale.setScalar(1 - sink * .35);
    if (this.ball.position.y < -CONFIG.ballRadius * 1.25) { this.ball.visible = false; this.ballBlob.visible = false; }
  }

  _animateCoins(dt) {
    for (const coin of this.coins) {
      if (coin.collecting > 0) { coin.collecting = Math.max(0, coin.collecting - dt); coin.mesh.scale.setScalar(coin.collecting / .22); if (coin.collecting === 0) coin.mesh.visible = false; continue; }
      if (coin.taken) continue;
      coin.mesh.position.y = .65 + Math.sin(this._coinAnim * 2.2 + coin.z * .15) * .08;
      coin.mesh.rotation.y = this._coinAnim * 1.15 + coin.z;
    }
  }

  _updateCamera(dt) {
    const target = this._deathHole && this.state === 'falling' ? this._deathHole : this.ball.position;
    const x = target.x * .32; const y = this.state === 'falling' ? 4.9 : 4.7 + this.ball.position.y * .12; const z = target.z - 6.8;
    const smoothing = 1 - Math.exp(-6 * dt);
    this.camera.position.x += (x - this.camera.position.x) * smoothing; this.camera.position.y += (y - this.camera.position.y) * smoothing; this.camera.position.z += (z - this.camera.position.z) * smoothing;
    this.camera.lookAt(target.x * .45, this.state === 'falling' ? .35 : .52, target.z + 5.5);
    this.sun.position.set(target.x + 7.5, 14, target.z - 5); this.sun.target.position.set(target.x, 0, target.z); this.sun.target.updateMatrixWorld(); this.scene.add(this.sun.target);
    if (this.state !== 'falling') { this.ballBlob.position.set(this.ball.position.x, .015, this.ball.position.z); this.ballBlob.visible = true; }
  }

  _updateHud() {
    const seconds = Math.ceil(this.timeLeft);
    this.ui.time.textContent = String(seconds); this.ui.timerPill.classList.toggle('is-urgent', seconds <= 10);
    this.ui.dist.textContent = String(Math.floor(this.distance)); this.ui.score.textContent = String(this.score);
    this.ui.discountScore.textContent = String(this.score); this.ui.discountYuan.textContent = String(this.score);
  }

  _resize() {
    const bounds = this.canvas.parentElement.getBoundingClientRect();
    const width = Math.max(1, Math.round(bounds.width));
    const height = Math.max(1, Math.round(bounds.height));
    this.camera.aspect = width / height;
    this.camera.fov = 60;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height, false);
    this.renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2));
  }

  _loop() {
    requestAnimationFrame(this._loop);
    const dt = Math.min(this._clock.getDelta(), .033);
    if (!this.paused) {
      this._coinAnim += dt;
      if (this.state === 'playing') this._simulate(dt);
      else if (this.state === 'falling') this._updateFall(dt);
      this._animateCoins(dt); this._updateCamera(dt);
    }
    this.renderer.render(this.scene, this.camera);
  }
}

function clampX(x) { return Math.max(-CONFIG.roadWidth / 2 + 1.2, Math.min(CONFIG.roadWidth / 2 - 1.2, x)); }
