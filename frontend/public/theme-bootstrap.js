(function applyInitialTheme() {
  var root = document.documentElement
  var theme = 'light'

  try {
    var rawDevice = localStorage.getItem('businessos_device_settings') || ''
    if (rawDevice) {
      var parsedDevice = JSON.parse(rawDevice)
      if (parsedDevice && typeof parsedDevice.theme === 'string') {
        theme = parsedDevice.theme.trim().toLowerCase() || theme
      }
    }

    if (theme === 'light') {
      var legacyTheme = String(localStorage.getItem('businessos_theme') || '').trim().toLowerCase()
      if (legacyTheme) theme = legacyTheme
    }

    if (theme === 'light') {
      var legacySettings = localStorage.getItem('businessos_settings') || ''
      if (legacySettings) {
        var parsedLegacy = JSON.parse(legacySettings)
        if (parsedLegacy && typeof parsedLegacy.theme === 'string') {
          theme = parsedLegacy.theme.trim().toLowerCase() || theme
        }
      }
    }
  } catch (_) {}

  if (theme === 'dark') {
    root.classList.add('dark')
    root.style.colorScheme = 'dark'
  } else {
    root.classList.remove('dark')
    root.style.colorScheme = 'light'
  }
})()
