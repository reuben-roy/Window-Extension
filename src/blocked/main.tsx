import React from 'react';
import { createRoot } from 'react-dom/client';
import '../assets/styles/index.css';
import Blocked from './Blocked';

const root = createRoot(document.getElementById('root')!);
root.render(
  <React.StrictMode>
    <Blocked />
  </React.StrictMode>,
);
