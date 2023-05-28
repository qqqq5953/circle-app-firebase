import { toRefs, ref, reactive } from 'vue'
import http from '../api/index'

export default function useAxios(url, method, options = {}) {
  const data = ref(null)
  const state = reactive({
    error: null,
    loading: false
  })

  const executeAxios = async () => {
    state.loading = true

    try {
      const response = await http[method](url, options)
      const { success, content, errorMessage, result = null } = response.data
      data.value = { success, content, errorMessage, result }

      if (!success) {
        state.error = { content, message: errorMessage }
      }
    } catch (error) {
      state.error = {
        content: 'useAxios error',
        message: error.message
      }
    } finally {
      state.loading = false
    }
  }

  executeAxios()

  return { data, ...toRefs(state) }
}
