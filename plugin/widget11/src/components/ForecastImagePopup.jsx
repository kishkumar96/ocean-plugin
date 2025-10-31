/**
 * Forecast Image Popup Component
 * 
 * Displays atoll-specific forecast images from THREDDS when clicking inundation markers
 * Shows wave height, period, and direction forecast images
 */

import React, { useState, useEffect } from 'react';
import { Modal, Button, Carousel, Spinner, Alert } from 'react-bootstrap';
import TuvaluConfig from '../config/TuvaluConfig';
import './ForecastImagePopup.css';

/**
 * Get forecast image URLs for a specific location
 * @param {string} location - Atoll or location name
 * @returns {Array} - Array of forecast image objects
 */
const getForecastImages = (location) => {
  // Find the matching atoll
  const atoll = TuvaluConfig.TUVALU_ATOLLS.find(a => 
    location.toLowerCase().includes(a.name.toLowerCase()) ||
    a.name.toLowerCase().includes(location.toLowerCase())
  );

  const dataset = atoll ? atoll.dataset : 'tuvalu_forecast';
  const atollName = atoll ? atoll.name : location;

  // THREDDS WMS GetMap base URL
  const baseUrl = TuvaluConfig.WMS_BASE_URL;
  
  // Generate forecast image URLs for different variables
  const variables = [
    {
      name: 'Significant Wave Height',
      layer: `${dataset}/hs`,
      style: 'boxfill/rainbow',
      colorscalerange: '0,6',
      unit: 'm',
      description: 'Maximum wave height forecast'
    },
    {
      name: 'Mean Wave Period',
      layer: `${dataset}/tm02`,
      style: 'boxfill/rainbow',
      colorscalerange: '0,20',
      unit: 's',
      description: 'Average wave period forecast'
    },
    {
      name: 'Peak Wave Period',
      layer: `${dataset}/tpeak`,
      style: 'boxfill/rainbow',
      colorscalerange: '0,13.68',
      unit: 's',
      description: 'Peak wave period forecast'
    },
    {
      name: 'Wave Direction',
      layer: `${dataset}/dirm`,
      style: 'vector/rainbow',
      colorscalerange: '0,360',
      unit: '°',
      description: 'Mean wave direction forecast'
    }
  ];

  // Get bbox for the atoll (or use Tuvalu bounds if not found)
  let bbox;
  if (atoll) {
    // Create a small bbox around the atoll (approximately 0.5 degrees)
    const padding = 0.25;
    bbox = `${atoll.lon - padding},${atoll.lat - padding},${atoll.lon + padding},${atoll.lat + padding}`;
  } else {
    // Use full Tuvalu bounds
    bbox = '176.0,-10.8,180.0,-5.6';
  }

  return variables.map(v => ({
    title: v.name,
    description: v.description,
    url: `${baseUrl}?SERVICE=WMS&VERSION=1.3.0&REQUEST=GetMap&LAYERS=${v.layer}&CRS=EPSG:4326&BBOX=${bbox}&WIDTH=800&HEIGHT=600&FORMAT=image/png&STYLES=${v.style}&COLORSCALERANGE=${v.colorscalerange}&TRANSPARENT=true`,
    legendUrl: `${baseUrl}?REQUEST=GetLegendGraphic&LAYER=${v.layer}&PALETTE=${v.style}&COLORBARONLY=true&WIDTH=60&HEIGHT=320&COLORSCALERANGE=${v.colorscalerange}&NUMCOLORBANDS=200&VERTICAL=true&TRANSPARENT=true&FORMAT=image/png`,
    unit: v.unit,
    location: atollName
  }));
};

/**
 * ForecastImagePopup Component
 */
