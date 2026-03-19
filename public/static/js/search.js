;(function () {
  const blog = window.blog || (window.blog = {})

  const onReady =
    blog.ready ||
    function (fn) {
      if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', fn, { once: true })
        return
      }
      fn()
    }

  const escapeHtml =
    blog.escapeHtml ||
    function (value) {
      return String(value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;')
    }

  const setLoading = function (loading) {
    const icon = document.querySelector('.page-search .icon-loading')
    if (icon instanceof HTMLElement) {
      icon.style.opacity = loading ? '1' : '0'
    }
  }

  const loadAllPostData = async function () {
    if (localStorage.db && localStorage.dbVersion === blog.buildAt) {
      setLoading(false)
      return localStorage.db
    }

    localStorage.removeItem('dbVersion')
    localStorage.removeItem('db')

    try {
      const response = await fetch(`${blog.baseurl}/static/xml/search.xml?t=${blog.buildAt}`)
      if (!response.ok) {
        throw new Error(`status ${response.status}`)
      }
      const data = await response.text()
      localStorage.db = data
      localStorage.dbVersion = blog.buildAt
      setLoading(false)
      return data
    } catch (error) {
      console.error('全文检索数据加载失败...', error)
      setLoading(false)
      return null
    }
  }

  onReady(function () {
    const input = document.getElementById('search-input')
    if (!(input instanceof HTMLInputElement)) {
      return
    }

    const items = Array.from(document.querySelectorAll('.list-search li'))
    const titles = items.map(function (item) {
      return item.querySelector('.title')?.textContent || ''
    })

    let contents = []
    let composing = false

    const parseContent = function (data) {
      if (!data) {
        return items.map(function () {
          return ''
        })
      }

      const root = document.createElement('div')
      root.innerHTML = data
      return Array.from(root.querySelectorAll('li')).map(function (item) {
        return item.textContent?.trim() || ''
      })
    }

    const mark = function (source, key, index) {
      const start = escapeHtml(source.slice(0, index))
      const match = escapeHtml(source.slice(index, index + key.length))
      const end = escapeHtml(source.slice(index + key.length))
      return `${start}<span class="hint">${match}</span>${end}`
    }

    const render = function (rawKey) {
      const key = blog.trim(rawKey)

      items.forEach(function (item, index) {
        const title = titles[index] || ''
        const content = contents[index] || ''
        const titleNode = item.querySelector('.title')
        const contentNode = item.querySelector('.content')

        if (!(titleNode instanceof HTMLElement) || !(contentNode instanceof HTMLElement)) {
          return
        }

        titleNode.textContent = title
        contentNode.textContent = ''

        if (key === '') {
          item.hidden = true
          return
        }

        let visible = false
        const titleIndex = title.toLowerCase().indexOf(key.toLowerCase())
        const contentIndex = content.toLowerCase().indexOf(key.toLowerCase())

        if (titleIndex !== -1) {
          visible = true
          titleNode.innerHTML = mark(title, key, titleIndex)
        }

        if (contentIndex !== -1) {
          visible = true
          const left = Math.max(contentIndex - 20, 0)
          const right = Math.min(left + Math.max(key.length, 100), content.length)
          const excerpt = content.slice(left, right)
          const excerptIndex = excerpt.toLowerCase().indexOf(key.toLowerCase())
          contentNode.innerHTML = `${mark(excerpt, key, excerptIndex)}...`
        } else if (titleIndex !== -1) {
          contentNode.textContent = `${content.slice(0, 100)}...`
        }

        item.hidden = !visible
      })
    }

    setLoading(true)
    loadAllPostData().then(function (data) {
      contents = parseContent(data)
      render(input.value)
    })

    input.addEventListener('input', function (event) {
      if (!composing) {
        render(event.target.value)
      }
    })

    input.addEventListener('compositionstart', function () {
      composing = true
    })

    input.addEventListener('compositionend', function (event) {
      composing = false
      render(event.target.value)
    })
  })
})()
