;(function () {
  if (!('serviceWorker' in navigator) || !('caches' in window)) {
    return
  }

  const cleanupPath = '/service-worker.js'

  const getScriptPath = function (registration) {
    const source = registration.active || registration.waiting || registration.installing
    if (!source?.scriptURL) {
      return ''
    }
    return new URL(source.scriptURL, location.href).pathname
  }

  const needsCleanup = async function () {
    const [registrations, keys] = await Promise.all([navigator.serviceWorker.getRegistrations(), caches.keys()])
    const hasLegacyRegistration = registrations.some(function (registration) {
      return getScriptPath(registration) !== cleanupPath
    })
    const hasLegacyCache = keys.some(function (key) {
      return key.startsWith('blog_')
    })
    return hasLegacyRegistration || hasLegacyCache
  }

  window.addEventListener('load', async function () {
    if (!(await needsCleanup())) {
      return
    }

    try {
      await navigator.serviceWorker.register(cleanupPath)
    } catch (error) {
      console.warn('cleanup service worker register failed', error)
    }
  })
})()
