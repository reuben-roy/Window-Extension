import React from 'react';
import { createRoot } from 'react-dom/client';
import '../assets/styles/index.css';
import Popup from '../popup/Popup';

const isEmbedded = new URLSearchParams(window.location.search).has('embedded');

const root = createRoot(document.getElementById('root')!);
root.render(
  <React.StrictMode>
    <Popup mode="panel" isEmbedded={isEmbedded} />
  </React.StrictMode>,
);
