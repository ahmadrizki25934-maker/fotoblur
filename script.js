// ============================================================================
// REAL-TIME PERFECT ALIGNMENT & DUAL-STAGE SMOOTHING SPATIAL ENGINE
// ============================================================================

const video = document.getElementById("video");
const canvas3d = document.getElementById("three-canvas");

// --- 1. THREE.JS KANVAS & KAMERA PROYEKSI ---
const scene = new THREE.Scene();
const camera3d = new THREE.PerspectiveCamera(60, 16 / 9, 0.1, 1000); // Kunci rasio ke 16:9
const renderer = new THREE.WebGLRenderer({ canvas: canvas3d, alpha: true, antialias: true });

// Set ukuran awal berdasarkan dimensi pembungkusnya
renderer.setSize(canvas3d.clientWidth, canvas3d.clientHeight, false);
camera3d.position.set(0, 0, 5); // Dekatkan kamera agar akurasi depth meningkat

// Pencahayaan Virtual Lingkungan Spasial
const ambientLight = new THREE.AmbientLight(0xffffff, 0.7);
scene.add(ambientLight);
const dirLight = new THREE.DirectionalLight(0xffffff, 0.8);
dirLight.position.set(5, 5, 5);
scene.add(dirLight);

// --- 2. CONFIGURATIONS & ADVANCED FILTERS ---
const MAX_OBJECTS = 20;
let spatialObjects = [];
let selectedObject = null;
let hoveredObject = null;

let pinchState = 'RELEASED';
let spawnTimer = 0;
let deleteTimer = 0;
let focusModeActive = false;

// Filter Data Koordinat (Makin kecil nilainya, makin hilangnya getaran/jitter)
const emaFilters = {};
const EMA_ALPHA = 0.12; 

// Pointer Spasial Bercahaya (Feature 1)
const pointerGeometry = new THREE.SphereGeometry(0.1, 32, 32);
const pointerMaterial = new THREE.MeshBasicMaterial({ color: 0x00ffff, transparent: true, opacity: 0.8 });
const spatialPointer = new THREE.Mesh(pointerGeometry, pointerMaterial);
spatialPointer.add(new THREE.Mesh(new THREE.SphereGeometry(0.04, 16, 16), new THREE.MeshBasicMaterial({ color: 0xffffff })));
scene.add(spatialPointer);

const handVisualizerGroup = new THREE.Group();
scene.add(handVisualizerGroup);

// --- 3. MATHEMATICAL ALIGNMENT MATRIX (KALIBRASI 1:1) ---
function applyEMA(id, currentValue) {
    if (!emaFilters[id]) emaFilters[id] = currentValue;
    emaFilters[id] = (EMA_ALPHA * currentValue) + ((1 - EMA_ALPHA) * emaFilters[id]);
    return emaFilters[id];
}

function calculateDistance(p1, p2) {
    return Math.sqrt(Math.pow(p1.x - p2.x, 2) + Math.pow(p1.y - p2.y, 2) + Math.pow(p1.z - p2.z, 2));
}

// Fungsi utama mengubah koordinat 2D MediaPipe menjadi Koordinat Real World 3D secara presisi
function mapToSpatialSpace(landmark, depthTarget = 0) {
    // Tahap 1: Haluskan koordinat mentah dari sensor kamera
    const sx = applyEMA('lm_x_' + landmark.index, landmark.x);
    const sy = applyEMA('lm_y_' + landmark.index, landmark.y);
    const sz = applyEMA('lm_z_' + landmark.index, landmark.z);

    // Hitung dimensi dinding frustum kamera secara dinamis pada kedalaman tertentu
    const distance = camera3d.position.z - depthTarget;
    const visibleHeight = 2 * Math.tan((camera3d.fov * Math.PI) / 360) * distance;
    const visibleWidth = visibleHeight * camera3d.aspect;

    // Mapping linier sempurna. Karena CSS dicerminkan bersamaan, sumbu X berjalan normal (kiri ke kanan)
    const targetX = (sx - 0.5) * visibleWidth;
    const targetY = -(sy - 0.5) * visibleHeight; // Balik sumbu Y karena Three.js menganggap atas adalah positif
    const targetZ = depthTarget - (sz * 3.5); // Multiplier kedalaman maju mundur tangan

    return new THREE.Vector3(targetX, targetY, targetZ);
}

