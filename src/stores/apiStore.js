import { defineStore } from 'pinia'
import { ref, computed } from 'vue'

const useApiStore = defineStore('api', () => {
  const loadingQueue = ref([])
  const isLoading = computed(() => {
    return loadingQueue.value.length !== 0
  })

  const axiosControllerQueue = ref([])
  const axiosMessages = ref('')

  function setAxiosMessage(msgObj) {
    axiosMessages.value = msgObj
  }

  return {
    loadingQueue,
    isLoading,
    axiosControllerQueue,
    axiosMessages,
    setAxiosMessage
  }
})

export default useApiStore
