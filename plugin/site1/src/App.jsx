import React from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import Header from './components/header';
import Home from './pages/Home';
import Link1 from './pages/Link1';
import Link2 from './pages/Link2';
import Link3 from './pages/Link3';
import './App.css';

function App() {
  return (
    <Router basename={process.env.PUBLIC_URL}>
      <div style={{ 
        backgroundColor: 'var(--color-background)', 
        minHeight: '100vh',
        transition: 'background-color 0.3s ease'
      }}>
        <Header />
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/link1" element={<Link1 />} />
          <Route path="/link2" element={<Link2 />} />
          <Route path="/link3" element={<Link3 />} />
          {/* Redirect any unknown routes to home */}
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </div>
    </Router>
  );
}

export default App;
