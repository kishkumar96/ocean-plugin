import React, { useEffect } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import Home from './pages/Home';
import './App.css';
import Header from './components/header';
import ErrorBoundary from './components/ErrorBoundary';
import './utils/NotificationManager'; // Initialize notification system
import { initConsoleErrorSuppressor } from './utils/ConsoleErrorSuppressor';
import logger from './utils/logger';

function App() {
  useEffect(() => {
    logger.info('APP', 'Tuvalu Multi-Island Widget initialized');
    
    // Initialize console error suppressor for known WMS server issues
    initConsoleErrorSuppressor();
  }, []);

  return (
    <ErrorBoundary userMessage="The Tuvalu Marine Forecast application encountered an unexpected error. Please try refreshing the page.">
      <Router 
        basename={process.env.NODE_ENV === 'development' ? '/' : process.env.PUBLIC_URL}
        future={{
          v7_startTransition: true,
          v7_relativeSplatPath: true
        }}
      >
        <div style={{ 
          backgroundColor: 'var(--color-background)', 
          minHeight: '100vh',
          transition: 'background-color 0.3s ease'
        }}>
          <Header />
          <Routes>
            <Route path="/" element={<Home widgetData={null} validCountries={['TUV']} />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </div>
      </Router>
    </ErrorBoundary>
  );
}

export default App;
