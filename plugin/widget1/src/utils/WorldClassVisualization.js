/**
 * WorldClassVisualization - Advanced Legend and Color Management
 * 
 * Professional-grade legend generation, color palette management, and scale optimization
 * designed specifically for marine forecast visualization systems.
 */

// Marine-optimized color palettes for different data types
const MARINE_PALETTES = {
  // Wave height - Blue to red progression
  waveHeight: {
    name: 'Marine Wave Height',
    colors: [
      '#000080', '#0040FF', '#0080FF', '#00BFFF', '#40DFFF',
      '#80FFFF', '#BFFF80', '#FFFF40', '#FFBF00', '#FF8000',
      '#FF4000', '#FF0000', '#BF0000', '#800000'
    ],
    domain: [0, 8],
    units: 'm',
    description: 'Optimized for significant wave height visualization'
  },
  
  // Wave period - Rainbow spectrum
  wavePeriod: {
    name: 'Wave Period Spectrum',
    colors: [
      '#4B0082', '#6A0DAD', '#8A2BE2', '#9932CC', '#BA55D3',
      '#DA70D6', '#FF69B4', '#FF1493', '#DC143C', '#B22222',
      '#CD5C5C', '#F08080', '#FFA07A', '#FF7F50', '#FF6347'
    ],
    domain: [2, 20],
    units: 's',
    description: 'Spectral colors for wave period differentiation'
  },
  
  // Wave direction - Circular hue mapping
  waveDirection: {
    name: 'Compass Direction',
    colors: [
      '#FF0000', '#FF4000', '#FF8000', '#FFBF00', '#FFFF00',
      '#BFFF00', '#80FF00', '#40FF00', '#00FF00', '#00FF40',
      '#00FF80', '#00FFBF', '#00FFFF', '#00BFFF', '#0080FF',
      '#0040FF', '#0000FF', '#4000FF', '#8000FF', '#BF00FF',
      '#FF00FF', '#FF00BF', '#FF0080', '#FF0040'
    ],
    domain: [0, 360],
    units: '°',
    circular: true,
    description: 'Circular color mapping for directional data'
  },
  
  // Coastal inundation - Depth-based palette
  inundation: {
    name: 'Coastal Inundation',
    colors: [
      '#E6F3FF', '#CCE7FF', '#B3DAFF', '#99CEFF', '#80C1FF',
      '#66B5FF', '#4DA8FF', '#339CFF', '#1A8FFF', '#0083FF'
    ],
    domain: [0, 3],
    units: 'm',
    description: 'Progressive blue tones for inundation levels'
  },
  
  // Generic jet palette for flexibility
  jet: {
    name: 'Jet Spectrum',
    colors: [
      '#000080', '#0000C0', '#0040FF', '#0080FF', '#00C0FF',
      '#00FFFF', '#40FFBF', '#80FF80', '#BFFF40', '#FFFF00',
      '#FFBF00', '#FF8000', '#FF4000', '#FF0000', '#C00000',
      '#800000'
    ],
    domain: [0, 1],
    units: '',
    description: 'Standard jet colormap for general use'
  }
};

export class WorldClassVisualization {
  constructor(options = {}) {
    this.options = {
      // Default configuration for Niue marine data
      defaultPalette: 'waveHeight',
      canvasSize: { width: 400, height: 60 },
      labelFont: '12px "SF Mono", Consolas, monospace',
      titleFont: '14px "SF Mono", Consolas, monospace',
      precision: 1,
      showTicks: true,
      showLabels: true,
      showTitle: true,
      backgroundColor: 'rgba(255, 255, 255, 0.95)',
      borderColor: 'rgba(0, 0, 0, 0.2)',
      textColor: '#2D3748',
      tickLength: 8,
      padding: {
        top: 30,
        right: 20,
        bottom: 25,
        left: 20
      },
      ...options
    };
    
    // Canvas cache for performance
    this.canvasCache = new Map();
    this.gradientCache = new Map();
  }

