# Template Site 1

A React application with Bootstrap, dark/light theme support, and React Router navigation.

## Quick Start

### Development
```bash
cd plugin/site1
npm start
```

### Production Build
```bash
npm run build
```

### Docker Deployment
```bash
# From root directory
docker-compose build
docker-compose up -d
```

## 📁 Project Structure

```
src/
├── components/
│   ├── header.jsx          # Navigation header with theme toggle
│   └── ThemeToggle.jsx     # Dark/light mode toggle component
├── pages/
│   ├── Home.jsx            # Landing page
│   ├── Link1.jsx           # First navigation page
│   ├── Link2.jsx           # Second navigation page
│   └── Link3.jsx           # Third navigation page
├── App.jsx                 # Main app with routing
├── App.css                 # Theme variables and styling
└── index.jsx               # App entry point
```

## ➕ How to Add a New Page

### Step 1: Create the Page Component

Create a new file in `src/pages/` directory:

```jsx
// src/pages/NewPage.jsx
import React from 'react';

export default function NewPage() {
  return (
    <div className="container mt-4">
      <div className="row">
        <div className="col-12">
          <h1 style={{ color: 'var(--color-text)' }}>New Page</h1>
          <p style={{ color: 'var(--color-text)' }}>
            This is your new page content.
          </p>
        </div>
      </div>
    </div>
  );
}
```

### Step 2: Add Route to App.jsx

Import and add the route in `src/App.jsx`:

```jsx
import NewPage from './pages/NewPage';

// Inside the Routes component
<Routes>
  <Route path="/" element={<Home />} />
  <Route path="/link1" element={<Link1 />} />
  <Route path="/link2" element={<Link2 />} />
  <Route path="/link3" element={<Link3 />} />
  <Route path="/newpage" element={<NewPage />} /> {/* Add this line */}
</Routes>
```

### Step 3: Add Navigation Link

Add the link to `src/components/header.jsx`:

```jsx
import { Link } from 'react-router-dom';

// Inside the navigation ul
<ul className="navbar-nav ms-auto mb-2 mb-lg-0">
  <li className="nav-item">
    <Link className="nav-link" to="/link1" style={{ color: 'var(--color-text)' }}>
      Link 1
    </Link>
  </li>
  {/* Add your new link */}
  <li className="nav-item">
    <Link className="nav-link" to="/newpage" style={{ color: 'var(--color-text)' }}>
      New Page
    </Link>
  </li>
</ul>
```

## 🎨 CSS for Dark/Light Mode

### Theme Variables System

The app uses CSS custom properties (variables) for consistent theming. All theme variables are defined in `src/App.css`:

```css
:root {
  /* Light mode palette */
  --color-primary: #2563eb;
  --color-secondary: #64748b;
  --color-accent: #f59e42;
  --color-background: #f8fafc;
  --color-surface: #ffffff;
  --color-text: #1e293b;
  --color-success: #22c55e;
  --color-warning: #facc15;
  --color-error: #ef4444;
  --color-info: #0ea5e9;
  --color-border: #e2e8f0;
  --card-shadow: 0 2px 8px rgba(0,0,0,0.10);
  --card-shadow-hover: 0 4px 16px rgba(0,0,0,0.18);
}

body.dark-mode {
  /* Dark mode palette */
  --color-primary: #60a5fa;
  --color-secondary: #a1a1aa;
  --color-accent: #fbbf24;
  --color-background: #2e2f33;
  --color-surface: #3f4854;
  --color-text: #f1f5f9;
  --color-border: #44454a;
  --color-success: #4ade80;
  --color-warning: #fde047;
  --color-error: #f87171;
  --color-info: #38bdf8;
  --card-shadow: 0 2px 8px rgba(0,0,0,0.32);
  --card-shadow-hover: 0 4px 16px rgba(0,0,0,0.44);
}
```

### Method 1: Theme-Aware CSS Classes (Recommended)

The easiest way to create theme-aware components is using the pre-built CSS classes:

#### Button Classes
```jsx
// Automatically adapts to dark/light theme
<button className="btn btn-theme-primary">Primary Button</button>
<button className="btn btn-theme-secondary">Secondary Button</button>
<button className="btn btn-theme-outline">Outline Button</button>
```

#### Card Classes
```jsx
// Card that automatically adapts to theme
<div className="card card-theme">
  <div className="card-body">
    <h5 className="text-theme-primary">Title</h5>
    <p className="text-theme-body">Content</p>
  </div>
</div>
```

#### Text Classes
```jsx
<h1 className="text-theme-body">Main Heading</h1>
<h2 className="text-theme-primary">Colored Heading</h2>
<p className="text-theme-secondary">Secondary Text</p>
```

#### Background Classes
```jsx
<div className="bg-theme-surface">Surface Background</div>
<div className="bg-theme-background">Page Background</div>
```

#### Alert Classes
```jsx
<div className="alert alert-theme-info">Info Alert</div>
<div className="alert alert-theme-success">Success Alert</div>
<div className="alert alert-theme-warning">Warning Alert</div>
<div className="alert alert-theme-error">Error Alert</div>
```

###  Method 2: Inline Styles with CSS Variables

Use CSS variables directly in your style props:

```jsx
<button 
  className="btn"
  style={{
    backgroundColor: 'var(--color-primary)',
    borderColor: 'var(--color-primary)',
    color: 'white'
  }}
>
  Custom Button
</button>

<div 
  style={{
    backgroundColor: 'var(--color-surface)',
    border: `1px solid var(--color-border)`,
    color: 'var(--color-text)'
  }}
>
  Custom Container
</div>
```

