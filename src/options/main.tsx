import React from 'react';
import { createRoot } from 'react-dom/client';
import '../assets/styles/index.css';
import Options from './Options';

const root = createRoot(document.getElementById('root')!);
root.render(
  <React.StrictMode>
    <Options />
  </React.StrictMode>,
);