const ForecastImagePopup = ({ show, onHide, location, inundationPoint }) => {
  const [forecastImages, setForecastImages] = useState([]);
  const [activeIndex, setActiveIndex] = useState(0);
  const [imageLoading, setImageLoading] = useState({});
  const [imageErrors, setImageErrors] = useState({});

  useEffect(() => {
    if (show && location) {
      const images = getForecastImages(location);
      setForecastImages(images);
      setActiveIndex(0);
      setImageLoading({});
      setImageErrors({});
    }
  }, [show, location]);

  const handleImageLoad = (index) => {
    setImageLoading(prev => ({ ...prev, [index]: false }));
  };

  const handleImageError = (index) => {
    setImageLoading(prev => ({ ...prev, [index]: false }));
    setImageErrors(prev => ({ ...prev, [index]: true }));
  };

  const handleSelect = (selectedIndex) => {
    setActiveIndex(selectedIndex);
  };

  if (!location) return null;

  return (
    <Modal 
      show={show} 
      onHide={onHide} 
      size="xl" 
      centered
      className="forecast-image-modal"
    >
      <Modal.Header closeButton>
        <Modal.Title>
          <div className="modal-title-content">
            <span className="location-icon">📊</span>
            <div>
              <div className="location-name">{location}</div>
              <div className="location-subtitle">Marine Forecast Images</div>
            </div>
          </div>
        </Modal.Title>
      </Modal.Header>
      
      <Modal.Body>
        {inundationPoint && (
          <Alert variant="info" className="mb-3">
            <div className="d-flex justify-content-between align-items-center">
              <div>
                <strong>Current Inundation:</strong> {inundationPoint.depth?.toFixed(2)} m
              </div>
              <div>
                <span 
                  className="badge" 
                  style={{ 
                    backgroundColor: inundationPoint.color,
                    fontSize: '0.9em',
                    padding: '0.5em 1em'
                  }}
                >
                  {inundationPoint.riskLevel}
                </span>
              </div>
            </div>
          </Alert>
        )}

        {inundationPoint?.imageUrl && (
          <div className="forecast-image-container mb-4">
            <div className="image-header">
              <h5>Primary Forecast Image</h5>
              <p className="text-muted">
                High-resolution inundation outlook provided by SPC GEM-THREDDS.
              </p>
            </div>
            <div className="image-content">
              <div className="image-with-legend">
                <img
                  src={inundationPoint.imageUrl}
                  alt={`Primary forecast for ${location}`}
                  className="forecast-map-image"
                  style={{ display: 'block' }}
                />
              </div>
            </div>
            <div className="text-center mt-3">
              <Button
                variant="outline-primary"
                size="sm"
                href={inundationPoint.imageUrl}
                target="_blank"
                rel="noreferrer"
              >
                Open Full Resolution Image
              </Button>
            </div>
          </div>
        )}

        {forecastImages.length === 0 ? (
          <div className="text-center py-5">
            <Spinner animation="border" role="status">
              <span className="visually-hidden">Loading forecast images...</span>
            </Spinner>
            <p className="mt-3">Loading forecast images...</p>
          </div>
        ) : (
          <Carousel 
            activeIndex={activeIndex} 
            onSelect={handleSelect}
            interval={null}
            className="forecast-carousel"
          >
            {forecastImages.map((image, index) => (
              <Carousel.Item key={index}>
                <div className="forecast-image-container">
                  <div className="image-header">
                    <h5>{image.title}</h5>
                    <p className="text-muted">{image.description}</p>
                  </div>
                  
                  <div className="image-content">
                    {imageLoading[index] !== false && (
                      <div className="image-loader">
                        <Spinner animation="border" />
                        <p>Loading image...</p>
                      </div>
                    )}
                    
                    {imageErrors[index] ? (
                      <Alert variant="warning">
                        <strong>Image unavailable</strong>
                        <p>The forecast image could not be loaded. This may indicate:</p>
                        <ul>
                          <li>No current forecast data available for {image.location}</li>
                          <li>Network connectivity issues</li>
                          <li>THREDDS server maintenance</li>
                        </ul>
                      </Alert>
                    ) : (
                      <div className="image-with-legend">
                        <img
                          src={image.url}
                          alt={`${image.title} for ${image.location}`}
                          className="forecast-map-image"
                          onLoad={() => handleImageLoad(index)}
                          onError={() => handleImageError(index)}
                          style={{ 
                            display: imageLoading[index] === false ? 'block' : 'none'
                          }}
                        />
                        {imageLoading[index] === false && !imageErrors[index] && (
                          <div className="legend-container">
                            <img
                              src={image.legendUrl}
                              alt={`Legend for ${image.title}`}
                              className="legend-image"
                            />
                            <div className="legend-unit">{image.unit}</div>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              </Carousel.Item>
            ))}
          </Carousel>
        )}

        <div className="carousel-indicators-custom mt-3">
          {forecastImages.map((image, index) => (
            <Button
              key={index}
              variant={activeIndex === index ? 'primary' : 'outline-secondary'}
              size="sm"
              onClick={() => setActiveIndex(index)}
              className="mx-1"
            >
              {image.title}
            </Button>
          ))}
        </div>
      </Modal.Body>

      <Modal.Footer>
        <div className="w-100 d-flex justify-content-between align-items-center">
          <small className="text-muted">
            Source: THREDDS ncWMS Server • SPC GEM-THREDDS
          </small>
          <Button variant="secondary" onClick={onHide}>
            Close
          </Button>
        </div>
      </Modal.Footer>
    </Modal>
  );
};

export default ForecastImagePopup;