###  Method 3: Conditional Styling with JavaScript

Detect the current theme and apply different styles:

```jsx
const isDarkMode = document.body.classList.contains('dark-mode');

<button 
  className="btn"
  style={{
    backgroundColor: isDarkMode ? '#60a5fa' : '#2563eb',
    borderColor: isDarkMode ? '#60a5fa' : '#2563eb',
    color: 'white'
  }}
>
  Conditional Button
</button>
```

###  Method 4: React Hook for Theme Detection

Create a custom hook for theme detection:

```jsx
// hooks/useTheme.js
import { useState, useEffect } from 'react';

export function useTheme() {
  const [isDark, setIsDark] = useState(false);

  useEffect(() => {
    const checkTheme = () => {
      setIsDark(document.body.classList.contains('dark-mode'));
    };
    
    checkTheme();
    // Listen for theme changes
    const observer = new MutationObserver(checkTheme);
    observer.observe(document.body, { attributes: true, attributeFilter: ['class'] });
    
    return () => observer.disconnect();
  }, []);

  return { isDark, isLight: !isDark };
}
```

Then use it in your components:

```jsx
import { useTheme } from '../hooks/useTheme';

function MyComponent() {
  const { isDark } = useTheme();
  
  return (
    <button 
      className="btn"
      style={{
        backgroundColor: isDark ? '#60a5fa' : '#2563eb',
        color: 'white'
      }}
    >
      Theme-Aware Button
    </button>
  );
}
```

### Available Theme Classes

| Class | Purpose | Example |
|-------|---------|---------|
| `btn-theme-primary` | Primary button | `<button className="btn btn-theme-primary">` |
| `btn-theme-secondary` | Secondary button | `<button className="btn btn-theme-secondary">` |
| `btn-theme-outline` | Outline button | `<button className="btn btn-theme-outline">` |
| `card-theme` | Theme-aware card | `<div className="card card-theme">` |
| `text-theme-primary` | Primary text color | `<h1 className="text-theme-primary">` |
| `text-theme-secondary` | Secondary text color | `<p className="text-theme-secondary">` |
| `text-theme-body` | Body text color | `<p className="text-theme-body">` |
| `bg-theme-surface` | Surface background | `<div className="bg-theme-surface">` |
| `bg-theme-background` | Page background | `<div className="bg-theme-background">` |
| `border-theme` | Theme border | `<div className="border border-theme">` |
| `alert-theme-info` | Info alert | `<div className="alert alert-theme-info">` |
| `alert-theme-success` | Success alert | `<div className="alert alert-theme-success">` |
| `alert-theme-warning` | Warning alert | `<div className="alert alert-theme-warning">` |
| `alert-theme-error` | Error alert | `<div className="alert alert-theme-error">` |

### How to Use Theme Variables

#### 1. Text Colors
```jsx
// Use for headings, paragraphs, labels
<h1 style={{ color: 'var(--color-text)' }}>Title</h1>
<p style={{ color: 'var(--color-text)' }}>Content</p>
```

#### 2. Background Colors
```jsx
// Use for containers, cards, sections
<div style={{ backgroundColor: 'var(--color-surface)' }}>
  Content
</div>
```

#### 3. Primary Colors
```jsx
// Use for buttons, links, highlights
<button style={{ 
  backgroundColor: 'var(--color-primary)', 
  color: 'white' 
}}>
  Click me
</button>
```

#### 4. Border Colors
```jsx
// Use for borders, dividers
<div style={{ 
  border: `1px solid var(--color-border)` 
}}>
  Content
</div>
```

#### 5. Shadow Effects
```jsx
// Use for cards, elevated elements
<div style={{ 
  boxShadow: 'var(--card-shadow)' 
}}>
  Card content
</div>
```

### Creating Theme-Aware Components

#### Example: Custom Card Component
```jsx
import React from 'react';

export default function CustomCard({ title, children }) {
  return (
    <div className="card card-theme">
      <div className="card-body">
        <h5 className="card-title text-theme-primary">
          {title}
        </h5>
        <div className="text-theme-body">
          {children}
        </div>
      </div>
    </div>
  );
}
```

#### Example: Custom Button Component
```jsx
import React from 'react';

export default function CustomButton({ children, variant = 'primary', ...props }) {
  const getButtonClass = () => {
    switch (variant) {
      case 'primary':
        return 'btn btn-theme-primary';
      case 'secondary':
        return 'btn btn-theme-secondary';
      case 'outline':
        return 'btn btn-theme-outline';
      default:
        return 'btn btn-theme-primary';
    }
  };

  return (
    <button className={getButtonClass()} {...props}>
      {children}
    </button>
  );
}
```

### Adding New Theme Variables

To add new theme variables:

1. **Add to light mode** (`:root`):
```css
:root {
  /* Existing variables... */
  --color-new: #your-light-color;
}
```

2. **Add to dark mode** (`body.dark-mode`):
```css
body.dark-mode {
  /* Existing variables... */
  --color-new: #your-dark-color;
}
```

3. **Use in components**:
```jsx
<div style={{ color: 'var(--color-new)' }}>
  Content with new color
</div>
```

4. **Create a CSS class** (optional):
```css
.text-theme-new {
  color: var(--color-new) !important;
}
```
## Look at ExampleButtons.jsx for examples