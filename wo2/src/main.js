import * as THREE from 'three';
import { PLYLoader } from 'three/addons/loaders/PLYLoader.js';
import { MTLLoader } from 'three/addons/loaders/MTLLoader.js';
import { OBJLoader } from 'three/addons/loaders/OBJLoader.js';

const host = document.querySelector('#canvas-wrap');
const loading = document.querySelector('#loading');
const errorBox = document.querySelector('#error');
const entryScreen = document.querySelector('#entry-screen');
const enterButton = document.querySelector('#enter-button');
const returnStartButton = document.querySelector('#return-start-button');
const debugBackdrop = document.querySelector('#debug-backdrop');
const commandForm = document.querySelector('#command-form');
const commandInput = document.querySelector('#command-input');
const commandStatus = document.querySelector('#command-status');
const coordReadout = document.querySelector('#coord-readout');
const crosshair = document.querySelector('#crosshair');
const help = document.querySelector('#help');
const gestureVideo = document.querySelector('#gesture-video');
const gestureCanvas = document.querySelector('#gesture-canvas');
const gestureContext = gestureCanvas.getContext('2d');
const gestureWidget = document.querySelector('#gesture-widget');
const gestureStateTag = document.querySelector('#gesture-state-tag');
const gestureButtons = [...document.querySelectorAll('.gesture-toggle')];
const introCover = document.querySelector('#intro-cover');
const infoModal = document.querySelector('#info-modal');
const infoButtons = document.querySelectorAll('.info-button');
const radialMenu = document.querySelector('#radial-menu');
const radialItems = [...radialMenu.querySelectorAll('button[data-index]')];
let introDismissed = false;
let longPressTimer = 0;
let longPressTriggered = false;
let radialSelection = 0;
let gestureZoomBaseWidth = 0;
let gestureZoomBaseFov = 72;
let cameraFlight = null;

function showInfo() { infoModal.hidden = false; }
function hideInfo() { infoModal.hidden = true; }
function updateRadialSelection() {
  radialItems.forEach((item, index) => {
    const relative = (index - radialSelection + radialItems.length + 2) % radialItems.length - 2;
    item.classList.toggle('is-selected', relative === 0);
    item.style.setProperty('--offset-y', `${relative * 15}vh`);
    item.style.setProperty('--arc-x', `${70 + (2 - Math.abs(relative)) * 60}px`);
  });
}
updateRadialSelection();
infoButtons.forEach((button) => button.addEventListener('click', showInfo));
document.querySelector('#info-close').addEventListener('click', hideInfo);
infoModal.addEventListener('click', (event) => { if (event.target === infoModal) hideInfo(); });

function dismissIntro() {
  if (introDismissed) return;
  introDismissed = true;
  const particleLayer = introCover.querySelector('.intro-particles');
  const particleCount = Math.min(280, Math.floor(window.innerWidth * window.innerHeight / 5000));
  for (let i = 0; i < particleCount; i += 1) {
    const particle = document.createElement('i');
    particle.className = 'intro-particle';
    particle.style.setProperty('--x', `${Math.random() * 100}%`);
    particle.style.setProperty('--y', `${Math.random() * 100}%`);
    particle.style.setProperty('--size', `${1 + Math.random() * 4}px`);
    particle.style.setProperty('--alpha', `${0.18 + Math.random() * 0.55}`);
    particle.style.setProperty('--blur', `${Math.random() * 2}px`);
    particle.style.setProperty('--dx', `${(Math.random() - 0.5) * 100}px`);
    particle.style.setProperty('--dy', `${-40 - Math.random() * 180}px`);
    particle.style.setProperty('--rot', `${(Math.random() - 0.5) * 180}deg`);
    particle.style.animationDelay = `${Math.random() * 0.35}s`;
    particleLayer.appendChild(particle);
  }
  introCover.classList.add('is-leaving');
  window.setTimeout(() => introCover.remove(), 1250);
}

window.addEventListener('wheel', (event) => {
  if (!radialMenu.hidden && Math.abs(event.deltaY) > 2) {
    event.preventDefault();
    radialSelection = (radialSelection + (event.deltaY > 0 ? 1 : radialItems.length - 1)) % radialItems.length;
    updateRadialSelection();
    return;
  }
  if (Math.abs(event.deltaY) > 8) dismissIntro();
}, { passive: false });
let touchStartY = 0;
window.addEventListener('touchstart', (event) => { touchStartY = event.changedTouches[0]?.clientY ?? 0; }, { passive: true });
window.addEventListener('touchend', (event) => {
  const endY = event.changedTouches[0]?.clientY ?? touchStartY;
  if (Math.abs(touchStartY - endY) > 35) dismissIntro();
}, { passive: true });

