(function bootstrapBusinessOsShell() {
  var root = document.documentElement
  var theme = 'light'

  function isInjectedRuntimeNoise(message) {
    var text = String(message || '')
    return (
      text.indexOf('No Listener: tabs:outgoing.message.ready') !== -1 ||
      text.indexOf('tabs:outgoing.message.ready') !== -1 ||
      text.indexOf('Receiving end does not exist') !== -1 ||
      text.indexOf("Evaluating a string as JavaScript violates the following Content Security Policy directive") !== -1 ||
      text.indexOf("'unsafe-eval' is not an allowed source of script") !== -1 ||
      (text.indexOf('cssRules') !== -1 && text.indexOf('null') !== -1)
    )
  }

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

  window.addEventListener('unhandledrejection', function(e) {
    var message = e && e.reason && e.reason.message ? e.reason.message : String((e && e.reason) || '')
    if (!isInjectedRuntimeNoise(message)) return
    e.preventDefault()
    if (typeof e.stopImmediatePropagation === 'function') e.stopImmediatePropagation()
  }, true)

  window.addEventListener('error', function(e) {
    var message = String((e && e.message) || (e && e.error && e.error.message) || '')
    if (!isInjectedRuntimeNoise(message)) return
    e.preventDefault()
    if (typeof e.stopImmediatePropagation === 'function') e.stopImmediatePropagation()
  }, true)
})()
