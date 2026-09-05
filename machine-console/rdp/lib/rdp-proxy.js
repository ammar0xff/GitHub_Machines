'use strict';

const tls = require('tls');
const net = require('net');

// ── RDCleanPath ASN.1 DER Constants ──
const VERSION_1 = 3390; // 3389 + 1

// ASN.1 tag constants
const TAG_SEQUENCE = 0x30;
const TAG_INTEGER = 0x02;
const TAG_OCTET_STRING = 0x04;
const TAG_UTF8STRING = 0x0c;

// Context-specific EXPLICIT tags used by RDCleanPath
const TAG_CTX = (n) => 0xa0 + n;

// ────────────────────────────────────────────────────
// ASN.1 DER Low-Level Helpers
// ────────────────────────────────────────────────────

/**
 * Encode ASN.1 DER length bytes.
 */
function derEncodeLength(length) {
    if (length < 0x80) {
        return Buffer.from([length]);
    }
    const bytes = [];
    let temp = length;
    while (temp > 0) {
        bytes.unshift(temp & 0xff);
        temp >>= 8;
    }
    return Buffer.from([0x80 | bytes.length, ...bytes]);
}

/**
 * Wrap content with a tag and proper DER length encoding.
 */
function derWrap(tag, content) {
    const len = derEncodeLength(content.length);
    return Buffer.concat([Buffer.from([tag]), len, content]);
}

/**
 * Encode an integer as ASN.1 DER INTEGER.
 */
function derEncodeInteger(value) {
    if (value === 0) {
        return derWrap(TAG_INTEGER, Buffer.from([0]));
    }
    const bytes = [];
    let temp = value;
    while (temp > 0) {
        bytes.unshift(temp & 0xff);
        temp >>= 8;
    }
    // Add leading zero if high bit set (to keep unsigned)
    if (bytes[0] & 0x80) {
        bytes.unshift(0);
    }
    return derWrap(TAG_INTEGER, Buffer.from(bytes));
}

/**
 * Encode a UTF-8 string as ASN.1 DER UTF8String.
 */
function derEncodeUtf8String(str) {
    return derWrap(TAG_UTF8STRING, Buffer.from(str, 'utf-8'));
}

/**
 * Encode raw bytes as ASN.1 DER OCTET STRING.
 */
function derEncodeOctetString(buf) {
    return derWrap(TAG_OCTET_STRING, buf);
}

/**
 * Wrap content in a context-specific EXPLICIT tag [n].
 */
function derWrapContext(tagNum, content) {
    return derWrap(TAG_CTX(tagNum), content);
}

/**
 * Decode DER length at offset. Returns { length, bytesRead }.
 */
function derDecodeLength(buf, offset) {
    const first = buf[offset];
    if (first < 0x80) {
        return { length: first, bytesRead: 1 };
    }
    const numBytes = first & 0x7f;
    let length = 0;
    for (let i = 0; i < numBytes; i++) {
        length = (length << 8) | buf[offset + 1 + i];
    }
    return { length, bytesRead: 1 + numBytes };
}

/**
 * Decode a DER TLV (Tag-Length-Value) at offset.
 * Returns { tag, value: Buffer, totalLength }.
 */
function derDecodeTLV(buf, offset) {
    const tag = buf[offset];
    const { length, bytesRead } = derDecodeLength(buf, offset + 1);
    const headerLen = 1 + bytesRead;
    const value = buf.slice(offset + headerLen, offset + headerLen + length);
    return { tag, value, totalLength: headerLen + length };
}

/**
 * Decode an ASN.1 DER INTEGER to a JS number.
 */
function derDecodeInteger(buf) {
    let val = 0;
    for (let i = 0; i < buf.length; i++) {
        val = (val << 8) | buf[i];
    }
    return val;
}

/**
 * Decode all TLV elements within a constructed value (SEQUENCE, context tags, etc.).
 * Returns an array of { tag, value, totalLength }.
 */