// --- 4. GESTURE ENGINE STATE MACHINE ---
function evaluateGestures(landmarks) {
    const thumbTip = landmarks[4];
    const indexTip = landmarks[8];
    const indexKnuckle = landmarks[5];
    const middleTip = landmarks[12];
    const ringTip = landmarks[16];
    const pinkyTip = landmarks[20];

    const pinchDist = calculateDistance(thumbTip, indexTip);
    
    const isIndexExtended = indexTip.y < indexKnuckle.y;
    const isMiddleExtended = middleTip.y < landmarks[9].y;
    const isRingExtended = ringTip.y < landmarks[13].y;
    const isPinkyExtended = pinkyTip.y < landmarks[17].y;

    // Deteksi Pinch
    if (pinchDist < 0.045) {
        pinchState = (pinchState === 'RELEASED') ? 'PRESSED' : 'HOLDING';
    } else {
        pinchState = 'RELEASED';
    }

    if (!isIndexExtended && !isMiddleExtended && !isRingExtended && !isPinkyExtended) return { name: "Fist", basic: "CLOSED" };
    if (isIndexExtended && isMiddleExtended && !isRingExtended && !isPinkyExtended) return { name: "Peace Sign", basic: "PEACE" };
    if (isIndexExtended && isMiddleExtended && isRingExtended && isPinkyExtended) return { name: "Open Palm", basic: "OPEN" };
    if (pinchState === 'HOLDING' || pinchState === 'PRESSED') return { name: "Pinch / Grab", basic: "PINCH" };

    return { name: "Tracking", basic: "UNKNOWN" };
}

// --- 5. INTERAKSI DAN MANIPULASI OBJEK ---
function handleObjectHover(pointerPos) {
    let closestObj = null;
    let minDistance = 0.6; // Jarak sensitivitas hover pointer ke objek

    spatialObjects.forEach(obj => {
        const dist = pointerPos.distanceTo(obj.mesh.position);
        if (dist < minDistance) {
            minDistance = dist;
            closestObj = obj;
        }
    });

    if (closestObj) {
        if (hoveredObject !== closestObj) {
            clearHoverState();
            hoveredObject = closestObj;
            // Berikan efek pendaran (glow) saat ter-hover mouse/pointer tangan
            hoveredObject.mesh.material.emissive.setHex(0x002233);
        }
    } else {
        clearHoverState();
    }
}

function clearHoverState() {
    if (hoveredObject) {
        hoveredObject.mesh.material.emissive.setHex(0x000000);
        hoveredObject = null;
    }
}

function createSpatialObject(position) {
    if (spatialObjects.length >= MAX_OBJECTS) return;

    const types = ['cube', 'sphere', 'panel'];
    const type = types[Math.floor(Math.random() * types.length)];
    let geom;

    if (type === 'cube') geom = new THREE.BoxGeometry(0.7, 0.7, 0.7);
    else if (type === 'sphere') geom = new THREE.SphereGeometry(0.4, 32, 32);
    else geom = new THREE.BoxGeometry(1.2, 0.8, 0.04); // Glassmorphic Window visionOS

    const mat = new THREE.MeshStandardMaterial({
        color: Math.random() * 0xffffff,
        roughness: 0.1,
        metalness: 0.1,
        transparent: true,
        opacity: 0.85
    });

    const mesh = new THREE.Mesh(geom, mat);
    mesh.position.copy(position);
    scene.add(mesh);

    spatialObjects.push({
        id: Math.floor(Math.random() * 10000),
        type: type,
        mesh: mesh,
        velocity: new THREE.Vector3(0, 0, 0)
    });
}

