// @ts-check
import { createLibp2p } from 'libp2p'
import { identify } from '@libp2p/identify'
import { noise } from '@chainsafe/libp2p-noise'
import { yamux } from '@chainsafe/libp2p-yamux'
import { multiaddr } from '@multiformats/multiaddr'
import { gossipsub } from '@chainsafe/libp2p-gossipsub'
import { webSockets } from '@libp2p/websockets'
import { webTransport } from '@libp2p/webtransport'
import { webRTC, webRTCDirect } from '@libp2p/webrtc'
import { circuitRelayTransport, circuitRelayServer } from '@libp2p/circuit-relay-v2'
import { enable, disable } from '@libp2p/logger'
import { pubsubPeerDiscovery } from '@libp2p/pubsub-peer-discovery'
import { PUBSUB_PEER_DISCOVERY } from './constants'
import { update, getPeerTypes, getAddresses, getPeerDetails } from './utils'
import { bootstrap } from '@libp2p/bootstrap'
import * as filters from '@libp2p/websockets/filters'

import { FileSharing } from './fileSharing.js'
const FILE_ANNOUNCE_TOPIC = 'file-announce-v1'

const App = async () => {
  const libp2p = await createLibp2p({
    addresses: {
      listen: [ 
        // 👇 Listen for webRTC connection
        '/webrtc',
      ],
    },
    transports: [
      webSockets({
        // Allow all WebSocket connections inclusing without TLS
        filter: filters.all,
      }),
      webTransport(),
      webRTC(),
      // // 👇 Required to create circuit relay reservations in order to hole punch browser-to-browser WebRTC connections
      circuitRelayTransport({
        discoverRelays: 1,
      }),
    ],
    connectionEncryption: [noise()],
    streamMuxers: [yamux()],
    connectionGater: {
      // Allow private addresses for local testing
      denyDialMultiaddr: async () => false,
    },
    peerDiscovery: [
      bootstrap({
        list: [
          '/ip4/35.200.242.137/tcp/9001/ws/p2p/12D3KooWCVPjKKKNoiRJzjAHGY2TBBSgS5J4eLJde5Eijop2qGxv',
          '/ip4/35.200.242.137/tcp/9002/p2p/12D3KooWCVPjKKKNoiRJzjAHGY2TBBSgS5J4eLJde5Eijop2qGxv'
        ],
      }),
      pubsubPeerDiscovery({
        interval: 1000,
        topics: [PUBSUB_PEER_DISCOVERY],
      }),
    ],
    services: {
      pubsub: gossipsub(),
      identify: identify(),
    },
  })

  // Initialize file sharing
  const fileSharing = new FileSharing(libp2p)
  globalThis.libp2p = libp2p
  globalThis.fileSharing = fileSharing

  // Subscribe to file announcements as soon as possible
  await libp2p.services.pubsub.subscribe(FILE_ANNOUNCE_TOPIC)
  console.log(`Subscribed to ${FILE_ANNOUNCE_TOPIC}`)
  
  const DOM = {
    nodePeerId: () => document.getElementById('output-node-peer-id'),
    nodeStatus: () => document.getElementById('output-node-status'),
    nodePeerCount: () => document.getElementById('output-peer-count'),
    nodePeerTypes: () => document.getElementById('output-peer-types'),
    nodePeerDetails: () => document.getElementById('output-peer-details'),
    nodeAddressCount: () => document.getElementById('output-address-count'),
    nodeAddresses: () => document.getElementById('output-addresses'),

    inputMultiaddr: () => document.getElementById('input-multiaddr'),
    connectButton: () => document.getElementById('button-connect'),
    loggingButtonEnable: () => document.getElementById('button-logging-enable'),
    loggingButtonDisable: () => document.getElementById('button-logging-disable'),
    outputQuery: () => document.getElementById('output'),

    fileInput: () => document.getElementById('file-input'),
    sharedFilesList: () => document.getElementById('shared-files-list'),
    availableFilesList: () => document.getElementById('available-files-list'),
    uploadStatus: () => document.getElementById('upload-status'),
    peerStatus: () => document.getElementById('peer-status'),
  }

  update(DOM.nodePeerId(), libp2p.peerId.toString())
  update(DOM.nodeStatus(), 'Online')

  // Track peer connections
  libp2p.addEventListener('peer:connect', async (event) => {
    const peerId = event.detail.toString()
    console.log('Connected to peer:', peerId)
    updatePeerStatus()
    
    // Share existing files with new peer
    const sharedFiles = fileSharing.getSharedFiles()
    for (const file of sharedFiles) {
      await fileSharing.announceFile(file)
    }
  })

  libp2p.addEventListener('peer:disconnect', (event) => {
    const peerId = event.detail.toString()
    console.log('Disconnected from peer:', peerId)
    updatePeerStatus()
  })

   // Handle file upload
   DOM.fileInput().addEventListener('change', async (event) => {
    const file = event.target.files[0]
    if (!file) return

    const statusEl = DOM.uploadStatus()
    try {
      statusEl.textContent = 'Processing file...'
      const fileId = await fileSharing.shareFile(file)
      statusEl.textContent = 'File shared successfully!'
      updateSharedFilesList()
      setTimeout(() => statusEl.textContent = '', 3000)
    } catch (err) {
      console.error('Error sharing file:', err)
      statusEl.textContent = `Error: ${err.message}`
      setTimeout(() => statusEl.textContent = '', 5000)
    }
  })

  // Listen for file announcements
  libp2p.services.pubsub.addEventListener('message', async (message) => {
    // console.log('topic:', message.detail.topic);
    
    if (message.detail.topic !== FILE_ANNOUNCE_TOPIC) return
    
    try {
      const announcement = JSON.parse(new TextDecoder().decode(message.detail.data))
      const fileInfo = fileSharing.handleFileAnnouncement(announcement)
      if (fileInfo) {
        updateAvailableFilesList()
      }
    } catch (err) {
      console.error('Error processing file announcement:', err)
    }
  })

  function updatePeerStatus() {
    const peers = libp2p.services.pubsub.getPeers()
    const topicPeers = libp2p.services.pubsub.getSubscribers(FILE_ANNOUNCE_TOPIC)
    const status = `Connected peers: ${peers.length}, Subscribed to topic: ${topicPeers.length}`
    update(DOM.peerStatus(), status)
    console.log(status)
  }

  function updateSharedFilesList() {
    const list = DOM.sharedFilesList()
    list.innerHTML = ''
    
    for (const file of fileSharing.getSharedFiles()) {
      const li = document.createElement('li')
      li.className = 'flex items-center gap-2 mb-2'
      li.innerHTML = `
        <span>${file.name} (${formatFileSize(file.size)})</span>
        <button class="bg-red-500 hover:bg-red-700 text-white text-sm py-1 px-2 rounded"
          onclick="removeSharedFile('${file.id}')">
          Remove
        </button>
      `
      list.appendChild(li)
    }
  }

  function updateAvailableFilesList() {
    const list = DOM.availableFilesList()
    list.innerHTML = ''
    
    for (const file of fileSharing.getAvailableFiles()) {
      const li = document.createElement('li')
      li.className = 'flex items-center gap-2 mb-2'
      li.innerHTML = `
        <span>${file.fileName} (${formatFileSize(file.fileSize)})</span>
        <button class="bg-blue-500 hover:bg-blue-700 text-white text-sm py-1 px-2 rounded"
          onclick="downloadFile('${file.peerId}', '${file.fileId}')">
          Download
        </button>
      `
      list.appendChild(li)
    }
  }


  // Set up interval updates
  setInterval(() => {
    update(DOM.nodePeerCount(), libp2p.getConnections().length)
    update(DOM.nodePeerTypes(), getPeerTypes(libp2p))
    update(DOM.nodeAddressCount(), libp2p.getMultiaddrs().length)
    update(DOM.nodeAddresses(), getAddresses(libp2p))
    update(DOM.nodePeerDetails(), getPeerDetails(libp2p))
    updatePeerStatus()
  }, 1000)

  // Add global functions for button handlers
  window.removeSharedFile = (fileId) => {
    fileSharing.sharedFiles.delete(fileId)
    updateSharedFilesList()
  }

  window.downloadFile = async (peerId, fileId) => {
    const statusEl = DOM.uploadStatus()
    try {
      statusEl.textContent = 'Downloading file...'
      const fileData = await fileSharing.requestFile(peerId, fileId)
      
      // Create and trigger download
      const a = document.createElement('a')
      a.href = fileData.data
      a.download = fileData.name
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      
      statusEl.textContent = 'File downloaded successfully!'
      setTimeout(() => statusEl.textContent = '', 3000)
    } catch (err) {
      console.error('Error downloading file:', err)
      statusEl.textContent = `Error downloading: ${err.message}`
      setTimeout(() => statusEl.textContent = '', 5000)
    }
  }

  function formatFileSize(bytes) {
    const units = ['B', 'KB', 'MB', 'GB']
    let size = bytes
    let unitIndex = 0
    
    while (size >= 1024 && unitIndex < units.length - 1) {
      size /= 1024
      unitIndex++
    }
    
    return `${size.toFixed(1)} ${units[unitIndex]}`
  }
}

App().catch((err) => {
  console.error(err) // eslint-disable-line no-console
})
