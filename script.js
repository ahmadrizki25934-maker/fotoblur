// ============================================================================
// APPLE VISION PRO SPATIAL COMPUTING ENGINE - REVISED ARCHITECTURE (2026)
// ============================================================================

const video = document.getElementById("video");
const canvas3d = document.getElementById("three-canvas");

// --- 1. THREE.JS SPATIAL ENGINE INITIALIZATION ---
const scene = new THREE.Scene();
const camera3d = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 1000);
const renderer = new THREE.WebGLRenderer({ canvas: canvas3d, alpha: true, antialias: true });

renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.shadowMap.enabled = true;

// Move camera back to capture spatial volume area properly
camera3d.position.set(0, 0, 8);

// Add spatial environment lightning systems
const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
scene.add(ambientLight);

const directionalLight = new THREE.DirectionalLight(0xffffff, 0.9);
directionalLight.position.set(5, 10, 7);
scene.add(directionalLight);

const pointLight = new THREE.PointLight(0x00ffff, 0.5, 15);
pointLight.position.set(0, 0, 4);
scene.add(pointLight);

// --- 2. CONFIGURATIONS & STATE ENGINE CONTROLS ---
const MAX_OBJECTS = 20;
let spatialObjects = [];
let selectedObject = null;
let hoveredObject = null;

// Gestures State Machine trackers
let pinchState = 'RELEASED'; // RELEASED, PRESSED, HOLDING
let spawnTimer = 0;
let deleteTimer = 0;
let focusModeActive = false;

// Exponential Moving Average (EMA) Filter data storage for ultra-smooth rendering
const emaFilters = {};
const EMA_ALPHA = 0.22; // Low value = higher smoothing, minimizes coordinate jittering

// Premium Hand Tracking Meshes Group
const handVisualizerGroup = new THREE.Group();
scene.add(handVisualizerGroup);

// Spatial Pointer Setup (Feature 1)
const pointerGeometry = new THREE.SphereGeometry(0.12, 32, 32);
const pointerMaterial = new THREE.MeshBasicMaterial({
    color: 0x00ffff,
    transparent: true,
    opacity: 0.8
});
const spatialPointer = new THREE.Mesh(pointerGeometry, pointerMaterial);
// Add core glow rings inside pointer
const innerGlow = new THREE.Mesh(new THREE.SphereGeometry(0.06, 16, 16), new THREE.MeshBasicMaterial({ color: 0xffffff }));
spatialPointer.add(innerGlow);
scene.add(spatialPointer);

// --- 3. FILTERING & UTILITIES ---
function applyEMA(id, currentValue) {
    if (!emaFilters[id]) {
        emaFilters[id] = currentValue;
    }
    emaFilters[id] = (EMA_ALPHA * currentValue) + ((1 - EMA_ALPHA) * emaFilters[id]);
    return emaFilters[id];
}

function calculateDistance(pt1, pt2) {
    return Math.sqrt(Math.pow(pt1.x - pt2.x, 2) + Math.pow(pt1.y - pt2.y, 2) + Math.pow(pt1.z - pt2.z, 2));
}

// Convert normalized MediaPipe landmarks coordinates safely to Three.js space coordinates
function mapToSpatialSpace(landmark) {
    const smoothedX = applyEMA('lm_x_' + landmark.index, landmark.x);
    const smoothedY = applyEMA('lm_y_' + landmark.index, landmark.y);
    const smoothedZ = applyEMA('lm_z_' + landmark.index, landmark.z);

    // Coordinate mapping mirroring X to prevent inverted hand direction tracking
    const targetX = -(smoothedX - 0.5) * 12; 
    const targetY = -(smoothedY - 0.5) * 7;
    const targetZ = -smoothedZ * 15; // Enhanced depth transformation multiplier

    return new THREE.Vector3(targetX, targetY, targetZ);
}

