// fileSharing.js
import { pipe } from 'it-pipe'
import * as lp from 'it-length-prefixed'
import { fromString as uint8ArrayFromString } from 'uint8arrays/from-string'
import { toString as uint8ArrayToString } from 'uint8arrays/to-string'
import all from 'it-all'
import { peerIdFromString } from '@libp2p/peer-id'

const FILE_SHARING_PROTOCOL = '/file-sharing/1.0.0'
const FILE_ANNOUNCE_TOPIC = 'file-announce-v1'

export class FileSharing {
  constructor(libp2p) {
    this.libp2p = libp2p
    this.sharedFiles = new Map()
    this.availableFiles = new Map()
    this.setupProtocol()

    // Verify protocol handler is registered
    this.verifyProtocolSetup()
  }

  verifyProtocolSetup() {
    const registeredProtocols = this.libp2p.getProtocols()
    console.log('Registered protocols:', registeredProtocols)
    
    if (!registeredProtocols.includes(FILE_SHARING_PROTOCOL)) {
      console.warn('File sharing protocol not found in registered protocols!')
    }
  }

  setupProtocol() {
    // Remove any existing handler first
    try {
      this.libp2p.unhandle(FILE_SHARING_PROTOCOL)
    } catch (err) {
      // Ignore if no handler exists
    }

    // Register new handler
    this.libp2p.handle(FILE_SHARING_PROTOCOL, async ({ connection, stream }) => {
      console.log('Handling incoming protocol stream from:', connection.remotePeer.toString())
      
      try {
        const data = await pipe(
          stream.source,
          lp.decode(),
          async function (source) {
            const arr = await all(source)
            return uint8ArrayToString(arr[0])
          }
        )

        const { type, fileId } = JSON.parse(data)
        console.log('Received file request:', { type, fileId })
        
        if (type === 'request' && this.sharedFiles.has(fileId)) {
          const fileData = this.sharedFiles.get(fileId)
          console.log('Sending file data for:', fileId)
          
          await pipe(
            [uint8ArrayFromString(JSON.stringify(fileData))],
            lp.encode(),
            stream.sink
          )
          console.log('File data sent successfully:', fileId)
        } else {
          console.warn('Invalid request or file not found:', { type, fileId })
          await pipe(
            [uint8ArrayFromString(JSON.stringify({ error: 'File not found or invalid request' }))],
            lp.encode(),
            stream.sink
          )
        }
      } catch (err) {
        console.error('Error handling protocol stream:', err)
        try {
          await pipe(
            [uint8ArrayFromString(JSON.stringify({ error: err.message }))],
            lp.encode(),
            stream.sink
          )
        } catch (sendErr) {
          console.error('Failed to send error response:', sendErr)
        }
      }
    })

    console.log('Protocol handler setup complete for:', FILE_SHARING_PROTOCOL)
  }

  async shareFile(file) {
    console.log('Starting file share process for:', file.name)
    const fileId = Math.random().toString(36).substr(2, 9)
    
    return new Promise((resolve, reject) => {
      const reader = new FileReader()
      
      reader.onload = async () => {
        try {
          const fileData = {
            id: fileId,
            name: file.name,
            type: file.type,
            size: file.size,
            data: reader.result,
            timestamp: Date.now()
          }
          
          this.sharedFiles.set(fileId, fileData)
          console.log('File processed and stored:', fileId)
          
          // Announce the file
          await this.announceFile(fileData)
          resolve(fileId)
        } catch (err) {
          reject(err)
        }
      }
      
      reader.onerror = () => reject(reader.error)
      reader.readAsDataURL(file)
    })
  }

  async announceFile(fileData) {
    const announcement = {
      peerId: this.libp2p.peerId.toString(),
      fileId: fileData.id,
      fileName: fileData.name,
      fileSize: fileData.size,
      timestamp: Date.now()
    }

    const peers = this.libp2p.services.pubsub.getPeers()
    console.log('Connected peers before announce:', peers.length)
    console.log('Peers subscribed to topic:', 
      this.libp2p.services.pubsub.getSubscribers(FILE_ANNOUNCE_TOPIC).length
    )

    await this.libp2p.services.pubsub.publish(
      FILE_ANNOUNCE_TOPIC,
      new TextEncoder().encode(JSON.stringify(announcement))
    )
    console.log('File announced:', announcement)
    this.handleFileAnnouncement(announcement);
  }

  handleFileAnnouncement(announcement) {
    const { peerId, fileId, fileName, fileSize, timestamp } = announcement
    if (peerId === this.libp2p.peerId.toString()) return

    const fileInfo = { peerId, fileId, fileName, fileSize, timestamp }
    this.availableFiles.set(fileId, fileInfo)
    console.log('New file available:', fileInfo)
    return fileInfo
  }

  async requestFile(peerId, fileId) {
    try {
      console.log('Starting file request process...')
      console.log('Current peer ID:', this.libp2p.peerId.toString())
      console.log('Target peer ID:', peerId)
      
      // Convert string peerId to PeerId object if it's a string
      let peerIdObj
      try {
        peerIdObj = typeof peerId === 'string' ? peerIdFromString(peerId) : peerId
        console.log('Converted peer ID:', peerIdObj.toString())
      } catch (err) {
        throw new Error(`Invalid peer ID format: ${err.message}`)
      }

      console.log('Attempting to establish protocol stream...')
      const stream = await this.libp2p.dialProtocol(peerIdObj, FILE_SHARING_PROTOCOL)
      
      if (!stream) {
        throw new Error('Protocol stream establishment failed')
      }

      console.log('stream:', stream);
      
      
      console.log('Protocol stream established successfully')

      // Send request
      console.log('Sending file request...')
      
      await pipe(
        [uint8ArrayFromString(JSON.stringify({ type: 'request', fileId }))],
        lp.encode(),
        stream.sink
      )

      // Wait for response
      console.log('Waiting for response...')
      const response = await pipe(
        stream.source,
        lp.decode(),
        async function (source) {
          const arr = await all(source)
          return JSON.parse(uint8ArrayToString(arr[0]))
        }
      )

      if (response.error) {
        throw new Error(`Peer response error: ${response.error}`)
      }

      console.log('File received successfully')
      return response

    } catch (err) {
      console.error('Detailed error in requestFile:', {
        message: err.message,
        stack: err.stack,
        name: err.name
      })
      throw new Error(`Failed to request file: ${err.message}`)
    }
  }

  getSharedFiles() {
    return Array.from(this.sharedFiles.values())
  }

  getAvailableFiles() {
    return Array.from(this.availableFiles.values())
  }
}