const scene = new THREE.Scene();
scene.background = new THREE.Color('#111516');
scene.add(new THREE.HemisphereLight(0xe7eee4, 0x292b26, 1.5));
const keyLight = new THREE.DirectionalLight(0xffffff, 1.8);
keyLight.position.set(2, -3, 5);
scene.add(keyLight);

const camera = new THREE.PerspectiveCamera(72, 1, 0.01, 100);
camera.up.set(0, 0, 1);

const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.domElement.tabIndex = 0;
renderer.domElement.setAttribute('aria-label', '房间漫游画面');
host.appendChild(renderer.domElement);

const assetUrl = (path) => new URL(`./assets/${path}`, document.baseURI).href;
const roomLoader = new PLYLoader();
const coordinateRaycaster = new THREE.Raycaster();
const objectRaycaster = new THREE.Raycaster();
const centerPointer = new THREE.Vector2(0, 0);
const cameraDirection = new THREE.Vector3();
const cameraTarget = new THREE.Vector3();
const scatterUniform = { value: 0 };
const scatterOriginUniform = { value: new THREE.Vector3() };
const scatterRadiusUniform = { value: 0.155 };

const audioListener = new THREE.AudioListener();
camera.add(audioListener);
const sound = new THREE.Audio(audioListener);
const audioLoader = new THREE.AudioLoader();

let roomCloud = null;
let interactiveModel = null;
let coordinateMode = false;
let debugOpen = false;
let hasStarted = false;
let introPlaying = false;
let introStartTime = 0;
let previousFrameTime = 0;
let yaw = Math.PI; // 朝向房间前墙（Y 轴负方向）。
let pitch = 0;
let floorZ = -1.364;
let pointSize = 0.009;
let handTracker = null;
let gestureStream = null;
let gestureActive = false;
let gestureInitializing = false;
let gestureGeneration = 0;
let gestureLastSeen = 0;
let lastGestureFrame = 0;
let handFrameInFlight = false;
const gestureState = { handDetected: false, yawSpeed: 0, pitchSpeed: 0, moveForward: 0, isPinching: false, lastPinchTriggerTime: 0 };
let scatterStartedAt = 0;
let scatterAnimating = false;
const START_X = 0.404;
const START_Y = 0.540;
const EYE_HEIGHT = 1.15;
const ITEM_VIEWPOINTS = [
  { label: '水壶', position: [0.404, 0.72], target: [0.404, 0.54, -0.75] },
  { label: '水槽', position: [-0.08, -0.48], target: [-0.08, -0.60, -0.68] },
  { label: '洗衣机', position: [0.38, -0.10], target: [0.42, -0.28, -0.62] },
  { label: '灶台', position: [-0.38, -0.08], target: [-0.34, -0.28, -0.62] },
  { label: '地毯', position: [0.02, 0.30], target: [0.02, 0.12, -1.15] },
];
const VIEW_YAW_CENTER = Math.PI;
const VIEW_YAW_LIMIT = 1.5;
const INTRO_MS = 3800;
const MOVE_SPEED = 0.82;
const LOOK_SENSITIVITY = 0.0019;
const LONG_PRESS_MS = 600;
const HAND_CONNECTIONS = [
  [0, 1], [1, 2], [2, 3], [3, 4], [0, 5], [5, 6], [6, 7], [7, 8],
  [5, 9], [9, 10], [10, 11], [11, 12], [9, 13], [13, 14], [14, 15], [15, 16],
  [13, 17], [17, 18], [18, 19], [19, 20], [0, 17],
];

function updateCameraLook() {
  const cosPitch = Math.cos(pitch);
  cameraDirection.set(
    Math.sin(yaw) * cosPitch,
    Math.cos(yaw) * cosPitch,
    Math.sin(pitch)
  );
  cameraTarget.copy(camera.position).add(cameraDirection);
  camera.lookAt(cameraTarget);
}

function showEntry(resume = false) {
  entryScreen.hidden = false;
  crosshair.hidden = true;
}

function beginIntro() {
  if (introPlaying) return;
  introPlaying = true;
  introStartTime = performance.now();
  camera.position.set(START_X, START_Y, floorZ + 0.48);
  yaw = Math.PI;
  pitch = 0;
  updateCameraLook();
}