  /**
   * Get marine palette configuration
   */
  getPalette(paletteId) {
    return MARINE_PALETTES[paletteId] || MARINE_PALETTES.jet;
  }

  /**
   * Get all available palettes
   */
  getAvailablePalettes() {
    return Object.keys(MARINE_PALETTES);
  }

  /**
   * Create gradient stops for a palette
   */
  createGradientStops(paletteId, customDomain = null) {
    const cacheKey = `${paletteId}_${customDomain?.join('-') || 'default'}`;
    
    if (this.gradientCache.has(cacheKey)) {
      return this.gradientCache.get(cacheKey);
    }

    const palette = this.getPalette(paletteId);
    const colors = palette.colors;
    const domain = customDomain || palette.domain;
    
    const stops = colors.map((color, index) => ({
      offset: index / (colors.length - 1),
      color,
      value: domain[0] + (index / (colors.length - 1)) * (domain[1] - domain[0])
    }));

    this.gradientCache.set(cacheKey, stops);
    return stops;
  }

  /**
   * Generate optimized tick values for a domain
   */
  generateTicks(min, max, targetCount = 5) {
    const range = max - min;
    const rawStep = range / (targetCount - 1);
    
    // Find nice step size
    const magnitude = Math.pow(10, Math.floor(Math.log10(rawStep)));
    const normalizedStep = rawStep / magnitude;
    
    let niceStep;
    if (normalizedStep <= 1) niceStep = 1;
    else if (normalizedStep <= 2) niceStep = 2;
    else if (normalizedStep <= 5) niceStep = 5;
    else niceStep = 10;
    
    const step = niceStep * magnitude;
    
    // Generate ticks
    const firstTick = Math.ceil(min / step) * step;
    const ticks = [];
    
    for (let value = firstTick; value <= max; value += step) {
      ticks.push(Number(value.toFixed(10))); // Avoid floating point errors
    }
    
    // Ensure we have min and max
    if (ticks[0] > min) ticks.unshift(min);
    if (ticks[ticks.length - 1] < max) ticks.push(max);
    
    return ticks;
  }

  /**
   * Format numeric values for display
   */
  formatValue(value, precision = this.options.precision) {
    if (Math.abs(value) >= 1000) {
      return (value / 1000).toFixed(1) + 'k';
    }
    
    if (value % 1 === 0 && value < 100) {
      return value.toString();
    }
    
    return Number(value).toFixed(precision);
  }

  /**
   * Create horizontal legend canvas
   */
  createHorizontalLegend(paletteId, options = {}) {
    const config = { ...this.options, ...options };
    const palette = this.getPalette(paletteId);
    const { width, height } = config.canvasSize;
    
    const cacheKey = `horizontal_${paletteId}_${width}x${height}_${JSON.stringify(options)}`;
    
    if (this.canvasCache.has(cacheKey)) {
      return this.canvasCache.get(cacheKey);
    }

    // Create canvas
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    
    // Clear and set background
    ctx.clearRect(0, 0, width, height);
    if (config.backgroundColor) {
      ctx.fillStyle = config.backgroundColor;
      ctx.fillRect(0, 0, width, height);
    }

    // Calculate drawing area
    const { padding } = config;
    const gradientWidth = width - padding.left - padding.right;
    const gradientHeight = 20;
    const gradientY = padding.top + 5;
    
    // Create gradient
    const gradient = ctx.createLinearGradient(
      padding.left, gradientY,
      padding.left + gradientWidth, gradientY
    );
    
    const stops = this.createGradientStops(paletteId, options.domain);
    stops.forEach(stop => {
      gradient.addColorStop(stop.offset, stop.color);
    });

    // Draw gradient bar
    ctx.fillStyle = gradient;
    ctx.fillRect(padding.left, gradientY, gradientWidth, gradientHeight);
    
    // Draw border
    if (config.borderColor) {
      ctx.strokeStyle = config.borderColor;
      ctx.lineWidth = 1;
      ctx.strokeRect(padding.left, gradientY, gradientWidth, gradientHeight);
    }

    // Draw title
    if (config.showTitle && palette.name) {
      ctx.fillStyle = config.textColor;
      ctx.font = config.titleFont;
      ctx.textAlign = 'center';
      ctx.fillText(
        `${palette.name} (${palette.units})`,
        width / 2,
        padding.top - 5
      );
    }

    // Draw ticks and labels
    if (config.showTicks || config.showLabels) {
      const domain = options.domain || palette.domain;
      const ticks = this.generateTicks(domain[0], domain[1], 6);
      
      ctx.fillStyle = config.textColor;
      ctx.font = config.labelFont;
      ctx.textAlign = 'center';
      ctx.lineWidth = 1;
      ctx.strokeStyle = config.textColor;

      ticks.forEach(tick => {
        const x = padding.left + ((tick - domain[0]) / (domain[1] - domain[0])) * gradientWidth;
        
        // Draw tick mark
        if (config.showTicks) {
          ctx.beginPath();
          ctx.moveTo(x, gradientY + gradientHeight);
          ctx.lineTo(x, gradientY + gradientHeight + config.tickLength);
          ctx.stroke();
        }
        
        // Draw label
        if (config.showLabels) {
          ctx.fillText(
            this.formatValue(tick, config.precision),
            x,
            gradientY + gradientHeight + config.tickLength + 15
          );
        }
      });
    }

    // Cache and return
    this.canvasCache.set(cacheKey, canvas);
    return canvas;
  }

