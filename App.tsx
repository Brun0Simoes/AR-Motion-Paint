import React, { useState, useRef, useEffect, useCallback } from 'react';
import { HandLandmarker, FilesetResolver } from '@mediapipe/tasks-vision';
import Toolbar from './components/Toolbar';
import { HandIcon } from './components/icons/HandIcon';

type AppState = "LOADING" | "READY" | "RUNNING" | "ERROR";

interface Point {
    x: number;
    y: number;
}

interface StrokeBase {
    color: string;
    lineWidth: number;
    // Transformation properties
    bounds: { minX: number; minY: number; maxX: number; maxY: number };
    center: Point;
    translateX: number;
    translateY: number;
    rotation: number; // in radians
    scale: number;
}

interface FreehandStroke extends StrokeBase {
    type: 'freehand';
    points: Point[];
}

interface FractalStroke extends StrokeBase {
    type: 'fractal';
    segments: { start: Point; end: Point }[];
}

type Stroke = FreehandStroke | FractalStroke;

interface ManipulationState {
    strokeIndex: number;
    mode: 'move-rotate' | 'scale-rotate';
    // For moving and one-hand rotating
    initialHandPos: Point;
    initialTranslate: { x: number; y: number };
    initialHandAngle: number; // The angle of the single grabbing hand
    initialRotation: number; // The rotation of the stroke when grab started
    // For scale/rotate with two hands
    initialHandPos1: Point;
    initialHandPos2: Point;
    initialDistance: number;
    initialHandsAngle: number; // The angle *between* the two hands
    initialScale: number;
}


