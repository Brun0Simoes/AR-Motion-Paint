import React from 'react';

interface HandIconProps {
    isPinching: boolean;
    isGrabbing: boolean;
    color: string;
    rotation: number; // in radians
    className?: string;
}

export const HandIcon: React.FC<HandIconProps> = ({ isPinching, isGrabbing, color, rotation, className }) => {
    const pinchTransform = "rotate(-15 12 12) translate(1, -1)";
    const grabTransform = "scale(0.95) rotate(5 12 12)";
    const openTransform = "";

    const baseTransform = isGrabbing ? grabTransform : (isPinching ? pinchTransform : openTransform);
    // Convert rotation from radians to degrees for CSS transform
    const rotationDegrees = rotation * (180 / Math.PI);
    // Apply the dynamic rotation on top of the base gesture transform
    const transform = `${baseTransform} rotate(${rotationDegrees}deg)`;

    return (
        <svg
            xmlns="http://www.w3.org/2000/svg"
            width="32"
            height="32"
            viewBox="0 0 24 24"
            fill="none"
            stroke={color}
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            className={`transition-transform duration-200 ease-in-out ${className || ''}`}
            style={{ 
                transform: transform,
                transformOrigin: 'center',
                filter: `drop-shadow(0 0 5px ${color})`
            }}
        >
            {isGrabbing ? (
                 <>
                    <path d="M10.25 15.25a2.5 2.5 0 0 1-5 0V9.5a2.5 2.5 0 0 1 5 0v5.75z" />
                    <path d="M14.25 14.25a2.5 2.5 0 0 1-5 0V9a2.5 2.5 0 0 1 5 0v5.25z" />
                    <path d="M18.25 13.25a2.5 2.5 0 0 1-5 0V9a2.5 2.5 0 0 1 5 0v4.25z" />
                    <path d="M7 10.5a2.5 2.5 0 0 0-5 0v2a2.5 2.5 0 0 0 5 0v-2z" />
                 </>
            ) : (
                <>
                    <path d="M14.5 18V8.5a2.5 2.5 0 0 0-5 0v9.5" />
                    <path d="M11.5 16.5a2.5 2.5 0 0 0 5 0V9" />
                    <path d="M8.5 17.5a2.5 2.5 0 0 0 5 0V9" />
                    <path d="M5 21a2.5 2.5 0 0 0 5 0V9" />
                    <path d="M18 18.5a2.5 2.5 0 0 0-5 0V9" />
                </>
            )}
             {isPinching && !isGrabbing && (
                <circle cx="12" cy="7" r="2" fill="white" stroke="white" className="animate-pulse" />
            )}
        </svg>
    );
};