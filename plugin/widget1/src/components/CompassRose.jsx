/**
 * Professional Marine Compass Rose - Niue Edition
 * Follows traditional nautical compass principles with Niue marine theming
 * Includes responsive positioning and rotation support for marine navigation
 */
import React, { useState, useEffect } from 'react';
import './CompassRose.css';

const CompassRose = ({ 
  position = 'bottom-left', 
  size = 100, 
  mapRotation = 0,
  responsive = true,
  style = {},
  className = ''
}) => {
  const [currentPosition, setCurrentPosition] = useState(position);
  
  // Responsive positioning: switch to bottom-left on mobile for Niue waters navigation
  useEffect(() => {
    if (!responsive) return;
    
    const handleResize = () => {
      const isMobile = window.innerWidth < 768;
      if (isMobile && position === 'top-right') {
        setCurrentPosition('bottom-left');
      } else {
        setCurrentPosition(position);
      }
    };
    
    handleResize(); // Initial check
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, [position, responsive]);

  const positionStyles = {
    'top-left': { top: '15px', left: '15px' },
    'top-right': { top: '15px', right: '15px' },
    'bottom-left': { bottom: '120px', left: '15px' }, // Away from legend/controls
    'bottom-right': { bottom: '80px', right: '15px' },
    'center-left': { top: '50%', left: '15px', transform: 'translateY(-50%)' },
    'map-center': { top: '50%', left: '50%', transform: 'translate(-50%, -50%)' }
  };

  return (
    <div 
      className={`compass-container niue-marine ${className}`}
      style={{
        ...positionStyles[currentPosition],
        width: `${size}px`,
        height: `${size}px`,
        ...style
      }}
    >
      <svg 
        width={size} 
        height={size} 
        viewBox="0 0 120 120"
        className="compass-svg niue-marine"
        style={{
          transform: mapRotation ? `rotate(${-mapRotation}deg)` : 'none'
        }}
      >
        {/* Definitions for Niue marine gradients and effects */}
        <defs>
          {/* Deep Niue ocean background gradient */}
          <radialGradient id="niueBgGradient" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="rgba(12, 74, 110, 0.95)" />
            <stop offset="100%" stopColor="rgba(30, 64, 175, 0.98)" />
          </radialGradient>
          
          {/* North arrow gradient - Niue marine cyan */}
          <linearGradient id="niueNorthGrad" x1="0%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%" stopColor="#06b6d4" />
            <stop offset="100%" stopColor="#0891b2" />
          </linearGradient>
          
          {/* Cardinal arrows - Pacific blue theme */}
          <linearGradient id="niueCardinalGrad" x1="0%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%" stopColor="#0ea5e9" />
            <stop offset="100%" stopColor="#0284c7" />
          </linearGradient>

          {/* Niue marine glow effects */}
          <filter id="niueGlow" x="-50%" y="-50%" width="200%" height="200%">
            <feDropShadow dx="0" dy="2" stdDeviation="4" floodColor="rgba(6, 182, 212, 0.3)" floodOpacity="1"/>
            <feGaussianBlur stdDeviation="2" result="coloredBlur"/>
            <feMerge> 
              <feMergeNode in="coloredBlur"/>
              <feMergeNode in="SourceGraphic"/>
            </feMerge>
          </filter>
          
          <filter id="niueTextShadow" x="-50%" y="-50%" width="200%" height="200%">
            <feDropShadow dx="0" dy="1" stdDeviation="2" floodColor="rgba(12, 74, 110, 0.9)"/>
          </filter>

          {/* Coral reef accent for Niue */}
          <linearGradient id="niueCoralGrad" x1="0%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%" stopColor="#f97316" />
            <stop offset="100%" stopColor="#ea580c" />
          </linearGradient>
        </defs>

        {/* Enhanced background with Niue marine theme */}
        <circle 
          cx="60" 
          cy="60" 
          r="55" 
          fill="url(#niueBgGradient)"
          stroke="rgba(6, 182, 212, 0.4)"
          strokeWidth="1.5"
          filter="url(#niueGlow)"
        />
        
        {/* Outer ring marks for 8-point compass - Niue waters navigation */}
        <g stroke="rgba(6, 182, 212, 0.5)" strokeWidth="1.2" fill="none">
          {/* Cardinal direction lines */}
          <line x1="60" y1="8" x2="60" y2="18" /> {/* N */}
          <line x1="112" y1="60" x2="102" y2="60" /> {/* E */}
          <line x1="60" y1="112" x2="60" y2="102" /> {/* S */}
          <line x1="8" y1="60" x2="18" y2="60" /> {/* W */}
          
          {/* Intercardinal direction marks */}
          <line x1="98.1" y1="21.9" x2="92.4" y2="27.6" /> {/* NE */}
          <line x1="98.1" y1="98.1" x2="92.4" y2="92.4" /> {/* SE */}
          <line x1="21.9" y1="98.1" x2="27.6" y2="92.4" /> {/* SW */}
          <line x1="21.9" y1="21.9" x2="27.6" y2="27.6" /> {/* NW */}
        </g>

        {/* North arrow - Enhanced with Niue marine colors */}
        <path
          d="M 60,12 L 65,45 L 60,40 L 55,45 Z"
          fill="url(#niueNorthGrad)"
          stroke="#0c4a6e"
          strokeWidth="1.2"
          filter="url(#niueGlow)"
        />
        
        {/* East arrow - Pacific blue */}
        <path
          d="M 108,60 L 75,65 L 80,60 L 75,55 Z"
          fill="url(#niueCardinalGrad)"
          stroke="#1e40af"
          strokeWidth="0.8"
        />
        
        {/* South arrow */}
        <path
          d="M 60,108 L 55,75 L 60,80 L 65,75 Z"
          fill="url(#niueCardinalGrad)"
          stroke="#1e40af"
          strokeWidth="0.8"
        />
        
        {/* West arrow */}
        <path
          d="M 12,60 L 45,55 L 40,60 L 45,65 Z"
          fill="url(#niueCardinalGrad)"
          stroke="#1e40af"
          strokeWidth="0.8"
        />

        {/* Intercardinal arrows - smaller, coral reef accent */}
        <path d="M 95.5,24.5 L 75,40 L 78,37 L 80,35 Z" fill="rgba(249, 115, 22, 0.7)" stroke="rgba(234, 88, 12, 0.8)" strokeWidth="0.5" />
        <path d="M 95.5,95.5 L 80,80 L 78,83 L 75,80 Z" fill="rgba(249, 115, 22, 0.7)" stroke="rgba(234, 88, 12, 0.8)" strokeWidth="0.5" />
        <path d="M 24.5,95.5 L 40,75 L 37,78 L 35,80 Z" fill="rgba(249, 115, 22, 0.7)" stroke="rgba(234, 88, 12, 0.8)" strokeWidth="0.5" />
        <path d="M 24.5,24.5 L 35,40 L 37,42 L 40,45 Z" fill="rgba(249, 115, 22, 0.7)" stroke="rgba(234, 88, 12, 0.8)" strokeWidth="0.5" />

        {/* Center circle - Niue marine core */}
        <circle cx="60" cy="60" r="4" fill="#0c4a6e" stroke="#06b6d4" strokeWidth="1.5" />

        {/* Enhanced cardinal direction labels with Niue marine text shadows */}
        <text 
          x="60" y="8" 
          textAnchor="middle" 
          fontSize="14" 
          fontWeight="bold" 
          fill="#06b6d4" 
          fontFamily='"SF Mono", "Monaco", "Consolas", monospace' 
          filter="url(#niueTextShadow)"
        >
          N
        </text>
        <text 
          x="112" y="64" 
          textAnchor="middle" 
          fontSize="11" 
          fontWeight="600" 
          fill="#38bdf8" 
          fontFamily='"SF Mono", "Monaco", "Consolas", monospace' 
          filter="url(#niueTextShadow)"
        >
          E
        </text>
        <text 
          x="60" y="118" 
          textAnchor="middle" 
          fontSize="11" 
          fontWeight="600" 
          fill="#38bdf8" 
          fontFamily='"SF Mono", "Monaco", "Consolas", monospace' 
          filter="url(#niueTextShadow)"
        >
          S
        </text>
        <text 
          x="8" y="64" 
          textAnchor="middle" 
          fontSize="11" 
          fontWeight="600" 
          fill="#38bdf8" 
          fontFamily='"SF Mono", "Monaco", "Consolas", monospace' 
          filter="url(#niueTextShadow)"
        >
          W
        </text>

        {/* Enhanced intercardinal labels with coral accent */}
        <text x="92" y="32" textAnchor="middle" fontSize="8" fill="rgba(249, 115, 22, 0.9)" fontFamily='"SF Mono", "Monaco", "Consolas", monospace' filter="url(#niueTextShadow)">NE</text>
        <text x="92" y="92" textAnchor="middle" fontSize="8" fill="rgba(249, 115, 22, 0.9)" fontFamily='"SF Mono", "Monaco", "Consolas", monospace' filter="url(#niueTextShadow)">SE</text>
        <text x="28" y="92" textAnchor="middle" fontSize="8" fill="rgba(249, 115, 22, 0.9)" fontFamily='"SF Mono", "Monaco", "Consolas", monospace' filter="url(#niueTextShadow)">SW</text>
        <text x="28" y="32" textAnchor="middle" fontSize="8" fill="rgba(249, 115, 22, 0.9)" fontFamily='"SF Mono", "Monaco", "Consolas", monospace' filter="url(#niueTextShadow)">NW</text>

        {/* Niue identifier - small text */}
        <text 
          x="60" y="75" 
          textAnchor="middle" 
          fontSize="6" 
          fill="rgba(6, 182, 212, 0.6)" 
          fontFamily='"SF Mono", "Monaco", "Consolas", monospace'
        >
          NIU
        </text>
      </svg>
    </div>
  );
};

export default CompassRose;