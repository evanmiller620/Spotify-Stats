import React, { useState } from 'react';
import ReactDOM from 'react-dom/client';
import About from './About';
import Songs from './Songs';
import Graphs from './Graphs';
import './index.css';
import reportWebVitals from './reportWebVitals';

interface NavButtonProps {
  active: boolean;  // active is a boolean
  onClick: () => void; // onClick is a function with no parameters returning void
  children: React.ReactNode; // children can be any valid React node
}

const NavButton: React.FC<NavButtonProps> = ({ active, onClick, children }) => (
  <button
    onClick={onClick}
    className={`nav-button ${active ? 'active' : ''}`}
  >
    {children}
  </button>
);

const App = () => {
  const [currentPage, setCurrentPage] = useState('songs');

  const renderPage = () => {
    switch (currentPage) {
      case 'songs':
        return <Songs />;
      case 'about':
        return <About />;
      case 'graphs':
        return <Graphs />;
      default:
        return <Songs />;
    }
  };

  return (
    <div className="app-container">
      <div className="side-navigation">
        <div className="logo">
          <h1>S</h1>
        </div>
        <nav className="nav-buttons">
          <NavButton
            active={currentPage === 'songs'}
            onClick={() => setCurrentPage('songs')}
          >
            Songs
          </NavButton>
          <NavButton
            active={currentPage === 'graphs'}
            onClick={() => setCurrentPage('graphs')}
          >
            Graphs
          </NavButton>
          <NavButton
            active={currentPage === 'about'}
            onClick={() => setCurrentPage('about')}
          >
            About
          </NavButton>
        </nav>
      </div>
      <main className="main-content">
        {renderPage()}
      </main>
    </div>
  );
};

const rootElement = document.getElementById('root');
if (rootElement) {
  const root = ReactDOM.createRoot(rootElement);
  root.render(
    <React.StrictMode>
      <App />
    </React.StrictMode>
  );
} else {
  console.error("Could not find root element with ID 'root'");
}

reportWebVitals(console.log);