function derDecodeChildren(buf) {
    const children = [];
    let offset = 0;
    while (offset < buf.length) {
        const tlv = derDecodeTLV(buf, offset);
        children.push(tlv);
        offset += tlv.totalLength;
    }
    return children;
}

// ────────────────────────────────────────────────────
// RDCleanPath PDU Parsing & Encoding
// ────────────────────────────────────────────────────

/**
 * Parse an RDCleanPath Request PDU from DER-encoded bytes.
 *
 * Returns: { destination, proxyAuth, x224ConnectionRequest, preconnectionBlob? }
 */
function parseRDCleanPathRequest(data) {
    const buf = Buffer.isBuffer(data) ? data : Buffer.from(data);

    // Outer SEQUENCE
    const outer = derDecodeTLV(buf, 0);
    if (outer.tag !== TAG_SEQUENCE) {
        throw new Error(`Expected SEQUENCE (0x30), got 0x${outer.tag.toString(16)}`);
    }

    const children = derDecodeChildren(outer.value);

    let version = null;
    let destination = null;
    let proxyAuth = null;
    let x224ConnectionRequest = null;
    let preconnectionBlob = null;

    for (const child of children) {
        const ctxTag = child.tag & 0x1f; // strip class bits to get tag number

        switch (ctxTag) {
            case 0: { // version
                const intTlv = derDecodeTLV(child.value, 0);
                version = derDecodeInteger(intTlv.value);
                break;
            }
            case 2: { // destination
                const strTlv = derDecodeTLV(child.value, 0);
                destination = strTlv.value.toString('utf-8');
                break;
            }
            case 3: { // proxy_auth
                const strTlv = derDecodeTLV(child.value, 0);
                proxyAuth = strTlv.value.toString('utf-8');
                break;
            }
            case 5: { // preconnection_blob
                const strTlv = derDecodeTLV(child.value, 0);
                preconnectionBlob = strTlv.value.toString('utf-8');
                break;
            }
            case 6: { // x224_connection_pdu
                const octTlv = derDecodeTLV(child.value, 0);
                x224ConnectionRequest = octTlv.value;
                break;
            }
        }
    }

    if (version !== VERSION_1) {
        throw new Error(`Unsupported RDCleanPath version: ${version} (expected ${VERSION_1})`);
    }
    if (!destination) {
        throw new Error('Missing destination in RDCleanPath request');
    }
    if (!x224ConnectionRequest) {
        throw new Error('Missing x224_connection_pdu in RDCleanPath request');
    }

    return { destination, proxyAuth, x224ConnectionRequest, preconnectionBlob };
}

/**
 * Build an RDCleanPath Response PDU as DER-encoded bytes.
 *
 * @param {string} serverAddr - Resolved server address (e.g. "192.168.2.31:3389")
 * @param {Buffer} x224Response - X.224 Connection Confirm bytes
 * @param {Buffer[]} certChain - Array of DER-encoded X.509 certificates
 * @returns {Buffer} DER-encoded RDCleanPath response
 */
function buildRDCleanPathResponse(serverAddr, x224Response, certChain) {
    const parts = [];

    // [0] version
    parts.push(derWrapContext(0, derEncodeInteger(VERSION_1)));

    // [6] x224_connection_pdu
    parts.push(derWrapContext(6, derEncodeOctetString(x224Response)));

    // [7] server_cert_chain — SEQUENCE OF OCTET STRING
    const certOctets = certChain.map((cert) => derEncodeOctetString(cert));
    const certSeq = derWrap(TAG_SEQUENCE, Buffer.concat(certOctets));
    parts.push(derWrapContext(7, certSeq));

    // [9] server_addr
    parts.push(derWrapContext(9, derEncodeUtf8String(serverAddr)));

    return derWrap(TAG_SEQUENCE, Buffer.concat(parts));
}

