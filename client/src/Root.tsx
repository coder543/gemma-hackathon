import { useMemo } from 'react'
import { CssBaseline, ThemeProvider, createTheme, useMediaQuery } from '@mui/material'
import App from './App.tsx'

function Root() {
  const prefersDarkMode = useMediaQuery('(prefers-color-scheme: dark)')
  const theme = useMemo(
    () => createTheme({
      palette: {
        mode: prefersDarkMode ? 'dark' : 'light',
      },
      shape: {
        borderRadius: 6,
      },
    }),
    [prefersDarkMode],
  )

  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <App />
    </ThemeProvider>
  )
}

export default Root
