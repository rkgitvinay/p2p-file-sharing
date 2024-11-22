// fileSharing.js
import { pipe } from 'it-pipe'
import * as lp from 'it-length-prefixed'
import { fromString as uint8ArrayFromString } from 'uint8arrays/from-string'
import { toString as uint8ArrayToString } from 'uint8arrays/to-string'
import all from 'it-all'

const FILE_SHARING_PROTOCOL = '/file-sharing/1.0.0'
const FILE_ANNOUNCE_TOPIC = 'file-announce-v1'

export class FileSharing {
  constructor(libp2p) {
    this.libp2p = libp2p
    this.sharedFiles = new Map()
    this.availableFiles = new Map()
    this.setupProtocol()
  }

  setupProtocol() {
    this.libp2p.handle(FILE_SHARING_PROTOCOL, async ({ stream }) => {
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
          await pipe(
            [uint8ArrayFromString(JSON.stringify(fileData))],
            lp.encode(),
            stream.sink
          )
          console.log('File data sent:', fileId)
        }
      } catch (err) {
        console.error('Error in file sharing protocol:', err)
      }
    })
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
    console.log('Requesting file:', { peerId, fileId })
    const { stream } = await this.libp2p.dialProtocol(peerId, FILE_SHARING_PROTOCOL)
    
    await pipe(
      [uint8ArrayFromString(JSON.stringify({ type: 'request', fileId }))],
      lp.encode(),
      stream.sink
    )

    const response = await pipe(
      stream.source,
      lp.decode(),
      async function (source) {
        const arr = await all(source)
        return JSON.parse(uint8ArrayToString(arr[0]))
      }
    )

    console.log('File received:', fileId)
    return response
  }

  getSharedFiles() {
    return Array.from(this.sharedFiles.values())
  }

  getAvailableFiles() {
    return Array.from(this.availableFiles.values())
  }
}