import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import './styles.css'
import { CapturePage } from './views/CapturePage'
import { DashboardPage } from './views/DashboardPage'
import { ReviewPage } from './views/ReviewPage'
import { SettingsPage } from './views/SettingsPage'

function Root() {
  const isMobile = window.innerWidth < 768
  return <Navigate to={isMobile ? '/capture' : '/dashboard'} replace />
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Root />} />
        <Route path="/capture" element={<CapturePage />} />
        <Route path="/dashboard" element={<DashboardPage />} />
        <Route path="/review/:listingId" element={<ReviewPage />} />
        <Route path="/settings" element={<SettingsPage />} />
      </Routes>
    </BrowserRouter>
  </React.StrictMode>
)
