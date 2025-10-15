import React from 'react';
import { motion } from 'framer-motion';

/**
 * Fancy Animated Icon Component - Niue Marine Edition
 * Provides beautiful animations and effects for Lucide React icons
 * optimized for marine forecast interface.
 */
const FancyIcon = ({
  icon: IconComponent, 
  size = 24,
  className = "", 
  animationType = "hover",
  color = "currentColor",
  onClick = null,
  style = {},
  disabled = false
}) => {
  // Animation variants - Marine-themed and subtle
  const getAnimationProps = () => {
    if (disabled) {
      return {
        animate: { opacity: 0.5 },
        transition: { duration: 0.3 }
      };
    }

    switch(animationType) {
      case 'wave':
        return {
          animate: { 
            y: [0, -2, 0],
            rotate: [0, 1, 0, -1, 0]
          },
          transition: { 
            duration: 4, 
            repeat: Infinity, 
            ease: "easeInOut",
            times: [0, 0.25, 0.5, 0.75, 1]
          }
        };
      
      case 'tide':
        return {
          animate: { 
            scale: [1, 1.05, 1],
            opacity: [0.8, 1, 0.8]
          },
          transition: { 
            duration: 3, 
            repeat: Infinity, 
            ease: "easeInOut" 
          }
        };
      
      case 'current':
        return {
          animate: { 
            x: [0, 2, 0, -2, 0],
            rotate: [0, 5, 0, -5, 0]
          },
          transition: { 
            duration: 5, 
            repeat: Infinity, 
            ease: "easeInOut" 
          }
        };
      
      case 'compass':
        return {
          animate: { rotate: [0, 360] },
          transition: { 
            duration: 12, 
            repeat: Infinity, 
            ease: "linear" 
          }
        };
      
      case 'pulse-marine':
        return {
          animate: { 
            scale: [1, 1.06, 1],
            boxShadow: [
              '0 0 0 0 rgba(6, 182, 212, 0)',
              '0 0 0 8px rgba(6, 182, 212, 0.2)',
              '0 0 0 0 rgba(6, 182, 212, 0)'
            ]
          },
          transition: { 
            duration: 2.5, 
            repeat: Infinity, 
            ease: "easeInOut" 
          }
        };
      
      case 'float':
        return {
          animate: { 
            y: [0, -3, 0],
            rotate: [0, 2, 0, -2, 0]
          },
          transition: { 
            duration: 6, 
            repeat: Infinity, 
            ease: "easeInOut" 
          }
        };
      
      case 'shimmer-ocean':
        return {
          animate: { 
            opacity: [0.6, 1, 0.6],
            scale: [0.98, 1.02, 0.98]
          },
          transition: { 
            duration: 3, 
            repeat: Infinity, 
            ease: "easeInOut" 
          }
        };
      
      case 'active':
        return {
          animate: {
            scale: [1, 1.1, 1],
            rotate: [0, 5, -5, 0]
          },
          transition: {
            duration: 0.6,
            ease: "easeInOut"
          }
        };
      
      default: // hover
        return {
          whileHover: { 
            scale: 1.1, 
            rotate: 5,
            transition: { duration: 0.2, ease: "easeOut" } 
          },
          whileTap: { 
            scale: 0.95,
            rotate: -2,
            transition: { duration: 0.1 }
          }
        };
    }
  };

  if (!IconComponent) {
    console.error('FancyIcon: IconComponent is undefined');
    return null;
  }

  const wrapperStyle = {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: size,
    height: size,
    position: 'relative',
    filter: disabled ? 'grayscale(1)' : 'none',
    ...style
  };

  const iconStyle = {
    cursor: onClick && !disabled ? 'pointer' : 'default',
    width: size,
    height: size,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    position: 'absolute',
    willChange: 'transform, opacity',
    borderRadius: '50%',
  };

  return (
    <div className={`fancy-icon-wrapper ${className}`} style={wrapperStyle}>
      <motion.div
        onClick={onClick && !disabled ? onClick : undefined}
        style={iconStyle}
        {...getAnimationProps()}
      >
        <IconComponent 
          size={size} 
          color={color}
          strokeWidth={1.8} // Slightly thicker for better visibility in marine context
        />
      </motion.div>
    </div>
  );
};

// Utility function for marine-specific icon animations
export const getMarineAnimationType = (variableType) => {
  const animations = {
    'wave': 'wave',
    'hs': 'tide',
    'tm02': 'pulse-marine',
    'tpeak': 'float',
    'dirm': 'current',
    'wind': 'current',
    'inundation': 'shimmer-ocean',
    'compass': 'compass'
  };
  
  return animations[variableType?.toLowerCase()] || 'hover';
};

export default FancyIcon;