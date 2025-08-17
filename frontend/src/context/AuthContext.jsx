import React, { createContext, useState, useEffect } from 'react'
import { api } from '../utils/api'

export const AuthContext = createContext()

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null)

  useEffect(() => {
    const token = localStorage.getItem('token')
    if (token) {
      setUser({ token })
    }
  }, [])

  const login = async (email, password) => {
    const res = await api.post('/api/login', { email, password })
    localStorage.setItem('token', res.data.token)
    setUser({ token: res.data.token })
  }

  const signup = async (email, password) => {
    const res = await api.post('/api/signup', { email, password })
    localStorage.setItem('token', res.data.token)
    setUser({ token: res.data.token })
  }

  const logout = () => {
    localStorage.removeItem('token')
    setUser(null)
  }

  return (
    <AuthContext.Provider value={{ user, login, signup, logout }}>
      {children}
    </AuthContext.Provider>
  )
}