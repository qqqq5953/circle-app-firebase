const admin = require('firebase-admin')

admin.initializeApp({
  credential: admin.credential.cert({
    projectId: process.env.FB_PROJECT_ID,
    privateKey: process.env.FB_PRIVATE_KEY?.replace(/\\n/g, '\n'),
    clientEmail: process.env.FB_CLIENT_EMAIL
  }),
  databaseURL:
    'https://cloud-func-test-256db-default-rtdb.asia-southeast1.firebasedatabase.app'
})

const firebaseDb = admin.database()

module.exports = firebaseDb
