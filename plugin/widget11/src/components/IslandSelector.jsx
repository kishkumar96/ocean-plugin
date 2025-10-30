/**
 * World-Class Island Selector Component
 * 
 * Provides sophisticated island selection and comparison UI
 */

import React, { useState, useEffect } from 'react';
import PropTypes from 'prop-types';
import { Dropdown, Button, Badge, ListGroup, Card } from 'react-bootstrap';
import multiIslandManager from '../services/MultiIslandManager';
import logger from '../utils/logger';
import './IslandSelector.css';

const IslandSelector = ({ onIslandChange, onComparisonChange, currentIsland }) => {
  const [islands, setIslands] = useState([]);
  const [selectedIsland, setSelectedIsland] = useState(null);
  const [comparisonMode, setComparisonMode] = useState(false);
  const [comparisonIslands, setComparisonIslands] = useState([]);
  const [showProfiles, setShowProfiles] = useState(false);

  useEffect(() => {
    const allIslands = multiIslandManager.getAllIslands();
    setIslands(allIslands);
    
    if (currentIsland) {
      const island = multiIslandManager.getIslandByName(currentIsland);
      setSelectedIsland(island);
    }
  }, [currentIsland]);

  const handleIslandSelect = (island) => {
    multiIslandManager.setCurrentIsland(island.name);
    setSelectedIsland(island);
    logger.island(island.name, 'Selected');
    
    if (onIslandChange) {
      onIslandChange(island);
    }
  };

  const handleToggleComparison = () => {
    const newMode = multiIslandManager.toggleComparisonMode();
    setComparisonMode(newMode);
    
    if (!newMode) {
      multiIslandManager.clearComparison();
      setComparisonIslands([]);
    }
  };

  const handleAddToComparison = (island) => {
    if (multiIslandManager.addToComparison(island.name)) {
      setComparisonIslands([...multiIslandManager.getComparisonIslands()]);
      
      if (onComparisonChange) {
        onComparisonChange(multiIslandManager.getComparisonIslands());
      }
    }
  };

  const handleRemoveFromComparison = (island) => {
    if (multiIslandManager.removeFromComparison(island.name)) {
      setComparisonIslands([...multiIslandManager.getComparisonIslands()]);
      
      if (onComparisonChange) {
        onComparisonChange(multiIslandManager.getComparisonIslands());
      }
    }
  };

  const getRegionColor = (lat) => {
    if (lat > -7.0) return '#28a745'; // North - Green
    if (lat > -9.0) return '#ffc107'; // Central - Yellow
    return '#007bff'; // South - Blue
  };

  const getRegionName = (lat) => {
    if (lat > -7.0) return 'North';
    if (lat > -9.0) return 'Central';
    return 'South';
  };

  return (
    <div className="island-selector-container">
      {/* Main Island Selector */}
      <Dropdown className="island-dropdown">
        <Dropdown.Toggle variant="primary" id="island-selector">
          🏝️ {selectedIsland ? selectedIsland.name : 'Select Island'}
          {selectedIsland?.isCapital && <Badge bg="warning" className="ms-2">Capital</Badge>}
        </Dropdown.Toggle>

        <Dropdown.Menu>
          <Dropdown.Header>Select Atoll</Dropdown.Header>
          {islands.map((island) => (
            <Dropdown.Item
              key={island.name}
              onClick={() => handleIslandSelect(island)}
              active={selectedIsland?.name === island.name}
            >
              <div className="d-flex justify-content-between align-items-center">
                <span>
                  {island.name}
                  {island.isCapital && <Badge bg="warning" size="sm" className="ms-2">Capital</Badge>}
                </span>
                <Badge 
                  bg="light" 
                  text="dark"
                  style={{ 
                    backgroundColor: getRegionColor(island.lat),
                    color: 'white'
                  }}
                >
                  {getRegionName(island.lat)}
                </Badge>
              </div>
            </Dropdown.Item>
          ))}
          <Dropdown.Divider />
          <Dropdown.Item onClick={() => setShowProfiles(!showProfiles)}>
            📊 {showProfiles ? 'Hide' : 'Show'} Island Profiles
          </Dropdown.Item>
        </Dropdown.Menu>
      </Dropdown>

      {/* Comparison Mode Toggle */}
      <Button
        variant={comparisonMode ? 'success' : 'outline-secondary'}
        size="sm"
        className="ms-2"
        onClick={handleToggleComparison}
      >
        {comparisonMode ? '✓ Comparison ON' : 'Compare Islands'}
      </Button>

      {/* Comparison Selection */}
      {comparisonMode && (
        <div className="comparison-panel mt-3">
          <Card>
            <Card.Header>
              <strong>Island Comparison</strong>
              <Badge bg="info" className="ms-2">{comparisonIslands.length} selected</Badge>
            </Card.Header>
            <Card.Body>
              <ListGroup variant="flush">
                {comparisonIslands.map((island) => (
                  <ListGroup.Item 
                    key={island.name}
                    className="d-flex justify-content-between align-items-center"
                  >
                    <span>{island.name}</span>
                    <Button
                      variant="outline-danger"
                      size="sm"
                      onClick={() => handleRemoveFromComparison(island)}
                    >
                      Remove
                    </Button>
                  </ListGroup.Item>
                ))}
              </ListGroup>

              {comparisonIslands.length < islands.length && (
                <>
                  <Dropdown.Divider />
                  <Dropdown className="mt-2">
                    <Dropdown.Toggle variant="outline-primary" size="sm">
                      + Add Island to Compare
                    </Dropdown.Toggle>
                    <Dropdown.Menu>
                      {islands
                        .filter(i => !comparisonIslands.find(ci => ci.name === i.name))
                        .map((island) => (
                          <Dropdown.Item
                            key={island.name}
                            onClick={() => handleAddToComparison(island)}
                          >
                            {island.name}
                          </Dropdown.Item>
                        ))}
                    </Dropdown.Menu>
                  </Dropdown>
                </>
              )}
            </Card.Body>
          </Card>
        </div>
      )}

      {/* Island Profiles */}
      {showProfiles && selectedIsland && (
        <div className="island-profile mt-3">
          <Card>
            <Card.Header>
              <strong>{selectedIsland.name} Profile</strong>
            </Card.Header>
            <Card.Body>
              <p><strong>Coordinates:</strong> {selectedIsland.lat.toFixed(4)}°S, {selectedIsland.lon.toFixed(4)}°E</p>
              <p><strong>Region:</strong> {getRegionName(selectedIsland.lat)}</p>
              <p><strong>Dataset:</strong> {selectedIsland.dataset}</p>
              {selectedIsland.isCapital && (
                <Badge bg="warning">Capital of Tuvalu</Badge>
              )}
            </Card.Body>
          </Card>
        </div>
      )}
    </div>
  );
};

IslandSelector.propTypes = {
  onIslandChange: PropTypes.func,
  onComparisonChange: PropTypes.func,
  currentIsland: PropTypes.string
};

export default IslandSelector;
