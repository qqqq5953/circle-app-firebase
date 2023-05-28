import axios from 'axios'
import { storeToRefs } from 'pinia'
import useApiStore from '@/stores/apiStore.js'

const http = axios.create({
  withCredentials: true,
  baseURL: 'https://asia-east1-cloud-func-test-256db.cloudfunctions.net'
})

http.interceptors.request.use(
  (config) => {
    const $store = useApiStore()
    const { axiosControllerQueue } = storeToRefs($store)

    // console.log('url', config.url)
    // const url = config.url
    // const apiName = url.split('api')[1]
    // loadingQueue.value.push(apiName)

    const controller = new AbortController()
    const cfg = {
      ...config,
      signal: controller.signal
    }
    axiosControllerQueue.value.push(controller)

    return cfg
  },
  (error) => {
    handleError(error)
  }
)

http.interceptors.response.use(
  (response) => {
    // loadingQueue.value.shift()
    return response
  },
  (error) => {
    handleError(error)
  }
)

function handleError(error) {
  const $store = useApiStore()
  const { setAxiosMessage } = $store

  const sentError = {
    id: Date.now(),
    title: error.response.data.includes('DOCTYPE')
      ? `${error.message} (${error.response.status})`
      : `${error.response.data} (${error.response.status})`,
    status: false
  }
  setAxiosMessage(sentError)
}

export default http
