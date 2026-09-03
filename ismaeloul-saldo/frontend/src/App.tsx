import { AnimatePresence } from 'framer-motion'
import { Navigate, Route, Routes, useLocation } from 'react-router-dom'

import { Cuenta } from './pages/Cuenta'
import { Panel } from './pages/Panel'

export function App() {
  const ubicacion = useLocation()

  // mode="wait": la pantalla vieja termina de salir antes de que entre la
  // nueva, para que no se solapen dos scrolls distintos.
  return (
    <AnimatePresence mode="wait" initial={false}>
      <Routes location={ubicacion} key={ubicacion.pathname}>
        <Route path="/" element={<Panel />} />
        <Route path="/cuentas/:id" element={<Cuenta />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </AnimatePresence>
  )
}
