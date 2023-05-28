require('dotenv').config()
const cors = require('cors')({ origin: true, credentials: true })
const yahooFinance = require('yahoo-finance')
const functions = require('firebase-functions')
const firebaseDb = require('./admin')
const axios = require('axios')

const holidaysRef = firebaseDb.ref('/holidays/')
const historyRef = firebaseDb.ref('/history/')
const fxToTWDRef = firebaseDb.ref('/fxToTWD/')
const closeCacheRef = firebaseDb.ref('/closeCache/')
const newAddingTempRef = firebaseDb.ref('/newAddingTemp/')
const holdingsTemptickersRef = firebaseDb.ref('/holdingsTickers/')
const holdingsTradeRef = firebaseDb.ref('/holdingsTrade/')
const holdingsStatsRef = firebaseDb.ref('/holdingsStats/')
const holdingsLatestInfoRef = firebaseDb.ref('/holdingsLatestInfo/')
const watchlistRef = firebaseDb.ref('/watchlist/')
const tabsRef = firebaseDb.ref('/tabs/')

const fetchNewQuotes = require('./holdings/fetchNewQuotes')
const updateInfoAndStats = require('./holdings/updateInfoAndStats')
const calculateStats = require('./holdings/calculateStats')
const updateDb = require('./holdings/updateDb')
const scheduleNextUpdateStock = require('./history/scheduleNextUpdateStock.js')

const getFormattedDate = require('./tools/getFormattedDate')
const getISODate = require('./tools/getISODate')
const parseFloatByDecimal = require('./tools/parseFloatByDecimal')
const formatNumber = require('./tools/formatNumber')
const getFxRates = require('./tools/getFxRates')
const numberWithCommas = require('./tools/getNumberWithComma')

const cookie = require('cookie')
const admin = require('firebase-admin')

exports.verifySessionCookie = functions
  .region('asia-east1')
  .https.onRequest((req, res) => {
    return cors(req, res, async () => {
      const cookies = cookie.parse(req.headers.cookie || req.body.sessionCookie)
      const sessionCookie = cookies['__session']

      try {
        if (sessionCookie) {
          const decodedClaims = await admin
            .auth()
            .verifySessionCookie(sessionCookie, true)

          const uid = decodedClaims.uid
          const user = await admin.auth().getUser(uid)

          if (!user) {
            return res.status(403).send({
              success: false,
              content: 'Forbidden',
              errorMessage: null,
              result: { hasLogin: false }
            })
          }
        } else {
          return res.send({
            success: false,
            content: 'Unauthorized',
            errorMessage: null,
            result: { hasLogin: false }
          })
        }

        res.send({
          success: true,
          content: 'user logged in',
          errorMessage: null,
          result: { hasLogin: true }
        })
      } catch (error) {
        if (error.message === 'auth/session-cookie-revoked') {
          res.status(401).send({
            success: false,
            content: 'Unauthorized',
            errorMessage: error.message,
            result: { hasLogin: false }
          })
        } else {
          res.send({
            success: false,
            content: 'login failed ',
            errorMessage: error.message,
            result: { hasLogin: false }
          })
        }
      }
    })
  })

exports.sessionLogin = functions
  .region('asia-east1')
  .https.onRequest((req, res) => {
    return cors(req, res, async () => {
      try {
        const idToken = req.body.idToken || ''
        const sessionCookie = req.body.sessionCookie || ''

        if (sessionCookie) {
          // has logged in before
          const decodedClaims = await admin
            .auth()
            .verifySessionCookie(sessionCookie, true)

          const uid = decodedClaims.uid
          const user = await admin.auth().getUser(uid)

          if (!user) {
            return res.status(403).send({
              success: false,
              content: 'Forbidden',
              errorMessage: null,
              result: { hasLogin: false }
            })
          }

          res.send({
            success: true,
            content: 'user logged in',
            errorMessage: null,
            result: { hasLogin: true, cookie: sessionCookie }
          })
        } else {
          // first time login
          const decodedToken = await admin.auth().verifyIdToken(idToken, true)
          const uid = decodedToken.uid
          const user = await admin.auth().getUser(uid)

          if (!user) {
            return res.status(403).send({
              success: false,
              content: 'Forbidden',
              errorMessage: null,
              result: { hasLogin: false }
            })
          }

          const expiresIn = 60 * 60 * 24 * 1000
          const customSessionCookie = await admin
            .auth()
            .createSessionCookie(idToken, { expiresIn })

          res
            .cookie('__session', customSessionCookie, {
              maxAge: expiresIn,
              httpOnly: true
            })
            .send({
              success: true,
              content: 'user logged in',
              errorMessage: null,
              result: { hasLogin: true, cookie: customSessionCookie }
            })
        }
      } catch (error) {
        const errorMsg = [
          'auth/session-cookie-revoked',
          'auth/id-token-revoked'
        ]
        if (errorMsg.includes(error.message)) {
          res.status(401).send({
            success: false,
            content: 'Unauthorized',
            errorMessage: error.message,
            result: { hasLogin: false }
          })
        } else {
          res.send({
            success: false,
            content: 'login failed ',
            errorMessage: error.message,
            result: { hasLogin: false }
          })
        }
      }
    })
  })

exports.sessionLogout = functions
  .region('asia-east1')
  .https.onRequest((req, res) => {
    return cors(req, res, async () => {
      try {
        res.clearCookie('__session')
        res.send({
          success: true,
          content: 'You have been logged out',
          errorMessage: null,
          result: { hasLogin: false }
        })
      } catch (error) {
        res.send({
          success: false,
          content: 'logout failed ',
          errorMessage: error.message,
          result: { hasLogin: false }
        })
      }
    })
  })

exports.checkUpdateInfoAndStats = functions
  .region('asia-east1')
  .https.onRequest((req, res) => {
    return cors(req, res, async () => {
      try {
        const result = await Promise.allSettled([
          holdingsStatsRef.once('value'),
          holdingsLatestInfoRef.once('value')
        ])

        let [holdingsStats, holdingLatestInfo] = result.map((item) =>
          item.value.val()
        )

        if (!holdingsStats || !holdingLatestInfo) {
          return res.send({
            success: true,
            content: 'The portfolio is empty',
            errorMessage: null,
            result: null
          })
        }

        const updateTimeSnapshot = await closeCacheRef
          .child('nextUpdateTime')
          .once('value')
        const nextUpdateTime = updateTimeSnapshot.val()
        const now = Date.now()
        const passUpdateTime = now > nextUpdateTime

        if (passUpdateTime) {
          // 超過更新時間
          console.log('========checkUpdateClose 超過更新時間========')

          // fetch new quotes
          const { tempTickers, quotePromises } = await fetchNewQuotes(
            holdingLatestInfo
          )
          const quoteResult = await Promise.allSettled(quotePromises)

          await updateInfoAndStats(tempTickers, quoteResult, holdingsStats)

          // get updated info and stats
          const result = await Promise.allSettled([
            holdingsLatestInfoRef.once('value'),
            holdingsStatsRef.once('value')
          ])

          holdingLatestInfo = result[0].value.val()
          holdingsStats = result[1].value.val()

          // schedule Next Update Stock
          const newNextUpdateTime = await scheduleNextUpdateStock()
          const newCurrentUpdateTime = Date.now()
          closeCacheRef.update({
            nextUpdateTime: newNextUpdateTime,
            latestUpdateTime: newCurrentUpdateTime
          })
        } else {
          // 還沒到更新時間
          console.log('========checkUpdateClose 還沒到更新時間========')
        }

        res.send({
          success: true,
          content: passUpdateTime ? '超過更新時間' : '還沒到更新時間',
          errorMessage: null,
          result: { holdingsStats, holdingLatestInfo, hasChecked: true }
        })
      } catch (error) {
        console.log('checkUpdateClose error', error)
        res.send({
          success: false,
          content: 'Check update failed',
          errorMessage: error.message,
          result: { hasChecked: false }
        })
      }
    })
  })

// Overview
exports.holdingLatestInfo = functions
  .region('asia-east1')
  .https.onRequest((req, res) => {
    return cors(req, res, async () => {
      try {
        const snapshot = await holdingsLatestInfoRef.once('value')
        const latestInfo = snapshot.val()

        const msg = {
          success: true,
          content: 'Latest info fetched',
          errorMessage: null,
          result: latestInfo
        }

        res.send(msg)
      } catch (error) {
        const msg = {
          success: false,
          content: 'Failed to fetch latest info',
          errorMessage: error.message,
          result: null
        }

        res.send(msg)
      }
    })
  })

exports.topThreePerformance = functions
  .region('asia-east1')
  .https.onRequest((req, res) => {
    return cors(req, res, async () => {
      if (req.query.hasChecked !== 'true') {
        return res.send({
          success: false,
          content: 'Failed to fetch topThreePerformance',
          errorMessage: 'Must call checkUpdateClose api first',
          result: null
        })
      }

      try {
        const result = await Promise.allSettled([
          holdingsStatsRef
            .orderByChild('profitOrLossPercentage')
            .limitToLast(3)
            .once('value'),
          holdingsLatestInfoRef.once('value')
        ])
        const [stats, latestInfo] = result.map((item) => item.value.val())

        const final = Object.entries(stats)
          .map(([tempTicker, item]) => {
            const { style, ticker, name } = latestInfo[tempTicker]

            return { ...item, style, ticker, name, tempTicker }
          })
          .reverse()

        console.log('stats', stats)
        const msg = {
          success: true,
          content: 'Holding stats fetched',
          errorMessage: null,
          result: final
        }

        res.send(msg)
      } catch (error) {
        const msg = {
          success: false,
          content: 'Failed to fetch holding stats',
          errorMessage: error.message,
          result: null
        }

        res.send(msg)
      }
    })
  })