const App: React.FC = () => {
    const [appState, setAppState] = useState<AppState>("LOADING");
    const [errorMessage, setErrorMessage] = useState<string>("");

    const [handLandmarker, setHandLandmarker] = useState<HandLandmarker | undefined>(undefined);
    const [webcamRunning, setWebcamRunning] = useState<boolean>(false);
    
    const [color, setColor] = useState<string>('#FFFFFF');
    const [lineWidth, setLineWidth] = useState<number>(8);
    const [drawingMode, setDrawingMode] = useState<'freehand' | 'fractal'>('freehand');

    const [isPaused, setIsPaused] = useState<boolean>(false);
    const [cursorPosition, setCursorPosition] = useState<{ x: number; y: number } | null>(null);
    const [cursorAngle, setCursorAngle] = useState<number>(0);
    const [isGrabbing, setIsGrabbing] = useState<boolean>(false);
    const [manipulatedStrokeIndex, setManipulatedStrokeIndex] = useState<number | null>(null);

    const [strokeHistory, setStrokeHistory] = useState<Stroke[]>([]);
    const [redoStack, setRedoStack] = useState<Stroke[]>([]);

    const videoRef = useRef<HTMLVideoElement>(null);
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const lastPosition = useRef<{ x: number; y: number } | null>(null);
    const currentStroke = useRef<Pick<FreehandStroke, 'type' | 'points' | 'color' | 'lineWidth'> | null>(null);
    const fractalStartPoint = useRef<Point | null>(null);
    const requestRef = useRef<number>();
    const smoothedPosition = useRef<{ x: number; y: number } | null>(null);
    const wasPinching = useRef<boolean[]>([false, false]);
    const wasGrabbing = useRef<boolean[]>([false, false]);
    const manipulationState = useRef<ManipulationState | null>(null);


    useEffect(() => {
        const createHandLandmarker = async () => {
            try {
                const vision = await FilesetResolver.forVisionTasks(
                    "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.3/wasm"
                );
                const newHandLandmarker = await HandLandmarker.createFromOptions(vision, {
                    baseOptions: {
                        modelAssetPath: `https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task`,
                        delegate: "GPU",
                    },
                    runningMode: "VIDEO",
                    numHands: 2,
                });
                setHandLandmarker(newHandLandmarker);
                setAppState("READY");
            } catch (error) {
                console.error("Error creating HandLandmarker:", error);
                setErrorMessage("Failed to load hand tracking model. Please refresh the page.");
                setAppState("ERROR");
            }
        };
        createHandLandmarker();
    }, []);

    const enableCam = async () => {
        if (!handLandmarker) {
            console.log("Wait! handLandmarker not loaded yet.");
            return;
        }

        if (webcamRunning) {
            setWebcamRunning(false);
            setAppState("READY");
            if (videoRef.current && videoRef.current.srcObject) {
              const stream = videoRef.current.srcObject as MediaStream;
              stream.getTracks().forEach(track => track.stop());
              videoRef.current.srcObject = null;
            }
            if (requestRef.current) {
                cancelAnimationFrame(requestRef.current);
            }
            return;
        }
        
        setWebcamRunning(true);
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ video: true });
            if (videoRef.current) {
                videoRef.current.srcObject = stream;
                videoRef.current.addEventListener("loadeddata", () => {
                  if (videoRef.current) {
                    setAppState("RUNNING");
                  }
                });
            }
        } catch (error) {
            console.error("Error accessing webcam:", error);
            setErrorMessage("Camera access denied. Please allow camera permissions in your browser settings.");
            setAppState("ERROR");
            setWebcamRunning(false);
        }
    };
    
    const draw = useCallback((start: { x: number; y: number }, end: { x: number; y: number }) => {
        const canvas = canvasRef.current;
        if (!canvas) return;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;
    
        ctx.beginPath();
        ctx.moveTo(start.x, start.y);
        ctx.lineTo(end.x, end.y);
        ctx.strokeStyle = color;
        ctx.lineWidth = lineWidth;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.stroke();
    }, [color, lineWidth]);
    
    const generateFractalTree = (startPoint: Point, endPoint: Point, depth: number): FractalStroke['segments'] => {
        const segments: FractalStroke['segments'] = [];
        const trunkLength = Math.hypot(endPoint.x - startPoint.x, endPoint.y - startPoint.y);
        const trunkAngle = Math.atan2(endPoint.y - startPoint.y, endPoint.x - startPoint.x);
        
        const branchAngle = Math.PI / 5; // 36 degrees
        const lengthRatio = 0.75;

        function addBranch(start: Point, angle: number, length: number, currentDepth: number) {
            if (currentDepth <= 0 || length < 2) return;

            const end = {
                x: start.x + Math.cos(angle) * length,
                y: start.y + Math.sin(angle) * length,
            };
            segments.push({ start, end });

            addBranch(end, angle - branchAngle, length * lengthRatio, currentDepth - 1);
            addBranch(end, angle + branchAngle, length * lengthRatio, currentDepth - 1);
        }

        addBranch(startPoint, trunkAngle, trunkLength, depth);
        return segments;
    };

    const calculateStrokeBounds = (stroke: Pick<FreehandStroke, 'type' | 'points'> | Pick<FractalStroke, 'type' | 'segments'>): { bounds: Stroke['bounds'], center: Point } => {
        let allPoints: Point[] = [];
        if (stroke.type === 'freehand') {
            allPoints = stroke.points;
        } else {
            allPoints = stroke.segments.flatMap(s => [s.start, s.end]);
        }

        if (allPoints.length === 0) return { 
            bounds: { minX: 0, minY: 0, maxX: 0, maxY: 0 }, 
            center: { x: 0, y: 0 } 
        };

        const minX = Math.min(...allPoints.map(p => p.x));
        const minY = Math.min(...allPoints.map(p => p.y));
        const maxX = Math.max(...allPoints.map(p => p.x));
        const maxY = Math.max(...allPoints.map(p => p.y));
        
        return {
            bounds: { minX, minY, maxX, maxY },
            center: { x: (minX + maxX) / 2, y: (minY + maxY) / 2 }
        };
    };

    const redrawCanvas = useCallback(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;
    
        ctx.clearRect(0, 0, canvas.width, canvas.height);
    
        strokeHistory.forEach((stroke, index) => {
            if (!stroke) return;
            
            ctx.save();
            
            // Apply transformations
            ctx.translate(stroke.center.x + stroke.translateX, stroke.center.y + stroke.translateY);
            ctx.rotate(stroke.rotation);
            ctx.scale(stroke.scale, stroke.scale);
            
            // Set styles
            ctx.strokeStyle = stroke.color;
            ctx.lineWidth = stroke.lineWidth;
            ctx.lineCap = 'round';
            ctx.lineJoin = 'round';
            
            if (stroke.type === 'freehand') {
                if (stroke.points.length < 2) return;
                ctx.beginPath();
                ctx.moveTo(stroke.points[0].x - stroke.center.x, stroke.points[0].y - stroke.center.y);
                for (let i = 1; i < stroke.points.length; i++) {
                    const point = stroke.points[i];
                    ctx.lineTo(point.x - stroke.center.x, point.y - stroke.center.y);
                }
                ctx.stroke();
            } else if (stroke.type === 'fractal') {
                 stroke.segments.forEach(segment => {
                    ctx.beginPath();
                    ctx.moveTo(segment.start.x - stroke.center.x, segment.start.y - stroke.center.y);
                    ctx.lineTo(segment.end.x - stroke.center.x, segment.end.y - stroke.center.y);
                    ctx.stroke();
                });
            }
            
            ctx.restore();

            if (manipulatedStrokeIndex === index) {
                ctx.save();
                ctx.translate(stroke.center.x + stroke.translateX, stroke.center.y + stroke.translateY);
                ctx.rotate(stroke.rotation);
                const width = (stroke.bounds.maxX - stroke.bounds.minX) * stroke.scale;
                const height = (stroke.bounds.maxY - stroke.bounds.minY) * stroke.scale;
                ctx.strokeStyle = '#4A90E2';
                ctx.lineWidth = 2;
                ctx.setLineDash([6, 3]);
                ctx.strokeRect(-width / 2, -height / 2, width, height);
                ctx.restore();
            }
        });
    }, [strokeHistory, manipulatedStrokeIndex]);

    useEffect(() => {
        redrawCanvas();
    }, [strokeHistory, manipulatedStrokeIndex, redrawCanvas]);

    const checkPinch = (hand: any[]): boolean => {
        if (!hand || hand.length < 21) return false;
        
        const thumbTip = hand[4];
        const indexTip = hand[8];
        const middlePip = hand[10];
        const ringPip = hand[14];
        const middleTip = hand[12];
        const ringTip = hand[16];
    
        // 1. Thumb and index tips are very close
        const pinchDistance = Math.hypot(thumbTip.x - indexTip.x, thumbTip.y - indexTip.y, thumbTip.z - indexTip.z);
        if (pinchDistance > 0.07) return false;
    
        // 2. Other key fingers are NOT curled, to distinguish from a fist.
        const isCurled = (tip: any, pip: any) => tip.y > pip.y;
        const middleCurled = isCurled(middleTip, middlePip);
        const ringCurled = isCurled(ringTip, ringPip);
    
        return !middleCurled && !ringCurled;
    };
    
    const checkGrab = (hand: any[]): boolean => {
        if (!hand || hand.length < 21) return false;
        
        const thumbTip = hand[4];
        const middlePip = hand[10];
        const ringPip = hand[14];
        const pinkyPip = hand[18];
        const middleTip = hand[12];
        const ringTip = hand[16];
        const pinkyTip = hand[20];
        const palmCenter = hand[9]; // Middle finger MCP as a proxy for palm center
    
        // 1. Check if the main fingers are curled (tip is lower than middle joint)
        const isCurled = (tip: any, pip: any) => tip.y > pip.y;
        const middleCurled = isCurled(middleTip, middlePip);
        const ringCurled = isCurled(ringTip, ringPip);
        const pinkyCurled = isCurled(pinkyTip, pinkyPip);
        const curledFingersCount = [middleCurled, ringCurled, pinkyCurled].filter(Boolean).length;
    
        // 2. Check if the thumb is closed towards the palm
        const thumbToPalmDist = Math.hypot(thumbTip.x - palmCenter.x, thumbTip.y - palmCenter.y);
        const isThumbClosed = thumbToPalmDist < 0.1;
    
        // A grab is when at least two fingers are curled and the thumb is closed.
        return curledFingersCount >= 2 && isThumbClosed;
    };

    const isPointInsideBounds = (point: Point, stroke: Stroke): boolean => {
        const w = (stroke.bounds.maxX - stroke.bounds.minX) * stroke.scale;
        const h = (stroke.bounds.maxY - stroke.bounds.minY) * stroke.scale;
        const cx = stroke.center.x + stroke.translateX;
        const cy = stroke.center.y + stroke.translateY;
        
        const cos = Math.cos(-stroke.rotation);
        const sin = Math.sin(-stroke.rotation);
        const translatedX = point.x - cx;
        const translatedY = point.y - cy;
        const rotatedX = translatedX * cos - translatedY * sin;
        const rotatedY = translatedX * sin + translatedY * cos;

        return Math.abs(rotatedX) < w / 2 && Math.abs(rotatedY) < h / 2;
    };
    
    const getHandAngle = (hand: any[]): number => {
        if (!hand || hand.length < 10) return 0;
        const wrist = hand[0];
        const mcp = hand[9]; // Middle finger MCP
        // atan2(y, x) gives the angle in radians from the x-axis
        return Math.atan2(mcp.y - wrist.y, mcp.x - wrist.x);
    };

    const predictWebcam = useCallback(() => {
        if (!videoRef.current || !canvasRef.current || !handLandmarker || videoRef.current.readyState < 2) {
            requestRef.current = requestAnimationFrame(predictWebcam);
            return;
        }

        const video = videoRef.current;
        const canvas = canvasRef.current;
        const displayWidth = video.clientWidth;
        const displayHeight = video.clientHeight;

        if (canvas.width !== displayWidth || canvas.height !== displayHeight) {
            canvas.width = displayWidth;
            canvas.height = displayHeight;
            redrawCanvas();
        }
        
        const startTimeMs = performance.now();
        const results = handLandmarker.detectForVideo(video, startTimeMs);
        if (!results.landmarks) {
            requestRef.current = requestAnimationFrame(predictWebcam);
            return;
        }

        const landmarks = results.landmarks;
        const videoIntrinsicWidth = video.videoWidth;
        const videoIntrinsicHeight = video.videoHeight;
        const videoAspectRatio = videoIntrinsicWidth / videoIntrinsicHeight;
        const displayAspectRatio = displayWidth / displayHeight;
        let scale = 1, offsetX = 0, offsetY = 0;

        if (videoAspectRatio > displayAspectRatio) {
            scale = displayHeight / videoIntrinsicHeight;
            offsetX = (displayWidth - videoIntrinsicWidth * scale) / 2;
        } else {
            scale = displayWidth / videoIntrinsicWidth;
            offsetY = (displayHeight - videoIntrinsicHeight * scale) / 2;
        }

        const transformPoint = (landmark: any) => ({
            x: (1 - landmark.x) * videoIntrinsicWidth * scale + offsetX,
            y: landmark.y * videoIntrinsicHeight * scale + offsetY,
        });

        let shouldPause = landmarks.length > 1 && landmarks[0][0].y < 0.35 && landmarks[1][0].y < 0.35;
        setIsPaused(shouldPause);
        
        const getMidpoint = (hand: any, isGrab: boolean) => {
            if (isGrab) {
                return transformPoint(hand[9]); // Middle finger MCP for stable grab center
            }
            return transformPoint({ // Midpoint between thumb and index for pinch
                x: (hand[4].x + hand[8].x) / 2,
                y: (hand[4].y + hand[8].y) / 2
            });
        };
        
        const cursorHand = landmarks.length > 0 ? landmarks[0] : null;
        if (cursorHand) {
            const isGrabbingNow = checkGrab(cursorHand);
            const isPinchingNow = checkPinch(cursorHand);
            const rawPoint = getMidpoint(cursorHand, isGrabbingNow);
            const smoothingFactor = 0.6; 
            if (!smoothedPosition.current) smoothedPosition.current = rawPoint;
            else smoothedPosition.current = {
                x: smoothedPosition.current.x * smoothingFactor + rawPoint.x * (1 - smoothingFactor),
                y: smoothedPosition.current.y * smoothingFactor + rawPoint.y * (1 - smoothingFactor),
            };
            setCursorPosition(smoothedPosition.current);
            setCursorAngle(getHandAngle(cursorHand));
            setIsGrabbing(isGrabbingNow || (landmarks.length > 1 && checkGrab(landmarks[1])));
        } else {
            setCursorPosition(null);
            smoothedPosition.current = null;
        }
        
        const isGrabbingNow = landmarks.map(hand => checkGrab(hand));
        const isPinchingNow = landmarks.map((hand, i) => !isGrabbingNow[i] && checkPinch(hand));
        
        const grabbingHands = landmarks.map((hand, i) => ({ hand, index: i })).filter((_, i) => isGrabbingNow[i]);
        const pinchingHands = landmarks.map((hand, i) => ({ hand, index: i })).filter((_, i) => isPinchingNow[i]);

        // --- MANIPULATION LOGIC (triggered by GRAB) ---
        if (manipulationState.current) {
            const currentStroke = strokeHistory[manipulationState.current.strokeIndex];
            if (!currentStroke) {
                manipulationState.current = null;
                setManipulatedStrokeIndex(null);
            } else if (grabbingHands.length === 0) {
                 manipulationState.current = null;
                 setManipulatedStrokeIndex(null);
            } else if (grabbingHands.length === 1 && manipulationState.current.mode === 'scale-rotate') {
                // Transition from 2 hands to 1
                const remainingHand = grabbingHands[0].hand;
                const handPos = getMidpoint(remainingHand, true);
                manipulationState.current = {
                    ...manipulationState.current,
                    mode: 'move-rotate',
                    initialHandPos: handPos,
                    initialTranslate: { x: currentStroke.translateX, y: currentStroke.translateY },
                    initialRotation: currentStroke.rotation,
                    initialHandAngle: getHandAngle(remainingHand),
                };
            } else if (grabbingHands.length >= 2 && manipulationState.current.mode === 'move-rotate') {
                // Transition from 1 hand to 2
                 const hand1Pos = getMidpoint(grabbingHands[0].hand, true);
                 const hand2Pos = getMidpoint(grabbingHands[1].hand, true);
                 manipulationState.current = {
                    ...manipulationState.current, mode: 'scale-rotate',
                    initialHandPos1: hand1Pos, initialHandPos2: hand2Pos,
                    initialDistance: Math.hypot(hand1Pos.x - hand2Pos.x, hand1Pos.y - hand2Pos.y),
                    initialHandsAngle: Math.atan2(hand2Pos.y - hand1Pos.y, hand2Pos.x - hand1Pos.x),
                    initialRotation: currentStroke.rotation, initialScale: currentStroke.scale
                 };
            } else if (manipulationState.current.mode === 'move-rotate' && grabbingHands.length === 1) {
                // Update 1-hand move and rotate
                const hand = grabbingHands[0].hand;
                const handPos = getMidpoint(hand, true);
                const handAngle = getHandAngle(hand);
                
                const dx = handPos.x - manipulationState.current.initialHandPos.x;
                const dy = handPos.y - manipulationState.current.initialHandPos.y;
                currentStroke.translateX = manipulationState.current.initialTranslate.x + dx;
                currentStroke.translateY = manipulationState.current.initialTranslate.y + dy;

                const angleDelta = handAngle - manipulationState.current.initialHandAngle;
                currentStroke.rotation = manipulationState.current.initialRotation + angleDelta;

            } else if (manipulationState.current.mode === 'scale-rotate' && grabbingHands.length >= 2) {
                // Update 2-hand scale and rotate
                const hand1Pos = getMidpoint(grabbingHands[0].hand, true);
                const hand2Pos = getMidpoint(grabbingHands[1].hand, true);
                const currentDist = Math.hypot(hand1Pos.x - hand2Pos.x, hand1Pos.y - hand2Pos.y);
                const currentAngle = Math.atan2(hand2Pos.y - hand1Pos.y, hand2Pos.x - hand1Pos.x);

                const scaleFactor = manipulationState.current.initialDistance > 1 ? currentDist / manipulationState.current.initialDistance : 1;
                currentStroke.scale = manipulationState.current.initialScale * scaleFactor;
                
                const angleDelta = currentAngle - manipulationState.current.initialHandsAngle;
                currentStroke.rotation = manipulationState.current.initialRotation + angleDelta;
            }
            setStrokeHistory([...strokeHistory]);
        } 
        // --- START MANIPULATION (on grab) OR DRAW (on pinch) ---
        else if (!isPaused) {
            // Priority 1: Start manipulation if grabbing
            if (grabbingHands.length > 0) {
                const handIndex = grabbingHands[0].index;
                const grabPoint = getMidpoint(grabbingHands[0].hand, true);
                const justGrabbed = !wasGrabbing.current[handIndex];
                
                if (justGrabbed) {
                    const strokeToManipulateIndex = [...strokeHistory].reverse().findIndex(s => isPointInsideBounds(grabPoint, s));
                    if (strokeToManipulateIndex !== -1) {
                        const originalIndex = strokeHistory.length - 1 - strokeToManipulateIndex;
                        const strokeToManipulate = strokeHistory[originalIndex];
                        const handAngle = getHandAngle(grabbingHands[0].hand);
                        
                        manipulationState.current = {
                            strokeIndex: originalIndex, 
                            mode: 'move-rotate',
                            initialHandPos: grabPoint,
                            initialTranslate: { x: strokeToManipulate.translateX, y: strokeToManipulate.translateY },
                            initialHandAngle: handAngle,
                            initialRotation: strokeToManipulate.rotation,
                            // Dummy values for two-hand state, will be populated on transition
                            initialHandPos1: grabPoint, initialHandPos2: grabPoint, 
                            initialDistance: 0, initialHandsAngle: 0, initialScale: strokeToManipulate.scale
                        };
                        setManipulatedStrokeIndex(originalIndex);
                    }
                }
            }
            // Priority 2: Draw if pinching AND not manipulating
            else if (pinchingHands.length === 1) {
                const pinchPoint = getMidpoint(pinchingHands[0].hand, false);
                if (drawingMode === 'freehand') {
                     if (!lastPosition.current) {
                        currentStroke.current = { type: 'freehand', points: [pinchPoint], color, lineWidth };
                        setRedoStack([]);
                    } else {
                        currentStroke.current?.points.push(pinchPoint);
                    }
                    if (lastPosition.current) draw(lastPosition.current, pinchPoint);
                    lastPosition.current = pinchPoint;
                } else {
                     if (!fractalStartPoint.current) fractalStartPoint.current = pinchPoint;
                     lastPosition.current = pinchPoint;
                }
            } else {
                // --- FINALIZE DRAWING ---
                if (lastPosition.current) {
                    if (drawingMode === 'freehand' && currentStroke.current && currentStroke.current.points.length > 1) {
                        const { bounds, center } = calculateStrokeBounds(currentStroke.current);
                        const newStroke: FreehandStroke = { ...currentStroke.current, bounds, center, translateX: 0, translateY: 0, rotation: 0, scale: 1 };
                        setStrokeHistory(prev => [...prev, newStroke]);
                    } else if (drawingMode === 'fractal' && fractalStartPoint.current) {
                         let depth = 6;
                         if (landmarks.length > 1) {
                             const handDist = Math.hypot(landmarks[0][0].x - landmarks[1][0].x, landmarks[0][0].y - landmarks[1][0].y) * videoIntrinsicWidth * scale;
                             depth = Math.round(3 + 8 * Math.max(0, Math.min(1, (handDist - 100) / 500)));
                         }
                         const segments = generateFractalTree(fractalStartPoint.current, lastPosition.current, depth);
                         const strokeToCalc = { type: 'fractal' as const, segments };
                         const { bounds, center } = calculateStrokeBounds(strokeToCalc);
                         const newStroke: FractalStroke = { type: 'fractal', segments, color, lineWidth: Math.max(1, lineWidth / 4), bounds, center, translateX: 0, translateY: 0, rotation: 0, scale: 1 };
                         setStrokeHistory(prev => [...prev, newStroke]);
                    }
                    currentStroke.current = null;
                    lastPosition.current = null;
                    fractalStartPoint.current = null;
                    setRedoStack([]);
                }
            }
        }

        wasPinching.current = isPinchingNow;
        wasGrabbing.current = isGrabbingNow;
        requestRef.current = requestAnimationFrame(predictWebcam);

    }, [handLandmarker, isPaused, draw, color, lineWidth, redrawCanvas, drawingMode, strokeHistory, manipulatedStrokeIndex]);

    useEffect(() => {
        if (webcamRunning && appState === "RUNNING") {
            requestRef.current = requestAnimationFrame(predictWebcam);
            return () => { if (requestRef.current) cancelAnimationFrame(requestRef.current); };
        }
    }, [webcamRunning, appState, predictWebcam]);


    const clearCanvas = () => {
        setStrokeHistory([]);
        setRedoStack([]);
        currentStroke.current = null;
        lastPosition.current = null;
        fractalStartPoint.current = null;
        manipulationState.current = null;
        setManipulatedStrokeIndex(null);
    };

    const handleUndo = () => {
        if (strokeHistory.length === 0) return;
        const lastStroke = strokeHistory[strokeHistory.length - 1];
        setRedoStack(prev => [lastStroke, ...prev]);
        setStrokeHistory(prev => prev.slice(0, -1));
    };
    
    const handleRedo = () => {
        if (redoStack.length === 0) return;
        const strokeToRedo = redoStack[0];
        setStrokeHistory(prev => [...prev, strokeToRedo]);
        setRedoStack(prev => prev.slice(1));
    };

    const renderStateContent = () => {
        switch (appState) {
            case "LOADING":
                return (
                    <div className="flex flex-col items-center justify-center h-full text-white">
                        <div className="w-16 h-16 border-4 border-dashed rounded-full animate-spin border-blue-400"></div>
                        <p className="mt-4 text-lg">Loading AI Model...</p>
                    </div>
                );
            case "READY":
            case "ERROR":
                return (
                    <div className="flex flex-col items-center justify-center h-full text-white bg-black bg-opacity-50 p-8 rounded-lg">
                        <h1 className="text-4xl font-bold mb-2">AR Motion Paint</h1>
                        <p className="text-lg mb-6">Draw and manipulate objects in the air!</p>
                        {appState === "ERROR" && <p className="text-red-400 mb-4">{errorMessage}</p>}
                        <button
                            onClick={enableCam}
                            className="px-8 py-3 bg-blue-600 text-white font-semibold rounded-lg shadow-lg hover:bg-blue-700 transition-all transform hover:scale-105 disabled:opacity-50 disabled:cursor-not-allowed"
                            disabled={appState === "LOADING"}
                        >
                            {webcamRunning ? "Disable Camera" : "Enable Camera"}
                        </button>
                    </div>
                );
            case "RUNNING":
                return null;
        }
    }

    return (
        <main className="w-screen h-screen overflow-hidden bg-gray-900 relative">
            <video ref={videoRef} autoPlay playsInline className={`absolute top-0 left-0 w-full h-full object-cover transform scale-x-[-1] ${appState === 'RUNNING' ? '' : 'hidden'}`}></video>
            <canvas ref={canvasRef} className={`absolute top-0 left-0 w-full h-full object-cover transform ${appState === 'RUNNING' ? '' : 'hidden'}`}></canvas>
            
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                <div className="pointer-events-auto">
                    {renderStateContent()}
                </div>
            </div>
            
            {appState === "RUNNING" && (
                <>
                    {cursorPosition && (
                        <div style={{ top: cursorPosition.y, left: cursorPosition.x, position: 'absolute', transform: 'translate(-50%, -50%)', pointerEvents: 'none' }}>
                            <HandIcon 
                                isPinching={lastPosition.current !== null || fractalStartPoint.current !== null} 
                                isGrabbing={isGrabbing}
                                color={color}
                                rotation={cursorAngle}
                            />
                        </div>
                    )}
                    {isPaused && (
                         <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 bg-black bg-opacity-50 text-white px-6 py-3 rounded-lg text-2xl font-bold pointer-events-none">
                            PAUSED
                        </div>
                    )}
                     <div className="absolute top-4 left-1/2 -translate-x-1/2 bg-black bg-opacity-50 text-white px-4 py-2 rounded-lg text-sm pointer-events-none max-w-sm text-center">
                       {!manipulationState.current ? "Pinch to draw. Make a fist to grab and move objects." : "Use second hand to scale and rotate."}
                    </div>
                    <Toolbar
                        color={color}
                        setColor={setColor}
                        lineWidth={lineWidth}
                        setLineWidth={setLineWidth}
                        clearCanvas={clearCanvas}
                        undo={handleUndo}
                        redo={handleRedo}
                        canUndo={strokeHistory.length > 0}
                        canRedo={redoStack.length > 0}
                        drawingMode={drawingMode}
                        setDrawingMode={setDrawingMode}
                    />
                </>
            )}
        </main>
    );
};

export default App;