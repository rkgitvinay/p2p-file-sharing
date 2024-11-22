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
          '/ip4/35.200.242.137/tcp/9001/ws/p2p/12D3KooWLzTm7EtKTQj3oqpEPSRF3ASfre2odjCC2u5foHN1z1QU',
          '/ip4/35.200.242.137/tcp/9002/p2p/12D3KooWLzTm7EtKTQj3oqpEPSRF3ASfre2odjCC2u5foHN1z1QU'
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

  globalThis.libp2p = libp2p

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
  }

  update(DOM.nodePeerId(), libp2p.peerId.toString())
  update(DOM.nodeStatus(), 'Online')

  libp2p.addEventListener('peer:connect', (event) => {
    const peerId = event.detail.toString();
    console.log('Connected to peer:', peerId)
  })
  libp2p.addEventListener('peer:disconnect', (event) => {})

  setInterval(() => {
    update(DOM.nodePeerCount(), libp2p.getConnections().length)
    update(DOM.nodePeerTypes(), getPeerTypes(libp2p))
    update(DOM.nodeAddressCount(), libp2p.getMultiaddrs().length)
    update(DOM.nodeAddresses(), getAddresses(libp2p))
    update(DOM.nodePeerDetails(), getPeerDetails(libp2p))
  }, 1000)
}

App().catch((err) => {
  console.error(err) // eslint-disable-line no-console
})
