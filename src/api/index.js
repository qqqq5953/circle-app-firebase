import axios from 'axios'
import { storeToRefs } from 'pinia'
import useApiStore from '@/stores/apiStore.js'

const $store = useApiStore()
const { axiosControllerQueue } = storeToRefs($store)

const http = axios.create({
  baseURL: 'http://localhost:8080'
})

http.interceptors.request.use(
  (config) => {
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
    console.log('request error', error)
  }
)

http.interceptors.response.use(
  (response) => {
    // loadingQueue.value.shift()
    return response
  },
  (error) => {
    console.log('response error', error)
  }
)

export default http
