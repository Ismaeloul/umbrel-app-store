import { Navigate, Route, Routes } from 'react-router-dom'

import { Cuenta } from './pages/Cuenta'
import { Panel } from './pages/Panel'

export function App() {
  return (
    <Routes>
      <Route path="/" element={<Panel />} />
      <Route path="/cuentas/:id" element={<Cuenta />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}
