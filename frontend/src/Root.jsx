import React from 'react'
import { Routes, Route } from 'react-router-dom'
import App from './App.jsx'

export default function Root() {
  return (
    <Routes>
      <Route path="/*" element={<App />} />
    </Routes>
  )
}