exports.quote = functions.region('asia-east1').https.onRequest((req, res) => {
  return cors(req, res, async () => {
    const quoteOptions = {
      symbol: req.query.ticker,
      modules: ['price']
    }

    try {
      const { price: priceObj } = await yahooFinance.quote(quoteOptions)

      const {
        longName: name,
        regularMarketPrice: price,
        symbol: ticker,
        regularMarketTime,
        marketState,
        regularMarketChange,
        regularMarketChangePercent
      } = priceObj

      const roundedChange = Math.round(regularMarketChange * 100) / 100

      const previousCloseChange =
        roundedChange > 0
          ? '+' + roundedChange.toFixed(2)
          : roundedChange.toFixed(2)

      const previousCloseChangePercent =
        Math.round(regularMarketChangePercent * 10000) / 100

      const obj = {
        price: parseFloat(price.toFixed(2)),
        previousCloseChange,
        previousCloseChangePercent,
        name,
        ticker,
        regularMarketTime,
        marketState
      }

      const msg = {
        success: true,
        content: '成功獲得標的',
        errorMessage: null,
        result: obj
      }

      res.send(msg)
    } catch (err) {
      const msg = {
        success: false,
        content: '獲得標的失敗',
        errorMessage: err.message,
        result: null
      }
      res.send(msg)
    }
  })
})

// HOLDINNGS PAGE
exports.holdings = functions
  .region('asia-east1')
  .https.onRequest((req, res) => {
    return cors(req, res, async () => {
      if (req.query.hasChecked !== 'true') {
        return res.send({
          success: false,
          content: 'Failed to fetch holdings',
          errorMessage: 'Must call checkUpdateClose api first',
          result: null
        })
      }

      const result = await Promise.allSettled([
        holdingsStatsRef.once('value'),
        holdingsLatestInfoRef.once('value')
      ])

      const [holdingsStats, latestInfoObj] = result.map((item) =>
        item.value.val()
      )

      if (!latestInfoObj) {
        return res.send({
          success: true,
          content: '無標的',
          errorMessage: null,
          result: null
        })
      }

      try {
        // 計算個別股票總市值
        const statsWithTotalValue = Object.entries(holdingsStats).reduce(
          (obj, entries) => {
            const [tempTicker, stat] = entries
            const { totalShares } = stat
            const price = latestInfoObj[tempTicker].close

            obj[tempTicker] = {
              ...stat,
              totalValue: parseFloatByDecimal(price * totalShares, 2)
            }
            return obj
          },
          {}
        )

        // organize
        const holdings = {}
        for (const tempTicker in latestInfoObj) {
          const info = latestInfoObj[tempTicker]
          const stats = statsWithTotalValue[tempTicker]

          holdings[tempTicker] = {
            latestInfo: info,
            totalStats: stats
          }
        }

        const msg = {
          success: true,
          content: 'Holdings fetched',
          errorMessage: null,
          result: holdings
        }

        res.send(msg)
      } catch (error) {
        console.log('error', error)
        const msg = {
          success: false,
          content: 'Failed to fetch holdings',
          errorMessage: error.message,
          result: null
        }

        res.send(msg)
      }
    })
  })

exports.totalStats = functions
  .region('asia-east1')
  .https.onRequest((req, res) => {
    return cors(req, res, async () => {
      if (req.query.hasChecked !== 'true') {
        return res.send({
          success: false,
          content: 'Failed to fetch totalStats',
          errorMessage: 'Must call checkUpdateClose api first',
          result: null
        })
      }

      try {
        const latestInfoSnapshot = await holdingsLatestInfoRef.once('value')
        const latestInfoObj = latestInfoSnapshot.val()
        if (!latestInfoObj) {
          return res.send({
            success: true,
            content: '無標的',
            errorMessage: null,
            result: null
          })
        }

        // get Fx and stats
        const result = await Promise.allSettled([
          fxToTWDRef.once('value'),
          holdingsStatsRef.once('value')
        ])
        const [fxToTWD, stats] = result.map((item) => item.value.val())
        const fxRates = await getFxRates(fxToTWD)

        // calculate total stats
        const { accTotalCost, accTotalValue, holdingsTotalValue } =
          Object.entries(stats).reduce(
            (obj, item) => {
              const [tempTicker, stats] = item
              const { totalCost, totalShares } = stats
              const close = latestInfoObj[tempTicker].close
              const code = latestInfoObj[tempTicker].code
              const exchangeRate = fxRates[code]
              const totalValue = totalShares * close

              obj.accTotalCost += totalCost * exchangeRate
              obj.accTotalValue += totalValue * exchangeRate
              obj.holdingsTotalValue.push({
                name: tempTicker,
                value: +(totalValue * exchangeRate).toFixed(2)
              })
              return obj
            },
            {
              accTotalCost: 0,
              accTotalValue: 0,
              holdingsTotalValue: []
            }
          )

        const totalStats = {
          'P / L': formatNumber({ number: accTotalValue - accTotalCost }),
          'P / L %':
            (((accTotalValue - accTotalCost) * 100) / accTotalCost).toFixed(2) +
            '%',
          'Total cost': formatNumber({ number: accTotalCost }),
          'Total value': formatNumber({ number: accTotalValue })
        }

        console.log('totalStats', totalStats)

        const msg = {
          success: true,
          content: 'Total stats fetched',
          errorMessage: null,
          result: { totalStats, holdingsTotalValue }
        }

        res.send(msg)
      } catch (error) {
        const msg = {
          success: false,
          content: 'Failed to fetch total stats',
          errorMessage: error.message,
          result: null
        }

        res.send(msg)
      }
    })
  })

exports.deleteStock = functions
  .region('asia-east1')
  .https.onRequest((req, res) => {
    return cors(req, res, async () => {
      const { tradeId, tempTicker, tradeDate } = req.query

      try {
        // 讀取刪除前資料
        const result = await Promise.allSettled([
          holdingsLatestInfoRef.child(tempTicker).once('value'),
          holdingsStatsRef.child(tempTicker).once('value'),
          holdingsTradeRef.child(tempTicker).child(tradeId).once('value')
        ])

        // delete close cache
        await deleteCachePrice(tradeDate, tempTicker)

        // delete history trade
        const deleteHistoryPromise = historyRef
          .child(tradeDate)
          .child(tradeId)
          .remove()

        // delete holdingsTrade
        const deleteTradePromise = holdingsTradeRef
          .child(tempTicker)
          .child(tradeId)
          .remove()

        const [latestInfo, stats, trade] = result.map((item) =>
          item.value.val()
        )

        const { close } = latestInfo
        const { cost, shares } = trade
        const { totalCost, totalShares } = stats
        const newTotalShares = totalShares - shares

        let updateStatsPromise
        if (newTotalShares !== 0) {
          // update holdingsStats
          console.log('update holdingsStats')
          const newTotalCost = totalCost - cost
          const newAverageCost = newTotalCost / newTotalShares
          const { profitOrLossPercentage, profitOrLossValue } = calculateStats(
            close,
            newAverageCost,
            newTotalShares
          )

          updateStatsPromise = updateDb(holdingsStatsRef, tempTicker, {
            totalCost: newTotalCost,
            totalShares: newTotalShares,
            averageCost: newAverageCost,
            profitOrLossPercentage,
            profitOrLossValue
          })
        } else {
          console.log('該標的已全數刪除')
          // 該標的已全數刪除
          holdingsTemptickersRef.child(tempTicker).remove()
          holdingsLatestInfoRef.child(tempTicker).remove()
          holdingsStatsRef.child(tempTicker).remove()
          newAddingTempRef.child(`${tradeDate}_${tempTicker}`).remove()
        }

        await Promise.allSettled([
          deleteHistoryPromise,
          deleteTradePromise,
          updateStatsPromise
        ])

        // 如果 holding 已空則刪除 cachePrice
        await holdingsTemptickersRef.once('value').then((snapshot) => {
          if (!snapshot.exists()) closeCacheRef.remove()
        })

        res.send({
          success: true,
          content: 'trade deleted',
          errorMessage: null,
          result: null
        })
      } catch (error) {
        console.log('error', error)
        res.send({
          success: false,
          content: 'trade delete falied',
          errorMessage: error.message,
          result: null
        })
      }

      async function deleteCachePrice(deletedTradeDate, tempTicker) {
        try {
          const hasCache = await closeCacheRef
            .child('closePrice')
            .child(`${deletedTradeDate}_${tempTicker}`)
            .once('value')

          if (!hasCache.exists()) return console.log('沒有 cache')

          //檢查該日幾筆交易
          const numberOfTrades = []
          await historyRef
            .child(deletedTradeDate)
            .orderByChild('tempTicker')
            .equalTo(tempTicker)
            .once('value')
            .then((snapshot) => {
              snapshot.forEach((childSnapshot) => {
                numberOfTrades.push(childSnapshot.val().tempTicker)
              })
            })

          console.log('numberOfTrades', numberOfTrades)

          if (numberOfTrades.length > 1) return console.log('該日有多筆交易')

          // 該交易是否只有於一個日期交易
          console.log(deletedTradeDate, '只有一筆交易')
          const tradeDateSet = new Set()
          await holdingsTradeRef
            .child(tempTicker)
            .orderByChild('tradeUnix')
            .once('value')
            .then((snapshot) => {
              snapshot.forEach((childSnapshot) => {
                const tradeDate = childSnapshot.val().tradeDate
                if (!tradeDateSet.has(tradeDate)) {
                  tradeDateSet.add(tradeDate)
                }
              })
            })

          const isSingleTradeDate = tradeDateSet.size === 1
          const todayDate = getISODate()

          // 標的只有於一個日期交易
          if (isSingleTradeDate) {
            console.log('標的只有於一個日期交易')

            await closeCacheRef
              .child('closePrice')
              .orderByKey()
              .startAt(`${deletedTradeDate}_${tempTicker}`)
              .endAt(`${todayDate}_${tempTicker}`)
              .once('value')
              .then((snapshot) => {
                snapshot.forEach((childSnapshot) => {
                  if (childSnapshot.key.endsWith(`_${tempTicker}`)) {
                    console.log('刪除的日期', childSnapshot.key)
                    childSnapshot.ref.remove()
                  }
                })
              })

            return
          }

          // 標的於多個日期交易
          console.log('標的於多個日期交易')
          const [firstTradeDate, secondTradeDate] = [...tradeDateSet.values()]

          if (firstTradeDate === deletedTradeDate) {
            // 刪除的標的為最早交易日
            console.log('刪除的標的為最早交易日')
            const deletePromises = []
            let countBack = 1
            let hasDeleteAll = false

            // 刪除第二交易日至最早交易日間的 cache
            console.log(
              '刪除第二交易日',
              secondTradeDate,
              '至最早交易日',
              firstTradeDate,
              '間的 cache'
            )
            while (!hasDeleteAll) {
              const oneDay = 86400000
              const toDeleteUnix =
                new Date(secondTradeDate).getTime() - oneDay * countBack
              const toDeleteDate = getISODate(new Date(toDeleteUnix))
              const key = `${toDeleteDate}_${tempTicker}`
              const deletePromise = closeCacheRef
                .child('closePrice')
                .child(key)
                .remove()
              deletePromises.push(deletePromise)
              countBack++
              console.log('刪除的 cache', key)

              // 已從第二交易日刪到最早交易日
              if (toDeleteDate === firstTradeDate) {
                console.log('已從第二交易日刪到最早交易日')
                hasDeleteAll = true
                break
              }
            }

            await Promise.allSettled(deletePromises)
          }
        } catch (error) {
          console.log('deleteCachePrice error', error)
        }
      }
    })
  })