/**
 * Build an RDCleanPath Error PDU as DER-encoded bytes.
 *
 * @param {number} errorCode - 1=general, 2=negotiation
 * @param {number} [httpStatusCode] - optional HTTP status code
 * @returns {Buffer} DER-encoded RDCleanPath error response
 */
function buildRDCleanPathError(errorCode, httpStatusCode) {
    const errParts = [];

    // [0] error_code
    errParts.push(derWrapContext(0, derEncodeInteger(errorCode)));

    // [1] http_status_code (optional)
    if (httpStatusCode != null) {
        errParts.push(derWrapContext(1, derEncodeInteger(httpStatusCode)));
    }

    const errSeq = derWrap(TAG_SEQUENCE, Buffer.concat(errParts));

    const parts = [];
    // [0] version
    parts.push(derWrapContext(0, derEncodeInteger(VERSION_1)));
    // [1] error
    parts.push(derWrapContext(1, errSeq));

    return derWrap(TAG_SEQUENCE, Buffer.concat(parts));
}

// ────────────────────────────────────────────────────
// Network: Destination Parsing
// ────────────────────────────────────────────────────

/**
 * Parse a destination string into { host, port }.
 * Handles IPv6 "[::1]:3389" and regular "host:port" formats.
 * Default port is 3389.
 */
function parseDestination(destination) {
    // IPv6: [host]:port
    if (destination.startsWith('[')) {
        const bracketEnd = destination.indexOf(']');
        if (bracketEnd === -1) throw new Error(`Invalid IPv6 destination: ${destination}`);
        const host = destination.slice(1, bracketEnd);
        const rest = destination.slice(bracketEnd + 1);
        const port = rest.startsWith(':') ? parseInt(rest.slice(1), 10) : 3389;
        return { host, port };
    }

    // Regular host:port
    const lastColon = destination.lastIndexOf(':');
    if (lastColon === -1) {
        return { host: destination, port: 3389 };
    }
    const host = destination.slice(0, lastColon);
    const port = parseInt(destination.slice(lastColon + 1), 10);
    if (isNaN(port)) {
        return { host: destination, port: 3389 };
    }
    return { host, port };
}

// ────────────────────────────────────────────────────
// Network: TCP + X.224 + TLS + Certificate Extraction
// ────────────────────────────────────────────────────

/**
 * Perform the RDCleanPath proxy handshake against an RDP server.
 *
 * Windows runner hosts vary at the OS level, so two server modes must be
 * supported:
 *
 *   A) Plaintext-first ("dance"): send the X.224 Connection Request over raw
 *      TCP, read the Connection Confirm (plaintext), then upgrade the SAME
 *      socket to TLS and extract the self-signed server certificate.
 *      Afterwards the server simply waits — the browser client drives MCS
 *      directly over the relayed TLS.
 *
 *   B) TLS-first: the server answers a TLS ClientHello immediately and expects
 *      the X.224 Connection Request INSIDE TLS. A plaintext CR gets rejected
 *      (ECONNRESET). Complete TLS, send the CR as the first TLS application
 *      data, read the Connection Confirm (decrypted), extract the certificate.
 *
 * The dance is attempted first, then TLS-first on a fresh socket. The selected
 * protocol is captured from the Connection Confirm; RDSTLS was already removed
 * by `forceSslNegotiation`, so SSL(1) is expected.
 *
 * @param {string} host
 * @param {number} port
 * @param {Buffer} x224Request - X.224 Connection Request bytes (SSL-only)
 * @returns {Promise<{ x224Response: Buffer, certChain: Buffer[], tlsSocket: tls.TLSSocket, pending: Buffer[] }>}
 */
