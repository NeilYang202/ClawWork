import { useEffect } from 'react'
import { useUiStore } from '../stores/uiStore'

export function useTheme() {
  const theme = useUiStore((s) => s.theme)
  const setTheme = useUiStore((s) => s.setTheme)

  // Load persisted theme on mount
  useEffect(() => {
    window.clawwork.getSettings().then((settings) => {
      if (settings?.theme) {
        setTheme(settings.theme)
      }
    })
  }, [setTheme])

  // Apply theme to DOM and persist on change
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme)
    window.clawwork.updateSettings({ theme })
  }, [theme])
}