exports.addStock = functions
  .region('asia-east1')
  .https.onRequest((req, res) => {
    return cors(req, res, async () => {
      try {
        const snapshot = await holdingsTemptickersRef.once('value')
        const isInHolding = snapshot.val()
          ? snapshot.val()[req.body.tempTicker]
          : snapshot.val()

        if (snapshot.numChildren() >= 5 && !isInHolding) {
          return res.send({
            success: false,
            content: 'Adding stock failed',
            errorMessage: 'Hire Andy Hsieh to manage more trades! :)',
            result: null
          })
        }

        const invalidInput = Object.keys(req.body).filter(
          (key) => req.body[key] == null
        )

        if (invalidInput.length !== 0) {
          const reservedKey = ['ticker', 'cost', 'shares', 'tradeDate']
          const errorMessage =
            'Invalid input field: ' +
            invalidInput.filter((key) => reservedKey.includes(key)).join(', ')
          const message = {
            success: false,
            content: '標的新增失敗',
            errorMessage,
            result: req.body
          }

          res.send(message)
          return
        }

        if (new Date(req.body.tradeDate).getFullYear() !== 2023) {
          return res.send({
            success: false,
            content: 'Adding stock failed: Year must be 2023',
            errorMessage: null,
            result: null
          })
        }

        const {
          previousCloseChange,
          previousCloseChangePercent,
          price: close,
          // 以上為了 buy 直接帶入不用再打 api
          ...rest
        } = req.body

        const {
          style,
          name,
          marketState,
          code,
          regularMarketTime,
          tempTicker,
          ticker,
          ...tradeInfo
        } = rest
        // set tickers
        holdingsTemptickersRef.child(tempTicker).set(ticker)

        // set latestInfo
        const latestInfoSnapshot = await holdingsLatestInfoRef
          .child(tempTicker)
          .once('value')

        if (!latestInfoSnapshot.val()) {
          updateDb(holdingsLatestInfoRef, tempTicker, {
            close,
            previousCloseChange,
            previousCloseChangePercent,
            style,
            name,
            marketState,
            code,
            regularMarketTime,
            tempTicker,
            ticker
          })
        } else {
          updateDb(holdingsLatestInfoRef, tempTicker, {
            close,
            previousCloseChange,
            previousCloseChangePercent,
            marketState,
            regularMarketTime
          })
        }

        // set trade
        const stockInfo = holdingsTradeRef.child(tempTicker).push()
        const id = stockInfo.key
        const tradeUnix = Date.parse(tradeInfo.tradeDate)
        const trade = {
          ...tradeInfo,
          id,
          tradeUnix,
          ticker,
          tempTicker,
          code,
          status: 'buy'
        }
        stockInfo.set(trade)

        // set history
        const { shares, cost, tradeDate } = tradeInfo
        historyRef.child(tradeDate).child(id).set({
          code,
          ticker,
          tempTicker,
          shares,
          cost
        })

        // set newAdding
        newAddingTempRef.child(`${tradeDate}_${tempTicker}`).set(ticker)

        // 計算 stats
        const holdingsSnapshot = await holdingsTradeRef
          .child(tempTicker)
          .once('value')
        const holdingsObj = holdingsSnapshot.val()

        let totalCost = 0
        let totalShares = 0

        for (const id in holdingsObj) {
          const trade = holdingsObj[id]
          const { cost, shares } = trade
          totalCost += parseFloat(cost) * parseFloat(shares)
          totalShares += parseFloat(shares)
        }

        const averageCost = parseFloatByDecimal(totalCost / totalShares, 2)
        const { profitOrLossPercentage, profitOrLossValue } = calculateStats(
          close,
          averageCost,
          totalShares
        )

        updateDb(holdingsStatsRef, tempTicker, {
          totalCost,
          totalShares,
          averageCost,
          profitOrLossPercentage,
          profitOrLossValue
        })

        // schedule Next Update Stock
        const cacheSnapshot = await closeCacheRef
          .child('latestUpdateTime')
          .once('value')

        if (!cacheSnapshot.exists()) {
          const newNextUpdateTime = await scheduleNextUpdateStock()
          const newCurrentUpdateTime = Date.now()
          closeCacheRef.update({
            nextUpdateTime: newNextUpdateTime,
            latestUpdateTime: newCurrentUpdateTime
          })
        }

        const message = {
          success: true,
          content: '標的新增成功',
          errorMessage: null,
          result: { ticker, ...tradeInfo }
        }

        res.send(message)
      } catch (error) {
        const message = {
          success: true,
          content: '標的新增失敗',
          errorMessage: error.message,
          result: null
        }
        res.send(message)
      }
    })
  })

exports.tradeDetails = functions
  .region('asia-east1')
  .https.onRequest((req, res) => {
    return cors(req, res, async () => {
      try {
        const tempTicker = req.query.tempTicker
        const tradeSnapshot = await holdingsTradeRef
          .child(tempTicker)
          .once('value')
        const tradeDetails = tradeSnapshot.val()

        console.log('tradeDetails', tradeDetails)

        if (!tradeDetails) {
          return res.send({
            success: false,
            content: '無標的',
            errorMessage: 'no ticker found in the holdings',
            result: null
          })
        }
        const result = await Promise.allSettled([
          holdingsStatsRef.child(tempTicker).once('value'),
          holdingsLatestInfoRef.child(tempTicker).once('value')
        ])

        const [stats, latestInfo] = result.map((item) => item.value.val())

        const sortedTrade = [...Object.values(tradeDetails)].sort((a, b) => {
          return b.tradeUnix - a.tradeUnix
        })

        res.send({
          success: true,
          content: '成功獲得交易紀錄',
          errorMessage: null,
          result: { sortedTrade, stats, latestInfo }
        })
      } catch (error) {
        res.send({
          success: false,
          content: '獲得交易紀錄失敗',
          errorMessage: error.message,
          result: null
        })
      }
    })
  })

exports.holidays = functions
  .region('asia-east1')
  .https.onRequest((req, res) => {
    return cors(req, res, async () => {
      try {
        const snapshot = await holidaysRef.once('value')
        let holidays

        if (!snapshot.exists()) {
          await fetchHolidays(2023)
          const newSnapshot = await holidaysRef.once('value')
          holidays = newSnapshot.val()
        } else {
          holidays = snapshot.val()
        }

        const message = {
          success: true,
          content: 'holidays fetched',
          errorMessage: null,
          result: holidays
        }

        res.send(message)
      } catch (error) {
        const message = {
          success: false,
          content: 'failed to get holidays',
          errorMessage: error.message,
          result: null
        }

        res.send(message)
      }

      async function fetchHolidays(year) {
        const holidayCountryCode = ['US', 'TW']
        const holidayPromise = holidayCountryCode.map((code) => {
          return axios.get(
            `https://calendarific.com/api/v2/holidays?api_key=5957df4e7e6c4c7a2c3761fd4fd56b5e6cd55afb&country=${code}&year=${year}&type=national`
          )
        })

        const result = await Promise.allSettled(holidayPromise)
        const holidays = result.reduce((obj, item, index) => {
          const code = holidayCountryCode[index]
          const holidays = item.value.data.response.holidays.reduce(
            (innerObj, holiday) => {
              const { name, date } = holiday
              innerObj[date.iso] = name
              return innerObj
            },
            {}
          )

          obj[code] = holidays
          return obj
        }, {})

        holidaysRef.set(holidays)
      }
    })
  })

