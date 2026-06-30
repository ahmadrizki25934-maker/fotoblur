const video = document.getElementById("video");
const canvas = document.getElementById("canvas");
const ctx = canvas.getContext("2d");

// ─────────────────────────────────────────────
// BLUR STATE MACHINE
// ─────────────────────────────────────────────
const blurState = {
  current: 0,           // current blur px (animated)
  target: 0,            // target blur px
  max: 16,              // max blur px
  speed: 0.08,          // lerp factor (lower = smoother)
  active: false,        // is blur fully requested
};

// ─────────────────────────────────────────────
// GESTURE CONFIDENCE SYSTEM
// ─────────────────────────────────────────────
const gestureState = {
  confidence: 0,
  maxConfidence: 12,    // frames to reach full confidence
  threshold: 8,         // frames needed to activate blur
  deactivateAt: 3,      // frames below which blur turns off
  gracePeriod: 0,       // grace frames when tracking is lost
  maxGrace: 6,          // max grace frames
};

// ─────────────────────────────────────────────
// ANIMATION LOOP
// ─────────────────────────────────────────────
function animateBlur() {
  // Smooth lerp toward target
  blurState.current += (blurState.target - blurState.current) * blurState.speed;

  // Snap to zero when nearly there to avoid infinite micro-steps
  if (Math.abs(blurState.current - blurState.target) < 0.01) {
    blurState.current = blurState.target;
  }

  // Apply blur to the video element using CSS filter (GPU accelerated)
  const px = blurState.current.toFixed(3);
  video.style.filter = `blur(${px}px)`;

  requestAnimationFrame(animateBlur);
}

animateBlur();

// ─────────────────────────────────────────────
// CAMERA INIT
// ─────────────────────────────────────────────
async function startCamera() {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ video: true });
    video.srcObject = stream;
  } catch (err) {
    console.warn("Camera access denied:", err);
  }
}

startCamera();

// ─────────────────────────────────────────────
// MEDIAPIPE HANDS SETUP
// ─────────────────────────────────────────────
const hands = new Hands({
  locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${file}`,
});

hands.setOptions({
  maxNumHands: 2,
  modelComplexity: 1,
  minDetectionConfidence: 0.7,
  minTrackingConfidence: 0.7,
});

hands.onResults(onResults);

const camera = new Camera(video, {
  onFrame: async () => {
    await hands.send({ image: video });
  },
  width: 1280,
  height: 720,
});

camera.start();

// ─────────────────────────────────────────────
// GESTURE DETECTION: PEACE / V SIGN
// ─────────────────────────────────────────────

/**
 * Returns true if a finger (given its tip, pip, mcp indices) is extended.
 * Uses the y-axis relative comparison (tip above pip above mcp).
 * Works for index and middle fingers robustly.
 */
function isFingerExtended(landmarks, tip, pip, mcp) {
  if (!landmarks[tip] || !landmarks[pip] || !landmarks[mcp]) return false;
  // In normalized coords, lower y = higher on screen
  // Tip should be clearly above pip, pip above mcp
  return landmarks[tip].y < landmarks[pip].y - 0.02 &&
         landmarks[pip].y < landmarks[mcp].y;
}

/**
 * Returns true if a finger is curled/closed.
 * Tip y should be below or near the pip (curled toward palm).
 */
function isFingerCurled(landmarks, tip, pip) {
  if (!landmarks[tip] || !landmarks[pip]) return false;
  // Tip is below pip (closer to palm) or nearly equal → curled
  return landmarks[tip].y > landmarks[pip].y - 0.01;
}

/**
 * Detect Peace Sign / V Sign on a single hand.
 * Landmark indices: https://developers.google.com/mediapipe/solutions/vision/hand_landmarker
 *
 * Index finger:  MCP=5, PIP=6, DIP=7, TIP=8
 * Middle finger: MCP=9, PIP=10, DIP=11, TIP=12
 * Ring finger:   MCP=13, PIP=14, TIP=16
 * Pinky:         MCP=17, PIP=18, TIP=20
 * Thumb:         MCP=2, IP=3, TIP=4
 */
function detectPeaceSign(landmarks) {
  if (!landmarks || landmarks.length < 21) return false;

  // ✓ Index extended
  const indexUp = isFingerExtended(landmarks, 8, 6, 5);
  // ✓ Middle extended
  const middleUp = isFingerExtended(landmarks, 12, 10, 9);
  // ✓ Ring curled
  const ringDown = isFingerCurled(landmarks, 16, 14);
  // ✓ Pinky curled
  const pinkyDown = isFingerCurled(landmarks, 20, 18);

  return indexUp && middleUp && ringDown && pinkyDown;
}

// ─────────────────────────────────────────────
// RESULTS HANDLER
// ─────────────────────────────────────────────
function onResults(results) {
  // Resize canvas to match video
  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  let peaceDetectedThisFrame = false;

  if (results.multiHandLandmarks && results.multiHandLandmarks.length > 0) {
    // Reset grace period since we have tracking
    gestureState.gracePeriod = 0;

    for (const landmarks of results.multiHandLandmarks) {
      // Draw skeleton (existing feature preserved)
      drawConnectors(ctx, landmarks, HAND_CONNECTIONS, {
        color: "#ffffff",
        lineWidth: 2,
      });
      drawLandmarks(ctx, landmarks, {
        color: "#00ffff",
        fillColor: "#ffffff",
        radius: 5,
      });

      // Check gesture
      if (detectPeaceSign(landmarks)) {
        peaceDetectedThisFrame = true;
      }
    }
  } else {
    // No hands detected — use grace period before losing gesture
    if (gestureState.gracePeriod < gestureState.maxGrace) {
      gestureState.gracePeriod++;
      // Keep last state during grace period
      peaceDetectedThisFrame = blurState.active;
    }
  }

  // ─── Update confidence score ───
  if (peaceDetectedThisFrame) {
    gestureState.confidence = Math.min(
      gestureState.confidence + 1,
      gestureState.maxConfidence
    );
  } else {
    gestureState.confidence = Math.max(gestureState.confidence - 1, 0);
  }

  // ─── Hysteresis: activate / deactivate blur ───
  if (!blurState.active && gestureState.confidence >= gestureState.threshold) {
    blurState.active = true;
    blurState.target = blurState.max;
  } else if (blurState.active && gestureState.confidence <= gestureState.deactivateAt) {
    blurState.active = false;
    blurState.target = 0;
  }
}
