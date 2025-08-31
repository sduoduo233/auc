const express = require('express')
const WebSocket = require('ws')
const path = require('path')
const http = require('http')

const app = express()
const port = 9000

const PATH = "/ipuaezrg9uer"

// Middleware to parse form data
app.use(express.urlencoded({ extended: true }))
app.use(express.json())

// Create HTTP server
const server = http.createServer(app)

// Create WebSocket server
const wss = new WebSocket.Server({ server })

// Auction state
let auctionState = {
  currentPrice: null,
  roundActive: false,
  participants: new Map(), // participantId -> { name, connected }
  responses: new Map(), // participantId -> 'yes' | 'no'
  roundResults: null
}

// Broadcast to all connected clients
function broadcast(data) {
  const message = JSON.stringify(data)
  wss.clients.forEach(client => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(message)
    }
  })
}

// WebSocket connection handling
wss.on('connection', (ws, req) => {

  if (req.url !== PATH + "_ws") {
    ws.close(1008, 'Invalid path')
    return
  }

  console.log('New WebSocket connection')
  
  // Send current auction state to new connection
  ws.send(JSON.stringify({
    type: 'auctionState',
    data: {
      currentPrice: auctionState.currentPrice,
      roundActive: auctionState.roundActive,
      participants: Array.from(auctionState.participants.values()),
      roundResults: auctionState.roundResults
    }
  }))
  
  ws.on('message', (message) => {
    try {
      const packet = JSON.parse(message)
      
      switch (packet.type) {
        case 'keepalive':
          // Reply to keepalive packet
          ws.send(JSON.stringify({
            type: 'keepaliveReply',
            data: { timestamp: packet.data.timestamp, serverTime: Date.now() }
          }))
          break
          
        case 'joinAuction':
          const participantId = Date.now().toString()
          auctionState.participants.set(participantId, {
            id: participantId,
            name: packet.data.name,
            connected: true
          })
          ws.participantId = participantId
          
          broadcast({
            type: 'participantJoined',
            data: {
              participant: auctionState.participants.get(participantId),
              participants: Array.from(auctionState.participants.values())
            }
          })
          break
          
        case 'setPrice':
          auctionState.currentPrice = packet.data.price
          auctionState.roundActive = true
          auctionState.responses.clear()
          auctionState.roundResults = null
          
          broadcast({
            type: 'newRound',
            data: {
              price: auctionState.currentPrice,
              roundActive: true
            }
          })
          break
          
        case 'submitResponse':
          if (auctionState.roundActive && ws.participantId) {
            auctionState.responses.set(ws.participantId, packet.data.response)
            
            broadcast({
              type: 'responseCount',
              data: {
                responseCount: auctionState.responses.size,
                totalParticipants: auctionState.participants.size
              }
            })
          }
          break
          
        case 'finishRound':
          if (auctionState.roundActive) {
            auctionState.roundActive = false
            
            // Prepare results
            const results = []
            auctionState.participants.forEach((participant, id) => {
              results.push({
                name: participant.name,
                response: auctionState.responses.get(id) || 'no response'
              })
            })
            
            auctionState.roundResults = results
            
            broadcast({
              type: 'roundFinished',
              data: {
                price: auctionState.currentPrice,
                results: results
              }
            })
          }
          break
      }
    } catch (error) {
      console.error('Error parsing WebSocket message:', error)
    }
  })
  
  ws.on('close', () => {
    if (ws.participantId) {
      auctionState.participants.delete(ws.participantId)
      broadcast({
        type: 'participantLeft',
        data: {
          participants: Array.from(auctionState.participants.values())
        }
      })
    }
  })
})

app.get(PATH, (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'))
})

server.listen(port, () => {
  console.log(`Auction website running on http://localhost:${port}`)
})
