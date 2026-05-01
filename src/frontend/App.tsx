import { Navigate, Route, Routes } from 'react-router-dom'
import AuthGuard from './components/AuthGuard'
import AdminDashboardPage from './pages/AdminDashboardPage'
import CreateUserPage from './pages/CreateUserPage'
import DisplayerPage from './pages/DisplayerPage'
import LoginPage from './pages/LoginPage'
import ModerationPage from './pages/ModerationPage'
import PasswordChangePage from './pages/PasswordChangePage'
import UploadConfirmationPage from './pages/UploadConfirmationPage'
import UploadPage from './pages/UploadPage'

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Navigate to="/upload" replace />} />
      <Route path="/upload" element={<UploadPage />} />
      <Route path="/upload/confirmation" element={<UploadConfirmationPage />} />
      <Route path="/login" element={<LoginPage />} />

      <Route
        path="/admin"
        element={
          <AuthGuard>
            <AdminDashboardPage />
          </AuthGuard>
        }
      />
      <Route
        path="/admin/moderation"
        element={
          <AuthGuard>
            <ModerationPage />
          </AuthGuard>
        }
      />
      <Route
        path="/admin/displayer"
        element={
          <AuthGuard>
            <DisplayerPage />
          </AuthGuard>
        }
      />
      <Route
        path="/admin/users/new"
        element={
          <AuthGuard>
            <CreateUserPage />
          </AuthGuard>
        }
      />
      <Route
        path="/admin/password"
        element={
          <AuthGuard>
            <PasswordChangePage />
          </AuthGuard>
        }
      />
      <Route path="*" element={<Navigate to="/upload" replace />} />
    </Routes>
  )
}
