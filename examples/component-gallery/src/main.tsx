import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@siwc/react/styles.css';
import './gallery.css';
import { Gallery } from './Gallery';

const root = document.getElementById('root');
if (!root) throw new Error('The component gallery root is missing.');

createRoot(root).render(<StrictMode><Gallery /></StrictMode>);