function performRDPHandshake(host, port, x224Request) {
    const logPrefix = `[${host}:${port}]`;
    const servername = net.isIP(host) ? undefined : host;
    const ccWaitMs = 4000;
    const tlsWaitMs = 6000;

    function attemptDance() {
        console.log(`${logPrefix} mode A (plaintext CR → CC → TLS upgrade)`);
        return new Promise((resolve, reject) => {
            let finished = false;
            const fail = (msg) => { if (!finished) { finished = true; reject(new Error(msg)); } };
            const ok = (value) => { if (!finished) { finished = true; resolve(value); } };

            const tcpSocket = net.createConnection({ host, port }, () => {
                tcpSocket.setTimeout(ccWaitMs + 2000);
                tcpSocket.write(x224Request);
            });
            tcpSocket.once('error', (err) => fail(`TCP/RDP connection failed: ${err.message}`));
            tcpSocket.on('timeout', () => { tcpSocket.destroy(); fail('dance timed out'); });

            tcpSocket.once('data', (x224Response) => {
                const cc = Buffer.from(x224Response);
                if (cc.length === 0) { tcpSocket.destroy(); fail('RDP server closed without X.224 response'); return; }
                console.log(`${logPrefix} mode A ✓ X.224 Connection Confirm (${cc.length} bytes)`);

                let needsTls = true;
                if (cc[5] === 0xd0 /* CC */ && cc.length >= 19) {
                    const selected = cc.readUInt32LE(15);
                    console.log(`${logPrefix} negotiated protocol=${selected} (mode A)`);
                    if (selected === 0) needsTls = false;
                } else {
                    console.log(`${logPrefix} negotiation type=0x${cc[5].toString(16)} — attempting TLS upgrade`);
                }

                if (!needsTls) {
                    ok({ x224Response: cc, certChain: [], tlsSocket: tcpSocket, pending: [] });
                    return;
                }

                const tlsSocket = tls.connect({ socket: tcpSocket, servername, rejectUnauthorized: false }, () => {
                    tlsSocket.setTimeout(0);
                    console.log(`${logPrefix} mode A ✓ TLS upgrade completed (${tlsSocket.getProtocol()})`);
                    try {
                        const peerCert = tlsSocket.getPeerCertificate(true);
                        const certChain = extractCertChain(peerCert);
                        console.log(`${logPrefix} mode A ✓ Extracted ${certChain.length} certificate(s)`);
                        ok({ x224Response: cc, certChain, tlsSocket, pending: [] });
                    } catch (err) {
                        fail(`Certificate extraction failed: ${err.message}`);
                    }
                });
                tlsSocket.once('error', (err) => fail(`TLS upgrade failed: ${err.message}`));
            });
        });
    }

    function attemptTlsFirst() {
        console.log(`${logPrefix} mode B (TLS first, CR inside TLS)`);
        return new Promise((resolve, reject) => {
            let finished = false;
            const fail = (msg) => { if (!finished) { finished = true; reject(new Error(msg)); } };
            const ok = (value) => { if (!finished) { finished = true; resolve(value); } };

            const tcpSocket = net.createConnection({ host, port });
            tcpSocket.once('error', (err) => fail(`TCP/RDP connection failed: ${err.message}`));

            const tlsSocket = tls.connect({ socket: tcpSocket, servername, rejectUnauthorized: false });
            tlsSocket.setTimeout(tlsWaitMs, () => { tlsSocket.destroy(); fail('TLS-first timed out waiting for Connection Confirm'); });
            tlsSocket.once('error', (err) => fail(`TLS handshake failed: ${err.message}`));
            tlsSocket.once('secureConnect', () => {
                console.log(`${logPrefix} mode B ✓ TLS established (${tlsSocket.getProtocol()}); sending CR inside TLS`);
                tlsSocket.write(x224Request);
                tlsSocket.once('data', (x224Response) => {
                    const cc = Buffer.from(x224Response);
                    console.log(`${logPrefix} mode B ✓ X.224 Connection Confirm (${cc.length} bytes)`);
                    if (cc[5] === 0xd0 /* CC */ && cc.length >= 19) {
                        console.log(`${logPrefix} negotiated protocol=${cc.readUInt32LE(15)} (mode B)`);
                    }
                    tlsSocket.removeAllListeners('timeout');
                    try {
                        const peerCert = tlsSocket.getPeerCertificate(true);
                        const certChain = extractCertChain(peerCert);
                        console.log(`${logPrefix} mode B ✓ Extracted ${certChain.length} certificate(s)`);
                        ok({ x224Response: cc, certChain, tlsSocket, pending: [] });
                    } catch (err) {
                        fail(`Certificate extraction failed: ${err.message}`);
                    }
                });
            });
        });
    }

    return attemptDance().catch(() => attemptTlsFirst());
}

