import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

// Development-ல SW disable பண்ணு
if ('serviceWorker' in navigator) {
  if (import.meta.env.PROD) {
    // Production-ல மட்டும் SW register பண்ணு
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('/sw.js')
        .then(() => console.log('SW registered!'))
        .catch(() => console.log('SW failed'));
    });
  } else {
    // Development-ல SW unregister பண்ணு
    navigator.serviceWorker.getRegistrations().then((registrations) => {
      registrations.forEach((registration) => registration.unregister());
    });
  }
}