  /**
   * Create vertical legend canvas
   */
  createVerticalLegend(paletteId, options = {}) {
    const config = { ...this.options, ...options };
    const palette = this.getPalette(paletteId);
    const { width, height } = config.canvasSize;
    
    const cacheKey = `vertical_${paletteId}_${width}x${height}_${JSON.stringify(options)}`;
    
    if (this.canvasCache.has(cacheKey)) {
      return this.canvasCache.get(cacheKey);
    }

    // Create canvas
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    
    // Clear and set background
    ctx.clearRect(0, 0, width, height);
    if (config.backgroundColor) {
      ctx.fillStyle = config.backgroundColor;
      ctx.fillRect(0, 0, width, height);
    }

    // Calculate drawing area
    const { padding } = config;
    const gradientWidth = 20;
    const gradientHeight = height - padding.top - padding.bottom;
    const gradientX = padding.left;
    
    // Create gradient (top to bottom)
    const gradient = ctx.createLinearGradient(
      gradientX, padding.top,
      gradientX, padding.top + gradientHeight
    );
    
    const stops = this.createGradientStops(paletteId, options.domain);
    // Reverse for top-to-bottom display (high values at top)
    stops.reverse().forEach((stop, index) => {
      gradient.addColorStop(index / (stops.length - 1), stop.color);
    });

    // Draw gradient bar
    ctx.fillStyle = gradient;
    ctx.fillRect(gradientX, padding.top, gradientWidth, gradientHeight);
    
    // Draw border
    if (config.borderColor) {
      ctx.strokeStyle = config.borderColor;
      ctx.lineWidth = 1;
      ctx.strokeRect(gradientX, padding.top, gradientWidth, gradientHeight);
    }

    // Draw title (rotated)
    if (config.showTitle && palette.name) {
      ctx.save();
      ctx.fillStyle = config.textColor;
      ctx.font = config.titleFont;
      ctx.textAlign = 'center';
      ctx.translate(width - 10, height / 2);
      ctx.rotate(-Math.PI / 2);
      ctx.fillText(`${palette.name} (${palette.units})`, 0, 0);
      ctx.restore();
    }

    // Draw ticks and labels
    if (config.showTicks || config.showLabels) {
      const domain = options.domain || palette.domain;
      const ticks = this.generateTicks(domain[0], domain[1], 6);
      
      ctx.fillStyle = config.textColor;
      ctx.font = config.labelFont;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.lineWidth = 1;
      ctx.strokeStyle = config.textColor;

      ticks.forEach(tick => {
        // Calculate y position (inverted for top-to-bottom)
        const y = padding.top + gradientHeight - ((tick - domain[0]) / (domain[1] - domain[0])) * gradientHeight;
        
        // Draw tick mark
        if (config.showTicks) {
          ctx.beginPath();
          ctx.moveTo(gradientX + gradientWidth, y);
          ctx.lineTo(gradientX + gradientWidth + config.tickLength, y);
          ctx.stroke();
        }
        
        // Draw label
        if (config.showLabels) {
          ctx.fillText(
            this.formatValue(tick, config.precision),
            gradientX + gradientWidth + config.tickLength + 5,
            y
          );
        }
      });
    }

    // Cache and return
    this.canvasCache.set(cacheKey, canvas);
    return canvas;
  }

