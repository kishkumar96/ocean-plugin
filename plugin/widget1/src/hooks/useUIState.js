/**
 * Custom hook for UI state management - Niue Marine Edition
 * 
 * Manages UI preferences persistence, panel state, and responsive behavior
 * optimized for marine forecast dashboard requirements.
 */

import { useState, useEffect, useCallback, useRef } from 'react';

// Default UI state for Niue marine interface
const DEFAULT_UI_STATE = {
  // Panel states
  leftPanel: {
    isOpen: false,
    activeTab: 'forecast',
    width: 400,
    position: { x: 20, y: 80 }
  },
  rightPanel: {
    isOpen: false,
    activeTab: 'legend',
    width: 350,
    position: { x: 'auto', y: 80 }
  },
  bottomCanvas: {
    isVisible: false,
    height: 300,
    mode: 'forecast' // 'forecast' | 'buoy'
  },
  
  // Layer preferences
  layerSettings: {
    selectedLayer: 'composite_hs_dirm',
    opacity: 0.7,
    animationSpeed: 'medium',
    autoPlay: false,
    showGrid: false,
    showBuoys: true
  },
  
  // Display preferences
  display: {
    theme: 'marine', // 'marine' | 'dark' | 'light'
    units: 'metric',
    timeFormat: '24h',
    showCompass: true,
    showHeader: true,
    compactMode: false
  },
  
  // Responsive breakpoints
  breakpoints: {
    mobile: 768,
    tablet: 1024,
    desktop: 1440
  },
  
  // Current screen info
  screen: {
    width: 1920,
    height: 1080,
    isMobile: false,
    isTablet: false,
    isDesktop: true
  }
};