function loadRoomFrom(paths, index = 0) {
  if (index >= paths.length) {
    loading.hidden = true;
    errorBox.hidden = false;
    errorBox.textContent = '房间模型未能载入。请确认 public/models/room.ply 文件存在。';
    return;
  }

  roomLoader.load(
    paths[index],
    (geometry) => {
      geometry.computeBoundingBox();
      const box = geometry.boundingBox;
      const center = box.getCenter(new THREE.Vector3());
      const size = box.getSize(new THREE.Vector3());
      geometry.translate(-center.x, -center.y, -center.z);

      const hasColors = geometry.hasAttribute('color');
      pointSize = Math.max(size.length() / 480, 0.003);
      const material = new THREE.PointsMaterial({
        size: pointSize,
        sizeAttenuation: true,
        vertexColors: hasColors,
        color: hasColors ? 0xffffff : 0xc9ddd2,
        transparent: true,
        opacity: 0.96,
        depthWrite: false,
      });
      material.onBeforeCompile = (shader) => {
        shader.uniforms.uScatter = scatterUniform;
        shader.uniforms.uScatterOrigin = scatterOriginUniform;
        shader.uniforms.uScatterRadius = scatterRadiusUniform;
        shader.vertexShader = shader.vertexShader.replace(
          '#include <common>',
          `#include <common>
          uniform float uScatter;
          uniform vec3 uScatterOrigin;
          uniform float uScatterRadius;
          vec3 pointHash(vec3 p) {
            return fract(sin(vec3(
              dot(p, vec3(127.1, 311.7, 74.7)),
              dot(p, vec3(269.5, 183.3, 246.1)),
              dot(p, vec3(113.5, 271.9, 124.6))
            )) * 43758.5453) * 2.0 - 1.0;
          }`
        );
        shader.vertexShader = shader.vertexShader.replace(
          '#include <begin_vertex>',
          `#include <begin_vertex>
          vec3 scatterDirection = normalize(pointHash(position + vec3(0.13, 2.71, 5.19)));
          float scatterDistance = 0.18 + 0.42 * fract(sin(dot(position, vec3(21.17, 9.23, 41.73))) * 43758.5453);
          float scatterFalloff = 1.0 - smoothstep(uScatterRadius * 0.38, uScatterRadius, distance(position, uScatterOrigin));
          transformed += scatterDirection * scatterDistance * scatterFalloff * uScatter;`
        );
      };
      material.customProgramCacheKey = () => 'room-point-scatter-v1';
      roomCloud = new THREE.Points(geometry, material);
      roomCloud.frustumCulled = false;
      scene.add(roomCloud);

      camera.near = 0.01;
      camera.far = Math.max(size.length() * 20, 100);
      camera.updateProjectionMatrix();
      loading.hidden = true;
      beginIntro();
    },
    undefined,
    (error) => {
      console.warn(`房间模型路径不可用：${paths[index]}`, error);
      loadRoomFrom(paths, index + 1);
    }
  );
}

// 兼容 GitHub 仓库直接发布（public/models）和 Vite 构建发布（models）。
loadRoomFrom(['./models/room.ply', './public/models/room.ply']);

const modelDirectory = assetUrl('INMOBJECT1/');
const mtlLoader = new MTLLoader();
mtlLoader.setPath(modelDirectory);
mtlLoader.load(
  'INMOBJECT1.mtl',
  (materials) => {
    materials.preload();
    const objLoader = new OBJLoader();
    objLoader.setMaterials(materials);
    objLoader.setPath(modelDirectory);
    objLoader.load(
      'INMOBJECT1.obj',
      (object) => {
        interactiveModel = object;
        interactiveModel.position.set(START_X, START_Y, floorZ + 0.12);
        // 模型文件使用 Y 轴朝上时，旋转到房间的 Z 轴向上坐标系。
        interactiveModel.rotation.x = Math.PI / 2;
        interactiveModel.scale.setScalar(1);
        scene.add(interactiveModel);
      },
      undefined,
      (error) => console.error('OBJ 模型载入失败：', error)
    );
  },
  undefined,
  (error) => console.error('MTL 材质载入失败：', error)
);

audioLoader.load(
  assetUrl('INMSOUND1.mp3'),
  (buffer) => {
    sound.setBuffer(buffer);
    sound.setLoop(false);
    sound.setVolume(1);
  },
  undefined,
  (error) => console.error('音频载入失败：', error)
);