/**
 * Extract the full certificate chain from a Node.js peer certificate object.
 * Returns an array of DER-encoded certificate buffers.
 */
function extractCertChain(peerCert) {
    const certs = [];
    if (!peerCert || !peerCert.raw) return certs;

    const seen = new Set();
    let current = peerCert;
    while (current && current.raw) {
        const fingerprint = current.fingerprint256 || current.raw.toString('hex');
        if (seen.has(fingerprint)) break;
        seen.add(fingerprint);
        certs.push(Buffer.from(current.raw));

        // Follow issuerCertificate chain
        if (current.issuerCertificate && current.issuerCertificate !== current) {
            current = current.issuerCertificate;
        } else {
            break;
        }
    }
    return certs;
}

// ────────────────────────────────────────────────────
// Bidirectional Relay: WebSocket ↔ TLS
// ────────────────────────────────────────────────────

/**
 * Rewrite the RDP Negotiation Request inside an X.224 Connection Request so the
 * client asks for SSL (protocol 1) only. Windows 2022 runners otherwise select
 * RDSTLS (protocol 8) when the client offers it, which IronRDP's RDCleanPath
 * WebSocket client does not handle in this proxy-relay path: it tears the
 * connection down as soon as the negotiation confirms RDSTLS.
 *
 * Scans the trailing RDP Negotiation Request structure (type 0x01, length 8) and
 * replaces requestedProtocols with PROTOCOL_SSL. Non-matching CRs pass through.
 *
 * @param {Buffer} cr - X.224 Connection Request bytes
 * @returns {Buffer} possibly-rewritten Connection Request
 */
function forceSslNegotiation(cr) {
    if (cr.length < 8) return cr;
    const tail = cr.length - 8;
    // RDP Negotiation Request: type(1)=0x01, flags(1), length(2)=8, requestedProtocols(4)
    if (cr[tail] !== 0x01 || cr.readUInt16BE(tail + 2) !== 8) return cr;
    const copy = Buffer.from(cr);
    const requested = cr.readUInt32LE(tail + 4);
    copy.writeUInt32LE(0x00000001, tail + 4); // PROTOCOL_SSL
    console.log(`Force SSL negotiation: requestedProtocols=0x${(requested >>> 0).toString(16)} → 0x1`);
    return copy;
}

/**
 * Set up bidirectional relay between a WebSocket and a TLS socket.
 *
 * Browser (WASM) → WebSocket → Proxy → TLS → RDP Server
 * RDP Server → TLS → Proxy → WebSocket → Browser (WASM)
 *
 * @param {WebSocket} ws - The WebSocket connection to the browser
 * @param {tls.TLSSocket} tlsSocket - The TLS connection to the RDP server
 */
