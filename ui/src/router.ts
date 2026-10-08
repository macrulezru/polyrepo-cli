import { computed, ref } from 'vue'

export interface Route {
  page: string
  param: string
  query: URLSearchParams
}

function parse(): Route {
  const hash = window.location.hash.replace(/^#\/?/, '')
  const [pathPart = '', queryPart = ''] = hash.split('?')
  const [page = 'packages', param = ''] = pathPart.split('/')
  return {
    page: page || 'packages',
    param: decodeURIComponent(param),
    query: new URLSearchParams(queryPart),
  }
}

const current = ref<Route>(parse())

window.addEventListener('hashchange', () => {
  current.value = parse()
})

export function useRoute() {
  return computed(() => current.value)
}

export function navigate(page: string, param = '', query: Record<string, string> = {}): void {
  const search = new URLSearchParams(query).toString()
  const path = param ? `${page}/${encodeURIComponent(param)}` : page
  window.location.hash = `#/${path}${search ? `?${search}` : ''}`
}

export function hrefFor(page: string, param = ''): string {
  return `#/${param ? `${page}/${encodeURIComponent(param)}` : page}`
}