function updateCoordinateReadout() {
  if (!coordinateMode || !roomCloud) return;
  coordinateRaycaster.params.Points.threshold = Math.max(pointSize * 2, 0.012);
  coordinateRaycaster.setFromCamera(centerPointer, camera);
  const hit = coordinateRaycaster.intersectObject(roomCloud)[0];
  coordReadout.textContent = hit
    ? `X ${hit.point.x.toFixed(3)} · Y ${hit.point.y.toFixed(3)} · Z ${hit.point.z.toFixed(3)}`
    : '准心附近没有点';
}

function toggleSound() {
  if (!sound.buffer) {
    commandStatus.textContent = '音频仍在载入，请稍后再点击物件。';
    return;
  }
  const toggle = () => {
    if (sound.isPlaying) {
      sound.pause();
      commandStatus.textContent = '音频已暂停';
    } else {
      sound.play();
      commandStatus.textContent = '正在播放物件音频';
    }
  };
  if (audioListener.context.state === 'suspended') {
    audioListener.context.resume().then(toggle).catch((error) => console.error('音频无法启动：', error));
  } else {
    toggle();
  }
}

function triggerScatter(origin = null) {
  if (!roomCloud) return;
  if (origin) scatterOriginUniform.value.copy(origin);
  else scatterOriginUniform.value.set(START_X, START_Y, floorZ + EYE_HEIGHT);
  scatterStartedAt = performance.now();
  scatterAnimating = true;
}

function updateScatter(time) {
  if (!scatterAnimating) return;
  const elapsed = (time - scatterStartedAt) / 1000;
  const burst = 0.22;
  const hold = 0.18;
  const returnDuration = 1.15;
  if (elapsed < burst) {
    const t = elapsed / burst;
    scatterUniform.value = t * t * (3 - 2 * t);
  } else if (elapsed < burst + hold) {
    scatterUniform.value = 1;
  } else if (elapsed < burst + hold + returnDuration) {
    const t = (elapsed - burst - hold) / returnDuration;
    const eased = t * t * (3 - 2 * t);
    scatterUniform.value = 1 - eased;
  } else {
    scatterUniform.value = 0;
    scatterAnimating = false;
  }
}

function setGestureButtons(label) {
  for (const button of gestureButtons) {
    if (button.classList.contains('gesture-toggle-entry')) {
      button.setAttribute('aria-label', label);
      const pathText = button.querySelector('textPath');
      if (pathText) pathText.textContent = gestureActive ? 'DISABLE CAMERA CONTROL' : 'ENABLE CAMERA CONTROL';
    } else button.textContent = label;
  }
}

