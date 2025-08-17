import React from 'react'
import { createRoot } from 'react-dom/client'
import Root from './Root.jsx'
import ErrorBoundary from './components/ErrorBoundary.jsx'
import { BrowserRouter } from 'react-router-dom'
import { AuthProvider } from './context/AuthContext'
import '@mantine/core/styles.css'
import './styles/index.css'
import { MantineProvider } from '@mantine/core'

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <MantineProvider defaultColorScheme="dark">
      <ErrorBoundary>
        <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
          <AuthProvider>
            <Root />
          </AuthProvider>
        </BrowserRouter>
      </ErrorBoundary>
    </MantineProvider>
  </React.StrictMode>
)