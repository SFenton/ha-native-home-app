/// <reference types="vite/client" />
import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './styles.css';
import './NativeChrome.css';
import './DeviceInteraction.css';
import './mobile-editor.css';

const root = createRoot(document.getElementById('root')!);
// Development only: the 2.0 preview story page, until the workspace shell hosts the preview.
if (import.meta.env.DEV && new URLSearchParams(location.search).has('preview2')) void import('./preview2/Harness').then(({ default: Harness }) => root.render(<Harness />));
else root.render(<React.StrictMode><App /></React.StrictMode>);
