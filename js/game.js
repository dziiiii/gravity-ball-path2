import * as THREE from 'three';
import { InputController } from './input.js';

const CONFIG = {
  duration: 60, roadWidth: 8, roadLength: 520, ballRadius: .5,
  gravity: 22, moveAcceleration: 20, friction: 1.9, maxSpeed: 15,
  forwardBias: 1.45, holeRadius: .94, coinRadius: .47,
};
const COLORS = {
  sky: 0xa9c8ff, road: 0xf4a9bd, cake: 0xf3cea0, cream: 0xfff1df,
  jam: 0x8e2050, jamCore: 0x420d2a, ball: 0xfffbf8,
};

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
    this.scene.add(new THREE.HemisphereLight(0xdce9ff, 0xffcad8, 1.05));
    this.scene.add(new THREE.AmbientLight(0xffedf3, .42));
    const sun = new THREE.DirectionalLight(0xfff2df, 1.48);
    sun.position.set(8, 16, -4); sun.castShadow = true; sun.shadow.mapSize.set(1536, 1536);
    sun.shadow.camera.near = 1; sun.shadow.camera.far = 50; sun.shadow.camera.left = -12; sun.shadow.camera.right = 12; sun.shadow.camera.top = 14; sun.shadow.camera.bottom = -14;
    sun.shadow.bias = -.00025; sun.shadow.normalBias = .04; sun.shadow.radius = 1.5;
    this.scene.add(sun); this.sun = sun;
    const fill = new THREE.DirectionalLight(0xffbad2, .48); fill.position.set(-10, 8, 10); this.scene.add(fill);
  }

  _buildWorld() {
    this.world = new THREE.Group(); this.scene.add(this.world);
    const cakeBase = new THREE.Mesh(new THREE.BoxGeometry(CONFIG.roadWidth + .35, .72, CONFIG.roadLength), new THREE.MeshStandardMaterial({ color: COLORS.cake, roughness: .82 }));
    cakeBase.position.set(0, -.42, CONFIG.roadLength / 2 - 10); cakeBase.receiveShadow = true; this.world.add(cakeBase);
    const road = new THREE.Mesh(new THREE.BoxGeometry(CONFIG.roadWidth, .22, CONFIG.roadLength), new THREE.MeshStandardMaterial({ color: COLORS.road, roughness: .72 }));
    road.position.set(0, -.03, CONFIG.roadLength / 2 - 10); road.receiveShadow = true; this.world.add(road);
    const railMaterial = new THREE.MeshStandardMaterial({ color: COLORS.cream, roughness: .76 });
    for (const side of [-1, 1]) {
      const rail = new THREE.Mesh(new THREE.BoxGeometry(.26, .2, CONFIG.roadLength), railMaterial);
      rail.position.set(side * (CONFIG.roadWidth / 2 - .16), .12, CONFIG.roadLength / 2 - 10); this.world.add(rail);
    }
    this._buildCakeScenery();

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
        const hole = new THREE.Mesh(new THREE.CircleGeometry(CONFIG.holeRadius, 40), new THREE.MeshStandardMaterial({ color: COLORS.jam, roughness: .34, metalness: .04 }));
        hole.rotation.x = -Math.PI / 2; hole.position.set(x, .02, holeZ); this.world.add(hole);
        const core = new THREE.Mesh(new THREE.CircleGeometry(CONFIG.holeRadius * .68, 32), new THREE.MeshBasicMaterial({ color: COLORS.jamCore }));
        core.rotation.x = -Math.PI / 2; core.position.set(x, .024, holeZ); this.world.add(core);
        const rim = new THREE.Mesh(new THREE.TorusGeometry(CONFIG.holeRadius, .085, 10, 40), new THREE.MeshStandardMaterial({ color: 0xffd2df, roughness: .75 }));
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

  _buildCakeScenery() {
    const matrix = new THREE.Matrix4();
    const quaternion = new THREE.Quaternion();
    const scale = new THREE.Vector3();
    const position = new THREE.Vector3();
    const creamMaterial = new THREE.MeshStandardMaterial({ color: COLORS.cream, roughness: .78 });

    const candyLand = new THREE.Mesh(new THREE.PlaneGeometry(34, CONFIG.roadLength), new THREE.MeshStandardMaterial({ color: 0xffcbd8, roughness: .9 }));
    candyLand.rotation.x = -Math.PI / 2; candyLand.position.set(0, -.8, CONFIG.roadLength / 2 - 10); candyLand.receiveShadow = true; this.world.add(candyLand);

    const pipingGeometry = new THREE.SphereGeometry(.24, 8, 6);
    const pipingCount = Math.floor(CONFIG.roadLength / 1.45) * 2;
    const piping = new THREE.InstancedMesh(pipingGeometry, creamMaterial, pipingCount);
    let pipeIndex = 0;
    for (let z = -9; z < CONFIG.roadLength - 10; z += 1.45) {
      for (const side of [-1, 1]) {
        position.set(side * (CONFIG.roadWidth / 2 - .17), .25, z);
        scale.set(1, .68, 1.35); matrix.compose(position, quaternion, scale);
        piping.setMatrixAt(pipeIndex++, matrix);
      }
    }
    piping.receiveShadow = true; this.world.add(piping);

    const seamMaterial = new THREE.MeshStandardMaterial({ color: 0xef9db5, roughness: .8 });
    const seams = new THREE.InstancedMesh(new THREE.BoxGeometry(CONFIG.roadWidth - .45, .015, .035), seamMaterial, 86);
    for (let i = 0; i < 86; i += 1) {
      position.set(0, .088, -7 + i * 6.05); scale.set(1, 1, 1); matrix.compose(position, quaternion, scale); seams.setMatrixAt(i, matrix);
    }
    this.world.add(seams);

    const cakeSpots = [];
    for (let z = 1, i = 0; z < CONFIG.roadLength - 5; z += 11.5, i += 1) {
      for (const side of [-1, 1]) {
        const size = 1.05 + ((i * 7 + (side > 0 ? 2 : 0)) % 5) * .1;
        cakeSpots.push({ x: side * (5.25 + (i % 3) * .68), z: z + (side > 0 ? 3.5 : 0), size, h: 1.5 + (i % 4) * .25, tiered: i % 3 === 1 });
      }
    }
    const cakeBody = new THREE.InstancedMesh(new THREE.CylinderGeometry(1, 1.08, 1, 18), new THREE.MeshStandardMaterial({ color: 0xf2c88f, roughness: .82 }), cakeSpots.length);
    const icing = new THREE.InstancedMesh(new THREE.CylinderGeometry(1.06, 1.08, .32, 18), new THREE.MeshStandardMaterial({ color: 0xff9fc4, roughness: .7 }), cakeSpots.length);
    const strawberry = new THREE.InstancedMesh(new THREE.ConeGeometry(.34, .72, 10), new THREE.MeshStandardMaterial({ color: 0xf04d5d, roughness: .68 }), cakeSpots.length);
    const leaves = new THREE.InstancedMesh(new THREE.ConeGeometry(.2, .24, 6), new THREE.MeshStandardMaterial({ color: 0x70b85b, roughness: .8 }), cakeSpots.length);
    const upperBody = new THREE.InstancedMesh(new THREE.CylinderGeometry(.67, .72, .75, 18), new THREE.MeshStandardMaterial({ color: 0xffe0ae, roughness: .8 }), cakeSpots.length);
    const upperIcing = new THREE.InstancedMesh(new THREE.CylinderGeometry(.72, .74, .22, 18), new THREE.MeshStandardMaterial({ color: 0xff8fbd, roughness: .68 }), cakeSpots.length);
    const dripCount = cakeSpots.length * 10;
    const drips = new THREE.InstancedMesh(new THREE.SphereGeometry(.13, 8, 6), new THREE.MeshStandardMaterial({ color: 0xff9fc4, roughness: .7 }), dripCount);
    const hiddenScale = new THREE.Vector3(.0001, .0001, .0001);
    cakeSpots.forEach((spot, i) => {
      position.set(spot.x, spot.h * .5, spot.z); scale.set(spot.size, spot.h, spot.size); matrix.compose(position, quaternion, scale); cakeBody.setMatrixAt(i, matrix);
      position.set(spot.x, spot.h + .04, spot.z); scale.set(spot.size, 1, spot.size); matrix.compose(position, quaternion, scale); icing.setMatrixAt(i, matrix);
      const topperY = spot.h + (spot.tiered ? 1.02 : .56);
      position.set(spot.x, spot.h + .58, spot.z); scale.copy(spot.tiered ? new THREE.Vector3(spot.size, spot.size, spot.size) : hiddenScale); matrix.compose(position, quaternion, scale); upperBody.setMatrixAt(i, matrix);
      position.set(spot.x, spot.h + .98, spot.z); scale.copy(spot.tiered ? new THREE.Vector3(spot.size, spot.size, spot.size) : hiddenScale); matrix.compose(position, quaternion, scale); upperIcing.setMatrixAt(i, matrix);
      position.set(spot.x, topperY, spot.z); scale.set(spot.size, spot.size, spot.size); matrix.compose(position, quaternion, scale); strawberry.setMatrixAt(i, matrix);
      position.set(spot.x, topperY + .42, spot.z); scale.set(spot.size, spot.size, spot.size); matrix.compose(position, quaternion, scale); leaves.setMatrixAt(i, matrix);
      for (let d = 0; d < 10; d += 1) {
        const angle = d / 10 * Math.PI * 2;
        const dripY = spot.h - .06 - (d % 3) * .1;
        position.set(spot.x + Math.cos(angle) * spot.size * .94, dripY, spot.z + Math.sin(angle) * spot.size * .94);
        scale.set(spot.size, 1 + (d % 3) * .45, spot.size); matrix.compose(position, quaternion, scale); drips.setMatrixAt(i * 10 + d, matrix);
      }
    });
    cakeBody.castShadow = cakeBody.receiveShadow = true; icing.castShadow = true; strawberry.castShadow = true; drips.castShadow = true;
    this.world.add(cakeBody, icing, drips, upperBody, upperIcing, strawberry, leaves);

    const candyGeometry = new THREE.SphereGeometry(.15, 8, 6);
    const candy = new THREE.InstancedMesh(candyGeometry, new THREE.MeshStandardMaterial({ roughness: .62 }), 240);
    const candyColors = [new THREE.Color(0x6ecdf4), new THREE.Color(0xffd25e), new THREE.Color(0xff88b6), new THREE.Color(0xb88af4), new THREE.Color(0x77d7b0)];
    for (let i = 0; i < 240; i += 1) {
      const side = i % 2 ? -1 : 1;
      position.set(side * (4.38 + ((i * 17) % 24) * .075), -.54 + (i % 3) * .025, -7 + i * 2.2);
      const s = .75 + (i % 4) * .12; scale.setScalar(s); matrix.compose(position, quaternion, scale);
      candy.setMatrixAt(i, matrix); candy.setColorAt(i, candyColors[i % candyColors.length]);
    }
    candy.castShadow = true; this.world.add(candy);

    this.rollers = [];
    const rollerMaterial = new THREE.MeshStandardMaterial({ color: 0xf0649b, roughness: .5 });
    const rollerLight = new THREE.MeshStandardMaterial({ color: 0xff9fc1, roughness: .58 });
    const rollerGeometry = new THREE.CylinderGeometry(.34, .34, 3.25, 18);
    for (let i = 0, z = 10; z < CONFIG.roadLength - 15; i += 1, z += 34) {
      const x = i % 2 ? 1.9 : -1.9;
      const group = new THREE.Group();
      const core = new THREE.Mesh(rollerGeometry, rollerMaterial); core.rotation.z = Math.PI / 2; core.castShadow = true; group.add(core);
      for (let d = -1.35; d <= 1.35; d += .45) {
        const ridge = new THREE.Mesh(new THREE.TorusGeometry(.39, .085, 7, 16), rollerLight);
        ridge.rotation.y = Math.PI / 2; ridge.position.x = d; ridge.castShadow = true; group.add(ridge);
      }
      group.position.set(x, .38, z); this.world.add(group); this.rollers.push({ x, z, half: 1.7, r: .52, mesh: group });
    }

    const donutMaterial = new THREE.MeshStandardMaterial({ color: 0xf35c9b, roughness: .55 });
    for (let i = 0; i < 32; i += 1) {
      const donut = new THREE.Mesh(new THREE.TorusGeometry(.52 + (i % 3) * .09, .25, 9, 20), donutMaterial);
      const side = i % 2 ? -1 : 1; donut.position.set(side * (4.08 + (i % 4) * .7), .12, i * 16 - 3); donut.rotation.x = Math.PI / 2; donut.rotation.z = i * .7; donut.castShadow = true; this.world.add(donut);
    }

    const berryCount = 92;
    const roadsideBerries = new THREE.InstancedMesh(new THREE.ConeGeometry(.38, .86, 12), new THREE.MeshStandardMaterial({ color: 0xf14c5d, roughness: .64 }), berryCount);
    const roadsideLeaves = new THREE.InstancedMesh(new THREE.ConeGeometry(.24, .27, 6), new THREE.MeshStandardMaterial({ color: 0x66ae54, roughness: .8 }), berryCount);
    for (let i = 0; i < berryCount; i += 1) {
      const side = i % 2 ? -1 : 1; const s = .75 + (i % 5) * .12; const x = side * (4.3 + (i % 4) * .72); const z = -1 + i * 5.65;
      position.set(x, .05 + .43 * s, z); scale.set(s, s, s); matrix.compose(position, quaternion, scale); roadsideBerries.setMatrixAt(i, matrix);
      position.set(x, .51 + .43 * s, z); scale.set(s, s, s); matrix.compose(position, quaternion, scale); roadsideLeaves.setMatrixAt(i, matrix);
    }
    roadsideBerries.castShadow = true; this.world.add(roadsideBerries, roadsideLeaves);

    const rainbowColors = [0xff7fa7, 0xffb65d, 0xffefb0, 0x79d9d0, 0x7ba8ef];
    for (let z = 27; z < CONFIG.roadLength - 15; z += 52) {
      const arch = new THREE.Group();
      rainbowColors.forEach((color, band) => {
        const radius = 2.92 - band * .23;
        const ring = new THREE.Mesh(new THREE.TorusGeometry(radius, .13, 8, 38, Math.PI), new THREE.MeshStandardMaterial({ color, roughness: .66 }));
        ring.position.y = .24; ring.castShadow = true; arch.add(ring);
      });
      arch.position.set(0, 0, z); this.world.add(arch);
    }

    const cloud = new THREE.InstancedMesh(new THREE.SphereGeometry(1, 10, 7), new THREE.MeshStandardMaterial({ color: 0xffdce8, roughness: .88 }), 48);
    for (let i = 0; i < 48; i += 1) {
      const side = i % 2 ? -1 : 1;
      position.set(side * (8.5 + (i % 4) * 1.1), 5.7 + (i % 5) * .48, i * 11 - 4);
      scale.set(1.6 + (i % 3) * .42, .48 + (i % 2) * .14, .72); matrix.compose(position, quaternion, scale); cloud.setMatrixAt(i, matrix);
    }
    this.world.add(cloud);
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
    for (const roller of this.rollers || []) {
      const dx = this.ball.position.x - roller.x; const dz = this.ball.position.z - roller.z;
      if (Math.abs(dx) < roller.half + CONFIG.ballRadius * .72 && Math.abs(dz) < roller.r + CONFIG.ballRadius * .72) {
        this.ball.position.z = roller.z - roller.r - CONFIG.ballRadius * .75;
        this.vel.z = -Math.max(2.8, Math.abs(this.vel.z) * .48);
        this.vel.x += Math.sign(dx || 1) * 1.8;
      }
    }
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
    for (const roller of this.rollers || []) roller.mesh.rotation.x += dt * 1.65;
    for (const coin of this.coins) {
      if (coin.collecting > 0) { coin.collecting = Math.max(0, coin.collecting - dt); coin.mesh.scale.setScalar(coin.collecting / .22); if (coin.collecting === 0) coin.mesh.visible = false; continue; }
      if (coin.taken) continue;
      coin.mesh.position.y = .65 + Math.sin(this._coinAnim * 2.2 + coin.z * .15) * .08;
      coin.mesh.rotation.y = Math.sin(this._coinAnim * 1.35 + coin.z * .18) * .42;
    }
  }

  _updateCamera(dt) {
    const target = this._deathHole && this.state === 'falling' ? this._deathHole : this.ball.position;
    const x = target.x * .3; const y = this.state === 'falling' ? 4.35 : 4.05 + this.ball.position.y * .1; const z = target.z - 6.9;
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