function dissolveObject(obj) {
    const duration = 400;
    const start = Date.now();
    function anim() {
        const progress = (Date.now() - start) / duration;
        if (progress < 1) {
            obj.mesh.scale.multiplyScalar(0.9);
            obj.mesh.material.opacity = 1 - progress;
            requestAnimationFrame(anim);
        } else {
            scene.remove(obj.mesh);
            spatialObjects = spatialObjects.filter(item => item.id !== obj.id);
            if (selectedObject === obj) selectedObject = null;
            updateInspector();
        }
    }
    anim();
}

// --- 6. VISUALISASI RANGKA TANGAN MODERN (Feature 14) ---
function drawPremiumSkeleton(landmarks) {
    handVisualizerGroup.clear();
    const jointMat = new THREE.MeshBasicMaterial({ color: 0x00ffff });
    const boneMat = new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.3 });

    const points = landmarks.map((lm, idx) => {
        lm.index = idx;
        const vec = mapToSpatialSpace(lm, 0);
        const sphere = new THREE.Mesh(new THREE.SphereGeometry(0.04, 8, 8), jointMat);
        sphere.position.copy(vec);
        handVisualizerGroup.add(sphere);
        return vec;
    });

    HAND_CONNECTIONS.forEach(conn => {
        const geom = new THREE.BufferGeometry().setFromPoints([points[conn[0]], points[conn[1]]]);
        handVisualizerGroup.add(new THREE.Line(geom, boneMat));
    });
}

// --- 7. CORE REALTIME PROCESSING PIPELINE ---
function onResults(results) {
    if (!results.multiHandLandmarks || results.multiHandLandmarks.length === 0) {
        spatialPointer.visible = false;
        handVisualizerGroup.clear();
        clearHoverState();
        document.getElementById("current-gesture").innerText = "Gesture: Detecting...";
        return;
    }

    spatialPointer.visible = true;
    const primaryHand = results.multiHandLandmarks[0];
    
    // Tahap 2 Interpolasi: Buat kursor mengikuti ujung telunjuk dengan transisi lerp yang halus
    const targetPointerPos = mapToSpatialSpace({ ...primaryHand[8], index: 8 }, 0);
    spatialPointer.position.lerp(targetPointerPos, 0.25); 

    drawPremiumSkeleton(primaryHand);
    const gesture = evaluateGestures(primaryHand);
    document.getElementById("current-gesture").innerText = `Gesture: ${gesture.name}`;

    handleObjectHover(spatialPointer.position);

    // ACTION TRIGGER MANAGER
    if (gesture.basic === "OPEN") {
        spawnTimer += 16.67;
        if (spawnTimer >= 1000) {
            createSpatialObject(spatialPointer.position.clone().add(new THREE.Vector3(0, 0, -0.5)));
            spawnTimer = 0;
        }
    } else { spawnTimer = 0; }

    if (pinchState === 'PRESSED' && hoveredObject) selectedObject = hoveredObject;

    if (pinchState === 'HOLDING' && selectedObject) {
        const lastPos = selectedObject.mesh.position.clone();
        // Gerakan objek mengikuti tangan dihaluskan dengan koefisien lerp 0.15 (sangat halus)
        selectedObject.mesh.position.lerp(spatialPointer.position, 0.15);
        
        // Simpan sisa kalkulasi perpindahan untuk efek momentum fisika meluncur
        selectedObject.velocity.subVectors(selectedObject.mesh.position, lastPos);

        // Rotasi interaktif mengikuti orientasi pergelangan tangan
        const wrist = mapToSpatialSpace({ ...primaryHand[0], index: 0 });
        const knuckle = mapToSpatialSpace({ ...primaryHand[9], index: 9 });
        const dir = new THREE.Vector3().subVectors(knuckle, wrist).normalize();
        selectedObject.mesh.rotation.x = dir.y * 1.5;
        selectedObject.mesh.rotation.y = dir.x * 1.5;
    }

    if (pinchState === 'RELEASED') selectedObject = null;

    // Deteksi Kontrol Dua Tangan (Scaling Objek)
    if (results.multiHandLandmarks.length >= 2 && gesture.basic === "OPEN" && selectedObject) {
        const secondaryHand = results.multiHandLandmarks[1];
        const secPointer = mapToSpatialSpace({ ...secondaryHand[8], index: 28 }, 0);
        const dist = spatialPointer.position.distanceTo(secPointer);
        selectedObject.mesh.scale.setScalar(Math.max(0.3, Math.min(2.5, dist * 0.5)));
    }

    if (gesture.basic === "CLOSED" && hoveredObject) {
        deleteTimer += 16.67;
        if (deleteTimer >= 1000) {
            dissolveObject(hoveredObject);
            deleteTimer = 0;
        }
    } else { deleteTimer = 0; }

    if (gesture.basic === "PEACE") {
        focusModeActive = !focusModeActive;
        dirLight.color.setHex(focusModeActive ? 0xff00bb : 0xffffff);
    }

    updateInspector();
}

