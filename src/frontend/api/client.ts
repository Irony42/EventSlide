const defaultHeaders = {
  'Content-Type': 'application/json'
}

async function parseJson<T>(response: Response): Promise<T> {
  if (!response.ok) {
    const message = await response.text()
    throw new Error(message || 'Request failed')
  }
  return (await response.json()) as T
}

export const apiClient = {
  get: async <T>(url: string): Promise<T> => {
    const response = await fetch(url, { credentials: 'include' })
    return parseJson<T>(response)
  },
  post: async <T>(url: string, body: unknown): Promise<T> => {
    const response = await fetch(url, {
      method: 'POST',
      credentials: 'include',
      headers: defaultHeaders,
      body: JSON.stringify(body)
    })
    return parseJson<T>(response)
  },
  patch: async <T>(url: string, body: unknown): Promise<T> => {
    const response = await fetch(url, {
      method: 'PATCH',
      credentials: 'include',
      headers: defaultHeaders,
      body: JSON.stringify(body)
    })
    return parseJson<T>(response)
  },
  postForm: async <T>(url: string, body: FormData): Promise<T> => {
    const response = await fetch(url, {
      method: 'POST',
      credentials: 'include',
      body
    })
    return parseJson<T>(response)
  },
  del: async <T>(url: string): Promise<T> => {
    const response = await fetch(url, { method: 'DELETE', credentials: 'include' })
    return parseJson<T>(response)
  }
}
