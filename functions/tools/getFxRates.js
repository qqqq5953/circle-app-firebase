const firebaseDb = require('../admin')
const axios = require('axios')
const fxToTWDRef = firebaseDb.ref('/fxToTWD/')

async function getFxRates(fxToTWD) {
  if (fxToTWD) {
    const { fxRates, nextUpdateTime } = fxToTWD
    return await checkFxUpdate(fxRates, nextUpdateTime)
  } else {
    return await checkFxUpdate()
  }
}

async function checkFxUpdate(ratesFromDB, nextUpdateTime) {
  const hasPassedNextUpdateTime =
    !nextUpdateTime || Date.now() >= nextUpdateTime

  if (!hasPassedNextUpdateTime) {
    return ratesFromDB
  }

  const fxRates = await fecthFxRates()
  const newNextUpdateTime = scheduleNextUpdateFxRates()
  updateFxToDB(fxRates, newNextUpdateTime)

  return fxRates
}

async function fecthFxRates() {
  const currencyToCodeMap = {
    USD: 'us',
    GBP: 'uk',
    HKD: 'hk',
    KRW: 'ks'
  }
  const currencies = ['USD', 'GBP', 'HKD', 'KRW']
  const fxRateApi = 'https://api.coinbase.com/v2/exchange-rates'
  const fetchPromise = currencies.map((currency) => {
    return axios.get(`${fxRateApi}?currency=${currency}`)
  })

  const currencyRes = await Promise.allSettled(fetchPromise)
  const fxRates = currencyRes.reduce(
    (obj, item) => {
      const { currency, rates } = item.value.data.data
      const code = currencyToCodeMap[currency]
      if (currency !== 'USD') {
        obj[code] = rates.TWD
      } else {
        obj['us'] = rates.TWD
        obj['mf'] = rates.TWD
      }

      return obj
    },
    { tw: '1' }
  )

  return fxRates
}

function scheduleNextUpdateFxRates() {
  const now = new Date()
  const nextUpdate = new Date(now)
  nextUpdate.setMinutes(0)
  nextUpdate.setSeconds(0)
  nextUpdate.setMilliseconds(0)
  nextUpdate.setHours(nextUpdate.getHours() + 1)

  // Check if it's a weekend day
  // let requireUpdate = updateOnWeekend
  const dayOfWeek = nextUpdate.getDay()

  if (dayOfWeek === 0 || dayOfWeek === 6) {
    nextUpdate.setDate(nextUpdate.getDate() + ((7 - dayOfWeek + 1) % 7))
    nextUpdate.setHours(4)
  } else {
  }

  const nextUpdateTime = nextUpdate.getTime()
  return nextUpdateTime
}

function updateFxToDB(fxRates, nextUpdateTime) {
  fxToTWDRef.set({ fxRates, nextUpdateTime })
}

module.exports = getFxRates
