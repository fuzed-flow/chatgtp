import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.jsx'
import { registerAppServiceWorker } from './lib/installApp.js'
import './index.css' 

if (typeof window !== 'undefined') {
  window.addEventListener('load', registerAppServiceWorker, { once: true })
}

ReactDOM.createRoot(document.getElementById('root')).render(
  // Temporarily removed <React.StrictMode> to prevent Supabase double-firing
  <App />
)