  /**
   * Get color for a specific value
   */
  getColorForValue(paletteId, value, domain = null) {
    const palette = this.getPalette(paletteId);
    const actualDomain = domain || palette.domain;
    const colors = palette.colors;
    
    // Handle out of range values
    if (value <= actualDomain[0]) return colors[0];
    if (value >= actualDomain[1]) return colors[colors.length - 1];
    
    // Normalize value to [0, 1]
    const normalized = (value - actualDomain[0]) / (actualDomain[1] - actualDomain[0]);
    
    // Find color index
    const colorIndex = normalized * (colors.length - 1);
    const lowerIndex = Math.floor(colorIndex);
    const upperIndex = Math.ceil(colorIndex);
    
    if (lowerIndex === upperIndex) {
      return colors[lowerIndex];
    }
    
    // Interpolate between colors
    const factor = colorIndex - lowerIndex;
    return this.interpolateColors(colors[lowerIndex], colors[upperIndex], factor);
  }

  /**
   * Interpolate between two hex colors
   */
  interpolateColors(color1, color2, factor) {
    const rgb1 = this.hexToRgb(color1);
    const rgb2 = this.hexToRgb(color2);
    
    const r = Math.round(rgb1.r + (rgb2.r - rgb1.r) * factor);
    const g = Math.round(rgb1.g + (rgb2.g - rgb1.g) * factor);
    const b = Math.round(rgb1.b + (rgb2.b - rgb1.b) * factor);
    
    return this.rgbToHex(r, g, b);
  }

  /**
   * Convert hex to RGB
   */
  hexToRgb(hex) {
    const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
    return result ? {
      r: parseInt(result[1], 16),
      g: parseInt(result[2], 16),
      b: parseInt(result[3], 16)
    } : null;
  }

  /**
   * Convert RGB to hex
   */
  rgbToHex(r, g, b) {
    const toHex = (c) => {
      const hex = c.toString(16);
      return hex.length === 1 ? '0' + hex : hex;
    };
    return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
  }

  /**
   * Create CSS gradient string
   */
  createCSSGradient(paletteId, direction = 'to right', domain = null) {
    const stops = this.createGradientStops(paletteId, domain);
    const stopStrings = stops.map(stop => 
      `${stop.color} ${Math.round(stop.offset * 100)}%`
    );
    
    return `linear-gradient(${direction}, ${stopStrings.join(', ')})`;
  }

  /**
   * Export legend as data URL
   */
  exportLegend(paletteId, format = 'png', orientation = 'horizontal', options = {}) {
    const canvas = orientation === 'horizontal' 
      ? this.createHorizontalLegend(paletteId, options)
      : this.createVerticalLegend(paletteId, options);
    
    return canvas.toDataURL(`image/${format}`);
  }

  /**
   * Clear all caches
   */
  clearCache() {
    this.canvasCache.clear();
    this.gradientCache.clear();
  }

  /**
   * Get cache statistics
   */
  getCacheStats() {
    return {
      canvasCacheSize: this.canvasCache.size,
      gradientCacheSize: this.gradientCache.size
    };
  }
}

export default WorldClassVisualization;