export const useUIState = (initialState = {}) => {
  // Storage key for persistence
  const STORAGE_KEY = 'niue-marine-ui-state';
  
  // Load saved state from localStorage or use defaults
  const loadSavedState = useCallback(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        return { ...DEFAULT_UI_STATE, ...parsed, ...initialState };
      }
    } catch (error) {
      console.warn('Failed to load UI state from localStorage:', error);
    }
    return { ...DEFAULT_UI_STATE, ...initialState };
  }, [initialState]);

  // Initialize state
  const [uiState, setUIState] = useState(loadSavedState);
  const saveTimeoutRef = useRef(null);

  // Persist state to localStorage with debouncing
  const persistState = useCallback((state) => {
    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current);
    }
    
    saveTimeoutRef.current = setTimeout(() => {
      try {
        const stateToSave = {
          ...state,
          // Don't save screen info as it's dynamic
          screen: undefined
        };
        localStorage.setItem(STORAGE_KEY, JSON.stringify(stateToSave));
      } catch (error) {
        console.warn('Failed to save UI state:', error);
      }
    }, 500); // 500ms debounce
  }, []);

  // Update state with persistence
  const updateUIState = useCallback((updates) => {
    setUIState(prevState => {
      const newState = typeof updates === 'function' 
        ? updates(prevState)
        : { ...prevState, ...updates };
      
      persistState(newState);
      return newState;
    });
  }, [persistState]);

  // Panel management functions
  const toggleLeftPanel = useCallback(() => {
    updateUIState(state => ({
      ...state,
      leftPanel: {
        ...state.leftPanel,
        isOpen: !state.leftPanel.isOpen
      }
    }));
  }, [updateUIState]);

  const toggleRightPanel = useCallback(() => {
    updateUIState(state => ({
      ...state,
      rightPanel: {
        ...state.rightPanel,
        isOpen: !state.rightPanel.isOpen
      }
    }));
  }, [updateUIState]);

  const setActiveTab = useCallback((panel, tab) => {
    updateUIState(state => ({
      ...state,
      [panel]: {
        ...state[panel],
        activeTab: tab,
        isOpen: true // Auto-open panel when setting tab
      }
    }));
  }, [updateUIState]);

  const setPanelPosition = useCallback((panel, position) => {
    updateUIState(state => ({
      ...state,
      [panel]: {
        ...state[panel],
        position
      }
    }));
  }, [updateUIState]);

  // Bottom canvas management
  const showBottomCanvas = useCallback((mode = 'forecast') => {
    updateUIState(state => ({
      ...state,
      bottomCanvas: {
        ...state.bottomCanvas,
        isVisible: true,
        mode
      }
    }));
  }, [updateUIState]);

  const hideBottomCanvas = useCallback(() => {
    updateUIState(state => ({
      ...state,
      bottomCanvas: {
        ...state.bottomCanvas,
        isVisible: false
      }
    }));
  }, [updateUIState]);

  // Layer settings management
  const updateLayerSettings = useCallback((settings) => {
    updateUIState(state => ({
      ...state,
      layerSettings: {
        ...state.layerSettings,
        ...settings
      }
    }));
  }, [updateUIState]);

  const setSelectedLayer = useCallback((layer) => {
    updateLayerSettings({ selectedLayer: layer });
  }, [updateLayerSettings]);

  const setLayerOpacity = useCallback((opacity) => {
    updateLayerSettings({ opacity });
  }, [updateLayerSettings]);

  // Display preferences
  const updateDisplaySettings = useCallback((settings) => {
    updateUIState(state => ({
      ...state,
      display: {
        ...state.display,
        ...settings
      }
    }));
  }, [updateUIState]);

  const toggleTheme = useCallback(() => {
    updateUIState(state => {
      const themes = ['marine', 'dark', 'light'];
      const currentIndex = themes.indexOf(state.display.theme);
      const nextTheme = themes[(currentIndex + 1) % themes.length];
      
      return {
        ...state,
        display: {
          ...state.display,
          theme: nextTheme
        }
      };
    });
  }, [updateUIState]);

  const toggleCompactMode = useCallback(() => {
    updateUIState(state => ({
      ...state,
      display: {
        ...state.display,
        compactMode: !state.display.compactMode
      }
    }));
  }, [updateUIState]);

  // Screen size tracking for responsive behavior
  useEffect(() => {
    const updateScreenSize = () => {
      const width = window.innerWidth;
      const height = window.innerHeight;
      const isMobile = width < uiState.breakpoints.mobile;
      const isTablet = width >= uiState.breakpoints.mobile && width < uiState.breakpoints.desktop;
      const isDesktop = width >= uiState.breakpoints.desktop;

      setUIState(prevState => ({
        ...prevState,
        screen: {
          width,
          height,
          isMobile,
          isTablet,
          isDesktop
        }
      }));
    };

    // Initial size
    updateScreenSize();

    // Listen for changes
    window.addEventListener('resize', updateScreenSize);
    return () => window.removeEventListener('resize', updateScreenSize);
  }, [uiState.breakpoints]);

  // Auto-close panels on mobile when screen becomes too small
  useEffect(() => {
    if (uiState.screen.isMobile) {
      updateUIState(state => ({
        ...state,
        leftPanel: { ...state.leftPanel, isOpen: false },
        rightPanel: { ...state.rightPanel, isOpen: false }
      }));
    }
  }, [uiState.screen.isMobile, updateUIState]);

  // Responsive panel width adjustment
  const getResponsivePanelWidth = useCallback((panelType) => {
    const { isMobile, isTablet, width } = uiState.screen;
    
    if (isMobile) {
      return Math.min(width - 40, 350); // Full width with margins on mobile
    }
    
    if (isTablet) {
      return panelType === 'left' ? 350 : 300;
    }
    
    // Desktop
    return uiState[`${panelType}Panel`].width;
  }, [uiState]);

  // CSS class helpers for responsive design
  const getResponsiveClasses = useCallback(() => {
    const { isMobile, isTablet, isDesktop } = uiState.screen;
    const { compactMode, theme } = uiState.display;
    
    return {
      container: [
        'niue-marine-app',
        `theme-${theme}`,
        isMobile && 'mobile',
        isTablet && 'tablet', 
        isDesktop && 'desktop',
        compactMode && 'compact'
      ].filter(Boolean).join(' '),
      
      leftPanel: [
        'left-panel',
        uiState.leftPanel.isOpen && 'open',
        isMobile && 'mobile-panel'
      ].filter(Boolean).join(' '),
      
      rightPanel: [
        'right-panel',
        uiState.rightPanel.isOpen && 'open',
        isMobile && 'mobile-panel'
      ].filter(Boolean).join(' '),
      
      bottomCanvas: [
        'bottom-canvas',
        uiState.bottomCanvas.isVisible && 'visible',
        `mode-${uiState.bottomCanvas.mode}`
      ].filter(Boolean).join(' ')
    };
  }, [uiState]);

  // Reset to defaults
  const resetUIState = useCallback(() => {
    setUIState({ ...DEFAULT_UI_STATE, screen: uiState.screen });
    localStorage.removeItem(STORAGE_KEY);
  }, [uiState.screen]);

  // Cleanup
  useEffect(() => {
    return () => {
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
      }
    };
  }, []);

  // Public API
  return {
    // Current state
    uiState,
    
    // Panel controls
    toggleLeftPanel,
    toggleRightPanel,
    setActiveTab,
    setPanelPosition,
    
    // Bottom canvas
    showBottomCanvas,
    hideBottomCanvas,
    
    // Layer settings
    updateLayerSettings,
    setSelectedLayer,
    setLayerOpacity,
    
    // Display settings
    updateDisplaySettings,
    toggleTheme,
    toggleCompactMode,
    
    // Responsive helpers
    getResponsivePanelWidth,
    getResponsiveClasses,
    
    // Utilities
    updateUIState,
    resetUIState,
    
    // Convenience accessors
    isLeftPanelOpen: uiState.leftPanel.isOpen,
    isRightPanelOpen: uiState.rightPanel.isOpen,
    isBottomCanvasVisible: uiState.bottomCanvas.isVisible,
    isMobile: uiState.screen.isMobile,
    isTablet: uiState.screen.isTablet,
    isDesktop: uiState.screen.isDesktop,
    theme: uiState.display.theme,
    compactMode: uiState.display.compactMode,
    selectedLayer: uiState.layerSettings.selectedLayer,
    layerOpacity: uiState.layerSettings.opacity
  };
};

export default useUIState;