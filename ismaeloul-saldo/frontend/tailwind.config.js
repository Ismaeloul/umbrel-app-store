/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // Oscuro por defecto y de un solo tema: la app no conmuta.
        fondo: '#0A0C0F',
        superficie: '#13171C',
        elevada: '#1B2027',
        borde: '#252C35',
        texto: '#E9EEF4',
        tenue: '#8A97A6',
        apagado: '#5C6875',
        menta: '#4FE0A0',
        ambar: '#F2B33D',
        rojo: '#FF6B6B',
      },
      fontFamily: {
        sans: [
          'ui-sans-serif',
          'system-ui',
          '-apple-system',
          'Segoe UI',
          'Roboto',
          'Helvetica Neue',
          'Arial',
          'sans-serif',
        ],
      },
      borderRadius: {
        tarjeta: '1rem',
      },
      keyframes: {
        brillo: {
          '0%': { backgroundPosition: '-200% 0' },
          '100%': { backgroundPosition: '200% 0' },
        },
      },
      animation: {
        brillo: 'brillo 1.4s linear infinite',
      },
    },
  },
  plugins: [],
}
