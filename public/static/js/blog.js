;(function () {
  const blog = window.blog || (window.blog = {})

  const onReady = (fn) => {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', fn, { once: true })
      return
    }
    fn()
  }

  const escapeHtml = (value) =>
    String(value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;')

  const build = `${blog.buildAt.slice(0, 4)}/${blog.buildAt.slice(4, 6)}/${blog.buildAt.slice(6, 8)} ${blog.buildAt.slice(8, 10)}:${blog.buildAt.slice(10, 12)}`
  const style1 = 'background:#4BB596;color:#ffffff;border-radius:2px;'
  const style2 = 'color:auto;'

  console.info(`%c Author %c ${blog.author}`, style1, style2)
  console.info(`%c Build  %c ${build}`, style1, style2)
  console.info(`%c Site   %c ${blog.domainUrl}`, style1, style2)

  blog.ready = onReady
  blog.trim = (value) => String(value).trim()
  blog.escapeHtml = escapeHtml
  blog.hasClass = (element, className) => element?.classList.contains(className) ?? false
  blog.addClass = (element, className) => element?.classList.add(className)
  blog.removeClass = (element, className) => element?.classList.remove(className)
  blog.ajax = function (option, success, fail) {
    const controller = new AbortController()
    const timeout = window.setTimeout(() => controller.abort(), option.timeout || 10000)

    fetch(option.url, {
      method: (option.method || 'GET').toUpperCase(),
      signal: controller.signal,
    })
      .then((response) => {
        if (!response.ok) {
          throw {
            error: '状态错误',
            code: response.status,
          }
        }
        return response.text()
      })
      .then(success)
      .catch((error) => {
        if (error?.name === 'AbortError') {
          fail({ error: '请求超时' })
          return
        }
        if (error?.error) {
          fail(error)
          return
        }
        fail({ error: '请求失败' })
      })
      .finally(() => {
        window.clearTimeout(timeout)
      })
  }

  blog.initClickEffect = function (textList) {
    window.addEventListener('click', function (event) {
      const target = event.target
      if (!(target instanceof Element)) {
        return
      }
      if (target.closest('a, .footer-btn')) {
        return
      }

      const text = textList[Math.floor(Math.random() * textList.length)]
      const item = document.createElement('span')
      item.textContent = text
      item.style.position = 'fixed'
      item.style.left = '0'
      item.style.top = '0'
      item.style.fontSize = '12px'
      item.style.whiteSpace = 'nowrap'
      item.style.userSelect = 'none'
      item.style.opacity = '0'
      item.style.transform = 'translateY(0)'

      document.body.appendChild(item)

      const rect = item.getBoundingClientRect()
      item.style.left = `${event.clientX - rect.width / 2}px`
      item.style.top = `${event.clientY - rect.height}px`
      item.style.opacity = '1'

      window.setTimeout(function () {
        item.style.transition = 'transform 500ms ease-out, opacity 500ms ease-out'
        item.style.opacity = '0'
        item.style.transform = 'translateY(-26px)'
      }, 20)

      window.setTimeout(function () {
        item.remove()
      }, 520)
    })
  }

  onReady(function () {
    if (!document.querySelector('.page-post')) {
      return
    }
    document.querySelectorAll('table').forEach(function (table) {
      const wrapper = document.createElement('div')
      wrapper.className = 'table-container'
      table.parentNode?.insertBefore(wrapper, table)
      wrapper.appendChild(table)
    })
  })

  onReady(function () {
    const button = document.querySelector('.footer-btn.to-top')
    if (!(button instanceof HTMLElement)) {
      return
    }

    const update = function () {
      button.classList.toggle('show', window.scrollY > 200)
    }

    window.addEventListener('scroll', update, { passive: true })
    button.addEventListener(
      'click',
      function (event) {
        window.scrollTo({ top: 0 })
        event.stopPropagation()
      },
      true
    )
    update()
  })

  onReady(function () {
    const post = document.querySelector('.page-post')
    if (!post) {
      return
    }

    const images = Array.from(post.querySelectorAll('img'))
    if (images.length === 0) {
      return
    }

    const style = document.createElement('style')
    style.textContent = [
      '.img-move-bg {',
      '  transition: opacity 300ms ease;',
      '  position: fixed;',
      '  inset: 0;',
      '  opacity: 0;',
      '  background-color: #000000;',
      '  z-index: 100;',
      '}',
      '.img-move-item {',
      '  transition: all 300ms ease;',
      '  position: fixed;',
      '  opacity: 0;',
      '  cursor: pointer;',
      '  z-index: 101;',
      '}',
    ].join('')
    document.head.appendChild(style)

    let currentImage = null
    let overlay = null
    let preview = null
    let restoreLock = false

    const centerPreview = function () {
      if (!(currentImage instanceof HTMLImageElement) || !(preview instanceof HTMLImageElement)) {
        return
      }

      let width = Math.min(currentImage.naturalWidth, Math.floor(document.documentElement.clientWidth * 0.9))
      let height = (width * currentImage.naturalHeight) / currentImage.naturalWidth

      if (window.innerHeight * 0.95 < height) {
        height = Math.min(currentImage.naturalHeight, Math.floor(window.innerHeight * 0.95))
        width = (height * currentImage.naturalWidth) / currentImage.naturalHeight
      }

      preview.style.left = `${(document.documentElement.clientWidth - width) / 2}px`
      preview.style.top = `${(window.innerHeight - height) / 2}px`
      preview.style.width = `${width}px`
      preview.style.height = `${height}px`
    }

    const closePreview = function () {
      if (restoreLock || !(currentImage instanceof HTMLImageElement) || !(overlay instanceof HTMLDivElement) || !(preview instanceof HTMLImageElement)) {
        return
      }

      restoreLock = true
      const rect = currentImage.getBoundingClientRect()

      overlay.style.opacity = '0'
      preview.style.opacity = '0'
      preview.style.left = `${rect.left}px`
      preview.style.top = `${rect.top}px`
      preview.style.width = `${rect.width}px`
      preview.style.height = `${rect.height}px`

      window.setTimeout(function () {
        overlay?.remove()
        preview?.remove()
        currentImage = null
        overlay = null
        preview = null
        restoreLock = false
      }, 300)
    }

    const prevent = function (event) {
      event.preventDefault()
    }

    window.addEventListener('resize', centerPreview)

    images.forEach(function (image) {
      image.addEventListener(
        'click',
        function (event) {
          const target = event.currentTarget
          if (!(target instanceof HTMLImageElement)) {
            return
          }

          currentImage = target
          const rect = target.getBoundingClientRect()
          overlay = document.createElement('div')
          overlay.className = 'img-move-bg'

          preview = document.createElement('img')
          preview.className = 'img-move-item'
          preview.src = target.src
          preview.style.left = `${rect.left}px`
          preview.style.top = `${rect.top}px`
          preview.style.width = `${rect.width}px`
          preview.style.height = `${rect.height}px`

          overlay.addEventListener('click', closePreview)
          overlay.addEventListener('wheel', closePreview)
          overlay.addEventListener('touchmove', prevent, { passive: false })

          preview.addEventListener('click', closePreview)
          preview.addEventListener('wheel', closePreview)
          preview.addEventListener('touchmove', prevent, { passive: false })
          preview.addEventListener('dragstart', prevent)

          document.body.appendChild(overlay)
          document.body.appendChild(preview)

          requestAnimationFrame(function () {
            if (overlay) {
              overlay.style.opacity = '0.5'
            }
            if (preview) {
              preview.style.opacity = '1'
            }
            centerPreview()
          })
        },
        true
      )
    })
  })

  onReady(function () {
    const button = document.querySelector('.footer-btn.theme-toggler')
    const icon = button?.querySelector('.svg-icon')
    if (!(button instanceof HTMLElement) || !(icon instanceof HTMLElement)) {
      return
    }

    const applyIcon = function (flag) {
      icon.classList.remove('icon-theme-light', 'icon-theme-dark')
      icon.classList.add(flag === 'true' ? 'icon-theme-dark' : 'icon-theme-light')
    }

    button.classList.remove('hide')
    applyIcon(blog.darkMode ? 'true' : 'false')

    const applyTheme = function (flag) {
      applyIcon(flag)
      document.documentElement.setAttribute('transition', '')
      window.setTimeout(function () {
        document.documentElement.removeAttribute('transition')
      }, 600)
      blog.initDarkMode(flag)
    }

    button.addEventListener('click', function () {
      const flag = blog.darkMode ? 'false' : 'true'
      localStorage.darkMode = flag
      applyTheme(flag)
    })

    const media = window.matchMedia?.('(prefers-color-scheme: dark)')
    media?.addEventListener('change', function (event) {
      if (event.matches === blog.darkMode) {
        return
      }
      localStorage.darkMode = ''
      applyTheme(event.matches ? 'true' : 'false')
    })
  })

  onReady(function () {
    document.querySelectorAll('.post h1, .post h2').forEach(function (heading) {
      heading.addEventListener('click', function (event) {
        const target = event.currentTarget
        if (!(target instanceof HTMLElement)) {
          return
        }
        target.scrollIntoView({ block: 'start' })
        if (target.id && history.replaceState) {
          history.replaceState({}, '', `#${target.id}`)
        }
      })
    })
  })
})()