async function startGestureMode() {
  if (gestureActive || gestureInitializing) return;
  const generation = ++gestureGeneration;
  gestureInitializing = true;
  setGestureButtons('正在启动摄像头与手势识别…');
  gestureButtons.forEach((button) => { button.disabled = true; });
  commandStatus.textContent = '正在请求摄像头权限并载入手势模型…';
  try {
    if (!navigator.mediaDevices?.getUserMedia) {
      throw new Error('此浏览器无法访问摄像头；请使用支持摄像头的 HTTPS 页面。');
    }
    gestureStream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } },
    });
    if (generation !== gestureGeneration) throw new Error('手势控制启动已取消。');
    gestureVideo.srcObject = gestureStream;
    await gestureVideo.play();

    if (typeof Hands !== 'function') throw new Error('MediaPipe Hands 脚本未能载入，请检查网络后刷新页面。');
    if (!handTracker) {
      handTracker = new Hands({
        locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${file}`,
      });
      handTracker.setOptions({
        maxNumHands: 1,
        modelComplexity: 1,
        minDetectionConfidence: 0.65,
        minTrackingConfidence: 0.6,
      });
      handTracker.onResults(processHandResults);
    }
    if (generation !== gestureGeneration) throw new Error('手势控制启动已取消。');

    gestureActive = true;
    gestureLastSeen = 0;
    lastGestureFrame = 0;
    gestureState.yawSpeed = 0;
    gestureState.pitchSpeed = 0;
    gestureState.moveForward = 0;
    gestureState.handDetected = false;
    gestureState.isPinching = false;
    gestureZoomBaseWidth = 0;
    gestureZoomBaseFov = camera.fov;
    help.innerHTML = '手掌左右/上下：环视 <span>·</span> 手掌前后：拉近/拉远 <span>·</span> 捏合：交互';
    gestureStateTag.textContent = '等待手部';
    setGestureButtons('Disable camera control');
    commandStatus.textContent = '手掌位置控制上下左右视角；拇指食指捏合可交互。';
    if (!document.pointerLockElement && !debugOpen) {
      hasStarted = true;
      entryScreen.hidden = true;
      crosshair.hidden = true;
    }
  } catch (error) {
    console.error('MediaPipe 手势控制启动失败：', error);
    stopGestureMode(false);
    commandStatus.textContent = `手势控制未启动：${error.message || '请检查摄像头权限和网络。'}`;
    if (!debugOpen) commandStatus.textContent = `手势控制未启动：${error.message || '请检查摄像头权限和网络。'}`;
  } finally {
    gestureInitializing = false;
    gestureButtons.forEach((button) => { button.disabled = false; });
  }
}

function stopGestureMode(showStatus = true) {
  gestureGeneration += 1;
  gestureActive = false;
  gestureState.yawSpeed = 0;
  gestureState.pitchSpeed = 0;
  gestureState.moveForward = 0;
  gestureState.handDetected = false;
  gestureState.isPinching = false;
  gestureLastSeen = 0;
  gestureZoomBaseWidth = 0;
  help.innerHTML = '鼠标环视 <span>·</span> 滚轮拉近/拉远 <span>·</span> 长按快速定位';
  if (handTracker) {
    handTracker.close();
    handTracker = null;
  }
  if (gestureStream) {
    for (const track of gestureStream.getTracks()) track.stop();
    gestureStream = null;
  }
  gestureVideo.srcObject = null;
  gestureStateTag.textContent = '摄像头已关闭';
  gestureContext.clearRect(0, 0, gestureCanvas.width, gestureCanvas.height);
  setGestureButtons('Enable camera control');
  if (showStatus) commandStatus.textContent = '摄像头手势控制已关闭。';
}

function toggleGestureMode() {
  if (gestureActive || gestureInitializing) stopGestureMode();
  else startGestureMode();
}

function toggleGestureWidget() {
  gestureWidget.hidden = !gestureWidget.hidden;
  if (!gestureActive && !gestureWidget.hidden) gestureStateTag.textContent = '摄像头未开启';
  commandStatus.textContent = gestureWidget.hidden ? '摄像头预览窗口已关闭。' : '摄像头预览窗口已打开。';
}

function recognizeHandFrame(time) {
  if (!gestureActive || debugOpen || !handTracker || gestureVideo.readyState < 2 || handFrameInFlight) return;
  if (time - lastGestureFrame < 66 || gestureVideo.currentTime === recognizeHandFrame.lastVideoTime) return;
  recognizeHandFrame.lastVideoTime = gestureVideo.currentTime;
  lastGestureFrame = time;
  handFrameInFlight = true;
  handTracker.send({ image: gestureVideo }).catch((error) => {
    console.error('MediaPipe 手势识别中断：', error);
    stopGestureMode(false);
    commandStatus.textContent = '手势识别中断，摄像头已关闭；可继续使用鼠标环视。';
  }).finally(() => { handFrameInFlight = false; });
}

function drawHandSkeleton(landmarks) {
  gestureCanvas.width = 240;
  gestureCanvas.height = 180;
  gestureContext.clearRect(0, 0, 240, 180);
  if (gestureVideo.readyState >= 2) {
    gestureContext.globalAlpha = 0.32;
    gestureContext.drawImage(gestureVideo, 0, 0, 240, 180);
    gestureContext.globalAlpha = 1;
  }
  if (!landmarks) return;

  gestureContext.strokeStyle = 'rgba(56, 189, 248, 0.85)';
  gestureContext.lineWidth = 2;
  HAND_CONNECTIONS.forEach(([from, to]) => {
    gestureContext.beginPath();
    gestureContext.moveTo(landmarks[from].x * 240, landmarks[from].y * 180);
    gestureContext.lineTo(landmarks[to].x * 240, landmarks[to].y * 180);
    gestureContext.stroke();
  });
  landmarks.forEach((point, index) => {
    gestureContext.beginPath();
    gestureContext.arc(point.x * 240, point.y * 180, index === 4 || index === 8 ? 4.2 : 2.5, 0, Math.PI * 2);
    gestureContext.fillStyle = index === 4 || index === 8 ? '#fbbf24' : '#e0f2fe';
    gestureContext.fill();
  });
}

function processHandResults(results) {
  gestureLastSeen = performance.now();
  const landmarks = results.multiHandLandmarks && results.multiHandLandmarks[0];
  drawHandSkeleton(landmarks);
  if (!landmarks) {
    gestureState.handDetected = false;
    gestureState.yawSpeed *= 0.85;
    gestureState.pitchSpeed *= 0.85;
    gestureState.moveForward *= 0.85;
    gestureStateTag.textContent = '未检测到手部';
    return;
  }

  gestureState.handDetected = true;
  const palmWidth = Math.hypot(landmarks[5].x - landmarks[17].x, landmarks[5].y - landmarks[17].y);
  if (!gestureZoomBaseWidth) {
    gestureZoomBaseWidth = palmWidth;
    gestureZoomBaseFov = camera.fov;
  } else if (palmWidth > 0.01) {
    const targetFov = THREE.MathUtils.clamp(gestureZoomBaseFov * gestureZoomBaseWidth / palmWidth, 38, 95);
    camera.fov += (targetFov - camera.fov) * 0.16;
    camera.updateProjectionMatrix();
  }
  const palmX = 1.0 - landmarks[9].x;
  const palmY = landmarks[9].y;
  const deadzone = 0.14;
  const offsetX = palmX - 0.5;
  const offsetY = palmY - 0.5;
  const targetYaw = Math.abs(offsetX) > deadzone
    ? Math.sign(offsetX) * ((Math.abs(offsetX) - deadzone) / (0.5 - deadzone)) * 1.2
    : 0;
  const targetPitch = Math.abs(offsetY) > deadzone
    ? -Math.sign(offsetY) * ((Math.abs(offsetY) - deadzone) / (0.5 - deadzone)) * 0.8
    : 0;
  gestureState.yawSpeed += (targetYaw - gestureState.yawSpeed) * 0.18;
  gestureState.pitchSpeed += (targetPitch - gestureState.pitchSpeed) * 0.18;

  const thumbTip = landmarks[4];
  const indexTip = landmarks[8];
  const pinchDistance = Math.hypot(thumbTip.x - indexTip.x, thumbTip.y - indexTip.y);
  if (pinchDistance < 0.055) {
    gestureStateTag.textContent = '捏合触发';
    const now = performance.now();
    if (!gestureState.isPinching && now - gestureState.lastPinchTriggerTime > 800) {
      gestureState.isPinching = true;
      gestureState.lastPinchTriggerTime = now;
      interactAtCrosshair();
    }
  } else {
    gestureState.isPinching = false;
    gestureStateTag.textContent = '视角控制';
  }
  gestureState.moveForward = 0;
}

function interactAtCrosshair() {
  if (coordinateMode) {
    updateCoordinateReadout();
    return;
  }
  objectRaycaster.setFromCamera(centerPointer, camera);
  if (interactiveModel && objectRaycaster.intersectObject(interactiveModel, true).length > 0) {
    toggleSound();
    return;
  }
  coordinateRaycaster.params.Points.threshold = Math.max(pointSize * 4, 0.03);
  coordinateRaycaster.setFromCamera(centerPointer, camera);
  const hit = roomCloud && coordinateRaycaster.intersectObject(roomCloud)[0];
  if (hit) triggerScatter(hit.point);
}

function openDebug() {
  if (debugOpen) return;
  debugOpen = true;
  debugBackdrop.hidden = false;
  if (document.pointerLockElement === renderer.domElement) document.exitPointerLock();
  crosshair.hidden = true;
  commandInput.value = '';
  commandInput.focus();
}

function closeDebug() {
  if (!debugOpen) return;
  debugOpen = false;
  debugBackdrop.hidden = true;
  if (gestureActive) {
    hasStarted = true;
    entryScreen.hidden = true;
  }
}

commandForm.addEventListener('submit', (event) => {
  event.preventDefault();
  const command = commandInput.value.trim();
  const pointCommand = command.match(/^\/point\s+([0-9]*\.?[0-9]+)$/i);

  if (pointCommand) {
    const value = Number(pointCommand[1]);
    if (!roomCloud || !Number.isFinite(value) || value <= 0) {
      commandStatus.textContent = '请输入大于 0 的点大小。';
    } else {
      pointSize = value;
      roomCloud.material.size = value;
      commandStatus.textContent = `点大小已设为 ${value}。`;
    }
  } else if (/^\/coor\s+on$/i.test(command)) {
    coordinateMode = true;
    coordReadout.hidden = false;
    updateCoordinateReadout();
    commandStatus.textContent = '坐标读取已开启：准心瞄准点云并点击读取。';
  } else if (/^\/coor\s+off$/i.test(command)) {
    coordinateMode = false;
    coordReadout.hidden = true;
    commandStatus.textContent = '坐标读取已关闭。';
  } else if (/^\/gesture\s+on$/i.test(command)) {
    startGestureMode();
  } else if (/^\/gesture\s+off$/i.test(command)) {
    stopGestureMode();
  } else if (/^\/window$/i.test(command)) {
    toggleGestureWidget();
  } else {
    commandStatus.textContent = '未识别命令。可用：/point X、/coor on/off、/gesture on/off、/window';
  }
  commandInput.value = '';
  commandInput.focus();
});

gestureButtons.forEach((button) => button.addEventListener('click', toggleGestureMode));

document.querySelector('#close-debug').addEventListener('click', closeDebug);
debugBackdrop.addEventListener('pointerdown', (event) => {
  if (event.target === debugBackdrop) closeDebug();
});

document.addEventListener('keydown', (event) => {
  if (event.key === '/' && !debugOpen && !['INPUT', 'TEXTAREA'].includes(document.activeElement?.tagName)) {
    event.preventDefault();
    openDebug();
    return;
  }
  if (event.key === 'Escape' && debugOpen) {
    event.preventDefault();
    closeDebug();
    return;
  }
  if (event.key === 'Escape' && !infoModal.hidden) {
    event.preventDefault();
    hideInfo();
    return;
  }
  if (event.key === 'Escape' && !radialMenu.hidden) {
    radialMenu.hidden = true;
    return;
  }
  if (event.key === 'Escape' && gestureActive) {
    stopGestureMode(false);
    if (document.pointerLockElement === renderer.domElement) document.exitPointerLock();
    showEntry(true);
    return;
  }
  if (event.key === 'Escape' && hasStarted && !debugOpen) {
    if (document.pointerLockElement === renderer.domElement) document.exitPointerLock();
    radialMenu.hidden = true;
    showEntry(true);
    return;
  }
  if (debugOpen || !hasStarted) return;
  if (event.code === 'Space') event.preventDefault();
});

document.addEventListener('mousemove', (event) => {
  if (document.pointerLockElement !== renderer.domElement || debugOpen) return;
  yaw = THREE.MathUtils.clamp(yaw + event.movementX * LOOK_SENSITIVITY, VIEW_YAW_CENTER - VIEW_YAW_LIMIT, VIEW_YAW_CENTER + VIEW_YAW_LIMIT);
  pitch = THREE.MathUtils.clamp(pitch - event.movementY * LOOK_SENSITIVITY, -1.42, 1.42);
  updateCameraLook();
});

document.addEventListener('wheel', (event) => {
  if (introDismissed && !introCover.isConnected && radialMenu.hidden && !debugOpen) {
    camera.fov = THREE.MathUtils.clamp(camera.fov + event.deltaY * 0.025, 38, 95);
    camera.updateProjectionMatrix();
  }
}, { passive: true });

renderer.domElement.addEventListener('pointerdown', (event) => {
  if (event.button !== 0 || !hasStarted || debugOpen) return;
  longPressTriggered = false;
  window.clearTimeout(longPressTimer);
  longPressTimer = window.setTimeout(() => {
    longPressTriggered = true;
    radialMenu.hidden = false;
    radialSelection = 0;
    updateRadialSelection();
    radialMenu.classList.remove('is-open');
    requestAnimationFrame(() => radialMenu.classList.add('is-open'));
    if (document.pointerLockElement === renderer.domElement) document.exitPointerLock();
  }, LONG_PRESS_MS);
});
document.addEventListener('pointerup', (event) => {
  if (event.button !== 0) return;
  window.clearTimeout(longPressTimer);
  if (!longPressTriggered && document.pointerLockElement === renderer.domElement && !debugOpen) interactAtCrosshair();
});
renderer.domElement.addEventListener('contextmenu', (event) => event.preventDefault());

radialMenu.addEventListener('click', (event) => {
  const index = Number(event.target.closest('button')?.dataset.index);
  if (!Number.isInteger(index) || !ITEM_VIEWPOINTS[index]) return;
  radialMenu.hidden = true;
  locateItem(index);
});

function locateItem(index) {
  const item = ITEM_VIEWPOINTS[index];
  const destination = new THREE.Vector3(item.position[0], item.position[1], floorZ + EYE_HEIGHT);
  const target = new THREE.Vector3(...item.target);
  const direction = target.sub(destination).normalize();
  const destinationYaw = Math.atan2(direction.x, direction.y);
  const destinationPitch = Math.asin(THREE.MathUtils.clamp(direction.z, -1, 1));
  cameraFlight = {
    startedAt: performance.now(),
    duration: 850,
    from: camera.position.clone(),
    to: destination,
    fromYaw: yaw,
    toYaw: destinationYaw,
    fromPitch: pitch,
    toPitch: destinationPitch,
  };
  if (!gestureActive) requestPointerLock();
}

function locateStart() {
  camera.fov = 72;
  camera.updateProjectionMatrix();
  cameraFlight = {
    startedAt: performance.now(), duration: 850, from: camera.position.clone(),
    to: new THREE.Vector3(START_X, START_Y - 0.22, floorZ + EYE_HEIGHT),
    fromYaw: yaw, toYaw: Math.PI, fromPitch: pitch, toPitch: 0,
  };
}

document.addEventListener('pointerlockchange', () => {
  const locked = document.pointerLockElement === renderer.domElement;
  if (locked) {
    hasStarted = true;
    entryScreen.hidden = true;
    crosshair.hidden = false;
  } else {
    crosshair.hidden = true;
  }
});

async function requestPointerLock() {
  try {
    const result = renderer.domElement.requestPointerLock();
    if (result && typeof result.then === 'function') await result;
    if (audioListener.context.state === 'suspended') await audioListener.context.resume();
  } catch (error) {
    commandStatus.textContent = '浏览器未能启用鼠标锁定，请检查权限。';
    console.warn('鼠标锁定未能启动：', error);
  }
}

enterButton.addEventListener('click', requestPointerLock);
returnStartButton.addEventListener('click', () => {
  radialMenu.hidden = true;
  locateStart();
  if (!gestureActive) requestPointerLock();
  else entryScreen.hidden = true;
});
entryScreen.addEventListener('click', (event) => {
  if (event.target === entryScreen) requestPointerLock();
});

function movePlayer(deltaSeconds) {
  const gestureFresh = gestureActive && gestureLastSeen && performance.now() - gestureLastSeen < 350;
  const pointerLocked = document.pointerLockElement === renderer.domElement;
  if (!hasStarted || (!pointerLocked && !gestureFresh) || debugOpen) return;
  if (gestureFresh) {
    yaw = THREE.MathUtils.clamp(yaw + gestureState.yawSpeed * deltaSeconds, VIEW_YAW_CENTER - VIEW_YAW_LIMIT, VIEW_YAW_CENTER + VIEW_YAW_LIMIT);
    pitch = THREE.MathUtils.clamp(pitch + gestureState.pitchSpeed * deltaSeconds, -1.05, 1.05);
    updateCameraLook();
  }
}

function resize() {
  const width = host.clientWidth;
  const height = host.clientHeight;
  if (!width || !height) return;
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
  renderer.setSize(width, height);
}
new ResizeObserver(resize).observe(host);
resize();

renderer.setAnimationLoop((time) => {
  const deltaSeconds = previousFrameTime ? Math.min((time - previousFrameTime) / 1000, 0.05) : 0;
  previousFrameTime = time;

  if (cameraFlight) {
    const t = THREE.MathUtils.clamp((time - cameraFlight.startedAt) / cameraFlight.duration, 0, 1);
    const eased = t * t * (3 - 2 * t);
    camera.position.lerpVectors(cameraFlight.from, cameraFlight.to, eased);
    const yawDelta = Math.atan2(Math.sin(cameraFlight.toYaw - cameraFlight.fromYaw), Math.cos(cameraFlight.toYaw - cameraFlight.fromYaw));
    yaw = cameraFlight.fromYaw + yawDelta * eased;
    pitch = THREE.MathUtils.lerp(cameraFlight.fromPitch, cameraFlight.toPitch, eased);
    updateCameraLook();
    if (t >= 1) cameraFlight = null;
  }

  if (introPlaying) {
    const t = THREE.MathUtils.clamp((time - introStartTime) / INTRO_MS, 0, 1);
    const eased = t * t * (3 - 2 * t);
    camera.position.set(START_X, START_Y - 0.22 * eased, floorZ + 0.48 + (EYE_HEIGHT - 0.48) * eased);
    updateCameraLook();
    if (t >= 1) {
      introPlaying = false;
      showEntry(false);
    }
  } else {
    recognizeHandFrame(time);
    movePlayer(deltaSeconds);
    if (coordinateMode) updateCoordinateReadout();
  }
  updateScatter(time);
  renderer.render(scene, camera);
});

window.addEventListener('beforeunload', () => stopGestureMode(false));
