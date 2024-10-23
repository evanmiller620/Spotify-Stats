import React from 'react';
import { render, screen } from '@testing-library/react';
import Songs from './Songs';
import Home from './Home';
import About from './About';

test('renders songs', () => {
  render(<Songs />);
});

test('renders home', () => {
  render(<Home />);
});


test('renders about', () => {
  render(<About />);
});