function setupRelay(ws, tlsSocket) {
    let wsBytesForwarded = 0;
    let tlsBytesForwarded = 0;

    const logPrefix = '[relay]';

    // TLS → WebSocket (RDP server → browser)
    tlsSocket.on('data', (data) => {
        tlsBytesForwarded += data.length;
        try {
            if (ws.readyState === 1 /* OPEN */) {
                ws.send(data);
            }
        } catch (err) {
            console.error(`${logPrefix} TLS→WS write error:`, err.message);
        }
    });

    // WebSocket → TLS (browser → RDP server)
    ws.on('message', (data) => {
        wsBytesForwarded += data.length;
        try {
            if (!tlsSocket.destroyed) {
                tlsSocket.write(data);
            }
        } catch (err) {
            console.error(`${logPrefix} WS→TLS write error:`, err.message);
        }
    });

    // Cleanup on close
    const cleanup = (source) => {
        console.log(`${logPrefix} ${source} closed — WS→TLS: ${wsBytesForwarded} bytes, TLS→WS: ${tlsBytesForwarded} bytes`);
        if (!tlsSocket.destroyed) tlsSocket.destroy();
        if (ws.readyState === 1) {
            try { ws.close(); } catch (_) {}
        }
    };

    tlsSocket.on('end', () => cleanup('TLS'));
    tlsSocket.on('error', (err) => {
        console.error(`${logPrefix} TLS error:`, err.message);
        cleanup('TLS (error)');
    });

    ws.on('close', () => cleanup('WebSocket'));
    ws.on('error', (err) => {
        console.error(`${logPrefix} WebSocket error:`, err.message);
        cleanup('WebSocket (error)');
    });
}

// ────────────────────────────────────────────────────
// Main Handler: Process a WebSocket connection
// ────────────────────────────────────────────────────

/**
 * Handle a new WebSocket connection from the browser's WASM RDP client.
 *
 * Protocol:
 * 1. Receive RDCleanPath Request (ASN.1 DER binary message)
 * 2. Parse destination, X.224 connection request
 * 3. TCP connect to RDP server, send X.224, receive X.224 confirm
 * 4. TLS handshake, extract server certificates
 * 5. Send RDCleanPath Response back to browser
 * 6. Bidirectional relay: WebSocket ↔ TLS
 *
 * @param {WebSocket} ws - The WebSocket connection
 */
function handleConnection(ws) {
    console.log('New WebSocket connection');

    // Wait for the first binary message: RDCleanPath Request
    ws.once('message', async (data) => {
        try {
            const requestData = Buffer.isBuffer(data) ? data : Buffer.from(data);
            console.log(`Received RDCleanPath request (${requestData.length} bytes)`);

            // Step 1: Parse RDCleanPath request
            const request = parseRDCleanPathRequest(requestData);
            console.log(`RDCleanPath Request → destination: ${request.destination}`);

            // Step 2: Parse destination
            const { host, port } = parseDestination(request.destination);
            console.log(`Connecting to RDP server at ${host}:${port}`);

            // Step 3-5: TCP + X.224 + TLS + Certs
            const cr = forceSslNegotiation(request.x224ConnectionRequest);
            const { x224Response, certChain, tlsSocket } = await performRDPHandshake(
                host,
                port,
                cr
            );

            // Step 6: Build and send RDCleanPath response
            const serverAddr = `${host}:${port}`;
            const responsePdu = buildRDCleanPathResponse(serverAddr, x224Response, certChain);
            console.log(`✓ Sending RDCleanPath response (${responsePdu.length} bytes) to browser`);
            ws.send(responsePdu);

            console.log('✓ RDCleanPath handshake complete — starting bidirectional relay');

            // Step 7: Bidirectional relay
            setupRelay(ws, tlsSocket);

        } catch (err) {
            console.error('RDCleanPath handshake error:', err.message);

            // Try to send error response to client
            try {
                const errorPdu = buildRDCleanPathError(1, 502);
                ws.send(errorPdu);
            } catch (_) {}

            try { ws.close(); } catch (_) {}
        }
    });

    ws.on('error', (err) => {
        console.error('WebSocket error:', err.message);
    });
}

module.exports = {
    handleConnection,
    parseRDCleanPathRequest,
    buildRDCleanPathResponse,
    buildRDCleanPathError,
    parseDestination,
    performRDPHandshake,
    forceSslNegotiation,
    setupRelay,
};