// --- 4. GESTURE COMPILER ENGINE ---
function evaluateGestures(landmarks) {
    // Collect specific structural landmarks
    const wrist = landmarks[0];
    const thumbTip = landmarks[4];
    const indexTip = landmarks[8];
    const indexKnuckle = landmarks[5];
    const middleTip = landmarks[12];
    const ringTip = landmarks[16];
    const pinkyTip = landmarks[20];

    // Compute direct Euclidean distance values
    const pinchDist = calculateDistance(thumbTip, indexTip);
    
    // Check if fingers are curled down or extended out relative to lower joints
    const isIndexExtended = indexTip.y < indexKnuckle.y;
    const isMiddleExtended = middleTip.y < landmarks[9].y;
    const isRingExtended = ringTip.y < landmarks[13].y;
    const isPinkyExtended = pinkyTip.y < landmarks[17].y;

    // Detect Pinch Activation State (Feature 2)
    const PINCH_THRESHOLD = 0.045;
    if (pinchDist < PINCH_THRESHOLD) {
        if (pinchState === 'RELEASED') pinchState = 'PRESSED';
        else pinchState = 'HOLDING';
    } else {
        pinchState = 'RELEASED';
    }

    // Evaluate basic hand positions based on structural parameters
    if (!isIndexExtended && !isMiddleExtended && !isRingExtended && !isPinkyExtended) {
        return { name: "Fist", basic: "CLOSED" };
    }
    if (isIndexExtended && isMiddleExtended && !isRingExtended && !isPinkyExtended) {
        return { name: "Peace Sign", basic: "PEACE" };
    }
    if (isIndexExtended && isMiddleExtended && isRingExtended && isPinkyExtended) {
        return { name: "Open Palm", basic: "OPEN" };
    }
    if (pinchState === 'HOLDING' || pinchState === 'PRESSED') {
        return { name: "Pinch / Grab", basic: "PINCH" };
    }

    return { name: "Tracking Hand", basic: "UNKNOWN" };
}

