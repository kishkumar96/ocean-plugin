/**
 * Custom hook for responsive window size management - Niue Marine Edition
 * 
 * Provides responsive features, breakpoint management, and adaptive layouts
 * optimized for marine dashboard interfaces across all device types.
 */

import { useState, useEffect, useCallback, useRef, useMemo } from 'react';

// Niue marine dashboard breakpoints
const DEFAULT_BREAKPOINTS = {
  xs: 0,        // Extra small devices (phones portrait)
  sm: 576,      // Small devices (phones landscape)
  md: 768,      // Medium devices (tablets portrait)
  lg: 992,      // Large devices (tablets landscape, small laptops)
  xl: 1200,     // Extra large devices (laptops, desktops)
  xxl: 1400,    // Extra extra large (large desktops, marine workstations)
  marine: 1920  // Marine professional displays
};

// Responsive behavior configurations for marine interfaces
const RESPONSIVE_CONFIGS = {
  // Panel behavior at different screen sizes
  panels: {
    xs: { width: '100%', stack: true, overlay: true },
    sm: { width: '90%', stack: true, overlay: true },
    md: { width: '400px', stack: false, overlay: false },
    lg: { width: '450px', stack: false, overlay: false },
    xl: { width: '500px', stack: false, overlay: false },
    marine: { width: '600px', stack: false, overlay: false }
  },
  
  // Map interface scaling
  map: {
    xs: { zoom: 10, controls: 'minimal' },
    sm: { zoom: 11, controls: 'compact' },
    md: { zoom: 12, controls: 'standard' },
    lg: { zoom: 12, controls: 'standard' },
    xl: { zoom: 13, controls: 'full' },
    marine: { zoom: 14, controls: 'professional' }
  },
  
  // Typography scaling for marine readability
  typography: {
    xs: { scale: 0.8, density: 'compact' },
    sm: { scale: 0.9, density: 'compact' },
    md: { scale: 1.0, density: 'standard' },
    lg: { scale: 1.1, density: 'standard' },
    xl: { scale: 1.2, density: 'comfortable' },
    marine: { scale: 1.3, density: 'professional' }
  }
};

