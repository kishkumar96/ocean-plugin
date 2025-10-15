import React from 'react';
import { NIUE_CONFIG } from '../config/NiueConfig';

const ModernHeader = () => {
  const [currentTime, setCurrentTime] = React.useState(new Date());

  React.useEffect(() => {
    const timer = setInterval(() => {
      setCurrentTime(new Date());
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  const formatDateTime = (date) => {
    // Format for Niue timezone (UTC-11)
    return date.toLocaleString('en-NU', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
      timeZone: 'Pacific/Niue'
    });
  };

  return (
    <nav style={{
      // Niue marine gradient - deeper blues reflecting Pacific waters
      background: 'linear-gradient(135deg, #0c4a6e 0%, #1e40af 30%, #0ea5e9 60%, #06b6d4 100%)',
      minHeight: '60px',
      padding: '0 30px',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      position: 'relative',
      zIndex: 1001,
      boxShadow: '0 2px 20px rgba(0,0,0,0.3)',
      borderBottom: '1px solid rgba(255,255,255,0.1)'
    }}>
      {/* Logo and Title */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: '15px'
      }}>
        <img 
          src={process.env.PUBLIC_URL + '/COSPPaC_white_crop2.png'} 
          alt="COSPPaC Logo" 
          height="35" 
          style={{ 
            filter: 'brightness(0) saturate(100%) invert(100%)',
            transition: 'filter 0.3s ease'
          }}
        />
        <div>
          <h1 style={{
            margin: 0,
            color: '#00d4ff',
            fontSize: '1.5rem',
            fontWeight: '700',
            textShadow: '0 2px 4px rgba(0,0,0,0.3)',
            background: 'linear-gradient(45deg, #00d4ff, #38bdf8)',
            WebkitBackgroundClip: 'text',
            WebkitTextFillColor: 'transparent',
            backgroundClip: 'text'
          }}>
            Niue Wave and Inundation Forecast System
          </h1>
          <p style={{
            margin: 0,
            color: 'rgba(255,255,255,0.8)',
            fontSize: '0.9rem',
            fontWeight: '300'
          }}>
            High Resolution Marine Forecasting • {NIUE_CONFIG.dataSources.primary.name} Data
          </p>
        </div>
      </div>

      {/* Controls */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: '20px'
      }}>
        {/* Connection Status with Niue flag colors inspiration */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <div style={{
            width: '8px',
            height: '8px',
            borderRadius: '50%',
            backgroundColor: '#10b981', // Green for active connection
            boxShadow: '0 0 6px rgba(16, 185, 129, 0.6)',
            animation: 'pulse 2s infinite'
          }}></div>
          <span style={{ fontSize: '0.8rem', color: 'rgba(255,255,255,0.7)' }}>Live</span>
          <span style={{ 
            fontSize: '0.8rem', 
            color: 'rgba(255,255,255,0.5)',
            marginLeft: '10px'
          }}>
            Niue Time: {formatDateTime(currentTime)}
          </span>
        </div>

        {/* Niue Status Indicator */}
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
          padding: '6px 12px',
          background: 'rgba(255,255,255,0.1)',
          borderRadius: '20px',
          backdropFilter: 'blur(10px)',
          border: '1px solid rgba(255,255,255,0.2)'
        }}>
          <span style={{
            fontSize: '0.75rem',
            color: 'rgba(255,255,255,0.9)',
            fontWeight: '500',
            textTransform: 'uppercase',
            letterSpacing: '0.5px'
          }}>
            🇳🇺 {NIUE_CONFIG.displayName}
          </span>
        </div>
      </div>

      {/* Add the pulse animation as a style tag */}
      <style dangerouslySetInnerHTML={{__html: `
        .pulse-dot {
          animation: pulse-animation 2s infinite;
        }
        @keyframes pulse-animation {
          0% { transform: scale(1); opacity: 1; }
          50% { transform: scale(1.2); opacity: 0.7; }
          100% { transform: scale(1); opacity: 1; }
        }
        
        /* Responsive design for mobile */
        @media (max-width: 768px) {
          nav h1 {
            font-size: 1.2rem !important;
          }
          nav p {
            font-size: 0.8rem !important;
          }
          nav > div:first-child {
            gap: 10px !important;
          }
          nav > div:last-child span {
            font-size: 0.7rem !important;
          }
        }
        
        @media (max-width: 480px) {
          nav h1 {
            font-size: 1rem !important;
          }
          nav p {
            display: none !important;
          }
          nav {
            padding: 0 15px !important;
          }
        }
      `}} />
    </nav>
  );
};

export default ModernHeader;