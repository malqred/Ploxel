import React from 'react';
import { createRoot } from 'react-dom/client';
import './styles/tokens.css';
import './styles/base.css';
import './styles/controls.css';
import './styles/fields.css';
import './styles/overlays.css';
import './styles/screens.css';
import './styles/library.css';
import './styles/mods.css';
import './styles/console.css';
import './styles/settings.css';
import './styles/worlds.css';
import './styles/skins.css';
import './styles/home.css';
import './styles/assistant.css';
import './styles/tour.css';
import './styles/import.css';
import './styles/keybinds.css';
import './styles/backgrounds.css';
import './styles/generated-fonts.css';
import { App } from './App';
import { SettingsProvider } from './state/settings';
import { ToastProvider } from './state/toast';
import { LocalizationLayer } from './ui/LocalizationLayer';

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <SettingsProvider>
      <LocalizationLayer>
        <ToastProvider>
          <App />
        </ToastProvider>
      </LocalizationLayer>
    </SettingsProvider>
  </React.StrictMode>
);