export const useWindowSize = (customBreakpoints = {}) => {
  // Merge custom breakpoints with defaults using useMemo
  const breakpoints = useMemo(() => ({ 
    ...DEFAULT_BREAKPOINTS, 
    ...customBreakpoints 
  }), [customBreakpoints]);
  
  // State management
  const [windowSize, setWindowSize] = useState({
    width: typeof window !== 'undefined' ? window.innerWidth : 1920,
    height: typeof window !== 'undefined' ? window.innerHeight : 1080,
    aspectRatio: typeof window !== 'undefined' ? window.innerWidth / window.innerHeight : 16/9
  });
  
  const [orientation, setOrientation] = useState('landscape');
  const [deviceType, setDeviceType] = useState('desktop');
  const [currentBreakpoint, setCurrentBreakpoint] = useState('xl');
  
  // Refs for performance optimization
  const resizeTimeoutRef = useRef(null);
  const previousSizeRef = useRef(windowSize);

  // Determine current breakpoint from width
  const getBreakpoint = useCallback((width) => {
    const sortedBreakpoints = Object.entries(breakpoints)
      .sort(([,a], [,b]) => b - a); // Sort descending
    
    for (const [name, minWidth] of sortedBreakpoints) {
      if (width >= minWidth) {
        return name;
      }
    }
    return 'xs'; // Fallback
  }, [breakpoints]);

  // Determine device type based on screen characteristics
  const getDeviceType = useCallback((width, height) => {
    const aspectRatio = width / height;
    
    // Marine workstation (ultra-wide or large displays)
    if (width >= 1920 && height >= 1080) {
      return 'marine-workstation';
    }
    
    // Desktop/laptop
    if (width >= 1024) {
      return 'desktop';
    }
    
    // Tablet
    if (width >= 768) {
      return aspectRatio > 1.2 ? 'tablet-landscape' : 'tablet-portrait';
    }
    
    // Mobile
    return aspectRatio > 1 ? 'mobile-landscape' : 'mobile-portrait';
  }, []);

  // Get orientation from dimensions
  const getOrientation = useCallback((width, height) => {
    return width > height ? 'landscape' : 'portrait';
  }, []);

  // Update all size-related state
  const updateSize = useCallback(() => {
    const width = window.innerWidth;
    const height = window.innerHeight;
    const aspectRatio = width / height;
    
    const newSize = { width, height, aspectRatio };
    const newOrientation = getOrientation(width, height);
    const newDeviceType = getDeviceType(width, height);
    const newBreakpoint = getBreakpoint(width);
    
    // Only update if something actually changed
    const hasChanged = 
      newSize.width !== previousSizeRef.current.width ||
      newSize.height !== previousSizeRef.current.height;
    
    if (hasChanged) {
      setWindowSize(newSize);
      setOrientation(newOrientation);
      setDeviceType(newDeviceType);
      setCurrentBreakpoint(newBreakpoint);
      
      previousSizeRef.current = newSize;
    }
  }, [getOrientation, getDeviceType, getBreakpoint]);

  // Debounced resize handler for performance
  const handleResize = useCallback(() => {
    if (resizeTimeoutRef.current) {
      clearTimeout(resizeTimeoutRef.current);
    }
    
    resizeTimeoutRef.current = setTimeout(updateSize, 150);
  }, [updateSize]);

  // Set up resize listener
  useEffect(() => {
    // Initial size calculation
    updateSize();
    
    // Add event listener
    window.addEventListener('resize', handleResize);
    window.addEventListener('orientationchange', handleResize);
    
    // Cleanup
    return () => {
      window.removeEventListener('resize', handleResize);
      window.removeEventListener('orientationchange', handleResize);
      
      if (resizeTimeoutRef.current) {
        clearTimeout(resizeTimeoutRef.current);
      }
    };
  }, [handleResize, updateSize]);

  // Responsive utilities
  const isBreakpoint = useCallback((breakpointName) => {
    return currentBreakpoint === breakpointName;
  }, [currentBreakpoint]);

  const isAtLeast = useCallback((breakpointName) => {
    const currentWidth = windowSize.width;
    const targetWidth = breakpoints[breakpointName] || 0;
    return currentWidth >= targetWidth;
  }, [windowSize.width, breakpoints]);

  const isAtMost = useCallback((breakpointName) => {
    const currentWidth = windowSize.width;
    const targetWidth = breakpoints[breakpointName] || Infinity;
    return currentWidth <= targetWidth;
  }, [windowSize.width, breakpoints]);

  const isBetween = useCallback((minBreakpoint, maxBreakpoint) => {
    const currentWidth = windowSize.width;
    const minWidth = breakpoints[minBreakpoint] || 0;
    const maxWidth = breakpoints[maxBreakpoint] || Infinity;
    return currentWidth >= minWidth && currentWidth <= maxWidth;
  }, [windowSize.width, breakpoints]);

  // Device type checks
  const isMobile = deviceType.includes('mobile');
  const isTablet = deviceType.includes('tablet');
  const isDesktop = deviceType === 'desktop';
  const isMarineWorkstation = deviceType === 'marine-workstation';
  
  // Orientation checks
  const isPortrait = orientation === 'portrait';
  const isLandscape = orientation === 'landscape';

  // Get responsive configuration for current breakpoint
  const getResponsiveConfig = useCallback((configType) => {
    const config = RESPONSIVE_CONFIGS[configType];
    if (!config) return null;
    
    return config[currentBreakpoint] || config.md || {}; // Fallback to medium
  }, [currentBreakpoint]);

  // Calculate optimal panel width for current screen
  const getOptimalPanelWidth = useCallback(() => {
    const { width } = windowSize;
    
    if (isMobile) {
      return Math.min(width - 40, 350); // Full width with margins
    }
    
    if (isTablet) {
      return Math.min(width * 0.6, 450); // 60% of screen width
    }
    
    if (isMarineWorkstation) {
      return Math.min(width * 0.25, 600); // 25% for large screens
    }
    
    return Math.min(width * 0.33, 500); // 33% for desktop
  }, [windowSize, isMobile, isTablet, isMarineWorkstation]);

  // CSS class helpers for responsive styling
  const getResponsiveClasses = useCallback(() => {
    return [
      `breakpoint-${currentBreakpoint}`,
      `device-${deviceType}`,
      `orientation-${orientation}`,
      isMobile && 'is-mobile',
      isTablet && 'is-tablet', 
      isDesktop && 'is-desktop',
      isMarineWorkstation && 'is-marine-workstation',
      windowSize.width < 480 && 'very-small',
      windowSize.width > 2560 && 'ultra-wide'
    ].filter(Boolean).join(' ');
  }, [currentBreakpoint, deviceType, orientation, isMobile, isTablet, isDesktop, isMarineWorkstation, windowSize.width]);

  // Media query utilities
  const createMediaQuery = useCallback((breakpointName, type = 'min') => {
    const width = breakpoints[breakpointName];
    if (!width) return '';
    
    const operator = type === 'min' ? 'min-width' : 'max-width';
    return `(${operator}: ${width}px)`;
  }, [breakpoints]);

  // Performance monitoring
  const getPerformanceMetrics = useCallback(() => {
    const { width, height } = windowSize;
    const pixelCount = width * height;
    
    return {
      resolution: `${width}x${height}`,
      pixelCount,
      aspectRatio: (width / height).toFixed(2),
      pixelDensity: window.devicePixelRatio || 1,
      breakpoint: currentBreakpoint,
      deviceType,
      
      // Performance classification
      performanceClass: pixelCount > 2073600 ? 'high-res' : // > 1920x1080
                       pixelCount > 921600 ? 'standard' :   // > 1280x720
                       'low-res',
      
      // Recommended settings
      recommendations: {
        animationLevel: pixelCount > 2073600 ? 'full' : 'reduced',
        mapTileSize: pixelCount > 2073600 ? 512 : 256,
        cacheSize: pixelCount > 2073600 ? 'large' : 'standard'
      }
    };
  }, [windowSize, currentBreakpoint, deviceType]);

  return {
    // Current state
    windowSize,
    orientation,
    deviceType,
    currentBreakpoint,
    
    // Device type flags
    isMobile,
    isTablet,
    isDesktop,
    isMarineWorkstation,
    isPortrait,
    isLandscape,
    
    // Breakpoint utilities
    isBreakpoint,
    isAtLeast,
    isAtMost,
    isBetween,
    
    // Responsive helpers
    getResponsiveConfig,
    getOptimalPanelWidth,
    getResponsiveClasses,
    createMediaQuery,
    
    // Performance
    getPerformanceMetrics,
    
    // Configuration
    breakpoints,
    
    // Convenience accessors
    width: windowSize.width,
    height: windowSize.height,
    aspectRatio: windowSize.aspectRatio
  };
};

export default useWindowSize;