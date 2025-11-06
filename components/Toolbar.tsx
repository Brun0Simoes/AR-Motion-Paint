import React from 'react';
import { BrushIcon } from './icons/BrushIcon';
import { ClearIcon } from './icons/ClearIcon';
import { UndoIcon } from './icons/UndoIcon';
import { RedoIcon } from './icons/RedoIcon';

interface ToolbarProps {
    color: string;
    setColor: (color: string) => void;
    lineWidth: number;
    setLineWidth: (width: number) => void;
    clearCanvas: () => void;
    undo: () => void;
    redo: () => void;
    canUndo: boolean;
    canRedo: boolean;
    drawingMode: 'freehand' | 'fractal';
    setDrawingMode: (mode: 'freehand' | 'fractal') => void;
}

const FractalIcon: React.FC<{ className?: string }> = ({ className }) => (
    <svg 
        xmlns="http://www.w3.org/2000/svg" 
        width="24" 
        height="24" 
        viewBox="0 0 24 24" 
        fill="none" 
        stroke="currentColor" 
        strokeWidth="1.5"
        strokeLinecap="round" 
        strokeLinejoin="round" 
        className={className}
    >
        <path d="M12 20v-8" />
        <path d="M12 12L8 8" />
        <path d="M12 12l4-4" />
        <path d="M8 8l-2-2" />
        <path d="M8 8l2-2" />
        <path d="M16 8l-2-2" />
        <path d="M16 8l2-2" />
    </svg>
);


const Toolbar: React.FC<ToolbarProps> = ({
    color,
    setColor,
    lineWidth,
    setLineWidth,
    clearCanvas,
    undo,
    redo,
    canUndo,
    canRedo,
    drawingMode,
    setDrawingMode
}) => {
    return (
        <div className="absolute bottom-4 left-1/2 -translate-x-1/2 flex items-center gap-4 bg-gray-800 bg-opacity-70 backdrop-blur-sm p-3 rounded-xl shadow-2xl border border-gray-700">
            
            {/* Color Picker */}
            <div className="relative flex items-center justify-center w-10 h-10">
                <input
                    type="color"
                    value={color}
                    onChange={(e) => setColor(e.target.value)}
                    className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                />
                <div 
                    className="w-full h-full rounded-full border-2 border-white/50" 
                    style={{ backgroundColor: color }}
                ></div>
            </div>

            {/* Line Width Slider */}
            <div className="flex items-center gap-2 text-white">
                <BrushIcon className="w-6 h-6 text-gray-300" />
                <input
                    type="range"
                    min="1"
                    max="50"
                    value={lineWidth}
                    onChange={(e) => setLineWidth(Number(e.target.value))}
                    className="w-32 h-2 bg-gray-600 rounded-lg appearance-none cursor-pointer accent-blue-500"
                />
            </div>
            
             {/* Drawing Mode Toggle */}
             <button
                onClick={() => setDrawingMode(drawingMode === 'freehand' ? 'fractal' : 'freehand')}
                className={`p-2 rounded-full transition-colors ${drawingMode === 'fractal' ? 'bg-blue-600' : 'hover:bg-gray-700'}`}
                title={drawingMode === 'freehand' ? 'Switch to Fractal Mode' : 'Switch to Freehand Mode'}
            >
                <FractalIcon className="w-6 h-6 text-gray-200" />
            </button>


            {/* Action Buttons */}
            <div className="w-px h-8 bg-gray-600"></div>

            <div className="flex items-center gap-1">
                <button
                    onClick={undo}
                    disabled={!canUndo}
                    className="p-2 rounded-full hover:bg-gray-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                    title="Undo"
                >
                    <UndoIcon className="w-6 h-6 text-gray-300" />
                </button>
                <button
                    onClick={redo}
                    disabled={!canRedo}
                    className="p-2 rounded-full hover:bg-gray-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                    title="Redo"
                >
                    <RedoIcon className="w-6 h-6 text-gray-300" />
                </button>
                <button
                    onClick={clearCanvas}
                    className="p-2 rounded-full hover:bg-gray-700 transition-colors"
                    title="Clear Canvas"
                >
                    <ClearIcon className="w-6 h-6 text-gray-300" />
                </button>
            </div>
        </div>
    );
};

export default Toolbar;
