import React from 'react';
import ExampleButtons from '../components/ExampleButtons';

export default function Home() {
  return (
    <div className="container mt-4">
      <div className="row">
        <div className="col-12">
          <h1 style={{ color: 'var(--color-text)' }}>Welcome</h1>
          <p style={{ color: 'var(--color-text)' }}>
            This is the main landing page.
            <ExampleButtons />
          </p>
        </div>
      </div>
    </div>
  );
}
