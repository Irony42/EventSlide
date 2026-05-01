import { apiClient } from './client'

export interface SessionResponse {
  authenticated: boolean
  user?: { username: string; partyId: string }
}

export const getSession = () => apiClient.get<SessionResponse>('/api/session')

export const login = (username: string, password: string) =>
  apiClient.post<{ success: boolean }>('/api/login', { username, password })

export const logout = () => apiClient.post<{ success: boolean }>('/api/logout', {})

export const createUser = (username: string, password: string) =>
  apiClient.post<{ success: boolean; message: string }>('/api/register', { username, password })

export const changePassword = (password: string, newPassword: string, newPassword2: string) =>
  apiClient.post<{ success: boolean; message: string }>('/api/passwordChange', {
    password,
    newPassword,
    newPassword2
  })