function updateInspector() {
    const panel = document.getElementById("object-inspector");
    if (!selectedObject) { panel.classList.add("hidden"); return; }
    panel.classList.remove("hidden");
    document.getElementById("inspect-status").innerText = "GRABBED";
    document.getElementById("inspect-status").className = "badge active";
    document.getElementById("inspect-id").innerText = selectedObject.id;
    document.getElementById("inspect-type").innerText = selectedObject.type.toUpperCase();
    document.getElementById("inspect-px").innerText = selectedObject.mesh.position.x.toFixed(2);
    document.getElementById("inspect-py").innerText = selectedObject.mesh.position.y.toFixed(2);
    document.getElementById("inspect-pz").innerText = selectedObject.mesh.position.z.toFixed(2);
    document.getElementById("inspect-rx").innerText = selectedObject.mesh.rotation.x.toFixed(2);
    document.getElementById("inspect-ry").innerText = selectedObject.mesh.rotation.y.toFixed(2);
    document.getElementById("inspect-rz").innerText = selectedObject.mesh.rotation.z.toFixed(2);
    document.getElementById("inspect-scale").innerText = selectedObject.mesh.scale.x.toFixed(2);
}

// --- 8. PHYSICS SIMULATOR & TICK ANIMATION ---
function animate() {
    requestAnimationFrame(animate);
    spatialObjects.forEach(obj => {
        if (obj !== selectedObject) {
            obj.mesh.position.add(obj.velocity);
            obj.velocity.multiplyScalar(0.90); // Mengurangi momentum secara halus (Friction)
            obj.mesh.rotation.x += 0.003;
            obj.mesh.rotation.y += 0.002;
        }
    });
    renderer.render(scene, camera3d);
}
animate();

// --- 9. PLATFORM INITIALIZATION HOOKS ---
async function startCamera() {
    const stream = await navigator.mediaDevices.getUserMedia({ video: { width: 1280, height: 720 } });
    video.srcObject = stream;
}
startCamera();

const hands = new Hands({ locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${file}` });
hands.setOptions({ maxNumHands: 2, modelComplexity: 1, minDetectionConfidence: 0.75, minTrackingConfidence: 0.75 });
hands.onResults(onResults);

const camera = new Camera(video, {
    onFrame: async () => { await hands.send({ image: video }); },
    width: 1280, height: 720
});
camera.start();

// Listener dinamis mengikuti resolusi kontainer pengunci
window.addEventListener('resize', () => {
    const w = canvas3d.clientWidth;
    const h = canvas3d.clientHeight;
    camera3d.aspect = w / h;
    camera3d.updateProjectionMatrix();
    renderer.setSize(w, h, false);
});