exports.fxRates = functions.region('asia-east1').https.onRequest((req, res) => {
  return cors(req, res, async () => {
    const fxToTWDSnapshot = await fxToTWDRef.once('value')
    const fxRates = await getFxRates(fxToTWDSnapshot.val())

    return res.send({
      success: true,
      content: 'get exchange rate',
      errorMessage: null,
      result: fxRates
    })
  })
})

// HISTORY PAGE
exports.history = functions.region('asia-east1').https.onRequest((req, res) => {
  return cors(req, res, async () => {
    try {
      const resPromise = await Promise.allSettled([
        holdingsLatestInfoRef.once('value'),
        historyRef.once('value'),
        holdingsTemptickersRef.once('value'),
        fxToTWDRef.once('value'),
        closeCacheRef.once('value')
      ])
      const [
        latestInfoSnapshot,
        historySnapshot,
        tempTickerSnapshot,
        fxToTWDSnapshot
      ] = resPromise

      if (!historySnapshot.value.val()) {
        return res.send({
          success: true,
          content: '尚未有紀錄',
          errorMessage: null,
          result: null
        })
      }

      const pricesAndFxRates = await Promise.allSettled([
        getHistoricalClosePrices(tempTickerSnapshot.value.val()),
        getFxRates(fxToTWDSnapshot.value.val())
      ])

      const [closePricesMap, fxRates] = pricesAndFxRates.map(
        (item) => item.value
      )

      const { totalValueMap, historyMap } = calculateTotalValue(
        latestInfoSnapshot,
        historySnapshot,
        closePricesMap,
        fxRates
      )

      const totalValue = Array.from(totalValueMap).reduce(
        (obj, [date, values]) => {
          obj.date.push(date)
          obj['Asset Value'].push(values.acc)
          return obj
        },
        { date: [], 'Asset Value': [] }
      )
      const historyDetails = Object.fromEntries(
        Array.from(historyMap).reverse()
      )

      const msg = {
        success: true,
        content: 'Historical data fetched',
        errorMessage: null,
        result: { totalValue, historyDetails }
      }

      res.send(msg)
    } catch (error) {
      console.log('error', error)
      const msg = {
        success: false,
        content: 'Failed to fetch historical data',
        errorMessage: error.message,
        result: null
      }

      res.send(msg)
    }

    function convertObjectToMap(object) {
      const map = new Map()
      for (const key in object) {
        if (object.hasOwnProperty(key)) {
          map.set(key, object[key])
        }
      }
      return map
    }

    async function checkCloseCacheExists() {
      const cachePromises = []
      const cacheObj = {}
      // 檢查新增標的是否已經有 cache price
      await newAddingTempRef.once('value').then((snapshot) => {
        snapshot.forEach((childSnapshot) => {
          const ticker = childSnapshot.val()
          const key = childSnapshot.key
          const cacheSnapshot = closeCacheRef
            .child('closePrice')
            .child(key)
            .once('value')
          cachePromises.push(cacheSnapshot)
          cacheObj[key] = ticker
        })
      })

      const result = await Promise.allSettled(cachePromises)
      const noCacheSnapshot = result.filter((item) => !item.value.val())

      if (noCacheSnapshot.length === 0) return null

      const newAddCache = noCacheSnapshot.reduce((obj, item) => {
        const key = item.value.key
        const ticker = cacheObj[key]
        const addTempTicker = key.split('_')[1]
        obj[addTempTicker] = ticker
        return obj
      }, {})

      return newAddCache
    }

    async function getHistoricalClosePrices(tempTickerObj) {
      try {
        const result = await Promise.allSettled([
          closeCacheRef.child('nextUpdateTime').once('value'),
          closeCacheRef.child('latestUpdateTime').once('value')
        ])

        const [nextUpdateTime, latestUpdateTime] = result.map((item) =>
          item.value.val()
        )

        // 沒 cache
        if (!latestUpdateTime) {
          console.log('========沒 cache========')
          newAddingTempRef.remove()
          await createPriceCache()
          return await getPriceCache()
        }

        // 檢查新增標的
        console.log('========檢查新增標的========')
        const newAddingCachedItems = await checkCloseCacheExists()
        console.log('newAddingCachedItems', newAddingCachedItems)

        if (newAddingCachedItems) {
          const newClosePriceMap = await getClosePrices({
            tempTickerObj: newAddingCachedItems,
            customEndDate: new Date(latestUpdateTime)
              .toLocaleDateString()
              .replace(/\//g, '-')
          })
          newAddingTempRef.remove()
          console.log('有新增標的 newClosePriceMap', newClosePriceMap)

          await updatePriceCache(newClosePriceMap)
        }

        // 檢查更新日
        console.log('========檢查更新日========')
        console.log('下個更新日為：', new Date(nextUpdateTime).toLocaleString())
        const now = Date.now()

        // 還沒到更新時間
        if (now < nextUpdateTime) {
          console.log('========還沒到更新時間========')

          if (newAddingCachedItems) {
            console.log('========有新增標的且需新增 cache price========')
            return await getPriceCache()
          }

          console.log('========不需新增 cache price========')
          const snapshot = await closeCacheRef.child('closePrice').once('value')
          const closePrice = snapshot.val()
          return convertObjectToMap(closePrice)
        }

        // 超過更新時間
        console.log('========超過更新時間========')
        let startDate = new Date(latestUpdateTime)

        if (startDate.getDay() === 6) {
          startDate = new Date(latestUpdateTime - 86400000)
        }
        if (startDate.getDay() === 0) {
          startDate = new Date(latestUpdateTime - 86400000 * 2)
        }

        const endDate = new Date(now)
        const newClosePriceMap = await getClosePrices({
          tempTickerObj,
          customStartDate: startDate,
          customEndDate: endDate
        })
        console.log('超過更新時間，更新後 closePriceMap', newClosePriceMap)

        const newNextUpdateTime = await scheduleNextUpdateStock()
        const newCurrentUpdateTime = Date.now()
        closeCacheRef.update({
          nextUpdateTime: newNextUpdateTime,
          latestUpdateTime: newCurrentUpdateTime
        })
        await updatePriceCache(newClosePriceMap)
        console.log('========超過更新時間，資料庫新增完成========')
        return await getPriceCache()
      } catch (error) {
        console.log('getHistoricalClosePrices error', error)
      }

      /*
    狀況：
    1. 有新增，沒過更新時間 
    2. 沒新增，沒過更新時間 
    3. 有新增，過更新時間 
    4. 沒新增，過更新時間 

    if(沒資料){
      // getClosePrices
      // 取得下次更新時間 nextUpdateTime
      // 取得當下更新日期 latestUpdateTime
      // price, latestUpdateTime 及 nextUpdateTime 存進資料庫 closeCacheRef

      return
    }

    newAddingTempRef === 上次新增後沒有更新及儲存股價的部分
    (要實現此判斷前 addStock 要判斷新加入的是否已存在 holdingsTickers，如果沒有才存進 newAddingTemp)
    
    if(有新增標的 newAddingTemp){
      1. 判斷最早日期是否有變動
      2. const closePriceMap = getClosePrices(newAddingTempRef)
      3. 清空 newAddingTempRef
      4. 儲存股價
    }

    if(現在時間超過下次更新日){
      // 檢查要新增幾日資料
        1.latestUpdateTime 跟今天差距
        2.getClosePrices(tickerRef)
        3.取得下次更新時間 nextUpdateTime
        4.取得當下更新日期 latestUpdateTime
        5.price, latestUpdateTime 及 nextUpdateTime 存進資料庫 closeCacheRef
    } else {
      // 直接從資料庫 closeCacheRef 讀取資料
    }
    */
    }

    async function getEarliestTradeDate(tempTicker) {
      const tradesRef = holdingsTradeRef.child(tempTicker)
      return tradesRef
        .orderByChild('tradeDate')
        .limitToFirst(1)
        .once('value')
        .then((snapshot) => {
          let code = null
          let ticker = null
          let earliestDate = null
          snapshot.forEach((tradeSnapshot) => {
            const trade = tradeSnapshot.val()
            code = trade.code
            ticker = trade.ticker
            earliestDate = trade.tradeDate
          })
          return { code, ticker, startDate: earliestDate }
        })
    }

    async function createPriceCache() {
      try {
        const tempTickerSnapshot = await holdingsTemptickersRef.once('value')
        const closePriceMap = await getClosePrices({
          tempTickerObj: tempTickerSnapshot.val()
        })
        const closePrice = Object.fromEntries(closePriceMap)
        const nextUpdateTime = await scheduleNextUpdateStock()
        const currentUpdateTime = Date.now()
        await closeCacheRef.set({
          closePrice,
          nextUpdateTime,
          latestUpdateTime: currentUpdateTime
        })
        return closePriceMap
      } catch (error) {
        console.log('createPriceCache error', error)
      }
    }

    async function getPriceCache() {
      const snapshot = await closeCacheRef.child('closePrice').once('value')
      return convertObjectToMap(snapshot.val())
    }

    async function updatePriceCache(closePriceMap) {
      const updatePromises = []
      for (const [date_tempticker, price] of closePriceMap.entries()) {
        const updatePromise = closeCacheRef
          .child('closePrice')
          .child(date_tempticker)
          .set(price)
        updatePromises.push(updatePromise)
      }

      await Promise.allSettled(updatePromises)
      console.log('========只有新增的標的 資料庫新增完成========')
    }

    async function getClosePrices({
      tempTickerObj,
      customStartDate,
      customEndDate
    }) {
      // 取得每日每標的收盤價
      const tempTickers = Object.keys(tempTickerObj)
      const tradeDatePromise = tempTickers.map((tempTicker) => {
        return getEarliestTradeDate(tempTicker)
      })

      const tradeDates = await Promise.allSettled(tradeDatePromise)
      const earliestTradeDateInfo = tradeDates.map((result) => result.value)
      console.log('earliestDates', earliestTradeDateInfo)

      const rawData = await fetchHistoricalTradeRawData(
        earliestTradeDateInfo,
        customStartDate,
        customEndDate
      )

      const closePricesMap = await geClosePricesMap(
        earliestTradeDateInfo,
        tempTickers,
        tempTickerObj,
        rawData
      )

      return closePricesMap
    }

    async function geClosePricesMap(
      earliestTradeDateInfo,
      tempTickers,
      tempTickerObj,
      rawData
    ) {
      const holidaySnapshot = await holidaysRef.once('value')
      const holiday = holidaySnapshot.val()

      const missingData = []
      const holidayRecord = { us: [], tw: [] }
      const closePriceMap = new Map()
      const prevOpenDateMap = new Map() // 紀錄各市場的前一開盤日
      let prevDate = ''

      for (let i = 0; i < earliestTradeDateInfo.length; i++) {
        const { ticker, startDate, code } = earliestTradeDateInfo[i]
        const tempTicker = tempTickers[i]
        const dataset = rawData[i].value[ticker].reverse()
        console.log('dataset', dataset)

        if (dataset.length === 0) {
          console.log(`${tempTicker} 在 startDate 為 ${startDate} 沒有資料`)
          missingData.push({ dateString: startDate, ticker, tempTicker })
          continue
        }

        for (let j = 0; j < dataset.length; j++) {
          const { date, close } = dataset[j]
          const dateString = date.toJSON().split('T')[0]
          console.log('close', close)
          console.log('startDate', startDate)
          console.log('dateString', dateString)

          // 紀錄各市場的前一開盤日
          prevOpenDateMap.set(`${dateString}_${code}`, prevDate)
          prevDate = dateString

          if (!close) {
            console.log(`${tempTicker} 在 ${dateString} 沒有close`)
            missingData.push({ dateString, ticker, tempTicker })
            continue
          }

          const startUnix = Date.parse(startDate)
          const datasetDateUnix = Date.parse(dateString)
          const isActualTradeDate = startUnix <= datasetDateUnix
          console.log('isActualTradeDate', isActualTradeDate)
          if (!isActualTradeDate) continue

          // 如果資料有多抓兩天，只有實際交易日需要寫入 closePriceMap
          closePriceMap.set(`${dateString}_${tempTicker}`, close)

          // 紀錄休市日
          if (
            holiday['US'][dateString] &&
            holidayRecord['us'].indexOf(dateString) === -1
          ) {
            console.log(`${dateString} 美股休市`)
            holidayRecord['us'].push(dateString)
          }

          if (
            holiday['TW'][dateString] &&
            holidayRecord['tw'].indexOf(dateString) === -1
          ) {
            console.log(`${dateString} 台股休市`)
            holidayRecord['tw'].push(dateString)
          }
        }
      }
      console.log('prevOpenDateMap', prevOpenDateMap)
      console.log('holidayRecord', holidayRecord)

      // 如果前一日的資料，historical 模組會找不到 close，用 quote 模組代替
      if (missingData.length !== 0) {
        console.log('==用 quote 模組==, missingData:', missingData)
        await fetchClosePriceForMissingData(missingData, closePriceMap)
      }

      // 找國定假日的股價
      const convertedDate = []
      if (holidayRecord['tw'].length !== 0) {
        const result = findHolidayMissingData(
          'tw',
          holidayRecord,
          prevOpenDateMap,
          tempTickers,
          tempTickerObj
        )
        convertedDate.push(...result)
      }

      if (holidayRecord['us'].length !== 0) {
        const result = findHolidayMissingData(
          'us',
          holidayRecord,
          prevOpenDateMap,
          tempTickers,
          tempTickerObj
        )
        convertedDate.push(...result)
      }

      convertedDate.forEach((item) => {
        const { nominal, actual } = item
        const actualClose = closePriceMap.get(actual)
        if (actualClose) closePriceMap.set(nominal, actualClose)
      })

      return closePriceMap
    }

    function findHolidayMissingData(
      code,
      holidayRecord,
      prevOpenDateMap,
      tempTickers,
      tempTickerObj
    ) {
      const marketDataToUse = {
        us: 'tw', // us 休市要用 tw 前一開盤日資料
        tw: 'us'
      }
      let temp = ''
      let multiplier = 1

      // 連假開始日期
      const holidayStart = holidayRecord[code].reduce((obj, date) => {
        const isLongWeekend =
          Date.parse(temp) + 86400000 * multiplier === Date.parse(date)

        if (temp && isLongWeekend) {
          obj[date] = temp
          multiplier++
        } else {
          multiplier = 1
          temp = date
        }

        return obj
      }, {})

      console.log(code, 'holidayStart', holidayStart)

      const convertedDate = holidayRecord[code]
        .map((date) => {
          const actualStartDate = holidayStart[date] ? holidayStart[date] : date
          const actualPrevOpenDate = prevOpenDateMap.get(
            `${actualStartDate}_${marketDataToUse[code]}`
          )

          return tempTickers
            .filter((tempTicker) => {
              const ticker = tempTickerObj[tempTicker]
              return code === 'tw'
                ? ticker.endsWith('.TW')
                : !ticker.endsWith('.TW')
            })
            .map((tempTicker) => {
              return {
                nominal: `${date}_${tempTicker}`,
                actual: `${actualPrevOpenDate}_${tempTicker}`
              }
            })
        })
        .reduce((acc, item) => acc.concat(item), [])

      console.log(code, '有假日', convertedDate)

      return convertedDate
    }

    function getQuoteOptionByDate(
      earliestDates,
      customStartDate,
      customEndDate
    ) {
      const { code, ticker, startDate } = earliestDates
      const quoteOptions = {
        symbols: [ticker],
        from: null,
        to: null,
        period: 'd'
      }

      console.log('=====code=====', code)

      // case：超過更新時間
      if (customStartDate) {
        console.log('有 customStartDate', customStartDate)
        quoteOptions.from =
          code === 'us'
            ? adjustDate(customStartDate, 'plus')
            : adjustDate(customStartDate, 'plus', 0)
      } else {
        // case：檢查新增標的、第一次新增
        console.log('沒有 customStartDate，用 startDate', startDate)
        // us 會往前多抓一天所以要調整
        quoteOptions.from =
          code === 'us' ? adjustDate(startDate, 'plus') : startDate
      }

      const today = new Date()
      const ISOToday = adjustDate(
        today.toLocaleDateString().replace(/\//g, '-')
      )
      const ISOYesterday = adjustDate(ISOToday, 'minus')

      const days = today.getDay()
      const hours = today.getHours()
      const mins = today.getMinutes()
      const isTodayWeekDay = days !== 0 && days !== 6
      const twMarketOpen =
        isTodayWeekDay &&
        code === 'tw' &&
        hours >= 9 &&
        (hours < 13 || (hours === 13 && mins <= 30))

      // case：超過更新時間、檢查新增標的
      if (customEndDate) {
        console.log('有 customEndDate', customEndDate)
        if (twMarketOpen) {
          // 開盤時抓的價格不包含今天，所以區間不用調整
          console.log('現在為盤中')
          quoteOptions.to = adjustDate(customEndDate, 'plus', 0)
        } else if (quoteOptions.from === ISOToday) {
          // quoteOptions.from 為今天（當日收盤新增標的）
          console.log('當日收盤後有新增標的')
          quoteOptions.to = quoteOptions.from
        } else {
          console.log('一般收盤後')
          quoteOptions.to = adjustDate(customEndDate, 'plus')
        }
      } else {
        // case：第一次新增
        console.log('沒有 customEndDate')
        if (twMarketOpen) {
          // 開盤時抓的價格不包含今天，所以區間不用調整
          console.log('現在為盤中')
          quoteOptions.to = adjustDate(ISOToday, 'plus', 0)
        } else {
          quoteOptions.to = adjustDate(ISOToday, 'plus')
        }
      }

      console.log('startDate', startDate)
      console.log('ISOYesterday', ISOYesterday)

      const isYesterdayTrade = startDate === ISOYesterday && isTodayWeekDay
      console.log('isYesterdayTrade', isYesterdayTrade)

      // 如果交易起始日為前一日，抓資料就多抓兩天(避開假日)，避免回傳空陣列
      if (isYesterdayTrade && code === 'tw') {
        console.log(ticker, '交易起始日為前一日')
        if (new Date(ISOYesterday).getDay() === 1 && startDate === ISOToday) {
          console.log('前一日為星期一')
          quoteOptions.to = adjustDate(ISOToday, 'plus', 1)
        } else {
          quoteOptions.from = adjustDate(quoteOptions.from, 'minus', 2)
        }
        console.log('adjustedStartDate', quoteOptions.from)
      }

      if (isYesterdayTrade && code === 'us') {
        quoteOptions.from = adjustDate(quoteOptions.from, 'plus', 0)
        console.log(ticker, '交易起始日為前一日')
        console.log('adjustedStartDate', quoteOptions.from)
      }

      console.log('quoteOptions', quoteOptions)

      return quoteOptions
    }

    async function fetchHistoricalTradeRawData(
      earliestTradeDateInfo,
      customStartDate,
      customEndDate
    ) {
      const historicalPromises = []
      for (let i = 0; i < earliestTradeDateInfo.length; i++) {
        const quoteOptions = getQuoteOptionByDate(
          earliestTradeDateInfo[i],
          customStartDate,
          customEndDate
        )
        historicalPromises.push(yahooFinance.historical(quoteOptions))
      }

      const rawData = await Promise.allSettled(historicalPromises)
      return rawData
    }

    async function fetchClosePriceForMissingData(missingData, closePriceMap) {
      const quotePromises = missingData.map((data) => {
        return yahooFinance.quote({
          symbol: data.ticker,
          modules: ['price']
        })
      })
      const rawQuotes = await Promise.allSettled(quotePromises)

      for (let i = 0; i < rawQuotes.length; i++) {
        const {
          regularMarketTime,
          regularMarketPrice,
          regularMarketPreviousClose
        } = rawQuotes[i].value.price

        const { dateString, ticker, tempTicker } = missingData[i]
        console.log('rawQuotes dateString', dateString)
        console.log('rawQuotes ticker', ticker)

        const nowDate = new Date().toJSON().split('T')[0]
        const marketOpenDate = regularMarketTime.toJSON().split('T')[0]
        const hasMarketOpened = nowDate === marketOpenDate
        console.log('hasMarketOpened', hasMarketOpened)

        const closePrice = hasMarketOpened
          ? regularMarketPrice // 今日已開盤
          : regularMarketPreviousClose // 今日尚未開盤

        closePriceMap.set(`${dateString}_${tempTicker}`, closePrice)
      }
    }

    function calculateTotalValue(
      latestInfoSnapshot,
      historySnapshot,
      closePricesMap,
      fxRates
    ) {
      const tradeDateTempMap = new Map() // 紀錄個股於交易日累積股數
      const historyMap = new Map()
      const historyEntries = Object.entries(historySnapshot.value.val())

      for (let i = 0; i < historyEntries.length; i++) {
        const [date, trades] = historyEntries[i]
        console.log('date', date)
        const tradesEntries = Object.entries(trades)
        const innerObj = {}

        // 計算單日 total value
        for (let j = 0; j < tradesEntries.length; j++) {
          const [id, trade] = tradesEntries[j]
          const { shares, tempTicker, code, cost } = trade
          const key = `${date}_${tempTicker}`
          const close = closePricesMap.get(key)
          console.log('tempTicker', tempTicker, close, shares)
          const exchangeRate = fxRates[code]
          const marketValueTWD = shares * close * exchangeRate
          const profitOrLossValue = formatNumber({ number: close - cost })
          const profitOrLossPercentage = (((close - cost) * 100) / cost)
            .toFixed(2)
            .padStart(2, '0')
          const { name, style } = latestInfoSnapshot.value.val()[tempTicker]

          innerObj[id] = {
            ...trade,
            name,
            style,
            profitOrLossValue,
            profitOrLossPercentage,
            cost: formatNumber({ number: cost }),
            close: formatNumber({ number: close }),
            marketValueTWD: formatNumber({ number: marketValueTWD })
          }

          historyRef
            .child(date)
            .child(id)
            .update({
              ...trade,
              close,
              profitOrLossValue,
              profitOrLossPercentage
            })

          if (!tradeDateTempMap.has(key)) {
            tradeDateTempMap.set(key, {
              shares: 0,
              code
            })
          }

          tradeDateTempMap.set(key, {
            shares: tradeDateTempMap.get(key).shares + parseFloat(shares),
            code
          })
        }

        historyMap.set(date, innerObj)
      }

      console.log('tradeDateTempMap', tradeDateTempMap)

      const closePricesEntries = Array.from(closePricesMap)
      const totalValueMap = new Map()
      const sharesEachDate = new Map() // 紀錄個股每日累積股數

      let totalTradeValue = 0
      let totalNonTradeValue = 0
      let sharesAsOfDate = {} // 紀錄所有個股當日的累積股數
      let prevDate = '' // 紀錄前一開盤日

      for (let i = 0; i < closePricesEntries.length; i++) {
        const [key, close] = closePricesEntries[i]
        const [marketOpenDate, tempticker] = key.split('_')
        console.log('===date===', marketOpenDate)

        if (prevDate === marketOpenDate) {
          console.log('同一天，沒歸零')
        } else {
          console.log('換一天，歸零')
          totalTradeValue = 0
          totalNonTradeValue = 0
        }

        if (tradeDateTempMap.has(key)) {
          // 當天有交易
          const { shares, code } = tradeDateTempMap.get(key)

          if (!sharesAsOfDate[tempticker]) {
            sharesAsOfDate[tempticker] = 0
          }
          sharesAsOfDate[tempticker] += shares
          const sharesAsOfToday = sharesAsOfDate[tempticker]

          const exchangeRate = fxRates[code]
          const marketValueTWD = sharesAsOfToday * close * exchangeRate
          totalTradeValue += marketValueTWD

          sharesEachDate.set(tempticker, { shares: sharesAsOfToday, code })
          console.log('當天有交易', key, sharesAsOfToday, totalTradeValue)
        } else {
          // 沒刪乾淨的 cache price（暫時擋掉）
          if (!sharesEachDate.get(tempticker)) return
          // 當天沒交易，用前一次的累績股數
          const { shares, code } = sharesEachDate.get(tempticker)
          const exchangeRate = fxRates[code]
          const marketValueTWD = shares * close * exchangeRate
          totalNonTradeValue += marketValueTWD
          console.log(
            '當天沒交易，用前一次的累績股數',
            key,
            shares,
            totalNonTradeValue
          )
        }

        console.log('sharesEachDate', sharesEachDate)

        // 紀錄當日尚未開盤之個股總市值(用前一日的收盤價)
        const now = new Date()
        const nowYear = now.getFullYear()
        const nowMonth = now.getMonth()
        const nowDate = now.getDate()
        const usMarketOpen = new Date(nowYear, nowMonth, nowDate, 21, 30, 0)
        const twMarketOpen = new Date(nowYear, nowMonth, nowDate, 9, 30, 0)

        let notYetOpenTotal = 0
        if (marketOpenDate === getISODate(now)) {
          sharesEachDate.forEach((value, tradeDayTempTicker) => {
            const isUsMarketOpen =
              value.code === 'us' && now.getTime() < usMarketOpen.getTime()
            const isTwMarketOpen =
              value.code === 'tw' && now.getTime() < twMarketOpen.getTime()

            if (
              // ＋且昨天有交易?
              (isUsMarketOpen || isTwMarketOpen) &&
              tempticker !== tradeDayTempTicker //當日個股closePriceMap中沒有價格
            ) {
              const prevClose = closePricesMap.get(
                `${prevDate}_${tradeDayTempTicker}`
              )
              const exchangeRate = fxRates[value.code]
              notYetOpenTotal += value.shares * prevClose * exchangeRate
            }
          })
        }
        console.log('notYetOpenTotal', notYetOpenTotal)

        prevDate = marketOpenDate
        const total = totalTradeValue + totalNonTradeValue + notYetOpenTotal
        totalValueMap.set(marketOpenDate, {
          acc: parseFloatByDecimal(total, 2)
        })
      }

      return { totalValueMap, historyMap }
    }

    function adjustDate(yyyymmdd, sign, multiplier = 1) {
      const unix = Date.parse(yyyymmdd)
      // 加一天（84600000）才能要得到當天資料，例如結束日期為 1/27，實際上 fetch 的資料範圍結束日為 1/26
      let dateObj

      if (sign === 'plus') {
        dateObj = new Date(unix + 84600000 * multiplier)
      } else if (sign === 'minus') {
        dateObj = new Date(unix - 84600000 * multiplier)
      } else {
        dateObj = new Date(unix)
      }

      const dd = String(dateObj.getDate()).padStart(2, '0')
      const mm = String(dateObj.getMonth() + 1).padStart(2, '0')
      const yyyy = dateObj.getFullYear()
      // console.log('adjustDate', sign, yyyy + '-' + mm + '-' + dd)

      return yyyy + '-' + mm + '-' + dd
    }
  })
})

exports.deleteClosePrice = functions
  .region('asia-east1')
  .https.onRequest((req, res) => {
    return cors(req, res, async () => {
      try {
        await closeCacheRef.remove()

        res.send({
          success: true,
          content: 'deletion done',
          errorMessage: null,
          result: null
        })
      } catch (error) {
        res.send({
          success: false,
          content: 'deletion failed',
          errorMessage: error.message,
          result: null
        })
      }
    })
  })

// WATCHLIST PAGE
exports.addToWatchlist = functions
  .region('asia-east1')
  .https.onRequest((req, res) => {
    return cors(req, res, async () => {
      const { listName } = req.query
      const { tickerItem } = req.body
      const list = listName.toLowerCase() === 'watchlist' ? 'default' : listName

      try {
        const snapshot = await watchlistRef.child(list).once('value')
        if (snapshot.numChildren() >= 5) {
          return res.send({
            success: false,
            content: 'Adding stock failed',
            errorMessage: 'Hire Andy Hsieh to add more stocks! :)',
            result: null
          })
        }

        await watchlistRef
          .child(list)
          .child(tickerItem.tempTicker)
          .set(tickerItem)

        const message = {
          success: true,
          content: '標的新增成功',
          errorMessage: null,
          result: tickerItem
        }
        res.send(message)
      } catch (error) {
        const message = {
          success: true,
          content: '標的新增失敗',
          errorMessage: error.message,
          result: null
        }
        res.send(message)
      }
    })
  })

exports.deleteFromWatchlist = functions
  .region('asia-east1')
  .https.onRequest((req, res) => {
    return cors(req, res, async () => {
      try {
        const listName = req.query.listName
        const deleteInfoArr = JSON.parse(req.query.deleteInfoArr)

        if (deleteInfoArr.length === 0) return

        const list =
          listName.toLowerCase() === 'watchlist' ? 'default' : listName

        for (let i = 0; i < deleteInfoArr.length; i++) {
          const ticker = deleteInfoArr[i]
          await watchlistRef.child(list).child(ticker).remove()
        }

        const message = {
          success: true,
          content: '刪除成功',
          errorMessage: null,
          result: deleteInfoArr
        }
        res.send(message)
      } catch (error) {
        console.log('error', error)
        const message = {
          success: false,
          content: '刪除失敗',
          errorMessage: error.message,
          result: null
        }
        res.send(message)
      }
    })
  })

exports.updateTicker = functions
  .region('asia-east1')
  .https.onRequest((req, res) => {
    return cors(req, res, async () => {
      try {
        const { listName, ticker } = req.query
        const { newItem } = req.body
        const {
          price,
          previousCloseChange,
          previousCloseChangePercent,
          marketState
        } = newItem

        const list =
          listName.toLowerCase() === 'watchlist' ? 'default' : listName

        const tickerRef = watchlistRef.child(list).child(ticker)
        const priceRef = tickerRef.child('price').set(price)
        const previousCloseChangeRef = tickerRef
          .child('previousCloseChange')
          .set(previousCloseChange)
        const previousCloseChangePercentRef = tickerRef
          .child('previousCloseChangePercent')
          .set(previousCloseChangePercent)
        const previousMarketStateRef = tickerRef
          .child('marketState')
          .set(marketState)

        await Promise.allSettled([
          priceRef,
          previousCloseChangeRef,
          previousCloseChangePercentRef,
          previousMarketStateRef
        ])

        const msg = {
          success: true,
          content: '更新 watchlist 成功',
          errorMessage: null,
          result: ticker
        }
        res.send(msg)
      } catch (error) {
        const msg = {
          success: true,
          content: '更新 watchlist 失敗',
          errorMessage: error.message,
          result: null
        }
        res.send(msg)
      }
    })
  })

exports.tickers = functions.region('asia-east1').https.onRequest((req, res) => {
  return cors(req, res, async () => {
    const listName = req.query.listName
    const list = listName.toLowerCase() === 'watchlist' ? 'default' : listName

    try {
      const watchlistChildRef = await watchlistRef.child(list).once('value')
      const watchlist = Object.values(watchlistChildRef.val())

      const msg = {
        success: true,
        content: '獲得 watchlist',
        errorMessage: null,
        result: watchlist
      }

      res.send(msg)
    } catch (error) {
      console.log('error', error.message)
      const msg = {
        success: false,
        content: '獲得標的失敗',
        errorMessage: error.message,
        result: null
      }
      res.send(msg)
    }
  })
})

exports.createWatchlist = functions
  .region('asia-east1')
  .https.onRequest((req, res) => {
    return cors(req, res, async () => {
      const initTabs = await tabsRef.once('value')

      if (initTabs.numChildren() >= 5) {
        return res.send({
          success: false,
          content: 'Adding watchlist failed',
          errorMessage: 'Hire Andy Hsieh to add more watchlist! :)',
          result: null
        })
      }

      const { listName } = req.query
      const omitName = ['null', 'undefined', '']
      const DEFAULT_TAB = 'Watchlist'

      const hasTabsArray = initTabs.val()?.length
      const hasSameTab = initTabs.val()?.includes(listName)
      const isOmitName = omitName.includes(listName)

      if (listName && hasTabsArray && !hasSameTab && !isOmitName) {
        return setTabs(listName)
      }

      if (!hasTabsArray) return setTabs(DEFAULT_TAB)

      const message = {
        success: false,
        content: '新增失敗',
        errorMessage: null,
        result: null
      }

      if (isOmitName) {
        message.errorMessage = 'Input must not be empty'
      } else if (hasSameTab) {
        message.errorMessage = 'Watchlist already exists'
      }

      res.send(message)

      async function setTabs(newTab) {
        const tabs =
          initTabs.val() == null
            ? [DEFAULT_TAB, listName]
            : [...initTabs.val(), listName]
        const tabsInfo = await getTabsInfo(tabs)
        let message = null

        try {
          await tabsRef.set(tabs)
          message = {
            success: true,
            content: '新增成功',
            errorMessage: null,
            result: { newTab, tabsInfo }
          }
        } catch (error) {
          message = {
            success: false,
            content: '新增失敗',
            errorMessage: error.message,
            result: null
          }
        }

        res.send(message)
      }
    })
  })

exports.deleteWatchlist = functions
  .region('asia-east1')
  .https.onRequest((req, res) => {
    return cors(req, res, async () => {
      try {
        const { listName } = req.query
        const tabs = await tabsRef.once('value')
        const newTabs = tabs.val().filter((tab) => tab !== listName)
        const tabsInfo = await getTabsInfo(newTabs)

        await tabsRef.set(newTabs)
        await watchlistRef.child(listName).remove()

        const message = {
          success: true,
          content: '刪除成功',
          errorMessage: null,
          result: tabsInfo
        }

        res.send(message)
      } catch (error) {
        const message = {
          success: false,
          content: '刪除失敗',
          errorMessage: error.message,
          result: null
        }
        res.send(message)
      }
    })
  })

exports.watchlist = functions
  .region('asia-east1')
  .https.onRequest((req, res) => {
    return cors(req, res, async () => {
      try {
        const DEFAULT_TAB = 'Watchlist'
        const initTabs = await tabsRef.once('value')

        let tabsInfo
        if (initTabs.val() == null) {
          await tabsRef.set([DEFAULT_TAB])
          tabsInfo = [{ name: DEFAULT_TAB, listLength: 0 }]
        } else {
          tabsInfo = await getTabsInfo(initTabs.val())
        }

        const message = {
          success: true,
          content: '成功獲得所有頁籤',
          errorMessage: null,
          result: tabsInfo
        }
        res.send(message)
      } catch (error) {
        const message = {
          success: false,
          content: '獲得頁籤失敗',
          errorMessage: error.message,
          result: null
        }
        console.log('error.message', error.message)
        res.send(message)
      }
    })
  })

exports.renameWatchlist = functions
  .region('asia-east1')
  .https.onRequest((req, res) => {
    return cors(req, res, async () => {
      const { oldName, newName } = req.query
      const emptyInput = !newName || newName.length === 0

      let message = {
        success: false,
        content: '編輯失敗',
        errorMessage: null,
        result: null
      }

      if (oldName === newName) {
        message.errorMessage = 'Please rename watchlist'
        res.send(message)
        return
      }
      if (emptyInput) {
        message.errorMessage = 'Input must not be empty'
        res.send(message)
        return
      }

      try {
        const tabs = await tabsRef.once('value')
        const allTabs = tabs.val()
        const isTabRepeated = allTabs.includes(newName)

        if (isTabRepeated) {
          message.errorMessage = 'Watchlist already exists'
          res.send(message)
          return
        }

        const idx = allTabs.indexOf(oldName)
        allTabs.splice(idx, 1, newName)
        await tabsRef.set(allTabs)

        const targetList = await watchlistRef.child(oldName).once('value')
        const isTargetListEmpty = targetList.val() == null

        if (!isTargetListEmpty) {
          await watchlistRef.child(oldName).remove()
          await watchlistRef.child(newName).set(targetList.val())
        }

        const tabsInfo = await getTabsInfo(allTabs)
        message = {
          success: true,
          content: '編輯成功',
          errorMessage: null,
          result: { newName, tabsInfo }
        }

        res.send(message)
      } catch (error) {
        const message = {
          success: false,
          content: '編輯失敗',
          errorMessage: error.message,
          result: null
        }
        res.send(message)
      }
    })
  })

exports.latestMarketData = functions
  .region('asia-east1')
  .https.onRequest((req, res) => {
    return cors(req, res, async () => {
      const quoteOptions = {
        symbol: req.query.ticker,
        modules: ['price']
      }

      try {
        const { price } = await yahooFinance.quote(quoteOptions)

        const {
          regularMarketPrice: currentPrice,
          regularMarketPreviousClose: previousClose,
          marketState
        } = price

        const previousCloseChange =
          parseFloat(currentPrice - previousClose) > 0
            ? '+' + parseFloat(currentPrice - previousClose).toFixed(2)
            : parseFloat(currentPrice - previousClose).toFixed(2)

        const previousCloseChangePercent = parseFloat(
          ((currentPrice - previousClose) / previousClose) * 100
        ).toFixed(2)

        const obj = {
          price: parseFloat(currentPrice.toFixed(2)),
          previousCloseChange,
          previousCloseChangePercent,
          marketState
        }

        const message = {
          success: true,
          content: '取得最新價成功',
          errorMessage: null,
          result: obj
        }

        res.send(message)
      } catch (error) {
        console.log('error', error)
        const message = {
          success: false,
          content: '取得失敗',
          errorMessage: error.message,
          result: null
        }

        res.send(message)
      }
    })
  })

async function getTabsInfo(tabs) {
  const DEFAULT_TAB = 'Watchlist'
  const watchlistsRef = await watchlistRef.once('value')

  const tabsInfo = tabs.map((tab) => {
    const list =
      tab !== DEFAULT_TAB
        ? watchlistsRef.val()?.[tab]
        : watchlistsRef.val()?.['default']
    const listLength = list ? Object.keys(list).length : 0

    return {
      name: tab,
      listLength
    }
  })

  return tabsInfo
}

// STOCKINFO PAGE
exports.financialData = functions
  .region('asia-east1')
  .https.onRequest((req, res) => {
    return cors(req, res, async () => {
      const quoteOptions = {
        symbol: req.query.ticker,
        modules: ['earnings', 'financialData']
      }

      try {
        const { earnings, financialData } = await yahooFinance.quote(
          quoteOptions
        )

        const {
          quickRatio,
          currentRatio,
          freeCashflow,
          operatingCashflow,
          returnOnAssets,
          returnOnEquity,
          revenueGrowth,
          totalRevenue,
          grossProfits,
          grossMargins,
          operatingMargins,
          ebitda,
          ebitdaMargins,
          profitMargins
        } = financialData

        const stock = {
          Profitability: {
            ROA: returnOnAssets,
            ROE: returnOnEquity
          },
          Liquidity: {
            'Quick Ratio': quickRatio,
            'Current Ratio': currentRatio
          },
          'Cash Flow': {
            'Free Cash Flow': freeCashflow,
            'Operating Cash Flow': operatingCashflow
          },
          IncomeStatement: {
            'Total Revenue': totalRevenue,
            'Gross Profit': grossProfits,
            'Operating Income': operatingMargins * totalRevenue,
            EBITDA: ebitda,
            'Net Profit': profitMargins * totalRevenue
          },
          IncomeStatementMargin: {
            'Revenue Growth': revenueGrowth,
            'Gross Margin': grossMargins,
            'Operating Margin': operatingMargins,
            'EBITDA Margin': ebitdaMargins,
            'Profit Margin': profitMargins
          },
          earnings
        }

        const message = {
          success: true,
          content: '取得成功',
          errorMessage: null,
          result: stock
        }

        res.send(message)
      } catch (error) {
        console.log('getFinancialData error', error)
        const message = {
          success: false,
          content: '取得失敗',
          errorMessage: error.message,
          result: null
        }

        res.send(message)
      }
    })
  })

exports.tickerSummary = functions
  .region('asia-east1')
  .https.onRequest((req, res) => {
    return cors(req, res, async () => {
      const quoteOptions = {
        symbol: req.query.ticker,
        modules: ['summaryProfile', 'summaryDetail', 'price']
      }

      try {
        const { summaryProfile, summaryDetail, price } =
          await yahooFinance.quote(quoteOptions)

        let ticker = null
        const { exchangeName, quoteType, marketState } = price

        if (quoteType === 'ETF') {
          const { longBusinessSummary } = summaryProfile
          const {
            yield,
            fiftyTwoWeekLow,
            fiftyTwoWeekHigh,
            dayLow,
            dayHigh,
            averageVolume,
            totalAssets,
            trailingPE,
            navPrice
          } = summaryDetail

          ticker = {
            profile: {
              longBusinessSummary
            },
            price: {
              exchangeName,
              quoteType,
              marketState
            },
            detail: {
              range: {
                'Day Range': {
                  low: dayLow.toFixed(2),
                  high: dayHigh.toFixed(2)
                },
                '52 Week Range': {
                  low: fiftyTwoWeekLow.toFixed(2),
                  high: fiftyTwoWeekHigh.toFixed(2)
                }
              },
              fixed: {
                'Total Assets': numberWithCommas(totalAssets),
                'Avg. Volume': numberWithCommas(averageVolume),
                'Nav Price': navPrice?.toFixed(2) || '---',
                'Trailing PE': trailingPE?.toFixed(2) || '---',
                Yield: `${parseFloat((yield * 100).toFixed(2))}%`
              }
            }
          }
        }

        if (quoteType === 'EQUITY') {
          const {
            longBusinessSummary,
            fullTimeEmployees,
            sector,
            website,
            city,
            state,
            country
          } = summaryProfile

          const {
            dividendYield,
            exDividendDate,
            beta,
            trailingPE,
            forwardPE,
            fiftyTwoWeekLow,
            fiftyTwoWeekHigh,
            dayLow,
            dayHigh,
            marketCap,
            averageVolume
          } = summaryDetail

          ticker = {
            profile: {
              longBusinessSummary,
              website,
              address: `${city}, ${state}, ${country}`,
              fullTimeEmployees: numberWithCommas(fullTimeEmployees),
              sector,
              country
            },
            price: {
              exchangeName,
              marketState,
              quoteType: quoteType === 'EQUITY' ? 'Equity' : quoteType
            },
            detail: {
              range: {
                'Day Range': {
                  low: dayLow.toFixed(2),
                  high: dayHigh.toFixed(2)
                },
                '52 Week Range': {
                  low: fiftyTwoWeekLow.toFixed(2),
                  high: fiftyTwoWeekHigh.toFixed(2)
                }
              },
              fixed: {
                'Market Cap': numberWithCommas(marketCap),
                'Avg. Volume': numberWithCommas(averageVolume),
                'Trailing PE': trailingPE?.toFixed(2) || '---',
                'Forward PE': forwardPE?.toFixed(2) || '---',
                Beta: beta?.toFixed(2) || '---',
                'Dividend Yield': dividendYield
                  ? `${parseFloat((dividendYield * 100).toFixed(2))}%`
                  : '---',
                'Ex-dividend Date': exDividendDate
                  ? `${exDividendDate.getFullYear()}-${
                      exDividendDate.getMonth() + 1
                    }-${exDividendDate.getDate()}`
                  : '---'
              }
            }
          }
        }

        const message = {
          success: true,
          content: '取得成功',
          errorMessage: null,
          result: ticker
        }

        res.send(message)
      } catch (error) {
        console.log('getTickerSummary error', error)
        const message = {
          success: false,
          content: '取得失敗',
          errorMessage: error.message,
          result: null
        }

        res.send(message)
      }
    })
  })

exports.historicalPrice = functions
  .region('asia-east1')
  .https.onRequest((req, res) => {
    return cors(req, res, async () => {
      const timespan = req.query.timespan

      switch (timespan) {
        case '1Y':
          await getPriceByTimespan(365)
          break
        case '5Y':
          await getPriceByTimespan(1825)
          break
      }

      async function getPriceByTimespan(totalTimespan) {
        const ticker = req.query.ticker

        const window = {
          to: getFormattedDate(0),
          from: getFormattedDate(totalTimespan)
        }

        try {
          const quotePromise = yahooFinance.quote({
            symbol: ticker,
            modules: ['price']
          })
          const historicalPromise = yahooFinance.historical({
            symbols: [ticker],
            ...window,
            period: 'd'
          })

          const [quoteResult, historicalResult] = await Promise.allSettled([
            quotePromise,
            historicalPromise
          ])
          const { regularMarketPrice, regularMarketTime } =
            quoteResult.value.price
          const historicalData = historicalResult.value[ticker]
          const priceMap = new Map()

          // 因各市場時間差， historical 模組沒提供當日收盤後資料，要另外用 quote 模組取得
          // 例如：台灣時間 11/2 收盤後，historical 模組只提供到 11/1 的資料，但同一時間美國還在 11/1，所以台股資料會少一天，美股則是完整的
          const hasLatestPrice =
            regularMarketPrice.toFixed(2) ===
            historicalData[0].close?.toFixed(2)

          if (!hasLatestPrice) {
            priceMap.set(
              regularMarketTime.toLocaleDateString(),
              parseFloat(regularMarketPrice.toFixed(2))
            )
          }

          for (let i = 0; i < historicalData.length; i++) {
            const dayData = historicalData[i]
            if (!dayData.close) continue
            const year = dayData.date.getFullYear()
            const month = dayData.date.getMonth() + 1
            const date = dayData.date.getDate()
            const fullDate = `${year}/${month}/${date}`
            priceMap.set(fullDate, parseFloat(dayData.close.toFixed(2)))
          }

          const message = {
            success: true,
            content: '取得成功',
            errorMessage: null,
            result: {
              close: [...priceMap]
            }
          }

          res.send(message)
        } catch (error) {
          console.log('error', error)
          const message = {
            success: false,
            content: '取得失敗',
            errorMessage: error.message,
            result: null
          }

          res.send(message)
        }
      }
    })
  })

// exports.fxRates = functions.region('asia-east1').https.onRequest((req, res) => {
//   return cors(req, res, async () => {})
// })

// exports.fxRates = functions.region('asia-east1').https.onRequest((req, res) => {
//   return cors(req, res, async () => {})
// })
