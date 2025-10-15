/**
 * Professional Marine Legend Component - Niue Edition
 * 
 * High-quality legend system for marine forecast data visualization
 * Optimized for Niue waters with professional maritime styling
 */
import React, { useState, useEffect, useMemo } from 'react';
import { Info, X, Maximize2, Minimize2 } from 'lucide-react';

const ProfessionalLegend = ({
  legendUrl,
  title = "Legend",
  units = "",
  variable = "",
  position = "bottom-right",
  isVisible = true,
  onToggleVisibility,
  className = "",
  style = {},
  responsive = true,
  expandable = true
}) => {
  const [imageLoaded, setImageLoaded] = useState(false);
  const [imageError, setImageError] = useState(false);
  const [isExpanded, setIsExpanded] = useState(false);
  const [currentPosition, setCurrentPosition] = useState(position);

  // Responsive positioning logic
  useEffect(() => {
    if (!responsive) return;
    
    const handleResize = () => {
      const isMobile = window.innerWidth < 768;
      const isTablet = window.innerWidth < 1024;
      
      if (isMobile) {
        setCurrentPosition('bottom-center');
      } else if (isTablet && position === 'bottom-right') {
        setCurrentPosition('bottom-right');
      } else {
        setCurrentPosition(position);
      }
    };
    
    handleResize();
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, [position, responsive]);

  // Position styles
  const positionStyles = {
    'bottom-right': { 
      bottom: '20px', 
      right: '20px' 
    },
    'bottom-left': { 
      bottom: '20px', 
      left: '20px' 
    },
    'top-right': { 
      top: '80px', 
      right: '20px' 
    },
    'top-left': { 
      top: '80px', 
      left: '20px' 
    },
    'bottom-center': { 
      bottom: '20px', 
      left: '50%', 
      transform: 'translateX(-50%)' 
    }
  };

  // Generate variable-specific styling
  const getVariableTheme = useMemo(() => {
    const variableThemes = {
      'hs': {
        accent: '#06b6d4',
        gradient: 'linear-gradient(135deg, rgba(6, 182, 212, 0.1), rgba(14, 165, 233, 0.1))',
        border: 'rgba(6, 182, 212, 0.3)'
      },
      'tm02': {
        accent: '#0ea5e9',
        gradient: 'linear-gradient(135deg, rgba(14, 165, 233, 0.1), rgba(30, 64, 175, 0.1))',
        border: 'rgba(14, 165, 233, 0.3)'
      },
      'tpeak': {
        accent: '#f97316',
        gradient: 'linear-gradient(135deg, rgba(249, 115, 22, 0.1), rgba(234, 88, 12, 0.1))',
        border: 'rgba(249, 115, 22, 0.3)'
      },
      'dirm': {
        accent: '#8b5cf6',
        gradient: 'linear-gradient(135deg, rgba(139, 92, 246, 0.1), rgba(124, 58, 237, 0.1))',
        border: 'rgba(139, 92, 246, 0.3)'
      },
      'inundation': {
        accent: '#3b82f6',
        gradient: 'linear-gradient(135deg, rgba(59, 130, 246, 0.1), rgba(37, 99, 235, 0.1))',
        border: 'rgba(59, 130, 246, 0.3)'
      }
    };

    const variableKey = variable?.toLowerCase() || '';
    for (const [key, theme] of Object.entries(variableThemes)) {
      if (variableKey.includes(key)) {
        return theme;
      }
    }
    
    // Default Niue marine theme
    return {
      accent: '#06b6d4',
      gradient: 'linear-gradient(135deg, rgba(12, 74, 110, 0.1), rgba(6, 182, 212, 0.1))',
      border: 'rgba(6, 182, 212, 0.3)'
    };
  }, [variable]);

  const handleImageLoad = () => {
    setImageLoaded(true);
    setImageError(false);
  };

  const handleImageError = () => {
    setImageLoaded(false);
    setImageError(true);
  };

  const toggleExpanded = () => {
    setIsExpanded(!isExpanded);
  };

  if (!isVisible) return null;

  return (
    <div
      className={`marine-legend niue-professional ${className}`}
      style={{
        ...positionStyles[currentPosition],
        background: getVariableTheme.gradient,
        borderColor: getVariableTheme.border,
        ...style
      }}
    >
      {/* Legend Header */}
      <div className="legend-header">
        <div className="legend-title-section">
          <Info size={12} color={getVariableTheme.accent} />
          <span 
            className="legend-title"
            style={{ color: getVariableTheme.accent }}
          >
            {title}
          </span>
          {units && (
            <span className="legend-units">({units})</span>
          )}
        </div>
        
        <div className="legend-controls">
          {expandable && (
            <button
              className="legend-control-btn expand-btn"
              onClick={toggleExpanded}
              aria-label={isExpanded ? 'Minimize legend' : 'Expand legend'}
              title={isExpanded ? 'Minimize' : 'Expand'}
            >
              {isExpanded ? <Minimize2 size={10} /> : <Maximize2 size={10} />}
            </button>
          )}
          {onToggleVisibility && (
            <button
              className="legend-control-btn close-btn"
              onClick={onToggleVisibility}
              aria-label="Hide legend"
              title="Hide legend"
            >
              <X size={10} />
            </button>
          )}
        </div>
      </div>

      {/* Legend Content */}
      <div className={`legend-content ${isExpanded ? 'expanded' : ''}`}>
        {legendUrl ? (
          <div className="legend-image-container">
            {!imageLoaded && !imageError && (
              <div className="legend-loading">
                <div 
                  className="loading-spinner"
                  style={{ borderTopColor: getVariableTheme.accent }}
                />
                <span>Loading...</span>
              </div>
            )}
            
            {imageError && (
              <div className="legend-error">
                <Info size={16} color={getVariableTheme.accent} />
                <span>Legend unavailable</span>
              </div>
            )}
            
            <img
              src={legendUrl}
              alt={`${title} legend`}
              className={`legend-image ${imageLoaded ? 'loaded' : ''}`}
              onLoad={handleImageLoad}
              onError={handleImageError}
              style={{ 
                display: (!imageLoaded || imageError) ? 'none' : 'block',
                borderColor: getVariableTheme.border
              }}
            />
          </div>
        ) : (
          <div className="legend-placeholder">
            <Info size={16} color={getVariableTheme.accent} />
            <span>No legend data</span>
          </div>
        )}

        {/* Variable Information */}
        {isExpanded && variable && (
          <div className="legend-metadata">
            <div className="metadata-item">
              <strong>Variable:</strong> {variable}
            </div>
            <div className="metadata-item">
              <strong>Source:</strong> SPC Marine
            </div>
            <div className="metadata-item">
              <strong>Region:</strong> Niue Waters
            </div>
          </div>
        )}
      </div>

      {/* Niue Waters Identifier */}
      <div className="legend-footer">
        <span className="niue-identifier">🇳🇺 Niue Waters</span>
      </div>

      <style jsx>{`
        .marine-legend.niue-professional {
          position: absolute;
          z-index: 1010;
          backdrop-filter: blur(12px);
          border: 1px solid;
          border-radius: 8px;
          padding: 10px;
          box-shadow: 0 8px 32px rgba(12, 74, 110, 0.4);
          font-family: 'SF Mono', 'Monaco', 'Consolas', monospace;
          color: #ffffff;
          min-width: 60px;
          max-width: ${isExpanded ? '200px' : '80px'};
          max-height: 80vh;
          transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
        }

        .legend-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: 8px;
          gap: 6px;
        }

        .legend-title-section {
          display: flex;
          align-items: center;
          gap: 4px;
          flex: 1;
          min-width: 0;
        }

        .legend-title {
          font-size: 9px;
          font-weight: 700;
          text-transform: uppercase;
          letter-spacing: 0.5px;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }

        .legend-units {
          font-size: 7px;
          color: rgba(255, 255, 255, 0.7);
          white-space: nowrap;
        }

        .legend-controls {
          display: flex;
          gap: 2px;
        }

        .legend-control-btn {
          background: rgba(255, 255, 255, 0.1);
          border: 1px solid rgba(255, 255, 255, 0.2);
          border-radius: 3px;
          padding: 2px;
          cursor: pointer;
          color: rgba(255, 255, 255, 0.8);
          transition: all 0.2s ease;
          display: flex;
          align-items: center;
          justify-content: center;
        }

        .legend-control-btn:hover {
          background: rgba(255, 255, 255, 0.2);
          color: #ffffff;
        }

        .legend-content {
          transition: all 0.3s ease;
          overflow: hidden;
        }

        .legend-content.expanded {
          max-width: none;
        }

        .legend-image-container {
          position: relative;
          display: flex;
          justify-content: center;
          align-items: center;
          min-height: 120px;
        }

        .legend-image {
          max-width: 100%;
          height: auto;
          border-radius: 4px;
          border: 1px solid;
          opacity: 0;
          transition: opacity 0.3s ease;
        }

        .legend-image.loaded {
          opacity: 1;
        }

        .legend-loading,
        .legend-error,
        .legend-placeholder {
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          padding: 20px;
          gap: 8px;
          color: rgba(255, 255, 255, 0.7);
          font-size: 8px;
        }

        .loading-spinner {
          width: 16px;
          height: 16px;
          border: 2px solid rgba(255, 255, 255, 0.2);
          border-top: 2px solid;
          border-radius: 50%;
          animation: spin 1s linear infinite;
        }

        @keyframes spin {
          0% { transform: rotate(0deg); }
          100% { transform: rotate(360deg); }
        }

        .legend-metadata {
          margin-top: 8px;
          padding-top: 8px;
          border-top: 1px solid rgba(255, 255, 255, 0.2);
          font-size: 7px;
        }

        .metadata-item {
          margin-bottom: 3px;
          display: flex;
          justify-content: space-between;
        }

        .legend-footer {
          margin-top: 6px;
          padding-top: 4px;
          border-top: 1px solid rgba(255, 255, 255, 0.1);
          text-align: center;
        }

        .niue-identifier {
          font-size: 6px;
          color: rgba(255, 255, 255, 0.6);
          letter-spacing: 0.3px;
        }

        /* Mobile responsiveness */
        @media (max-width: 768px) {
          .marine-legend.niue-professional {
            max-width: ${isExpanded ? '160px' : '60px'};
            padding: 8px;
          }

          .legend-image-container {
            min-height: 100px;
          }
        }

        @media (max-width: 480px) {
          .marine-legend.niue-professional {
            max-width: ${isExpanded ? '140px' : '50px'};
            padding: 6px;
          }

          .legend-image-container {
            min-height: 80px;
          }
        }
      `}</style>
    </div>
  );
};

export default ProfessionalLegend;