// --- 5. INTERACTION SYSTEMS ---
function handleObjectSelection(pointerPos) {
    let closestObj = null;
    let minDistance = 0.75; // Interaction volume bounding threshold radius

    spatialObjects.forEach(obj => {
        const distance = pointerPos.distanceTo(obj.mesh.position);
        if (distance < minDistance) {
            minDistance = distance;
            closestObj = obj;
        }
    });

    // Hover Engine updates (Feature 3)
    if (closestObj) {
        if (hoveredObject !== closestObj) {
            clearHoverState();
            hoveredObject = closestObj;
            // Visual accent feedback modifications
            hoveredObject.mesh.material.emissive.setHex(0x003333);
            document.body.style.cursor = "pointer";
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

// Spawns spatial structures into application (Feature 4)
function createSpatialObject(position) {
    if (spatialObjects.length >= MAX_OBJECTS) return;

    const types = ['cube', 'sphere', 'panel'];
    const randomType = types[Math.floor(Math.random() * types.length)];
    let geom;

    if (randomType === 'cube') geom = new THREE.BoxGeometry(0.8, 0.8, 0.8);
    else if (randomType === 'sphere') geom = new THREE.SphereGeometry(0.5, 32, 32);
    else geom = new THREE.BoxGeometry(1.4, 0.9, 0.05); // visionOS Panel dimension simulation

    // Dynamic material assignment mimicking spatial crystal properties
    const mat = new THREE.MeshStandardMaterial({
        color: Math.random() * 0xffffff,
        roughness: 0.1,
        metalness: 0.1,
        transparent: true,
        opacity: 0.85,
        emissive: 0x000000
    });

    const mesh = new THREE.Mesh(geom, mat);
    mesh.position.copy(position);
    scene.add(mesh);

    spatialObjects.push({
        id: Math.floor(Math.random() * 10000),
        type: randomType,
        mesh: mesh,
        velocity: new THREE.Vector3(0, 0, 0),
        prevPosition: mesh.position.clone()
    });
}

// Destroys targets with structural animation workflows (Feature 11)
function dissolveObject(obj) {
    const duration = 500; // ms
    const startTime = Date.now();

    function animateDissolve() {
        const elapsed = Date.now() - startTime;
        const progress = elapsed / duration;

        if (progress < 1) {
            obj.mesh.scale.multiplyScalar(0.88);
            obj.mesh.material.opacity = 1 - progress;
            requestAnimationFrame(animateDissolve);
        } else {
            scene.remove(obj.mesh);
            spatialObjects = spatialObjects.filter(item => item.id !== obj.id);
            if (selectedObject === obj) selectedObject = null;
            updateInspector();
        }
    }
    animateDissolve();
}

// Updates HTML UI layout systems (Feature 17)
function updateInspector() {
    const panel = document.getElementById("object-inspector");
    if (!selectedObject) {
        panel.classList.add("hidden");
        document.getElementById("inspect-status").innerText = "IDLE";
        document.getElementById("inspect-status").className = "badge";
        return;
    }

    panel.classList.remove("hidden");
    document.getElementById("inspect-status").innerText = "SELECTED";
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

// --- 6. PREMIUM CORE HAND VISUALIZATION GENERATOR (Feature 14) ---
function generatePremiumSkeleton(landmarks) {
    handVisualizerGroup.clear();

    const jointMat = new THREE.MeshBasicMaterial({ color: 0x00ffff });
    const boneMat = new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.4, linewidth: 2 });

    const spatialPoints = landmarks.map((lm, index) => {
        lm.index = index;
        const vec = mapToSpatialSpace(lm);
        
        // Add neon joints elements
        const sphereGeom = new THREE.SphereGeometry(0.05, 8, 8);
        const jointMesh = new THREE.Mesh(sphereGeom, jointMat);
        jointMesh.position.copy(vec);
        handVisualizerGroup.add(jointMesh);

        return vec;
    });

    // Build connections pipeline lines
    HAND_CONNECTIONS.forEach(connection => {
        const startPt = spatialPoints[connection[0]];
        const endPt = spatialPoints[connection[1]];

        const lineGeom = new THREE.BufferGeometry().setFromPoints([startPt, endPt]);
        const line = new THREE.Line(lineGeom, boneMat);
        handVisualizerGroup.add(line);
    });
}

// --- 7. MEDIAPIPE FRAME CONTROL ROUTINE ---
function onResults(results) {
    if (!results.multiHandLandmarks || results.multiHandLandmarks.length === 0) {
        spatialPointer.visible = false;
        handVisualizerGroup.clear();
        clearHoverState();
        document.getElementById("current-gesture").innerText = "Gesture: No Hand Found";
        return;
    }

    spatialPointer.visible = true;
    
    // Process primary lead hand input stream profiles
    const primaryHandLandmarks = results.multiHandLandmarks[0];
    
    // Feature 1: Map Index finger tip as dominant driving cursor engine position
    const indexTipPos = mapToSpatialSpace({ ...primaryHandLandmarks[8], index: 8 });
    spatialPointer.position.copy(indexTipPos);

    // Draw high quality glass structural design layers
    generatePremiumSkeleton(primaryHandLandmarks);

    // Compute spatial gestures
    const gesture = evaluateGestures(primaryHandLandmarks);
    document.getElementById("current-gesture").innerText = `Gesture: ${gesture.name}`;

    // Handle interactive hover validations across world environments
    handleObjectSelection(indexTipPos);

    // TRIGGER STATE MACHINES DISPATCH CONTEXT
    
    // SPAWN LOGIC SYSTEM (Feature 4)
    if (gesture.basic === "OPEN") {
        spawnTimer += 16.67; // Increment estimate frames timing delta step size
        if (spawnTimer >= 1000) {
            createSpatialObject(indexTipPos.clone().add(new THREE.Vector3(0, 0, -1)));
            spawnTimer = 0;
        }
    } else {
        spawnTimer = 0;
    }

    // GRAB & MOVEMENT LOGIC SYSTEM (Feature 5, 6, 7 & 8)
    if (pinchState === 'PRESSED' && hoveredObject) {
        selectedObject = hoveredObject;
    }

    if (pinchState === 'HOLDING' && selectedObject) {
        // Track displacement variations across frames using linear interpolation filters (Lerp)
        const smoothedTargetPos = new THREE.Vector3().lerpVectors(selectedObject.mesh.position, indexTipPos, 0.25);
        
        selectedObject.velocity.subVectors(smoothedTargetPos, selectedObject.mesh.position);
        selectedObject.mesh.position.copy(smoothedTargetPos);

        // Map rotational variables driven by palm alignments profiles
        const wristPos = mapToSpatialSpace({ ...primaryHandLandmarks[0], index: 0 });
        const middleKnucklePos = mapToSpatialSpace({ ...primaryHandLandmarks[9], index: 9 });
        
        const deltaDirection = new THREE.Vector3().subVectors(middleKnucklePos, wristPos).normalize();
        selectedObject.mesh.rotation.x = deltaDirection.y * 2.0;
        selectedObject.mesh.rotation.y = deltaDirection.x * 2.0;
    }

    // DISENGAGE DROP MOMENTUM TRANSITIONS (Feature 13)
    if (pinchState === 'RELEASED' && selectedObject) {
        selectedObject = null;
    }

    // MULTI-HAND CONFIGURATIONS FOR TWO HAND SCALE CONTROLS (Feature 9)
    if (results.multiHandLandmarks.length >= 2 && gesture.basic === "OPEN") {
        const secondaryHandLandmarks = results.multiHandLandmarks[1];
        const secondaryIndexTip = mapToSpatialSpace({ ...secondaryHandLandmarks[8], index: 28 });
        
        const currentHandsDistance = indexTipPos.distanceTo(secondaryIndexTip);
        if (selectedObject) {
            const calculatedScaleFactor = Math.max(0.3, Math.min(3.0, currentHandsDistance * 0.4));
            selectedObject.mesh.scale.setScalar(calculatedScaleFactor);
        }
    }

    // DELETE / DISSOLVE ROUTINE OPERATION (Feature 11)
    if (gesture.basic === "CLOSED" && hoveredObject) {
        deleteTimer += 16.67;
        if (deleteTimer >= 1000) {
            dissolveObject(hoveredObject);
            deleteTimer = 0;
        }
    } else {
        deleteTimer = 0;
    }

    // TOGGLE FOCUS MODAL SYSTEMS (Feature 15)
    if (gesture.basic === "PEACE") {
        focusModeActive = !focusModeActive;
        directionalLight.color.setHex(focusModeActive ? 0xff00ff : 0xffffff);
    }

    updateInspector();
}

// --- 8. REALTIME PHYSICAL RIGID WORLD SIMULATOR ENGINE (Feature 13) ---
function updatePhysics() {
    spatialObjects.forEach(obj => {
        // Apply physics update routine steps if object is released from direct control inputs
        if (obj !== selectedObject) {
            obj.mesh.position.add(obj.velocity);
            obj.velocity.multiplyScalar(0.92); // Fluid medium friction deceleration formula application
            
            // Apply slight ambient idle float rotation frequencies
            obj.mesh.rotation.x += 0.005;
            obj.mesh.rotation.y += 0.003;
        }
    });
}

// Main game loop driver
function animate() {
    requestAnimationFrame(animate);
    updatePhysics();
    renderer.render(scene, camera3d);
}
animate();

// --- 9. LIFECYCLE PLATFORM HOOKS INITIALIZATIONS ---
async function startCamera() {
    const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: 1280, height: 720 }
    });
    video.srcObject = stream;
}

startCamera();

const hands = new Hands({
    locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${file}`
});

hands.setOptions({
    maxNumHands: 2,
    modelComplexity: 1,
    minDetectionConfidence: 0.75,
    minTrackingConfidence: 0.75
});

hands.onResults(onResults);

const camera = new Camera(video, {
    onFrame: async () => {
        await hands.send({ image: video });
    },
    width: 1280,
    height: 720
});

camera.start();

// Handle responsive spatial layout configuration variations dynamically
window.addEventListener('resize', () => {
    camera3d.aspect = window.innerWidth / window.innerHeight;
    camera3d.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
});
